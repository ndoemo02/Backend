// /api/brain/helpers.js - Shared helper functions for brain router
// Consolidated utilities to eliminate duplication

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

export function normalize(text) {
  if (!text) return '';
  return text.toLowerCase()
    .replace(/[^a-ząćęłńóśźż0-9 ]/g, '')
    .trim();
}

export function normalizeTxt(s = '') {
  if (!s) return '';
  return stripDiacritics(s.toLowerCase())
    .replace(/[-_]/g, ' ')
    .replace(/[„"'"'.:,;!?()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Mapowanie skrótów/aliasów nazw restauracji na rozwinięte formy,
// które ułatwiają dopasowanie (np. "rezydencja" → "rezydencja luxury hotel").
const BASE_RESTAURANT_ALIAS_MAP = {
  'rezydencja': ['rezydencja luxury', 'rezydencja luxury hotel'],
};

function normalizeAliasMap(map = {}) {
  const result = { ...BASE_RESTAURANT_ALIAS_MAP };
  if (!map || typeof map !== 'object') return result;
  for (const [alias, canonical] of Object.entries(map)) {
    const key = String(alias || '').trim().toLowerCase();
    if (!key) continue;
    const values = Array.isArray(canonical)
      ? canonical.map((c) => String(c || '').trim().toLowerCase()).filter(Boolean)
      : [String(canonical || '').trim().toLowerCase()].filter(Boolean);
    if (!values.length) continue;
    if (!result[key]) result[key] = [];
    result[key] = Array.from(new Set([...result[key], ...values]));
  }
  return result;
}

export function expandRestaurantAliases(normalizedText = '', dynamicMap = {}) {
  if (!normalizedText) return normalizedText;
  const aliasMap = normalizeAliasMap(dynamicMap);
  let out = normalizedText;
  for (const [key, arr] of Object.entries(aliasMap)) {
    if (normalizedText.includes(key)) {
      out += ' ' + arr.join(' ');
    }
  }
  return out;
}

// ============================================================================
// FUZZY MATCHING
// ============================================================================

export function levenshtein(a, b) {
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

export function fuzzyMatch(a, b, threshold = 3) {
  if (!a || !b) return false;
  const normA = normalize(a);
  const normB = normalize(b);
  if (normA === normB) return true;
  if (normA.includes(normB) || normB.includes(normA)) return true;
  if (normA.split(' ')[0] === normB.split(' ')[0]) return true;
  const dist = levenshtein(normA, normB);
  return dist <= threshold;
}

export function fuzzyIncludes(name, text) {
  if (!name || !text) return false;
  const n = normalizeTxt(name); // Menu Item
  const t = normalizeTxt(text); // User Request

  // 1. Exact / Substring match (Fast)
  if (t.includes(n) || n.includes(t)) return true;

  const nToks = n.split(' ').filter(x => x.length > 1);
  const tToks = t.split(' ').filter(x => x.length > 1);

  // Helper: check if token 'query' exists in 'targetArray' loosely
  const hasToken = (query, targetArray) => {
    return targetArray.some(target => {
      if (target.includes(query) || query.includes(target)) return true;
      // Allow 1-2 char diff for inflections on longer words
      if (query.length > 3 && target.length > 3) {
        return levenshtein(query, target) <= 2;
      }
      return false;
    });
  };

  // 2. Forward Check: Does User Text cover enough of Menu Item? (e.g. User says full name)
  // Penalize long menu names if user only said one word, UNLESS that word is very unique?
  // Current logic: requires 60% of menu tokens.
  const nLong = nToks.filter(tok => tok.length > 2);
  if (nLong.length > 0) {
    const hits = nLong.filter(tok => hasToken(tok, tToks));
    if (hits.length / nLong.length >= 0.6) return true;
  }

  // 3. Reverse Check: Does Menu Item cover enough of User Request? (Shorthand / "Pizza")
  // User: "Burger" -> Menu: "Burger Klasyczny" (Match)
  // User: "Pomidorowa" -> Menu: "Zupa Pomidorowa" (Match)
  const tLong = tToks.filter(tok => tok.length > 2);

  // Guard: Don't match generic 3-letter words blindly if that's all there is
  if (tLong.length === 0) return false;

  const matchedUserTokens = tLong.filter(tok => hasToken(tok, nToks));
  const userCoverage = matchedUserTokens.length / tLong.length;

  // If user said 1 strong word (e.g. "pomidorowa"), and it matches -> 100% -> OK.
  // If user said "zupę pomidorową" (2 words), and both match -> 100% -> OK.
  // Threshold: 0.75 allows "zupa pomidorowa szybka" (2/3 match)
  if (userCoverage >= 0.75) return true;

  // 4. Special Case: Single significant token match (e.g. "Schabowy")
  // If user provided single significant word that matches perfectly/strongly a significant word in menu
  if (tLong.length === 1 && nToks.length > 0) {
    if (hasToken(tLong[0], nToks)) return true;
  }

  return false;
}

// ============================================================================
// QUANTITY & SIZE EXTRACTION
// ============================================================================

const QTY_WORDS = {
  'jedno': 1, 'jedna': 1, 'jeden': 1,
  'dwa': 2, 'dwie': 2, 'dwóch': 2,
  'trzy': 3, 'trzech': 3,
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

  return 1;
}

export function extractSize(text = '') {
  if (!text) return null;
  const s = normalizeTxt(text);

  const m = s.match(/\b(26|28|30|31|32|40)\s*(cm)?\b/);
  if (m) return parseInt(m[1], 10);

  if (/\b(mala|mała|small)\b/.test(s)) return 26;
  if (/\b(srednia|średnia|medium)\b/.test(s)) return 32;
  if (/\b(duza|duża|large)\b/.test(s)) return 40;

  return null;
}

// ============================================================================
// LOCATION & CUISINE EXTRACTION
// ============================================================================

export function extractLocation(text) {
  const locationKeywords = ['w', 'na', 'blisko', 'koło', 'niedaleko', 'obok', 'przy'];
  const pattern = new RegExp(`(?:${locationKeywords.join('|')})\\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)*)`, 'i');
  const match = text.match(pattern);

  let location = null;

  if (match) {
    location = match[1]?.trim();
  } else {
    // Fallback: Spróbuj wyłapać miasto bez przedimka (np. "Piekary Śląskie")
    const cityPattern = /\b([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)*)\b/g;
    const cities = text.match(cityPattern);
    if (cities && cities.length > 0) {
      // Weź ostatnie słowo z dużej litery (najprawdopodobniej miasto)
      location = cities[cities.length - 1];
    }
  }

  if (!location) return null;

  const blacklist = ['tutaj', 'tu', 'szybko', 'pobliżu', 'okolicy', 'menu', 'coś', 'cos', 'azjatyckiego', 'azjatyckie', 'szybkiego', 'dobrego', 'innego', 'Zamów', 'Pokaż', 'Znajdź', 'Chcę'];
  const locationLower = location.toLowerCase();

  if (blacklist.includes(locationLower) || blacklist.some(word => locationLower.startsWith(word + ' '))) {
    return null;
  }

  // Normalize case endings for Polish cities
  // 🔧 Obsługa złożonych nazw (np. "Piekarach Śląskich" → "Piekary Śląskie")
  location = location
    .split(' ')
    .map(word => {
      // Priorytety: najpierw dłuższe końcówki, potem krótsze
      if (/ich$/i.test(word)) {
        return word.replace(/ich$/i, 'ie');  // Śląskich → Śląskie (najpierw!)
      }
      if (/im$/i.test(word)) {
        return word.replace(/im$/i, 'ie');   // Śląskim → Śląskie
      }
      if (/ach$/i.test(word)) {
        return word.replace(/ach$/i, 'y');  // Piekarach → Piekary
      }
      if (/ami$/i.test(word)) {
        return word.replace(/ami$/i, 'a');   // Gliwicami → Gliwica
      }
      if (/iu$/i.test(word)) {
        return word.replace(/iu$/i, '');     // Bytomiu → Bytom
      }
      // Wyjątek: Nie zamieniaj "-ie" jeśli słowo już jest w mianowniku (np. "Śląskie", "Pomorskie")
      const adjectiveEndings = /skie$/i;
      if (adjectiveEndings.test(word)) {
        return word; // Zostaw bez zmian
      }
      if (/ie$/i.test(word)) {
        return word.replace(/ie$/i, 'a');    // Katowicie → Katowica
      }
      return word;
    })
    .join(' ');

  return location;
}

const CUISINE_MAP = {
  'pizza': 'Pizzeria', 'pizze': 'Pizzeria', 'pizzy': 'Pizzeria', 'pizzeria': 'Pizzeria',
  'kebab': 'Kebab', 'kebaba': 'Kebab', 'kebabu': 'Kebab',
  'burger': 'Amerykańska', 'burgera': 'Amerykańska', 'burgery': 'Amerykańska',
  'wloska': 'Włoska', 'wloskiej': 'Włoska',
  'polska': 'Polska', 'polskiej': 'Polska',
  'wietnamska': 'Wietnamska', 'wietnamskiej': 'Wietnamska',
  'chinska': 'Chińska', 'chinskiej': 'Chińska',
  'tajska': 'Tajska', 'tajskiej': 'Tajska',
  'azjatyckie': 'azjatyckie', 'azjatyckiej': 'azjatyckiej',
  'fastfood': 'fastfood', 'fast food': 'fast food',
  'lokalne': 'lokalne', 'lokalnej': 'lokalnej',
  'wege': 'wege', 'wegetarianskie': 'wege'
};

export function extractCuisineType(text) {
  const normalized = normalize(text);
  for (const [keyword, cuisineType] of Object.entries(CUISINE_MAP)) {
    if (normalized.includes(keyword)) return cuisineType;
  }
  return null;
}

// ============================================================================
// DISTANCE CALCULATION
// ============================================================================

export function calculateDistance(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

