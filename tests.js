const { analizeSession } = require('./suggestions.js')

// runSessionTests()
async function runSessionTests() {
    const tests = [
        {
            name: "Normal browsing (no message)",
            session: {
                events: [
                    { type: "page_view", page: "Home" },
                    { type: "page_view", page: "Product - Hoodie" },
                    { type: "add_to_cart", productId: "hoodie123" },
                    { type: "checkout_start" },
                ],
                currentPage: "Checkout",
                cart: [{ id: "hoodie123", qty: 1 }],
                timeOnSite: 45,
            },
            expected: { showMessage: false },
        },
        {
            name: "Hesitation on product page",
            session: {
                events: [{ type: "page_view", page: "Product - Running Shoes" }],
                currentPage: "Product - Running Shoes",
                cart: [],
                timeOnSite: 75,
            },
            expected: { showMessage: true },
        },
        {
            name: "Cart abandonment risk",
            session: {
                events: [
                    { type: "add_to_cart", productId: "tshirt001" },
                    { type: "page_view", page: "About Us" },
                    { type: "page_view", page: "Home" },
                ],
                currentPage: "Home",
                cart: [{ id: "tshirt001", qty: 1 }],
                timeOnSite: 130,
            },
            expected: { showMessage: true },
        },
        {
            name: "Search/filter confusion",
            session: {
                events: [
                    { type: "search", term: "jacket" },
                    { type: "filter", category: "Men" },
                    { type: "filter", category: "Winter" },
                    { type: "search", term: "warm waterproof jacket" },
                ],
                currentPage: "Search Results",
                cart: [],
                timeOnSite: 90,
            },
            expected: { showMessage: true },
        },
        {
            name: "High-value cart idle (trigger discount)",
            session: {
                events: [
                    { type: "add_to_cart", productId: "shoes123" },
                    { type: "add_to_cart", productId: "hoodie123" },
                    { type: "add_to_cart", productId: "hat321" },
                ],
                currentPage: "Cart",
                cart: [
                    { id: "shoes123", qty: 1 },
                    { id: "hoodie123", qty: 1 },
                    { id: "hat321", qty: 1 },
                ],
                timeOnSite: 200,
            },
            expected: { showMessage: true },
        },
    ];

    let passed = 0;

    for (const test of tests) {
        console.log(`\n🧪 Running test: ${test.name}`);
        try {
            const result = await analizeSession(test.session);

            // Validate showMessage flag
            const correct = result.showMessage === test.expected.showMessage;

            if (correct) {
                console.log(`✅ Passed`);
                passed++;
            } else {
                console.log(`❌ Failed`);
            }

            console.log("Expected:", test.expected);
            console.log("Received:", result);
        } catch (err) {
            console.log(`❌ Error running test:`, err.message);
        }
    }

    console.log(`\n🏁 Tests finished: ${passed}/${tests.length} passed.`);
}