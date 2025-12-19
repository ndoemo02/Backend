// api/brain/ai/llmIntent.js
/**
 * LLM Intent Detection Module v3 (GPT-4o-mini)
 * Precyzyjna detekcja intencji z użyciem OpenAI.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 4000;

async function callOpenAI(messages) {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY not configured");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(OPENAI_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages,
                temperature: 0.0, // Deterministic
                max_tokens: 150,
                response_format: { type: "json_object" }
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "{}";
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

export async function llmDetectIntent(text, session = {}) {
    // Guard for tests
    const IS_TEST = !!(process.env.VITEST || process.env.VITEST_WORKER_ID || process.env.NODE_ENV === 'test');
    if (IS_TEST && process.env.FORCE_LLM_TEST !== 'true') {
        return { intent: 'unknown', confidence: 0, reasoning: 'Test mode' };
    }

    try {
        const startTime = Date.now();

        const systemPrompt = `You are Amber Brain's intent detector.
Classify user input into JSON:
{
  "intent": "find_nearby | show_menu | add_to_cart | modify_order | confirm_order | cancel_order | smalltalk | unknown",
  "restaurant": "string | null",
  "item": "string | null",
  "quantity": number | null,
  "confidence": 0.0-1.0
}

Rules:
- "unknown" if not sure or confidence < 0.55
- "find_nearby" for location search / "where to eat"
- "show_menu" for menu requests
- "add_to_cart" for ordering specific items
- "smalltalk" for greetings/thanks
`;

        const userPrompt = `User: "${text}"
Context: ${JSON.stringify({
            lastIntent: session.lastIntent,
            lastRestaurant: session.lastRestaurant?.name,
            hasPendingOrder: !!session.pendingOrder
        })}
JSON:`;

        const rawResponse = await callOpenAI([
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ]);

        let result = JSON.parse(rawResponse);

        // Enforce confidence threshold
        if (result.confidence < 0.55) {
            result.intent = "unknown";
        }

        console.log(`🧠 GPT Intent: ${result.intent} (${result.confidence}) in ${Date.now() - startTime}ms`);

        return result;

    } catch (err) {
        console.error('❌ LLM Intent failed:', err.message);
        return { intent: 'unknown', confidence: 0, reasoning: err.message };
    }
}

