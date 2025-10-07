// tracker.js (Updated with Strategic Triggers, Robustness, and Debug Logging)

const EngagementTracker = (function () {

    // --- Configuration and State ---
    let config = {};
    let state = {
        sessionId: null,
        events: [],
        sessionStartTime: null,
        pageViewStartTime: null,
        backendUrl: '', // Will be set dynamically in init
        isPopupVisible: false,
        hesitationTimer: null,
        exitIntentFired: false,
        isRequestPending: false, // Prevents concurrent requests
        lastRequestTimestamp: 0  // For cooldown
    };

    // --- Constants for configurable logic ---
    const HESITATION_DELAY_MS = 60000; // 60 seconds
    const COOLDOWN_PERIOD_MS = 30000; // 30 seconds between server calls

    // A helper for clean console logs
    function log(...args) {
        console.log('[ET]', ...args);
    }
    function errorLog(...args) {
        console.error('[ET]', ...args);
    }

    // --- Private Methods ---

    function init(userConfig) {
        log('Tracker Initializing...');
        config = userConfig;
        
        // ★ DYNAMICALLY SET BACKEND URL ★
        try {
            const baseUrl = new URL(config.scriptUrl).origin;
            state.backendUrl = `${baseUrl}/offer-suggestion`;
            log('Backend URL configured to:', state.backendUrl);
        } catch (e) {
            errorLog('Invalid scriptUrl provided in config. Cannot set backend URL.', config.scriptUrl);
            return; // Stop execution if config is broken
        }

        loadSession();
        attachEventListeners();
        trackPageView();
        log('Tracker Initialized Successfully.');
    }

    function loadSession() {
        const storedSessionId = sessionStorage.getItem('et_sessionId');
        if (storedSessionId) {
            state.sessionId = storedSessionId;
            state.events = JSON.parse(sessionStorage.getItem('et_events')) || [];
            state.sessionStartTime = parseInt(sessionStorage.getItem('et_sessionStartTime'), 10);
            log('Resumed session with ID:', state.sessionId);
        } else {
            state.sessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            state.sessionStartTime = Date.now();
            sessionStorage.setItem('et_sessionId', state.sessionId);
            sessionStorage.setItem('et_sessionStartTime', state.sessionStartTime);
            sessionStorage.setItem('et_events', JSON.stringify([]));
            log('Started new session with ID:', state.sessionId);
        }
    }

    function saveEvents() {
        sessionStorage.setItem('et_events', JSON.stringify(state.events));
    }

    function addEvent(eventData) {
        eventData.timestamp = new Date().toISOString();
        state.events.push(eventData);
        saveEvents();
        log('Event Added:', eventData.type, eventData);
    }

    function attachEventListeners() {
        document.body.addEventListener('click', handleGlobalClick, true);
        window.addEventListener('beforeunload', updateLastPageViewTime);
        document.documentElement.addEventListener('mouseleave', handleExitIntent);
        log('Event listeners attached.');
    }

    async function getCartItemCount() {
        try {
            const response = await fetch('/cart.js');
            if (!response.ok) {
                log('Could not fetch cart.js, assuming 0 items.');
                return 0;
            }
            const cart = await response.json();
            log('Fetched cart count:', cart.item_count);
            return cart.item_count || 0;
        } catch (error) {
            errorLog('Could not fetch cart count.', error);
            return 0;
        }
    }

    function updateLastPageViewTime() {
        if (!state.pageViewStartTime) return;
        const timeOnPage = Math.round((Date.now() - state.pageViewStartTime) / 1000);
        const lastEvent = state.events[state.events.length - 1];

        if (lastEvent && lastEvent.type === 'page_view' && lastEvent.time_on_page === 0) {
            lastEvent.time_on_page = timeOnPage;
            log(`Updated time on page for ${lastEvent.page} to ${timeOnPage}s.`);
            saveEvents();
        }
    }

    function trackPageView() {
        updateLastPageViewTime();

        if (state.hesitationTimer) {
            log('New page view. Clearing previous hesitation timer.');
            clearTimeout(state.hesitationTimer);
        }
        state.exitIntentFired = false;
        state.pageViewStartTime = Date.now();
        const currentPath = window.location.pathname;
        addEvent({ type: 'page_view', page: currentPath, time_on_page: 0 });

        // --- STRATEGIC TRIGGER LOGIC ---

        // ★ ROBUST PAGE DETECTION ★
        if (currentPath.includes('/cart')) {
            log("Strategy: On Cart Page. Triggering server check.");
            sendDataToServer();
        }

        // ★ ROBUST PAGE DETECTION ★
        if (currentPath.includes('/products/')) {
            log(`Strategy: On Product Page. Starting ${HESITATION_DELAY_MS / 1000}s hesitation timer.`);
            state.hesitationTimer = setTimeout(() => {
                log("Strategy: Hesitation timer fired. Triggering server check.");
                addEvent({ type: 'hesitation', on_page: currentPath });
                sendDataToServer();
            }, HESITATION_DELAY_MS);
        }
    }

    function handleGlobalClick(e) {
        log('Global click detected on:', e.target);
        const addToCartButton = e.target.closest('[name="add"], [type="submit"], .add-to-cart');
        const form = e.target.closest('form[action*="/cart/add"]');
        let clickType = null;

        if (addToCartButton || form) {
            clickType = 'add_to_cart';
        }

        if (clickType) {
            addEvent({ type: 'click', element: clickType });
            // TRIGGER 3: High-Intent Click
            if (clickType === 'add_to_cart') {
                log("Strategy: 'Add to Cart' click detected. Triggering server check after 500ms delay.");
                setTimeout(() => sendDataToServer(), 500);
            }
        }
    }

    function handleExitIntent(e) {
        if (e.clientY <= 0 && !state.exitIntentFired) {
            state.exitIntentFired = true;
            log("Strategy: Exit intent detected. Triggering server check.");
            addEvent({ type: 'exit_intent' });
            sendDataToServer();
        }
    }

    async function sendDataToServer() {
        const now = Date.now();
        if (state.isPopupVisible) {
            log('Aborting send: Popup is already visible.');
            return;
        }
        if (state.isRequestPending) {
            log('Aborting send: A request is already pending.');
            return;
        }
        if (now - state.lastRequestTimestamp < COOLDOWN_PERIOD_MS) {
            log(`Aborting send: Cooldown active. ${Math.round((COOLDOWN_PERIOD_MS - (now - state.lastRequestTimestamp))/1000)}s remaining.`);
            return;
        }

        log('Pre-flight checks passed. Preparing to send data...');
        state.isRequestPending = true;
        state.lastRequestTimestamp = now;

        const cartItems = await getCartItemCount();
        const timeOnSite = Math.round((Date.now() - state.sessionStartTime) / 1000);
        
        const payload = {
            session: {
                events: state.events,
                currentPage: window.location.pathname,
                cart: { itemCount: cartItems },
                timeOnSite: timeOnSite
            }
        };

        log("Sending data to server:", payload);

        try {
            const response = await fetch(state.backendUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            log("Received response from server:", result);

            if (result.showMessage && result.message) {
                showPopup(result.message);
            }
        } catch (error) {
            errorLog("Error sending data to server:", error);
        } finally {
            state.isRequestPending = false;
            log('Request finished.');
        }
    }

    function showPopup(message) {
        if (state.isPopupVisible || document.getElementById('et-popup-overlay')) {
            log('Popup show aborted, one already exists.');
            return;
        }
        log('Showing popup with message:', message);
        state.isPopupVisible = true;
        addEvent({ type: 'message_shown', message: message });

        const overlay = document.createElement('div');
        // ... (rest of popup creation code is fine) ...
    }

    return {
        init: function (userConfig) {
            // Wait for the DOM to be ready before starting
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => init(userConfig));
            } else {
                init(userConfig);
            }
        }
    };

})();