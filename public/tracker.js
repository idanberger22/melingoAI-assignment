/* tracker.js */
window.EngagementTracker = (function () {
    // ========================
    // CONFIG + STATE
    // ========================
    let config = {};
    let state = {
        sessionId: null,
        events: [],
        sessionStartTime: null,
        pageViewStartTime: null,
        backendUrl: "",
        isPopupVisible: false,
        isRequestPending: false,
        lastRequestTimestamp: 0,
        analysesThisSession: 0,
        debug: true,

        // Cart state
        isCartOpen: false,
        lastKnownCartCount: 0,
        postAtcTimer: null,
        cartInactivityTimer: null,

        // PDP hesitation
        hesitationTimer: null,

        // Confusion detector
        filterClicksWindow: [], // timestamps of filter/search actions

        // Idle tracking
        lastActivityTs: Date.now(),

        // Modal UI colors
        modalBackgroundColor: "#FFFFFF",
        modalTextColor: "#000000",
    };

    // ========================
    // THRESHOLDS (tweakable)
    // ========================
    const HESITATION_DELAY_MS = 60_000;             // PDP hesitation
    const CART_INACTIVITY_DELAY_MS = 60_000;        // Drawer open but idle
    const POST_ATC_NOPROGRESS_DELAY_MS = 60_000;    // After Add-To-Cart, no progress
    const CONFUSION_WINDOW_MS = 25_000;             // Lookback window for filters/search
    const CONFUSION_MIN_ACTIONS = 5;                // Actions within window to trigger
    const COOLDOWN_PERIOD_MS = 30_000;              // Min gap between analyses
    const MAX_ANALYSES_PER_SESSION = 6;             // Hard cap per session
    const EVENTS_MAX_LENGTH = 50;                    // Max length of events array

    // ========================
    // HELPERS
    // ========================
    function log(...args) { if (state.debug) console.log("[event tracker]", ...args); }
    function errorLog(...args) { if (state.debug) console.error("[event tracker]", ...args); }

    async function getCart() {
        try {
            const r = await fetch("/cart.js", { credentials: "same-origin" });
            if (!r.ok) return { itemCount: 0, items: [], total_price: 0 };
            const c = await r.json();
            return {
                itemCount: c.item_count || 0,
                items: c.items || [],
                total_price: c.total_price || 0,
            };
        } catch (e) {
            errorLog("Could not fetch cart data.", e);
            return { itemCount: 0, items: [], total_price: 0 };
        }
    }

    function nowIso() { return new Date().toISOString(); }

    function visible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0" &&
            rect.width > 0 &&
            rect.height > 0
        );
    }

    function saveEvents() {
        try {
            sessionStorage.setItem("et_events", JSON.stringify(state.events));
        } catch { }
    }

    function addEvent(eventData) {
        eventData.timestamp = nowIso();
        state.events.push(eventData);
        if (state.events.length > EVENTS_MAX_LENGTH) state.events.shift();
        saveEvents();
        log("Event Added:", eventData.type, eventData);
    }

    function classifyPage() {
        const p = location.pathname.toLowerCase();
        const body = document.body || {};
        const cls = (body.className || "") + " " + Array.from(body.classList || []).join(" ");

        if (p.includes("/products/") || cls.includes("template-product")) return "pdp";
        if (p.includes("/collections/") || cls.includes("template-collection")) return "plp";
        if (p.includes("/search") || cls.includes("template-search")) return "search";
        if (p === "/cart" || cls.includes("template-cart")) return "cart";
        if (p.includes("/checkout")) return "checkout";
        return "other";
    }

    function canAnalyze() {
        if (!state.backendUrl) { errorLog("No backendUrl configured; aborting analysis"); return false; }
        if (state.analysesThisSession >= MAX_ANALYSES_PER_SESSION) { log("Analysis gated: max per session reached."); return false; }
        if (state.isRequestPending) { log("Analysis gated: request already pending."); return false; }
        if (Date.now() - state.lastRequestTimestamp < COOLDOWN_PERIOD_MS) { log("Analysis gated: cooldown period."); return false; }
        return true;
    }

    function buildSnapshot(reason, cart) {
        return {
            reason,
            currentPage: location.href,
            pageType: classifyPage(),
            cart: cart || { itemCount: 0, items: [], total_price: 0 },
            events: state.events,
            lastActivityTs: state.lastActivityTs,
        };
    }

    // ========================
    // INIT / SESSION MGMT
    // ========================
    function loadSession() {
        try {
            const storedSessionId = sessionStorage.getItem("et_sessionId");
            if (storedSessionId) {
                state.sessionId = storedSessionId;
                state.events =
                    JSON.parse(sessionStorage.getItem("et_events") || "[]") || [];
                state.sessionStartTime = parseInt(
                    sessionStorage.getItem("et_sessionStartTime") || String(Date.now()),
                    10
                );
                state.analysesThisSession = parseInt(
                    sessionStorage.getItem("et_analysesCount") || "0",
                    10
                );
                log("Resumed session:", state.sessionId);
            } else {
                state.sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                state.sessionStartTime = Date.now();
                sessionStorage.setItem("et_sessionId", state.sessionId);
                sessionStorage.setItem("et_sessionStartTime", String(state.sessionStartTime));
                sessionStorage.setItem("et_events", JSON.stringify([]));
                sessionStorage.setItem("et_analysesCount", "0");
                sessionStorage.setItem("et_msgShown", "0");
                log("Started new session:", state.sessionId);
            }
        } catch (e) {
            // If sessionStorage blocked, still operate best-effort
            errorLog("Session init failed; proceeding best-effort.", e);
            state.sessionId = state.sessionId || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            state.sessionStartTime = state.sessionStartTime || Date.now();
        }
    }

    function init(userConfig) {
        config = userConfig || {};
        try {
            const baseUrl = new URL(config.scriptUrl).origin;
            state.backendUrl = `${baseUrl}/suggestions/offer-suggestion`;
            state.modalBackgroundColor = config.modalBackgroundColor || "#FFFFFF";
            state.modalTextColor = config.modalTextColor || "#000000";
            state.debug = config.debug || false;
            log("Backend URL:", state.backendUrl);
        }
        catch (e) {
            errorLog("Invalid scriptUrl; aborting init.", config.scriptUrl, e);
            return;
        }

        loadSession();
        state.pageViewStartTime = Date.now();

        bindGlobalActivity();
        autoPageViewWatcher();
        trackPageView(); // initial page

        bindAtcInterceptors();
        bindWishlistAndFilter();
        bindExitIntent();
        observeCartDrawer();

        // Page unload
        window.addEventListener("beforeunload", () => {
            const dur = Date.now() - (state.pageViewStartTime || Date.now());
            addEvent({ type: "page_exit", durationMs: dur, pageType: classifyPage(), url: location.href });
            try {
                const payload = JSON.stringify({ sessionId: state.sessionId, recentEvents: state.events, at: nowIso() });
                navigator.sendBeacon && navigator.sendBeacon(state.backendUrl, payload);
            } catch { }
        });

        log("Tracker Initialized Successfully.");
    }

    // ========================
    // ACTIVITY + TIMERS
    // ========================
    function bindGlobalActivity() {
        const bump = () => (state.lastActivityTs = Date.now());
        ["click", "scroll", "keydown", "mousemove", "touchstart", "visibilitychange"].forEach(evt =>
            document.addEventListener(evt, bump, { passive: true })
        );
    }

    function startPdpHesitationTimer() {
        clearTimeout(state.hesitationTimer);
        if (classifyPage() !== "pdp") return;
        state.hesitationTimer = setTimeout(() => {
            addEvent({ type: "pdp_hesitation" });
            getSuggestion("pdp_hesitation");
        }, HESITATION_DELAY_MS);
    }

    function clearPdpHesitationTimer() {
        clearTimeout(state.hesitationTimer);
        state.hesitationTimer = null;
    }

    function startPostAtcIdleTimer() {
        clearTimeout(state.postAtcTimer);
        state.postAtcTimer = setTimeout(async () => {
            const cart = await getCart();
            if ((Date.now() - state.lastActivityTs) >= POST_ATC_NOPROGRESS_DELAY_MS && cart.itemCount >= 1) {
                addEvent({ type: "post_atc_idle", itemCount: cart.itemCount });
                getSuggestion("post_atc_idle");
            }
        }, POST_ATC_NOPROGRESS_DELAY_MS + 50);
    }

    function startCartInactivityTimer() {
        clearTimeout(state.cartInactivityTimer);
        state.cartInactivityTimer = setTimeout(async () => {
            if (!state.isCartOpen) return;
            const cart = await getCart();
            if (cart.itemCount > 0) {
                addEvent({ type: "cart_drawer_inactivity", itemCount: cart.itemCount });
                getSuggestion("cart_drawer_inactivity");
            }
        }, CART_INACTIVITY_DELAY_MS);
    }

    function resetCartInactivityTimer() {
        if (state.isCartOpen) startCartInactivityTimer();
    }

    // ========================
    // PAGE VIEWS
    // ========================
    function trackPageView() {
        const type = classifyPage();
        const previousDuration = Date.now() - (state.pageViewStartTime || Date.now());
        if (state.pageViewStartTime) {
            addEvent({ type: "page_time", pageType: type, durationMs: previousDuration, url: location.href });
        }
        state.pageViewStartTime = Date.now();

        addEvent({ type: "page_view", pageType: type, url: location.href, referrer: document.referrer || "" });

        // PDP hesitation timer
        clearPdpHesitationTimer();
        if (type === "pdp") startPdpHesitationTimer();

        // If actual /cart page (rare), consider high-value confidence nudge
        if (type === "cart") {
            getCart().then(cart => {
                state.lastKnownCartCount = cart.itemCount || 0;
                if (cart.itemCount >= 3) {
                    addEvent({ type: "cart_confidence_nudge", itemCount: cart.itemCount });
                    getSuggestion("high_value_cart_confidence");
                }
            });
        }
    }

    // SPA routing watcher (pushState/replaceState/popstate)
    function autoPageViewWatcher() {
        const push = history.pushState;
        const replace = history.replaceState;
        history.pushState = function () {
            push.apply(this, arguments);
            setTimeout(trackPageView, 0);
        };
        history.replaceState = function () {
            replace.apply(this, arguments);
            setTimeout(trackPageView, 0);
        };
        window.addEventListener("popstate", () => setTimeout(trackPageView, 0));
    }

    // ========================
    // CLICKS: ATC / WISHLIST / FILTERS / SEARCH
    // ========================
    function bindAtcInterceptors() {
        // 1) Form submissions to /cart/add
        document.addEventListener("submit", (e) => {
            try {
                const form = e.target;
                if (!(form instanceof HTMLFormElement)) return;
                const action = (form.getAttribute("action") || "").toLowerCase();
                if (action.includes("/cart/add")) {
                    addEvent({ type: "add_to_cart_form" });
                    startPostAtcIdleTimer();
                    clearPdpHesitationTimer();
                }
            } catch { }
        }, true);

        // 2) Buttons that look like ATC
        document.addEventListener("click", (e) => {
            const el = e.target.closest('button, [role="button"], input[type="submit"], a');
            if (!el) return;
            const txt = (el.innerText || el.value || "").toLowerCase();
            const nameAttr = (el.getAttribute("name") || "").toLowerCase();
            const idAttr = (el.id || "").toLowerCase();
            const dataAttrs = el.getAttributeNames().join(" ").toLowerCase();

            const isAtc =
                txt.includes("add to cart") || txt.includes("add-to-cart") || txt.includes("add") && txt.includes("cart") ||
                nameAttr === "add" ||
                idAttr.includes("add-to-cart") ||
                dataAttrs.includes("add-to-cart") || dataAttrs.includes("product-form__submit");

            if (isAtc) {
                addEvent({ type: "add_to_cart_click" });
                startPostAtcIdleTimer();
                clearPdpHesitationTimer();
            }
        }, true);
    }

    function bindWishlistAndFilter() {
        // Wishlist-like elements
        document.addEventListener("click", (e) => {
            const el = e.target.closest('button,[role="button"],a,[data-wishlist]');
            if (!el) return;
            const txt = (el.innerText || "").toLowerCase();
            const idAttr = (el.id || "").toLowerCase();
            const dataAttrs = el.getAttributeNames().join(" ").toLowerCase();
            const looksWishlist = txt.includes("wishlist") || idAttr.includes("wishlist") || dataAttrs.includes("wishlist");
            if (looksWishlist) addEvent({ type: "wishlist_click" });
        }, true);

        // Filters & sorters (commonly selects/checkboxes on PLP)
        document.addEventListener("change", (e) => {
            const el = e.target;
            if (!el) return;
            const name = (el.getAttribute("name") || "").toLowerCase();
            const idAttr = (el.id || "").toLowerCase();
            const cls = (el.className || "").toLowerCase();
            const isFilter =
                name.includes("filter") || idAttr.includes("filter") || cls.includes("filter") || name.includes("sort");
            if (isFilter) {
                addEvent({ type: "filter_change", control: name || idAttr || "unknown" });
                recordConfusionAction();
            }
        }, true);

        // Search submissions / typing
        document.addEventListener("submit", (e) => {
            const form = e.target;
            if (!(form instanceof HTMLFormElement)) return;
            const action = (form.getAttribute("action") || "").toLowerCase();
            const hasSearchInput = !!form.querySelector('input[type="search"], input[name="q"], input[name="search"]');
            if (action.includes("/search") || hasSearchInput) {
                const q = (form.querySelector('input[type="search"], input[name="q"], input[name="search"]') || {}).value || "";
                addEvent({ type: "search_submit", q });
                recordConfusionAction();
            }
        }, true);
    }

    function recordConfusionAction() {
        const now = Date.now();
        state.filterClicksWindow.push(now);
        // trim window
        state.filterClicksWindow = state.filterClicksWindow.filter(ts => now - ts <= CONFUSION_WINDOW_MS);
        if (state.filterClicksWindow.length >= CONFUSION_MIN_ACTIONS) {
            addEvent({ type: "filter_search_confusion", countInWindow: state.filterClicksWindow.length });
            getSuggestion("filter_search_confusion");
            // cool down this detector
            state.filterClicksWindow = [];
        }
    }

    // ========================
    // EXIT INTENT
    // ========================
    function bindExitIntent() {
        // Mouse leaves viewport top (desktop)
        document.addEventListener("mouseout", async (e) => {
            e = e || window.event;
            const from = e.relatedTarget || e.toElement;
            if (!from && e.clientY <= 0) {
                const cart = await getCart();
                if (cart.itemCount >= 1) {
                    addEvent({ type: "exit_intent_cart", itemCount: cart.itemCount });
                    getSuggestion("exit_intent_cart");
                }
            }
        });

        // Tab hidden (mobile/desktop)
        document.addEventListener("visibilitychange", async () => {
            if (document.visibilityState === "hidden") {
                const cart = await getCart();
                if (cart.itemCount >= 2) {
                    addEvent({ type: "visibility_hidden_with_cart", itemCount: cart.itemCount });
                    getSuggestion("visibility_hidden_with_cart");
                }
            }
        });
    }

    // ========================
    // CART DRAWER (Shopify)
    // ========================
    function isLikelyCartDrawerOpen() {
        // Common theme selectors
        const candidates = [
            '#CartDrawer', '#cart-drawer', '.cart-drawer', '[data-cart-drawer]',
            '[aria-label="Cart"]', '[data-drawer="cart"]', '[id*="CartDrawer"]', '[id*="cart-drawer"]',
            '[data-cart-modal]', '.cart-modal', '#cart-modal',
            '.mini-cart', '#mini-cart', '.ajaxcart'
        ];
        for (const sel of candidates) {
            const el = document.querySelector(sel);
            if (visible(el)) return true;
        }
        // Many themes toggle a class on body
        const body = document.body;
        if (body && (body.classList.contains("cart-open") || body.classList.contains("js-drawer-open"))) return true;
        return false;
    }

    function observeCartDrawer() {
        // Initial detection
        updateCartDrawerState();

        // Observe DOM mutations that may open/close drawer
        const mo = new MutationObserver(() => {
            updateCartDrawerState();
        });
        mo.observe(document.documentElement, { attributes: true, childList: true, subtree: true });

        // Any interaction should reset inactivity if drawer open
        ["click", "mousemove", "keydown", "touchstart", "scroll"].forEach(evt => {
            document.addEventListener(evt, () => {
                if (state.isCartOpen) resetCartInactivityTimer();
            }, { passive: true });
        });
    }

    async function updateCartDrawerState() {
        const open = isLikelyCartDrawerOpen();
        if (open && !state.isCartOpen) {
            state.isCartOpen = true;
            const cart = await getCart();
            state.lastKnownCartCount = cart.itemCount || 0;
            addEvent({ type: "cart_drawer_open", itemCount: cart.itemCount });

            // High-value confidence nudge signal (LLM decides)
            if (cart.itemCount >= 3) {
                getSuggestion("high_value_cart_confidence");
            }

            startCartInactivityTimer();
        } else if (!open && state.isCartOpen) {
            state.isCartOpen = false;
            clearTimeout(state.cartInactivityTimer);
            addEvent({ type: "cart_drawer_close" });
        }
    }

    // ========================
    // SERVER CALL
    // ========================
    async function getSuggestion(reason) {
        if (!canAnalyze()) return;

        state.isRequestPending = true;
        state.lastRequestTimestamp = Date.now();

        const cart = await getCart();
        state.lastKnownCartCount = cart.itemCount || 0;

        const session = buildSnapshot(reason, cart);
        log("Analyzing session...", session);

        try {
            const response = await fetch(state.backendUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(session),
                keepalive: true,
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const result = await response.json();
            log("Server result:", result);

            if (result.showMessage && result.message) showPopup(result.message);

            state.analysesThisSession += 1;
            try { sessionStorage.setItem("et_analysesCount", String(state.analysesThisSession)); } catch { }
        }
        catch (error) {
            errorLog("Error sending data to server:", error);
        }
        finally {
            state.isRequestPending = false;
        }
    }

    // ========================
    // POPUP UI
    // ========================
    function showPopup(message) {
        if (state.isPopupVisible || document.getElementById("et-popup-overlay")) return;
        state.isPopupVisible = true;
        try { sessionStorage.setItem("et_msgShown", "1"); } catch { }

        addEvent({ type: "message_shown", message });

        const overlay = document.createElement("div");
        overlay.id = "et-popup-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        Object.assign(overlay.style, {
            position: "fixed",
            inset: "0",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: "9999",
            transition: "opacity 0.3s ease",
            opacity: "0",
        });

        const popup = document.createElement("div");
        Object.assign(popup.style, {
            background: state.modalBackgroundColor,
            color: state.modalTextColor,
            borderRadius: "12px",
            padding: "24px 28px",
            maxWidth: "420px",
            width: "min(90%, 420px)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
            position: "relative",
            textAlign: "center",
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
            fontSize: "16px",
            lineHeight: "1.4",
        });

        const closeBtn = document.createElement("button");
        closeBtn.ariaLabel = "Close";
        closeBtn.textContent = "×";
        Object.assign(closeBtn.style, {
            position: "absolute",
            top: "8px",
            right: "12px",
            background: "none",
            border: "none",
            fontSize: "22px",
            fontWeight: "bold",
            cursor: "pointer",
            color: state.modalTextColor,
            lineHeight: "1",
        });

        const messageEl = document.createElement("div");
        messageEl.textContent = message;

        function closePopup() {
            state.isPopupVisible = false;
            document.body.style.overflow = "";
            overlay.style.opacity = "0";
            setTimeout(() => overlay.remove(), 250);
        }

        closeBtn.addEventListener("click", closePopup);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) closePopup(); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePopup(); }, { once: true });

        popup.appendChild(closeBtn);
        popup.appendChild(messageEl);
        overlay.appendChild(popup);
        document.body.appendChild(overlay);
        document.body.style.overflow = "hidden";
        requestAnimationFrame(() => { overlay.style.opacity = "1"; });
    }

    // ========================
    // PUBLIC API
    // ========================
    return {
        init: function (userConfig) {
            if (document.readyState === "loading")
                document.addEventListener("DOMContentLoaded", () => init(userConfig));
            else init(userConfig);
        },
        trackPageView, // exposed for SPA manual calls if needed
    };
})();
