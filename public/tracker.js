// tracker.js (Updated with Strategic Triggers)

const EngagementTracker = (function () {

    // --- Configuration and State ---
    let config = {};
    let state = {
        sessionId: null,
        events: [],
        sessionStartTime: null,
        pageViewStartTime: null,
        backendUrl: 'https://test.com/suggestions/offer-suggestion',
        isPopupVisible: false,
        // Timer for tracking hesitation on a single page
        hesitationTimer: null,
        // Flag to ensure exit intent only fires once per page load
        exitIntentFired: false
    };

    // --- Constants for configurable logic ---
    const HESITATION_DELAY_MS = 60000; // 60 seconds

    // --- Private Methods ---

    function init(userConfig) {
        config = userConfig;
        loadSession();
        attachEventListeners();
        trackPageView();
    }

    function loadSession() {
        // ... (No changes here, code is the same)
        const storedSessionId = sessionStorage.getItem('et_sessionId');
        if (storedSessionId) {
            state.sessionId = storedSessionId;
            state.events = JSON.parse(sessionStorage.getItem('et_events')) || [];
            state.sessionStartTime = parseInt(sessionStorage.getItem('et_sessionStartTime'), 10);
        } else {
            state.sessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            state.sessionStartTime = Date.now();
            sessionStorage.setItem('et_sessionId', state.sessionId);
            sessionStorage.setItem('et_sessionStartTime', state.sessionStartTime);
            sessionStorage.setItem('et_events', JSON.stringify([]));
        }
    }

    function saveEvents() {
        sessionStorage.setItem('et_events', JSON.stringify(state.events));
    }

    function addEvent(eventData) {
        eventData.timestamp = new Date().toISOString();
        state.events.push(eventData);
        saveEvents();
    }

    function attachEventListeners() {
        document.body.addEventListener('click', handleGlobalClick, true);
        window.addEventListener('beforeunload', updateLastPageViewTime);
        // Add listener for exit intent
        document.documentElement.addEventListener('mouseleave', handleExitIntent);
    }

    async function getCartItemCount() {
        // ... (No changes here, code is the same)
        try {
            const response = await fetch('/cart.js');
            if (!response.ok) return 0;
            const cart = await response.json();
            return cart.item_count || 0;
        } catch (error) {
            console.error("EngagementTracker: Could not fetch cart count.", error);
            return 0;
        }
    }

    function updateLastPageViewTime() {
        // ... (No changes here, code is the same)
        if (!state.pageViewStartTime) return;
        const timeOnPage = Math.round((Date.now() - state.pageViewStartTime) / 1000);
        for (let i = state.events.length - 1; i >= 0; i--) {
            if (state.events[i].type === 'page_view' && state.events[i].time_on_page === 0) {
                state.events[i].time_on_page = timeOnPage;
                break;
            }
        }
        saveEvents();
    }

    // ★ MODIFIED ★: This function now contains the core logic for page-based triggers.
    function trackPageView() {
        updateLastPageViewTime();

        // Always clear any previous hesitation timer when navigating to a new page.
        if (state.hesitationTimer) {
            clearTimeout(state.hesitationTimer);
        }
        // Reset exit intent flag for the new page.
        state.exitIntentFired = false;

        state.pageViewStartTime = Date.now();
        const currentPageType = window.location.pathname;
        const eventData = { type: 'page_view', page: window.location.pathname, time_on_page: 0 };
        addEvent(eventData);

        // --- STRATEGIC TRIGGER LOGIC ---

        // TRIGGER 1: Critical Page View. User is on the cart page, a key decision moment.
        if (currentPageType === 'cart') {
            console.log("Strategy: Triggering server check due to Cart Page visit.");
            sendDataToServer();
        }

        // TRIGGER 2: Hesitation on Product Page. User might have questions.
        if (currentPageType === 'product') {
            console.log(`Strategy: Starting ${HESITATION_DELAY_MS / 1000}s hesitation timer for product page.`);
            state.hesitationTimer = setTimeout(() => {
                console.log("Strategy: Triggering server check due to product page hesitation.");
                addEvent({ type: 'hesitation', on_page: window.location.pathname });
                sendDataToServer();
            }, HESITATION_DELAY_MS);
        }
    }

    // ★ MODIFIED ★: This function now only triggers on the most important clicks.
    function handleGlobalClick(e) {
        const addToCartButton = e.target.closest('[name="add"], [data-track-click="add-to-cart"]');
        const form = e.target.closest('form[action*="/cart/add"]');
        let clickType = null;

        if (addToCartButton || form) clickType = 'add_to_cart';
        else if (e.target.closest('[href*="/account/wishlist"]')) clickType = 'wishlist';
        else if (e.target.closest('.filter-element')) clickType = 'filter';

        if (clickType) {
            addEvent({ type: 'click', element: clickType });

            // --- STRATEGIC TRIGGER LOGIC ---
            // TRIGGER 3: High-Intent Click. Adding to cart is the strongest signal.
            if (clickType === 'add_to_cart') {
                console.log("Strategy: Triggering server check due to 'Add to Cart' click.");
                // Use a small delay to allow Shopify's cart API to update.
                setTimeout(() => sendDataToServer(), 500);
            }
        }
    }

    // ★ NEW FUNCTION ★: Handles the exit-intent logic.
    function handleExitIntent(e) {
        // Check if mouse is leaving the top of the viewport and we haven't already fired.
        if (e.clientY <= 0 && !state.exitIntentFired) {
            state.exitIntentFired = true; // Prevent it from firing multiple times

            // --- STRATEGIC TRIGGER LOGIC ---
            // TRIGGER 4: Exit Intent. A last chance to engage the user.
            console.log("Strategy: Triggering server check due to exit intent.");
            addEvent({ type: 'exit_intent' });
            sendDataToServer();
        }
    }

    async function sendDataToServer() {
        if (state.isPopupVisible) return;

        const cartItems = await getCartItemCount();
        const timeOnSite = Math.round((Date.now() - state.sessionStartTime) / 1000);
        const eventsToSend = state.events.slice(-15);

        const payload = {
            session: {
                events: eventsToSend,
                current_page: window.location.pathname,
                cart_items: cartItems,
                time_on_site: timeOnSite
            }
        };

        console.log("EngagementTracker: Sending data to server", payload);

        try {
            // ... (rest of the function is unchanged)
            const response = await fetch(state.backendUrl, { /* ... */ });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const result = await response.json();
            console.log("EngagementTracker: Received response", result);
            if (result.showMessage && result.message) {
                showPopup(result.message);
            }
        } catch (error) {
            console.error("EngagementTracker: Error sending data to server:", error);
        }
    }

    function showPopup(message) {
        // ... (No changes here, code is the same)
        if (state.isPopupVisible || document.getElementById('et-popup-overlay')) return;
        state.isPopupVisible = true;
        addEvent({ type: 'message_shown', message: message });

        // ... (DOM creation for popup is unchanged)
    }

    return {
        init: function (userConfig) {
            // ... (No changes here, code is the same)
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => init(userConfig));
            } else {
                init(userConfig);
            }
        }
    };

})();