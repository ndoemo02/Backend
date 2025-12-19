
import { normalize } from "../utils/normalizeText.js";
import { callLLM } from "../ai/llmClient.js";
import { fuzzyMatch } from "../helpers.js";

/**
 * Normalized string helper (removes diacritics, lowercase)
 */
function superNormalize(str) {
    if (!str) return "";
    return str
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
        .replace(/ł/g, "l").replace(/Ł/g, "L") // special case for Ł
        .replace(/[^a-z0-9\s]/g, "")
        .trim();
}

/**
 * Hybrid Restaurant Selection (Heuristic + LLM)
 */
export async function resolveRestaurantSelectionHybrid({
    userText,
    sessionContext,
    llmClient = { callLLM }, // Default to internal helper
    logger = console
}) {
    const list = sessionContext?.lastRestaurants || [];
    if (!Array.isArray(list) || list.length === 0) {
        return { restaurant: null, method: "none", confidence: 0 };
    }

    const normText = superNormalize(userText);

    // 1. Numeric / Ordinal Heuristic
    // Maps "druga", "2", "ta druga" -> index
    const ordinalMap = {
        "pierwsz": 1, "jeden": 1, "jedynk": 1, "1": 1,
        "drug": 2, "dwa": 2, "dwujk": 2, "2": 2,
        "trzeci": 3, "trzy": 3, "trojk": 3, "3": 3,
        "czwart": 4, "cztery": 4, "4": 4,
        "piat": 5, "piec": 5, "5": 5
    };

    // Check specific number/ordinal words
    const tokens = normText.split(/\s+/);
    let foundIndex = -1;

    for (const t of tokens) {
        for (const [key, idx] of Object.entries(ordinalMap)) {
            if (t.includes(key) || t === String(idx)) {
                // strict check for digits
                if (/\d/.test(t) && t !== String(idx)) continue;
                foundIndex = idx - 1;
                break;
            }
        }
        if (foundIndex >= 0) break;
    }

    if (foundIndex >= 0 && list[foundIndex]) {
        return {
            restaurant: list[foundIndex],
            method: "heuristic",
            confidence: 0.95
        };
    }

    // 2. Name / Fragment Heuristic (Scoring)
    const candidates = list.map(r => {
        let score = 0;
        const rName = superNormalize(r.name);
        const rCity = superNormalize(r.city || "");

        // Full phrasing check?
        if (rName.includes(normText)) score += 3;

        // Token overlap
        const rTokens = rName.split(/\s+/);
        for (const ut of tokens) {
            if (ut.length < 3) continue; // skip short words
            if (rName.includes(ut)) score += 1;
            if (rCity.includes(ut)) score += 0.5;

            // Checking individual restaurant word tokens against user token (fuzzy)
            for (const rt of rTokens) {
                if (rt.startsWith(ut) || ut.startsWith(rt)) score += 0.5;
                // Fuzzy check using Levenshtein
                if (fuzzyMatch(ut, rt, 2)) score += 1.0;
                // Common stem check (Polish specific heuristic for odmiana)
                if (ut.length > 4 && rt.length > 4 && ut.substring(0, 4) === rt.substring(0, 4)) score += 0.8;
            }
        }
        return { ...r, score };
    });

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const second = candidates[1];

    if (best.score >= 2) {
        // Significant leader?
        if (!second || (best.score - second.score >= 1)) {
            return {
                restaurant: best,
                method: "heuristic",
                confidence: 0.85
            };
        }
    }
    // Single candidate with decent score
    if (best.score >= 0.7 && candidates.filter(c => c.score > 0.5).length === 1) {
        return {
            restaurant: best,
            method: "heuristic",
            confidence: 0.8
        };
    }

    logger.log(`🔍 SmartSelection Debug: "${userText}" -> Best: ${best.score} (${best.name || ''}) vs Second: ${second?.score || 0}`);

    // 3. LLM Fallback (if ambiguity or no match)
    // Only if not resolved

    // Check if best score is very low, maybe skip LLM if garbage?
    // User says "nie zgadywać".
    // Try LLM if heuristics failed but input might be valid.

    // Prepare concise list for LLM context
    const contextList = list.map(r => ({
        index: r.index,
        name: r.name,
        city: r.city,
        cuisine: r.cuisine
    }));

    const systemPrompt = `You are a helpful assistant mapping user selection to a restaurant list.
List: ${JSON.stringify(contextList)}
User Reply: "${userText}"
Task: Pick the ONE restaurant that the user refers to.
Return JSON: { "index": number | null } (1-based index).
If ambiguous or none, return null.`;

    try {
        const jsonStr = await llmClient.callLLM({
            system: systemPrompt,
            user: "Selection:",
            jsonMode: true
        });

        if (jsonStr) {
            const parsed = JSON.parse(jsonStr);
            if (parsed.index && list[parsed.index - 1]) {
                return {
                    restaurant: list[parsed.index - 1],
                    method: "llm",
                    confidence: 0.8
                };
            }
        }
    } catch (e) {
        logger.warn("LLM Selection fallback failed", e);
    }

    return { restaurant: null, method: "none", confidence: 0 };
}
