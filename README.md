# Proactive Engagement System for Shopify

## 🚀 Setup (Backend)

**Requirements:** Node.js 18+, npm

```bash
# 1) Install
npm install

# 2) Environment
# required: OpenAI API key
export aiKey=YOUR_OPENAI_API_KEY
# optional: PORT
export PORT=3001

# 3) Run
npm start
```

**What it serves**
- `public/` is served statically (place `tracker.js` here).
- API route: `POST /suggestions/offer-suggestion`  
  (protected with `helmet`, CORS for your Shopify domain, and `express-rate-limit`).

**Key files**
- `app.js` – Express app, static hosting, CORS, rate limit.
- `routes/suggestions.js` – LLM analysis endpoint.
- `prompt.js` – System prompt with engagement rules.
- `snippet.html` – snippet to paste .

---

## 🧩 Shopify Integration

1) **Host the tracker**  
   Ensure `tracker.js` is accessible at:
   ```
   https://melingoai-assignment.onrender.com (already hosted)
   ```

2) **Inject the snippet into your theme**  
   Shopify Admin → **Online Store → Themes → Edit code**  
   Add before `</head>` (e.g., in `layout/theme.liquid`):

```html
<script>
  (function () {
    const trackerConfig = {
      scriptUrl: 'https://melingoai-assignment.onrender.com', // backend service url
      modalBackgroundColor: '#FFFFFF', // background color of the modal
      modalTextColor: '#000000', // text color of the modal
      debug: true // should display logs for debugging
    }
    const script = document.createElement('script')
    script.src = trackerConfig.scriptUrl + '/tracker.js'
    script.async = true
    script.onload = function () {
      if (window.EngagementTracker) {
        window.EngagementTracker.init(trackerConfig)
        console.log('Tracker initialized')
      }
    }
    document.head.appendChild(script)
  })();
</script>
```

3) **What the tracker does automatically**
- Tracks **page views**, **time-on-page**, **Add to Cart**, **filters/search**, **wishlist**.
- Detects **PDP hesitation**, **post-ATC idle**, **cart drawer inactivity**, **exit intent**.
- Reads `/cart.js` for truthy cart state.
- Sends session snapshots to `POST /suggestions/offer-suggestion` with cooldowns and per‑session caps.

---

## 🧠 How Prompting Works

**Endpoint:** `POST /suggestions/offer-suggestion`  
**Model:** `gpt-5-mini` with `response_format: { "type": "json_object" }`

**Messages**
- **system** – Profit- and brand‑safe rules:
  - Be conservative (no spam).  
  - Offer **help** on PDP hesitation (no discount).  
  - Gentle reminders on **potential cart abandonment**.  
  - Help during **search/filter confusion**.  
  - For **high‑value carts**, build confidence (shipping/returns).  
  - **Discounts (10–20%)** as a **last resort** on strong abandonment; generate codes like `SAVE15`.
- **user** – `Analyze the following user session data: <JSON snapshot>`

**Request (example)**
```json
{
  "reason": "pdp_hesitation",
  "sessionId": "123",
  "page": {"url": "…/products/running-shoes", "type": "pdp", "durationMs": 70214},
  "cart": {"itemCount": 0, "items": [], "total_price": 0},
  "recentEvents": [{"type":"page_view","timestamp":"…"}]
}
```

**Response (example)**
```json
{
  "showMessage": true,
  "message": "Questions about our running shoes? I’m here to help—size, fit, or returns.",
  "reasoning": "60+ seconds on PDP without ATC; assistance is appropriate."
}
```
**note : I did not include openAI api keys, as they are linked to payment method.
The backend service is hosted on https://melingoai-assignment.onrender.com where you can test the project.
