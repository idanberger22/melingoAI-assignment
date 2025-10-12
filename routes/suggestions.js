const express = require('express')
const OpenAI = require("openai")
const openai = new OpenAI({ apiKey: process.env.aiKey })
const suggestionRouter = express.Router()
const systemPrompt = require('../prompt')

suggestionRouter.post('/offer-suggestion', async (req, res) => {
    try {
        const session  = req.body
        const response = await analizeSession(session)
        return res.json(response)
    }
    catch (err) {
        console.error("Error offerSuggestion:", err);
        return res.status(500).json({ error: "Internal server error" })
    }
})

async function analizeSession(session) {
    const userPrompt = `Analyze the following user session data: ${JSON.stringify(session, null, 2)}`
    const completion = await openai.chat.completions.create({
        model: 'gpt-5-mini',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
    })

    const llmResponse = completion.choices[0].message.content;
    return JSON.parse(llmResponse)
}

module.exports = {
    suggestionRouter,
    analizeSession
}