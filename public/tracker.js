window.EngagementTracker = (function () {
    let config = {}
    let state = {
        sessionId: null,
        events: [],
        sessionStartTime: null,
        pageViewStartTime: null,
        backendUrl: '',
        isPopupVisible: false,
        hesitationTimer: null, // For product pages
        exitIntentFired: false,
        isRequestPending: false,
        lastRequestTimestamp: 0,
        modalBackgroundColor: '#FFFFFF',
        modalTextColor: '#000000',
        // --- NEW STATE for Cart Drawer ---
        isCartOpen: false,
        cartHesitationTimer: null
    }

    const HESITATION_DELAY_MS = 60000 // 60 seconds
    const CART_INACTIVITY_DELAY_MS = 90000 // 90 seconds
    const COOLDOWN_PERIOD_MS = 30000 // 30 seconds between server calls

    function log(...args) {
        console.log('[event tracker]', ...args)
    }
    function errorLog(...args) {
        console.error('[event tracker]', ...args)
    }

    function init(userConfig) {
        log('Tracker Initializing...')
        config = userConfig
        try {
            const baseUrl = new URL(config.scriptUrl).origin
            state.backendUrl = `${baseUrl}/suggestions/offer-suggestion`
            state.modalBackgroundColor = userConfig.modalBackgroundColor || '#FFFFFF'
            state.modalTextColor = userConfig.modalTextColor || '#000000'
            log('Backend URL configured to:', state.backendUrl)
        }
        catch (e) {
            errorLog('Invalid scriptUrl provided in config. Cannot set backend URL.', config.scriptUrl)
            return // Stop execution if config is broken
        }
        loadSession()
        attachEventListeners()
        trackPageView()
        log('Tracker Initialized Successfully.')
    }

    function loadSession() {
        const storedSessionId = sessionStorage.getItem('et_sessionId')
        if (storedSessionId) {
            state.sessionId = storedSessionId
            state.events = JSON.parse(sessionStorage.getItem('et_events')) || []
            state.sessionStartTime = parseInt(sessionStorage.getItem('et_sessionStartTime'), 10)
            log('Resumed session with ID:', state.sessionId)
        }
        else {
            state.sessionId = `${Date.now()}-${Math.random()}`
            state.sessionStartTime = Date.now()
            sessionStorage.setItem('et_sessionId', state.sessionId)
            sessionStorage.setItem('et_sessionStartTime', state.sessionStartTime)
            sessionStorage.setItem('et_events', JSON.stringify([]))
            log('Started new session with ID:', state.sessionId)
        }
    }

    function saveEvents() {
        sessionStorage.setItem('et_events', JSON.stringify(state.events))
    }

    function addEvent(eventData) {
        eventData.timestamp = new Date().toISOString()
        state.events.push(eventData)
        saveEvents()
        log('Event Added:', eventData.type, eventData)
    }

    async function getSuggestion() {
        const now = Date.now()
        if (state.isPopupVisible || state.isRequestPending || now - state.lastRequestTimestamp < COOLDOWN_PERIOD_MS) return
        state.isRequestPending = true
        state.lastRequestTimestamp = now

        const cart = await getCart()
        const timeOnSite = Math.round((Date.now() - state.sessionStartTime) / 1000)

        const session = {
            events: state.events,
            currentPage: window.location.pathname,
            cart,
            timeOnSite: timeOnSite
        }

        log("Analyzing session for possible suggestion...", session)

        try {
            const response = await fetch(state.backendUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(session)
            })

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
            const result = await response.json()
            log("Received response from server:", result)
            if (result.showMessage && result.message) showPopup(result.message)
        }
        catch (error) {
            errorLog("Error sending data to server:", error)
        }
        state.isRequestPending = false
    }

    function showPopup(message) {
        if (state.isPopupVisible || document.getElementById('et-popup-overlay')) return
        state.isPopupVisible = true
        addEvent({ type: 'message_shown', message: message })

        // --- Overlay ---
        const overlay = document.createElement('div')
        overlay.id = 'et-popup-overlay'
        Object.assign(overlay.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: '9999',
            transition: 'opacity 0.3s ease',
            opacity: '0'
        })

        // --- Popup box ---
        const popup = document.createElement('div')
        Object.assign(popup.style, {
            background: state.modalBackgroundColor,
            color: state.modalTextColor,
            borderRadius: '12px',
            padding: '24px 28px',
            maxWidth: '400px',
            width: '80%',
            boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
            position: 'relative',
            textAlign: 'center',
            fontFamily: 'sans-serif',
            fontSize: '16px',
            lineHeight: '1.4'
        })

        // --- Close button ---
        const closeBtn = document.createElement('button')
        closeBtn.textContent = '×'
        Object.assign(closeBtn.style, {
            position: 'absolute',
            top: '8px',
            right: '12px',
            background: 'none',
            border: 'none',
            fontSize: '22px',
            fontWeight: 'bold',
            cursor: 'pointer',
            color: state.modalTextColor,
            lineHeight: '1'
        })

        const messageEl = document.createElement('div')
        messageEl.textContent = message

        function closePopup() {
            state.isPopupVisible = false
            overlay.style.opacity = '0'
            setTimeout(() => overlay.remove(), 300)
        }
        
        closeBtn.addEventListener('click', closePopup)
        // Close on overlay click, but not on popup click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closePopup();
            }
        });

        popup.appendChild(closeBtn)
        popup.appendChild(messageEl)
        overlay.appendChild(popup)
        document.body.appendChild(overlay)
        requestAnimationFrame(() => {
            overlay.style.opacity = '1'
        })
    }

    // --- MODIFIED & NEW TRACKER FUNCTIONS ---

    function attachEventListeners() {
        document.body.addEventListener('click', handleGlobalClick, true)
        window.addEventListener('beforeunload', updateLastPageViewTime)
        document.documentElement.addEventListener('mouseleave', handleExitIntent)
        observeCartDrawerAndBody(); // <-- NEW: Start the observer
        log('Event listeners attached.')
    }

    // --- NEW: Function to check if cart drawer is open using a list of selectors ---
    function isCartDrawerOpen() {
        const cartSelectors = [
            'cart-drawer[open]', '#CartDrawer[open]', '#CartDrawer.is-open',
            '.drawer.drawer--cart.is-open', '.drawer--cart.is-open', '.cart-drawer.is-open',
            '.ajaxcart.is-visible', '.cart-popup-wrapper.is-active', '[data-cart-popup].is-active',
            '#CartPopup.is-active', 'cart-notification[open]', 'details[id*="Cart"][open]',
            'details[id*="Drawer"][open]', '.site-header__cart--active', '.js-drawer-open'
        ];
        return cartSelectors.some(selector => document.querySelector(selector));
    }

    // --- NEW: MutationObserver to watch for cart drawer changes ---
    function observeCartDrawerAndBody() {
        const observer = new MutationObserver(() => {
            const isNowOpen = isCartDrawerOpen();

            if (isNowOpen && !state.isCartOpen) {
                // Cart has just opened
                state.isCartOpen = true;
                log('Strategy: Cart drawer opened.');
                addEvent({ type: 'cart_opened' });

                getSuggestion(); // Initial check for high-value cart

                if (state.cartHesitationTimer) clearTimeout(state.cartHesitationTimer);
                state.cartHesitationTimer = setTimeout(() => {
                    log("Strategy: Cart inactivity timer fired. Triggering server check for discount offer.");
                    addEvent({ type: 'cart_hesitation' });
                    getSuggestion();
                }, CART_INACTIVITY_DELAY_MS);

            } else if (!isNowOpen && state.isCartOpen) {
                // Cart has just closed
                state.isCartOpen = false;
                log('Cart drawer closed.');
                addEvent({ type: 'cart_closed' });
                if (state.cartHesitationTimer) {
                    clearTimeout(state.cartHesitationTimer);
                    log('Cart inactivity timer cleared.');
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        log('Cart drawer observer is now active.');
    }

    async function getCart() {
        try {
            const response = await fetch('/cart.js')
            if (!response.ok) return { itemCount: 0, items: [] };
            const cart = await response.json()
            return { itemCount: cart.item_count || 0, items: cart.items || [] }
        }
        catch (error) {
            errorLog('Could not fetch cart data.', error)
            return { itemCount: 0, items: [] };
        }
    }

    function updateLastPageViewTime() {
        if (!state.pageViewStartTime) return
        const timeOnPage = Math.round((Date.now() - state.pageViewStartTime) / 1000)
        const lastEvent = state.events[state.events.length - 1]

        if (lastEvent && lastEvent.type === 'page_view' && lastEvent.time_on_page === 0) {
            lastEvent.time_on_page = timeOnPage
            log(`Updated time on page for ${lastEvent.page} to ${timeOnPage}s.`)
            saveEvents()
        }
    }

    function trackPageView() {
        updateLastPageViewTime()

        if (state.hesitationTimer) {
            log('New page view. Clearing previous page hesitation timer.')
            clearTimeout(state.hesitationTimer)
        }
        state.exitIntentFired = false
        state.pageViewStartTime = Date.now()
        const currentPath = window.location.pathname
        addEvent({ type: 'page_view', page: currentPath, time_on_page: 0 })

        // --- STRATEGIC TRIGGER LOGIC ---
        // (The cart logic is now handled by the MutationObserver)
        if (currentPath.includes('/products/')) {
            log(`Strategy: On Product Page. Starting ${HESITATION_DELAY_MS / 1000}s hesitation timer.`)
            state.hesitationTimer = setTimeout(() => {
                log("Strategy: Product hesitation timer fired. Triggering server check.")
                addEvent({ type: 'hesitation', on_page: currentPath })
                getSuggestion()
            }, HESITATION_DELAY_MS)
        }
    }

    // --- MODIFIED handleGlobalClick: Added filter detection ---
    function handleGlobalClick(e) {
        const filterElement = e.target.closest('a[href*="?filter"], .facet-filters__field input, .filter-group input, .collection-sidebar__filter input');
        
        if (filterElement) {
            const filterDetail = filterElement.closest('label')?.textContent.trim() || filterElement.name || filterElement.id;
            addEvent({ type: 'click', element: 'filter', detail: filterDetail });

            const sixtySecondsAgo = new Date(Date.now() - 60000).toISOString();
            const recentFilterClicks = state.events.filter(event =>
                event.type === 'click' && event.element === 'filter' && event.timestamp > sixtySecondsAgo
            ).length;

            if (recentFilterClicks >= 3) {
                log(`Strategy: Filter confusion detected (${recentFilterClicks} clicks). Triggering server check.`);
                setTimeout(() => getSuggestion(), 250);
            }
            return; // Exit after processing filter click
        }

        const addToCartButton = e.target.closest('[name="add"], [type="submit"], .add-to-cart, form[action*="/cart/add"] button[type="submit"]');
        const form = e.target.closest('form[action*="/cart/add"]');

        if (addToCartButton || form) {
            addEvent({ type: 'click', element: 'add_to_cart' });
            log("Strategy: 'Add to Cart' click detected. Triggering server check after 500ms delay to allow cart to update.");
            setTimeout(() => getSuggestion(), 500);
        }
    }

    function handleExitIntent(e) {
        if (e.clientY <= 0 && !state.exitIntentFired) {
            state.exitIntentFired = true
            log("Strategy: Exit intent detected. Triggering server check.")
            addEvent({ type: 'exit_intent' })
            getSuggestion()
        }
    }

    return {
        init: function (userConfig) {
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init(userConfig));
            else init(userConfig); 
        }
    }
})();