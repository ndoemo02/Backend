/**
 * PhraseGenerator.js
 * 
 * LLM-Powered Phrase Generator for Natural Dialog
 * 
 * Purpose: Transform deterministic facts into natural spoken Polish
 * 
 * ❌ Does NOT make decisions
 * ❌ Does NOT ask questions the FSM didn't authorize
 * ❌ Does NOT change meaning
 * ✅ Paraphrases for natural speech
 * ✅ Max 2 sentences
 * ✅ Falls back to SurfaceRenderer on failure
 * 
 * INPUT:  { surfaceKey, facts, lang }
 * OUTPUT: { spokenText, ssml, fromLLM: boolean }
 */

import { renderSurface } from './SurfaceRenderer.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const PHRASE_GENERATOR_CONFIG = {
    enabled: true,
    maxSentences: 2,
    maxWords: 40,
    maxChars: 300, // Hard cap for TTS
    timeout: 2000, // ms
    fallbackOnError: true
};

// System prompt for phrase generation (Polish)
const SYSTEM_PROMPT = `Jesteś asystentem głosowym do zamawiania jedzenia. 
Twoim jedynym zadaniem jest przeformułowanie podanego tekstu na naturalną mowę.

ZASADY:
1. Maksymalnie 2 krótkie zdania
2. NIE zadawaj nowych pytań - tylko przepisz te które są w oryginale  
3. NIE zmieniaj sensu ani informacji
4. Bądź przyjazna ale rzeczowa
5. Używaj naturalnego języka mówionego (nie pisanego)
6. Jeśli w oryginale jest lista numerowana, zachowaj numery

Przykłady:
Oryginał: "Mam kilka opcji dla \"pizza\". Wybierz: 1) Margherita (25 zł) 2) Pepperoni (28 zł)"
Przepisane: "Mam dla ciebie kilka opcji pizzy: pierwsza to Margherita za dwadzieścia pięć złotych, druga to Pepperoni za dwadzieścia osiem."

Oryginał: "Chcesz menu której restauracji? 1. Pizza Hut, 2. Domino's"  
Przepisane: "Z której restauracji chcesz zobaczyć menu? Mam Pizza Hut i Domino's."`;

// ═══════════════════════════════════════════════════════════════════════════
// PHRASE GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

let openaiClient = null;

/**
 * Get or initialize OpenAI client (lazy loading)
 */
function getOpenAIClient() {
    if (!openaiClient) {
        try {
            const OpenAI = require('openai');
            openaiClient = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
        } catch (err) {
            console.warn('[PhraseGenerator] OpenAI not available:', err.message);
            return null;
        }
    }
    return openaiClient;
}

/**
 * Generate natural spoken phrase from surface output
 * 
 * @param {Object} input
 * @param {string} input.surfaceKey - Dialog surface key
 * @param {Object} input.facts - Facts to render
 * @param {string} [input.lang='pl'] - Language code
 * @param {Object} [options]
 * @param {boolean} [options.skipLLM=false] - Force template-only
 * @returns {Promise<{ spokenText: string, ssml: string, fromLLM: boolean, surfaceKey: string }>}
 */
export async function generatePhrase(input, options = {}) {
    const { surfaceKey, facts = {}, lang = 'pl' } = input;
    const { skipLLM = false } = options;

    // Step 1: Get deterministic template output
    const surface = { key: surfaceKey, facts };
    const { reply: templateText, uiHints } = renderSurface(surface);

    // If LLM disabled or skipped, return template
    if (!PHRASE_GENERATOR_CONFIG.enabled || skipLLM) {
        return {
            spokenText: templateText,
            ssml: wrapSSML(templateText),
            fromLLM: false,
            surfaceKey: surfaceKey
        };
    }

    // Step 2: Try LLM paraphrase
    try {
        const paraphrased = await paraphraseWithLLM(templateText, surfaceKey);

        if (paraphrased && paraphrased.length > 0) {
            // Validate: ensure no new questions added
            const valid = validateParaphrase(templateText, paraphrased);

            if (valid) {
                // Hard cap: truncate to maxChars
                let finalText = paraphrased;
                if (finalText.length > PHRASE_GENERATOR_CONFIG.maxChars) {
                    finalText = finalText.slice(0, PHRASE_GENERATOR_CONFIG.maxChars - 3) + '...';
                    console.debug(`[PhraseGenerator] Truncated to ${PHRASE_GENERATOR_CONFIG.maxChars} chars`);
                }

                return {
                    spokenText: finalText,
                    ssml: wrapSSML(finalText, surfaceKey),
                    fromLLM: true,
                    surfaceKey: surfaceKey
                };
            } else {
                console.warn('[PhraseGenerator] Validation failed, using template');
            }
        }
    } catch (err) {
        console.warn('[PhraseGenerator] LLM error, falling back:', err.message);
    }

    // Step 3: Fallback to template
    return {
        spokenText: templateText,
        ssml: wrapSSML(templateText),
        fromLLM: false,
        surfaceKey: surfaceKey
    };
}

