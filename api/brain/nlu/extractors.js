
/**
 * Shared Intelligence Extractors
 * Ported from Legacy/helpers.js to ensure V2 parity.
 */

// ============================================================================
// TEXT NORMALIZATION
// ============================================================================

export function stripDiacritics(s = '') {
    if (!s) return '';
    return s.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ł/g, 'l')
        .replace(/Ł/g, 'L');
}

export function normalizeTxt(s = '') {
    if (!s) return '';
    return stripDiacritics(s.toLowerCase())
        .replace(/[-_]/g, ' ')
        .replace(/[„"'"'.:,;!?()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ============================================================================
// QUANTITY EXTRACTION
// ============================================================================

const QTY_WORDS = {
    'jedno': 1, 'jedna': 1, 'jeden': 1,
    'dwa': 2, 'dwie': 2, 'dwóch': 2, 'dwoje': 2,
    'trzy': 3, 'trzech': 3, 'troje': 3,
    'cztery': 4, 'czterech': 4,
    'pięć': 5, 'pięciu': 5,
    'sześć': 6, 'sześciu': 6,
    'siedem': 7, 'siedmiu': 7,
    'osiem': 8, 'ośmiu': 8,
    'dziewięć': 9, 'dziewięciu': 9,
    'dziesięć': 10, 'dziesięciu': 10,
    'kilka': 2, 'kilku': 2, 'parę': 2
};

export function extractQuantity(text) {
    if (!text) return 1;
    const normalized = normalizeTxt(text);

    // Pattern 1: Numbers (2x, 3x, 2 razy)
    const numPattern = /(\d+)\s*(?:x|razy|sztuk|porcj)/i;
    const numMatch = normalized.match(numPattern);
    if (numMatch) return parseInt(numMatch[1], 10);

    // Pattern 2: Word form
    for (const [word, qty] of Object.entries(QTY_WORDS)) {
        if (normalized.includes(word)) return qty;
    }
    // Pattern 3: Lone numbers (careful) - only if explicit digits
    const loneDigit = normalized.match(/\b(\d+)\b/);
    if (loneDigit) {
        // Only accept if small number (1-10) to avoid confusing IDs or similar
        const val = parseInt(loneDigit[1], 10);
        if (val > 0 && val < 20) return val;
    }

    return 1;
}

// ============================================================================
// LOCATION & CUISINE EXTRACTION
// ============================================================================

const CUISINE_MAP = {
    'pizza': 'Pizzeria', 'pizze': 'Pizzeria', 'pizzy': 'Pizzeria', 'pizzeria': 'Pizzeria',
    'kebab': 'Kebab', 'kebaba': 'Kebab', 'kebabu': 'Kebab',
    'burger': 'Amerykańska', 'burgera': 'Amerykańska', 'burgery': 'Amerykańska',
    'wloska': 'Włoska', 'włoska': 'Włoska', 'wloskiej': 'Włoska',
    'polska': 'Polska', 'polskiej': 'Polska',
    'wietnamska': 'Wietnamska', 'wietnamskiej': 'Wietnamska',
    'chinska': 'Chińska', 'chińska': 'Chińska', 'chinskiej': 'Chińska',
    'tajska': 'Tajska', 'tajskiej': 'Tajska',
    'azjatyckie': 'azjatyckie', 'azjatyckiej': 'azjatyckiej',
    'fastfood': 'fastfood', 'fast food': 'fast food',
    'lokalne': 'lokalne', 'lokalnej': 'lokalnej',
    'wege': 'wege', 'wegetarianskie': 'wege', 'wegetariańskie': 'wege'
};

export function extractCuisineType(text) {
    const normalized = normalizeTxt(text);
    for (const [keyword, cuisineType] of Object.entries(CUISINE_MAP)) {
        if (normalized.includes(keyword)) return cuisineType;
    }
    return null;
}

// Advanced Location Extractor (Legacy Port)
export function extractLocation(text) {
    if (!text) return null;

    // 1. Explicit Prepositions
    const locationKeywords = ['w', 'na', 'blisko', 'koło', 'niedaleko', 'obok', 'przy'];
    const pattern = new RegExp(`(?:${locationKeywords.join('|')})\\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)*)`, 'i');
    const match = text.match(pattern);

    let location = null;

    if (match) {
        location = match[1]?.trim();
    } else {
        // 2. Fallback: Capitalized words at end of sentence or standalone
        const cityPattern = /\b([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)*)\b/g;
        const cities = text.match(cityPattern);
        if (cities && cities.length > 0) {
            // Take last capitalized sequence that isn't blacklisted
            location = cities.reverse().find(c => !isBlacklisted(c.toLowerCase()));
        }
    }

    if (!location) return null;
    if (isBlacklisted(location.toLowerCase())) return null;

    // 3. Normalize Polish Grammar (Inflections)
    return normalizePolishCity(location);
}

function isBlacklisted(locLower) {
    const blacklist = [
        'tutaj', 'tu', 'szybko', 'pobliżu', 'okolicy', 'menu', 'coś', 'cos',
        'azjatyckiego', 'azjatyckie', 'szybkiego', 'dobrego', 'innego', 'inne',
        'zamów', 'pokaż', 'znajdź', 'chcę', 'raz', 'dwa', 'mam',
        'hubertus', 'kamienica', 'monte', 'carlo',
        'chleb', 'chlebie', 'talerz', 'talerzu', 'miska', 'misce', 'zupa', 'zupie',
        'pizzy', 'pizza', 'burger', 'burgera',
        'cola', 'coca', 'coca-cola', 'fanta', 'sprite', 'napój', 'napoje', 'woda'
    ];
    return blacklist.includes(locLower) || blacklist.some(word => locLower.startsWith(word + ' '));
}

function normalizePolishCity(raw) {
    return raw
        .split(' ')
        .map(word => {
            // Priorytety: najpierw dłuższe końcówki
            if (/ich$/i.test(word)) return word.replace(/ich$/i, 'ie');  // Śląskich → Śląskie
            if (/im$/i.test(word)) return word.replace(/im$/i, 'ie');   // Śląskim → Śląskie
            if (/ach$/i.test(word)) return word.replace(/ach$/i, 'y');  // Piekarach → Piekary
            if (/ami$/i.test(word)) return word.replace(/ami$/i, 'a');   // Gliwicami → Gliwica
            if (/iu$/i.test(word)) return word.replace(/iu$/i, '');     // Bytomiu → Bytom
            // Adjectives usually safe
            if (/skie$/i.test(word)) return word;
            if (/ie$/i.test(word)) return word.replace(/ie$/i, 'a');    // Katowicie → Katowica (approximation)
            return word;
        })
        .join(' ');
}
