
import { detectIntent } from "../intents/intentRouterGlue.js";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Smart Intent Resolution Layer
 * Simplifies logic: Check Classic -> Check Context/Confidence -> LLM Fallback
 */
export async function smartResolveIntent({ text, session, restaurants, previousIntent }) {
    // 1. Guard empty input
    if (!text || !text.trim()) {
        return { intent: "smalltalk", confidence: 0, slots: {}, source: 'empty' };
    }

    const sessionId = session?.sessionId || 'default';

    // 2. Classic NLU
    let det = { intent: 'unknown', confidence: 0, slots: {} };
    try {
        det = await detectIntent(text, sessionId);
    } catch (e) {
        console.warn('⚠️ Classic NLU failed:', e.message);
    }

    const classicResult = {
        ...det,
        intent: det.intent || 'unknown',
        confidence: det.confidence || 0,
        slots: det.entities || {},
        source: 'classic'
    };

    // 3. Fast-track (Skip LLM)
    // Jeśli mamy expectedContext LUB wysokie confidence (> 0.75)
    // Wyjątek: jeśli classic zwrócił 'none'/'unknown' i nie ma expectedContext, to nie jest "high confidence" w sensie użyteczności.
    // Ale user mówi: "det.intent ma wysokie confidence".

    // Check strict context existence
    const hasExpectedContext = !!session?.expectedContext;

    // Confidence check
    const isConfident = (classicResult.confidence >= 0.75) &&
        (classicResult.intent !== 'none') &&
        (classicResult.intent !== 'unknown') &&
        (classicResult.intent !== 'fallback');

    if (hasExpectedContext || isConfident) {
        // Log decision
        // console.log(`🧠 [SmartIntent] Skipping LLM (Ctx: ${hasExpectedContext}, Conf: ${classicResult.confidence.toFixed(2)})`);
        return classicResult;
    }

    // 4. LLM Fallback
    const USE_LLM = process.env.USE_LLM_INTENT === 'true' || process.env.OPENAI_API_KEY;
    if (!USE_LLM) return classicResult;

    try {
        const contextData = {
            lastIntent: previousIntent || 'none',
            lastRestaurant: session?.lastRestaurant?.name || null,
            city: session?.last_location || null
        };

        const systemPrompt = `Analyze user text and return JSON.
Target Intents: [create_order, show_menu, find_nearby, change_restaurant, confirm_order, cancel_order, smalltalk, unknown].

Rules:
- If user wants food/drink -> create_order (extract items)
- If user asks for location/places -> find_nearby
- If user changes preference ('wolałbym pizza', 'jednak kebab') -> find_nearby (with cuisine)
- If user picks a place -> show_menu or confirm selection
- If ambiguous -> unknown

Return JSON: { "intent": "string", "confidence": number, "slots": object }
Context: ${JSON.stringify(contextData)}`;

        const response = await fetch(OPENAI_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini", // Fast model
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `User: "${text}"` }
                ],
                temperature: 0.0,
                response_format: { type: "json_object" }
            })
        });

        if (response.ok) {
            const json = await response.json();
            const content = json.choices?.[0]?.message?.content;
            if (content) {
                const parsed = JSON.parse(content);
                // 5. Merge / Refine
                if (parsed.intent && parsed.intent !== 'unknown') {
                    return {
                        ...classicResult, // Preserve classic raw data
                        intent: parsed.intent,
                        confidence: parsed.confidence || 0.85,
                        slots: { ...classicResult.slots, ...(parsed.slots || {}) },
                        source: 'llm'
                    };
                }
            }
        }
    } catch (err) {
        console.warn('⚠️ SmartIntent LLM error:', err.message);
    }

    return classicResult;
}