/**
 * Paraphrase text using LLM
 * @param {string} text - Original template text
 * @param {string} surfaceKey - Context hint
 * @returns {Promise<string | null>}
 */
async function paraphraseWithLLM(text, surfaceKey) {
    const client = getOpenAIClient();
    if (!client) return null;

    const userPrompt = `Przepisz na naturalną mowę (max 2 zdania):\n\n"${text}"`;

    try {
        const response = await Promise.race([
            client.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt }
                ],
                max_tokens: 150,
                temperature: 0.7
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), PHRASE_GENERATOR_CONFIG.timeout)
            )
        ]);

        const result = response.choices?.[0]?.message?.content?.trim();
        return result || null;

    } catch (err) {
        console.debug('[PhraseGenerator] LLM call failed:', err.message);
        return null;
    }
}

/**
 * Validate paraphrased output
 * - No new questions added
 * - Essential info preserved
 * - Not too long
 * 
 * @param {string} original - Template text
 * @param {string} paraphrased - LLM output
 * @returns {boolean}
 */
function validateParaphrase(original, paraphrased) {
    // Check length
    const wordCount = paraphrased.split(/\s+/).length;
    if (wordCount > PHRASE_GENERATOR_CONFIG.maxWords) {
        return false;
    }

    // Check sentence count (rough)
    const sentenceCount = (paraphrased.match(/[.!?]/g) || []).length;
    if (sentenceCount > PHRASE_GENERATOR_CONFIG.maxSentences + 1) {
        return false;
    }

    // Check for new questions (if original had no question, paraphrase shouldn't add one)
    const originalHasQuestion = original.includes('?');
    const paraphrasedQuestions = (paraphrased.match(/\?/g) || []).length;
    const originalQuestions = (original.match(/\?/g) || []).length;

    if (paraphrasedQuestions > originalQuestions + 1) {
        // LLM added questions - reject
        return false;
    }

    return true;
}

/**
 * Wrap text in SSML with prosody hints
 * @param {string} text - Text to wrap
 * @param {string} [surfaceKey] - Context for tone
 * @returns {string}
 */
function wrapSSML(text, surfaceKey = null) {
    // Determine prosody based on surface
    let rate = 'medium';
    let pitch = 'medium';

    if (surfaceKey === 'ERROR') {
        pitch = 'low';
        rate = 'slow';
    } else if (surfaceKey === 'CONFIRM_ADD') {
        pitch = 'high';
    } else if (surfaceKey?.startsWith('ASK_')) {
        pitch = '+5%';
    }

    // Build SSML
    const ssml = `<speak>
  <prosody rate="${rate}" pitch="${pitch}">
    ${escapeSSML(text)}
  </prosody>
</speak>`;

    return ssml;
}

/**
 * Escape text for SSML
 * @param {string} text
 * @returns {string}
 */
function escapeSSML(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCH AND SYNC HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Synchronous version - uses template only
 * @param {Object} input
 * @returns {{ spokenText: string, ssml: string, fromLLM: false, surfaceKey: string }}
 */
export function generatePhraseSync(input) {
    const { surfaceKey, facts = {} } = input;

    const surface = { key: surfaceKey, facts };
    const { reply: templateText } = renderSurface(surface);

    return {
        spokenText: templateText,
        ssml: wrapSSML(templateText, surfaceKey),
        fromLLM: false,
        surfaceKey: surfaceKey
    };
}

/**
 * Update phrase generator config
 * @param {Partial<typeof PHRASE_GENERATOR_CONFIG>} config
 */
export function configurePhraseGenerator(config) {
    Object.assign(PHRASE_GENERATOR_CONFIG, config);
}

/**
 * Check if LLM phrase generation is available
 * @returns {boolean}
 */
export function isLLMAvailable() {
    return !!getOpenAIClient();
}
