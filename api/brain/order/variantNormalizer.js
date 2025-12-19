
// import { normalize } from "../utils/normalizeText.js"; 
// DISABLE global normalize because it strips 'do', 'na', 'u' for unrelated reasons (location parsing usually).

function safeNormalize(text) {
    if (!text) return "";
    return text.toLowerCase().trim();
}

// Levenshtein distance for fuzzy matching
function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

// Synonyms map: key (safe normalized) -> value (standard code)
export const SIZE_SYNONYMS = {
    // Normal forms (with diacritics) + Accusative forms (małą, dużą)
    'mała': 'small', 'małą': 'small', 'mały': 'small', 'maly': 'small', 'mala': 'small', 's': 'small',
    'średnia': 'medium', 'średnią': 'medium', 'średni': 'medium', 'srednia': 'medium', 'sredni': 'medium', 'm': 'medium',
    'duża': 'large', 'dużą': 'large', 'duży': 'large', 'duza': 'large', 'duzy': 'large', 'l': 'large',
    'maxi': 'large', 'wielka': 'large',
    'giga': 'xxl', 'mega': 'xxl', 'xxl': 'xxl'
};

// Exclusions map: keyword -> normalized code to remove
export const EXCLUSION_KEYWORDS = {
    'cebuli': 'onion', 'cebula': 'onion',
    'ostrego': 'spicy', 'ostre': 'spicy',
    'sosu': 'sauce', 'sos': 'sauce',
    'pomidora': 'tomato', 'pomidor': 'tomato'
};

// Fuzzy Extras Map
const FUZZY_EXTRAS = {
    'czosnkowy': 'garlic_sauce',
    'czosnek': 'garlic_sauce', // simplified
    'ostry': 'spicy',
    'pikantny': 'spicy',
    'ketchup': 'ketchup',
    'frytki': 'fries'
};

export function normalizeSize(text) {
    if (!text) return null;
    const lower = safeNormalize(text);

    // Sort keys by length descending
    const sortedKeys = Object.keys(SIZE_SYNONYMS).sort((a, b) => b.length - a.length);

    for (const key of sortedKeys) {
        const val = SIZE_SYNONYMS[key];

        if (key.length <= 2) {
            const regex = new RegExp(`(^|\\s)${key}($|\\s|\\.|,)`, 'i');
            if (regex.test(lower)) return val;
        } else {
            if (lower.includes(key)) return val;
        }
    }
    return null;
}

export function normalizeExtras(text) {
    if (!text) return [];
    const extras = [];
    const lower = safeNormalize(text);

    // 1. Phrasal Matches (High Confidence)
    if (lower.includes('podwójny ser') || lower.includes('podwojny ser') ||
        lower.includes('podwójnym serem') || lower.includes('podwojnym serem') ||
        lower.includes('serem')) {
        extras.push('extra_cheese');
    }

    if (lower.includes('podwójne mięso') || lower.includes('podwojne mieso') ||
        lower.includes('podwójnym mięsem')) {
        extras.push('double_meat');
    }

    if (lower.includes('ostre') || lower.includes('ostra') || lower.includes('ostrą') || lower.includes('pikantn')) {
        extras.push('spicy');
    }

    if (lower.includes('sos ') || lower.endsWith('sos')) {
        extras.push('sauce_generic');
    }

    // 2. Fuzzy Token Matching (Typo correction)
    const tokens = lower.split(/[\s,.]+/); // simpler splitting
    for (const token of tokens) {
        if (token.length < 4) continue; // skip short words for fuzzy match to avoid noise

        for (const [target, code] of Object.entries(FUZZY_EXTRAS)) {
            // Check threshold: 1 edit for len<=5, 2 edits for len>5
            const threshold = target.length > 5 ? 2 : 1;
            if (levenshtein(token, target) <= threshold) {
                if (!extras.includes(code)) {
                    extras.push(code);
                }
            }
        }
    }

    // Deduplicate?
    return [...new Set(extras)];
}

export function normalizeExclusions(text) {
    if (!text) return [];
    const exclusions = [];
    const lower = safeNormalize(text);

    // Common polish exclusion prefixes
    const prefixRegex = /(?:bez|nie chce|omin)\s+([a-ząćęłńóśźż]+)/g;

    let match;
    while ((match = prefixRegex.exec(lower)) !== null) {
        const word = match[1];
        if (EXCLUSION_KEYWORDS[word]) {
            exclusions.push(EXCLUSION_KEYWORDS[word]);
        } else {
            exclusions.push(word);
        }
    }

    return exclusions;
}
