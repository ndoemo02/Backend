
import { smartResolveIntent } from './api/brain/ai/smartIntent.js';

async function runTest() {
    const examples = [
        { text: "dwa duże kebsy ostre i browarki", session: {} },
        { text: "pokaż menu klaps burger", session: { lastIntent: 'find_nearby' } },
        { text: "mam ochotę na jakiś fast food w Piekarach", session: {} }
    ];

    console.log("🚀 Starting Smart Intent Test\n");

    for (const ex of examples) {
        console.log(`\nInput: "${ex.text}"`);
        const result = await smartResolveIntent({
            text: ex.text,
            session: ex.session,
            restaurants: [],
            previousIntent: ex.session.lastIntent
        });
        console.log(`Result:`, JSON.stringify(result, null, 2));
    }
}

// Mock env for test if not set
if (!process.env.OPENAI_API_KEY) {
    console.warn("⚠️ NO OPENAI_API_KEY provided, tests might fallback to classic only or fail LLM call.");
}
process.env.USE_LLM_INTENT = 'true';

runTest();
