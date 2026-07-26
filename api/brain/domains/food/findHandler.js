/**
 * Food Domain: Find Restaurants
 * Odpowiada za wyszukiwanie restauracji (SQL/Geo).
 * Refactored: Clean Architecture with Decision Matrix (City > GPS > Fallback)
 */

import { extractLocation, extractCuisineType } from '../../nlu/extractors.js';
import { pluralPl } from '../../utils/formatter.js';
import { calculateDistance } from '../../helpers.js';
import { supabase } from '../../../_supabase.js';
import { normalizeGroundedMenuQuery, scoreGroundedMenuItem } from '../../grounding/menuGrounding.js';
import { filterRestaurantsForPublicDemo, isPublicDemoCatalogOnly } from '../../data/restaurantCatalog.js';

// ── Discovery Ranking Layer (additive, non-breaking) ──────────
// Lazy import — jeśli moduł nie istnieje (stare środowisko), discovery po
// prostu nie jest aktywne. Handler nie crasha.
let _matchQueryToTaxonomy = null;
let _runDiscovery = null;
let _buildChips = null;
let _discoveryUnavailable = false;

// Eager preload — first execute() call pays ~0ms instead of ~50ms import latency
const _discoveryPreload = loadDiscoveryEngine();

async function loadDiscoveryEngine() {
    if (_discoveryUnavailable) return false;
    if (_matchQueryToTaxonomy) return true; // już załadowany
    try {
        // Prefer JS artifact in runtime (Node), then TS source in dev/test runners.
        let mod = null;
        try {
            mod = await import('../../discovery/discoveryFilter.js');
        } catch {
            mod = await import('../../discovery/discoveryFilter.ts');
        }
        _matchQueryToTaxonomy = mod.matchQueryToTaxonomy;
        _runDiscovery = mod.runDiscovery;
        _buildChips = mod.buildChips || null;
        return true;
    } catch (err) {
        _discoveryUnavailable = true;
        console.warn('[Discovery] Moduł niedostępny — tryb legacy:', err?.message);
        return false;
    }
}

// --- Configuration & Constants ---

const SERVICE_CITY = 'Piekary Śląskie';
const SERVICE_CITY_KEYWORD = 'piekar';
const ALLOW_NEARBY_CITY_FALLBACK = false;

const KNOWN_CITIES = [SERVICE_CITY, 'Bytom', 'Radzionków', 'Chorzów', 'Katowice', 'Siemianowice Śląskie', 'Świerklaniec', 'Zabrze', 'Tarnowskie Góry', 'Świętochłowice', 'Mysłowice'];

const NEARBY_CITY_MAP = {
    'piekary śląskie': ['Bytom', 'Radzionków', 'Chorzów', 'Siemianowice Śląskie', 'Świerklaniec'],
    'bytom': ['Piekary Śląskie', 'Radzionków', 'Chorzów', 'Zabrze'],
    'radzionków': ['Piekary Śląskie', 'Bytom', 'Tarnowskie Góry'],
    'chorzów': ['Katowice', 'Bytom', 'Świętochłowice'],
    'katowice': ['Chorzów', 'Siemianowice Śląskie', 'Mysłowice'],
};

// --- Helper Functions (Pure Logic) ---

function isSupportedServiceCity(value) {
    const normalized = normalizeLooseText(value);
    return normalized.includes(SERVICE_CITY_KEYWORD);
}

function buildServiceCityOnlyReply(requestedCity = null) {
    if (requestedCity) {
        return `Na razie działamy tylko w ${SERVICE_CITY}. Dla "${requestedCity}" nie mam jeszcze restauracji.`;
    }
    return `Na razie działamy tylko w ${SERVICE_CITY}.`;
}

function filterRestaurantsToServiceCity(restaurants) {
    if (!Array.isArray(restaurants) || restaurants.length === 0) return [];
    return restaurants.filter((restaurant) => isSupportedServiceCity(restaurant?.city || ''));
}

function normalizeLocation(loc) {
    if (!loc) return null;
    const l = loc.toLowerCase().trim();
    if (
        /\bcurrent\s+location\b/i.test(l)
        || /\bmy\s+location\b/i.test(l)
        || /\bnearby\b/i.test(l)
        || /\bw\s*poblizu\b/i.test(l)
        || /\bblisko\b/i.test(l)
    ) {
        return null;
    }
    if (l.includes('piekar')) return 'Piekary Śląskie';
    if (l.includes('katow')) return 'Katowice';
    if (l.includes('bytom')) return 'Bytom';
    // Fallback for known cities check
    const knownMatch = KNOWN_CITIES.find(c => c.toLowerCase() === l);
    return knownMatch || loc; // Return original if no normalization match, specific handlers might fuzzy match later
}

function normalizeLooseText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ł/g, 'l')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LOCATION_ADDRESS_HINTS = [
    'ul.', 'ul ', 'ulica', 'aleja', 'al.', 'al ',
    'plac', 'pl.', 'rondo', 'os.', 'os ', 'osiedle',
    'numer', ' nr '
];

function isAddressLikeLocation(value) {
    const normalized = normalizeLooseText(value);
    if (!normalized) return false;

    const hasStreetHint = LOCATION_ADDRESS_HINTS.some((hint) => normalized.includes(hint));
    const hasStreetNumber = /\b\d+[a-z]?\b/i.test(normalized);
    const endsWithStreetNumber = /^[a-z\s.-]{3,}\s+\d+[a-z]?$/i.test(normalized);

    return hasStreetHint || (hasStreetNumber && endsWithStreetNumber);
}

function resolveSessionCityFallback(session) {
    const candidate = session?.last_location || session?.default_city || null;
    if (!candidate) return null;
    if (isAddressLikeLocation(candidate)) return null;
    const normalized = normalizeLocation(candidate) || candidate;
    if (!isSupportedServiceCity(normalized)) return null;
    return SERVICE_CITY;
}

const CUISINE_NORMALIZATION_RULES = [
    { pattern: /\bitalian\b|\bwlosk\b|\bwloska\b/, value: 'Wloska' },
    { pattern: /\bpolish\b|\bpolsk\b|\bpolska\b/, value: 'Polska' },
    { pattern: /\bamerican\b|\bamerykan\b|\bamerykanska\b/, value: 'Amerykanska' },
    { pattern: /\bfast\s*food\b|\bfastfood\b/, value: 'Fast Food' },
    { pattern: /\basian\b|\bazjat\b|\bazjatycka\b/, value: 'Azjatycka' },
    { pattern: /\bvietnam(?:ese)?\b|\bwietnamsk\w*\b/, value: 'Azjatycka' },
    { pattern: /\bthai\b|\btajsk\w*\b/, value: 'Azjatycka' },
    { pattern: /\bkebab\b|\bdoner\b/, value: 'Kebab' },
    { pattern: /\bpizza\b|\bpizzeria\b/, value: 'Pizza' },
    { pattern: /\bpierog\b|\bpierogi\b/, value: 'Pierogi' },
];

function normalizeCuisineSignal(rawCuisine) {
    if (!rawCuisine) return null;

    const original = String(rawCuisine).trim();
    const normalized = normalizeLooseText(original);
    if (!normalized) return null;

    // Guard against accidental restaurant-name downgrade in cuisine slot.
    if (normalized.includes('restauracja ')) return null;

    for (const rule of CUISINE_NORMALIZATION_RULES) {
        if (rule.pattern.test(normalized)) {
            return rule.value;
        }
    }

    return original;
}

function looksLikeCuisineLabel(value) {
    const normalized = normalizeLooseText(value);
    if (!normalized) return false;
    if (GENERIC_DISCOVERY_TERMS.has(normalized)) return true;
    return CUISINE_NORMALIZATION_RULES.some((rule) => rule.pattern.test(normalized));
}

const ITEM_FAMILY_DICTIONARY = {
    rollo: ['rollo', 'rolo', 'rollo kebab', 'kebab rollo', 'durum rollo'],
    lawasz: ['lawasz', 'lawasz kebab', 'lawasz kebs', 'lawaszkebab'],
    pita: ['pita', 'pita kebab', 'pita rollo'],
    kebab: ['kebab', 'kebaba', 'kebaby', 'doner', 'doner kebab', 'döner'],
    lody: ['lody', 'lodow', 'lodowy', 'lodowe', 'lodami', 'ice cream', 'icecream', 'gelato'],
    deser: ['deser', 'desery', 'dessert', 'desserts', 'ciasto', 'ciasta', 'tort', 'krem', 'gofry', 'nalesniki'],
    napoje: ['napoj', 'napoje', 'napoju', 'drinks', 'drink', 'beverage', 'beverages', 'cola', 'coca cola', 'fanta', 'sprite', 'woda'],
    calzone: ['calzone', 'pizza calzone'],
    schabowy: ['schabowy', 'kotlet schabowy', 'schab tradycyjny'],
    nalesnik: ['nalesnik', 'nalesniki', 'nalesniki', 'naleśnik', 'naleśniki'],
    pierogi: ['pierogi', 'pierog', 'pieróg'],
    zurek: ['zurek', 'żurek', 'zur slaski', 'żur śląski'],
};

const GENERIC_DISCOVERY_TERMS = new Set([
    'restauracja', 'restauracje', 'restauracji', 'lokal', 'lokale', 'jedzenie',
    'pizza', 'pizzeria', 'pizzy', 'kebab', 'burger', 'burgery', 'sushi', 'ramen',
    'wloska', 'włoska', 'azjatycka', 'azjatyckie', 'polska', 'fastfood',
]);

const ITEM_QUERY_STOPWORDS = new Set([
    'gdzie', 'zjem', 'szukam', 'szukamy', 'restauracje', 'restauracji', 'restauracja',
    'lokal', 'lokale', 'w', 'na', 'do', 'po', 'poprosze', 'poproszę',
    'chce', 'chcę', 'mam', 'ochote', 'ochotę', 'prosze', 'proszę',
    'z', 'i', 'oraz',
]);

const NON_DISH_TOKENS = new Set([
    'znajdz', 'znajdź', 'pokaz', 'pokaż', 'pokazcie', 'pokażcie', 'cos', 'coś',
    'jakies', 'jakieś', 'miejsce', 'miejsca', 'lokal', 'lokale', 'restauracje',
    'restauracji', 'knajpa', 'knajpy', 'jedzenie',
]);

const ITEM_SIGNAL_TOKENS = new Set(
    Object.values(ITEM_FAMILY_DICTIONARY)
        .flat()
        .map((term) => normalizeLooseText(term))
        .flatMap((term) => term.split(' '))
        .filter((token) => token.length >= 4)
);

function buildItemAliases(itemQuery) {
    const normalizedQuery = normalizeLooseText(itemQuery);
    const aliases = new Set([normalizedQuery]);

    for (const [family, terms] of Object.entries(ITEM_FAMILY_DICTIONARY)) {
        const normalizedTerms = terms.map((term) => normalizeLooseText(term));
        if (
            family === normalizedQuery
            || normalizedTerms.some((term) =>
                normalizedQuery === term
                || normalizedQuery.includes(term)
                || (normalizedQuery.length >= 4 && term.startsWith(normalizedQuery))
            )
        ) {
            aliases.add(normalizeLooseText(family));
            for (const term of normalizedTerms) aliases.add(term);
        }
    }

    for (const token of normalizedQuery.split(' ').filter((token) => token.length >= 4 && !ITEM_QUERY_STOPWORDS.has(token))) {
        aliases.add(token);
    }

    return Array.from(aliases).filter(Boolean);
}

const MENU_LED_REQUIRED_ALIASES = new Set([
    'lody', 'lodow', 'lodowy', 'lodowe', 'lodami', 'ice cream', 'icecream', 'gelato',
    'deser', 'desery', 'dessert', 'desserts',
    'napoj', 'napoje', 'napoju', 'drinks', 'drink', 'beverage', 'beverages', 'cola', 'coca cola',
]);

function requiresMenuLedDiscovery(itemQuery) {
    return buildItemAliases(itemQuery).some((alias) => MENU_LED_REQUIRED_ALIASES.has(alias));
}

const GROUNDED_REQUIRED_QUALIFIERS = new Set(['pikant']);

function requiresGroundedQualifierMatch(itemQuery) {
    return normalizeGroundedMenuQuery(itemQuery)
        .split(' ')
        .some((token) => GROUNDED_REQUIRED_QUALIFIERS.has(token));
}

function parseDbAliases(rawAliases) {
    if (Array.isArray(rawAliases)) {
        return rawAliases
            .map((alias) => normalizeLooseText(alias))
            .filter(Boolean);
    }

    if (typeof rawAliases !== 'string') return [];
    const trimmed = rawAliases.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed
                    .map((alias) => normalizeLooseText(alias))
                    .filter(Boolean);
            }
        } catch {
            // fallthrough to delimiter split
        }
    }

    return trimmed
        .split(/[,;|]/)
        .map((alias) => normalizeLooseText(alias))
        .filter(Boolean);
}

function buildItemSearchCorpus(item) {
    const corpus = new Set();
    const directFields = [item?.base_name, item?.name, item?.item_family];

    for (const field of directFields) {
        const normalized = normalizeLooseText(field);
        if (normalized) corpus.add(normalized);
    }

    for (const alias of parseDbAliases(item?.item_aliases)) {
        if (alias) corpus.add(alias);
    }

    const family = normalizeLooseText(item?.item_family);
    if (family && ITEM_FAMILY_DICTIONARY[family]) {
        for (const term of ITEM_FAMILY_DICTIONARY[family]) {
            const normalized = normalizeLooseText(term);
            if (normalized) corpus.add(normalized);
        }
    }

    return Array.from(corpus).filter(Boolean);
}

function extractItemQueryCandidate(ctx, discoveryParams) {
    const entityDish = String(
        ctx?.entities?.dish ||
        ctx?.entities?.item ||
        ctx?.entities?.items?.[0]?.dish ||
        ctx?.entities?.items?.[0]?.name ||
        ''
    ).trim();
    const cuisineEntity = String(ctx?.entities?.cuisine || '').trim();

    if (entityDish) {
        const normalizedEntity = normalizeLooseText(entityDish);
        if (normalizedEntity && !GENERIC_DISCOVERY_TERMS.has(normalizedEntity)) {
            return entityDish;
        }
    }

    if (cuisineEntity) {
        const normalizedCuisineEntity = normalizeLooseText(cuisineEntity);
        if (normalizedCuisineEntity && !GENERIC_DISCOVERY_TERMS.has(normalizedCuisineEntity)) {
            return cuisineEntity;
        }
    }

    const normalizedCuisine = normalizeLooseText(discoveryParams?.cuisine || '');
    if (!entityDish && (GENERIC_DISCOVERY_TERMS.has(normalizedCuisine) || normalizedCuisine.includes('pizzeria'))) {
        return null;
    }

    let candidate = normalizeLooseText(ctx?.text || '');
    if (!candidate) return null;

    const cleanupPatterns = [
        /\bgdzie zjem\b/g,
        /\bgdzie moge zjesc\b/g,
        /\bszukam\b/g,
        /\bchce zjesc\b/g,
        /\bchce\b/g,
        /\bmam ochote na\b/g,
        /\brestauracji\b/g,
        /\brestauracje\b/g,
        /\brestauracja\b/g,
        /\blokal\b/g,
        /\blokale\b/g,
    ];

    for (const pattern of cleanupPatterns) {
        candidate = candidate.replace(pattern, ' ');
    }

    const normalizedLocation = normalizeLooseText(discoveryParams?.location || discoveryParams?.originalLocation || '');
    if (normalizedLocation) {
        candidate = candidate.replace(new RegExp(`\\b${escapeRegex(normalizedLocation)}\\b`, 'g'), ' ');
        for (const token of normalizedLocation.split(' ').filter((token) => token.length >= 3)) {
            candidate = candidate.replace(new RegExp(`\\b${escapeRegex(token)}\\b`, 'g'), ' ');
        }
    }
    // Usuń końcowe frazy lokalizacyjne, np. "w piekarach", "na bytomiu".
    candidate = candidate.replace(/\b(w|na)\s+[a-z0-9]{3,}(?:\s+[a-z0-9]{3,})?$/g, ' ');

    candidate = candidate.replace(/\s+/g, ' ').trim();
    if (!candidate) return null;

    const normalizedText = normalizeLooseText(ctx?.text || '');
    const hasDishIntentHint = /(zjem|chce zjesc|chce|mam ochote na|zamawiam|poprosze)/.test(normalizedText);

    const meaningfulTokens = candidate
        .split(' ')
        .filter((token) => token.length >= 3 && !ITEM_QUERY_STOPWORDS.has(token));
    if (!meaningfulTokens.length) return null;

    const hasOnlyNonDishTokens = meaningfulTokens.every((token) => NON_DISH_TOKENS.has(token));
    if (hasOnlyNonDishTokens) return null;

    const hasFamilySignal = meaningfulTokens.some((token) => ITEM_SIGNAL_TOKENS.has(token));
    if (!entityDish && !cuisineEntity && !hasFamilySignal && !hasDishIntentHint) return null;

    if (meaningfulTokens.length === 1 && GENERIC_DISCOVERY_TERMS.has(meaningfulTokens[0])) {
        return null;
    }

    const groundedCandidate = normalizeGroundedMenuQuery(candidate);
    return groundedCandidate || meaningfulTokens.join(' ');
}

function scoreMenuItemMatch(item, aliases) {
    const corpus = buildItemSearchCorpus(item);
    if (!corpus.length) return 0;

    let best = 0;
    for (const needle of corpus) {
        for (const alias of aliases) {
            if (!alias) continue;
            if (needle === alias) {
                best = Math.max(best, 140);
                continue;
            }
            if (needle.startsWith(`${alias} `) || needle.endsWith(` ${alias}`)) {
                best = Math.max(best, 120);
                continue;
            }
            if (containsNormalizedPhrase(needle, alias)) {
                best = Math.max(best, 100);
                continue;
            }
            if (needle.length >= 5 && containsNormalizedPhrase(alias, needle)) {
                best = Math.max(best, 85);
            }
        }
    }

    const queryTokens = aliases
        .flatMap((alias) => alias.split(' '))
        .filter((token) => token.length >= 4 && !ITEM_QUERY_STOPWORDS.has(token));

    if (queryTokens.length > 0) {
        const uniqueTokens = [...new Set(queryTokens)];
        const tokenHits = uniqueTokens.filter((token) =>
            corpus.some((needle) => containsNormalizedPhrase(needle, token))
        ).length;
        if (tokenHits > 0) {
            best = Math.max(best, 60 + tokenHits * 10);
        }
    }

    return best;
}

function containsNormalizedPhrase(haystack, phrase) {
    if (!haystack || !phrase) return false;
    const normalizedHaystack = ` ${haystack.replace(/\s+/g, ' ')} `;
    const normalizedPhrase = phrase.replace(/\s+/g, ' ').trim();
    if (!normalizedPhrase) return false;
    return normalizedHaystack.includes(` ${normalizedPhrase} `);
}

async function fetchCityMenuRows(restaurantIds) {
    const selectColumns = 'id, name, base_name, item_family, item_aliases, restaurant_id, available';
    const buildQuery = () => supabase
        .from('menu_items_v2')
        .select(selectColumns)
        .in('restaurant_id', restaurantIds);

    const probeQuery = buildQuery();

    if (probeQuery && typeof probeQuery.range === 'function') {
        const batchSize = 1000;
        const maxRows = 20000;
        const rows = [];

        for (let from = 0; from < maxRows; from += batchSize) {
            const to = from + batchSize - 1;
            const { data, error } = await buildQuery().range(from, to);
            if (error) throw error;

            const page = Array.isArray(data) ? data : [];
            if (!page.length) break;

            rows.push(...page);
            if (page.length < batchSize) break;
        }

        return rows;
    }

    if (probeQuery && typeof probeQuery.limit === 'function') {
        const { data, error } = await buildQuery().limit(5000);
        if (error) throw error;
        return Array.isArray(data) ? data : [];
    }

    const { data, error } = await buildQuery();
    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

async function rankRestaurantsByItemFromCandidates({ restaurants, coords, itemQuery }) {
    const aliases = buildItemAliases(itemQuery);
    if (!aliases.length || !Array.isArray(restaurants) || restaurants.length === 0) return [];

    const restaurantIds = restaurants.map((restaurant) => restaurant?.id).filter(Boolean);
    if (!restaurantIds.length) return [];

    const menuRows = await fetchCityMenuRows(restaurantIds);
    if (!Array.isArray(menuRows) || menuRows.length === 0) return [];

    const byRestaurant = new Map();
    for (const item of menuRows) {
        if (item?.available === false) continue;
        const itemName = item?.base_name || item?.name || '';
        const legacyScore = scoreMenuItemMatch(item, aliases);
        const groundedScore = scoreGroundedMenuItem(item, itemQuery);
        if (requiresGroundedQualifierMatch(itemQuery) && groundedScore < 75) continue;
        if (legacyScore < 85 && groundedScore < 75) continue;
        const score = Math.max(legacyScore, groundedScore);

        const restaurantId = item?.restaurant_id;
        if (!restaurantId) continue;

        const existing = byRestaurant.get(restaurantId) || {
            maxScore: 0,
            hits: new Set(),
        };
        existing.maxScore = Math.max(existing.maxScore, score);
        if (itemName) existing.hits.add(String(itemName));
        byRestaurant.set(restaurantId, existing);
    }

    const ranked = restaurants
        .map((restaurant) => {
            const match = byRestaurant.get(restaurant.id);
            if (!match) return null;
            const matchedItems = Array.from(match.hits).slice(0, 3);
            const distance = (coords && Number.isFinite(restaurant.lat) && Number.isFinite(restaurant.lng))
                ? calculateDistance(coords.lat, coords.lng, restaurant.lat, restaurant.lng)
                : restaurant.distance;
            return {
                ...restaurant,
                distance,
                item_match_score: match.maxScore,
                matched_menu_items: matchedItems,
            };
        })
        .filter(Boolean);

    ranked.sort((a, b) => {
        if ((b.item_match_score || 0) !== (a.item_match_score || 0)) {
            return (b.item_match_score || 0) - (a.item_match_score || 0);
        }
        const aHits = Array.isArray(a.matched_menu_items) ? a.matched_menu_items.length : 0;
        const bHits = Array.isArray(b.matched_menu_items) ? b.matched_menu_items.length : 0;
        if (bHits !== aHits) return bHits - aHits;
        if (Number.isFinite(a.distance) && Number.isFinite(b.distance)) {
            return a.distance - b.distance;
        }
        return 0;
    });

    return ranked.slice(0, 10);
}

async function searchRestaurantsByItemInCity({ location, coords, itemQuery }) {
    const aliases = buildItemAliases(itemQuery);
    if (!aliases.length) return [];

    const { data: cityRestaurants, error: restErr } = await supabase
        .from('restaurants')
        .select('id, name, address, city, cuisine_type, lat, lng, delivery_available, price_level, taxonomy_groups, taxonomy_cats, taxonomy_tags, maps_rating, maps_ratings_total, opening_hours, phone, website, image_url, photo_gallery')
        .eq('is_active', true)
        .ilike('city', `%${location}%`)
        .limit(80);

    if (restErr) throw restErr;
    if (!Array.isArray(cityRestaurants) || cityRestaurants.length === 0) return [];

    const restaurantIds = cityRestaurants.map((restaurant) => restaurant.id).filter(Boolean);
    if (!restaurantIds.length) return [];

    const menuRows = await fetchCityMenuRows(restaurantIds);
    if (!Array.isArray(menuRows) || menuRows.length === 0) return [];

    const byRestaurant = new Map();
    for (const item of menuRows) {
        if (item?.available === false) continue;
        const itemName = item?.base_name || item?.name || '';
        const legacyScore = scoreMenuItemMatch(item, aliases);
        const groundedScore = scoreGroundedMenuItem(item, itemQuery);
        if (requiresGroundedQualifierMatch(itemQuery) && groundedScore < 75) continue;
        if (legacyScore < 85 && groundedScore < 75) continue;
        const score = Math.max(legacyScore, groundedScore);

        const restaurantId = item?.restaurant_id;
        if (!restaurantId) continue;

        const existing = byRestaurant.get(restaurantId) || {
            maxScore: 0,
            hits: new Set(),
        };
        existing.maxScore = Math.max(existing.maxScore, score);
        if (itemName) existing.hits.add(String(itemName));
        byRestaurant.set(restaurantId, existing);
    }

    const ranked = cityRestaurants
        .map((restaurant) => {
            const match = byRestaurant.get(restaurant.id);
            if (!match) return null;
            const matchedItems = Array.from(match.hits).slice(0, 3);
            const distance = (coords && Number.isFinite(restaurant.lat) && Number.isFinite(restaurant.lng))
                ? calculateDistance(coords.lat, coords.lng, restaurant.lat, restaurant.lng)
                : restaurant.distance;
            return {
                ...restaurant,
                distance,
                item_match_score: match.maxScore,
                matched_menu_items: matchedItems,
            };
        })
        .filter(Boolean);

    ranked.sort((a, b) => {
        if ((b.item_match_score || 0) !== (a.item_match_score || 0)) {
            return (b.item_match_score || 0) - (a.item_match_score || 0);
        }
        const aHits = Array.isArray(a.matched_menu_items) ? a.matched_menu_items.length : 0;
        const bHits = Array.isArray(b.matched_menu_items) ? b.matched_menu_items.length : 0;
        if (bHits !== aHits) return bHits - aHits;
        if (Number.isFinite(a.distance) && Number.isFinite(b.distance)) {
            return a.distance - b.distance;
        }
        return 0;
    });

    return ranked.slice(0, 10);
}

function isPizzaDiscoveryQuery(text, cuisine) {
    const blob = normalizeLooseText(`${text || ''} ${cuisine || ''}`);
    return blob.includes('pizza') || blob.includes('pizz') || blob.includes('pizzeria');
}

function hasPizzaRestaurantSignal(restaurant) {
    const corpus = normalizeLooseText(
        `${restaurant?.name || ''} ${restaurant?.cuisine_type || ''} ${restaurant?.description || ''}`
    );
    return corpus.includes('pizza') || corpus.includes('pizz') || corpus.includes('pizzeria');
}

function rankPizzaFirst(restaurants) {
    const scored = (restaurants || []).map((restaurant, idx) => {
        const corpus = normalizeLooseText(
            `${restaurant?.name || ''} ${restaurant?.cuisine_type || ''} ${restaurant?.description || ''}`
        );
        const score =
            (hasPizzaRestaurantSignal(restaurant) ? 100 : 0) +
            (corpus.includes('pizzeria') ? 20 : 0) +
            (corpus.includes('wloska') ? 10 : 0);
        return { restaurant, score, idx };
    });

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.idx - b.idx;
    });

    return scored.map((row) => row.restaurant);
}

function mergeUniqueRestaurants(primary, secondary) {
    const seen = new Set();
    const out = [];
    for (const r of [...(primary || []), ...(secondary || [])]) {
        const key = r?.id || `${r?.name || ''}:${r?.city || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
    }
    return out;
}

function getCuisineSearchVariants(cuisine) {
    if (!cuisine) return [];
    const base = String(cuisine).trim();
    const normalized = normalizeLooseText(base);
    if (!normalized) return [base];

    if (normalized === 'azjatycka' || normalized === 'asian') {
        // Live DB often stores concrete cuisines (Wietnamska/Tajska/Chinska)
        // instead of umbrella "Azjatycka".
        return [base, 'Wietnamska', 'Tajska', 'Chinska', 'Chińska'];
    }

    if (normalized === 'fast food' || normalized === 'fastfood') {
        // "fast food" is a user-level umbrella, while DB uses concrete cuisine labels.
        return [base, 'Amerykanska', 'Amerykańska', 'Kebab', 'Burger', 'Burgery'];
    }

    // Jeśli cuisine nie pasuje do żadnej reguły normalizacji (np. 'ostre', 'kawiarnia'),
    // nie filtruj SQL po cuisine_type — to są sygnały taksonomiczne (tagi/kategorie),
    // a nie cuisine_type w bazie. Discovery engine je obsłuży.
    const matchesAnyRule = CUISINE_NORMALIZATION_RULES.some(r => r.pattern.test(normalized));
    if (!matchesAnyRule) return [];

    return [base];
}

async function searchRestaurantsWithCuisineVariants(repo, location, cuisine) {
    if (!cuisine) return repo.searchRestaurants(location, null);
    const variants = getCuisineSearchVariants(cuisine);
    if (variants.length === 0) return repo.searchRestaurants(location, null);
    if (variants.length === 1) return repo.searchRestaurants(location, variants[0]);
    // Parallel queries for multiple variants (e.g. "azjatycka" → 5 variants)
    const results = await Promise.all(
        variants.map(v => repo.searchRestaurants(location, v).catch(() => []))
    );
    return results.reduce((merged, rows) => mergeUniqueRestaurants(merged, rows || []), []);
}

async function searchNearbyWithCuisineVariants(repo, lat, lng, radiusKm, cuisine) {
    if (!cuisine) return repo.searchNearby(lat, lng, radiusKm, null);
    const variants = getCuisineSearchVariants(cuisine);
    if (variants.length === 0) return repo.searchNearby(lat, lng, radiusKm, null);
    if (variants.length === 1) return repo.searchNearby(lat, lng, radiusKm, variants[0]);
    // Parallel queries for multiple variants
    const results = await Promise.all(
        variants.map(v => repo.searchNearby(lat, lng, radiusKm, v).catch(() => []))
    );
    return results.reduce((merged, rows) => mergeUniqueRestaurants(merged, rows || []), []);
}

function resolveDiscoveryMode(ctx) {
    const { text, session, entities, body } = ctx;

    // Parse coordinates first so live tool calls can force GPS path when available.
    const bodyLat = body?.lat != null ? parseFloat(body.lat) : null;
    const bodyLng = body?.lng != null ? parseFloat(body.lng) : null;
    const bodyCoords = (Number.isFinite(bodyLat) && Number.isFinite(bodyLng))
        ? { lat: bodyLat, lng: bodyLng }
        : null;
    const ctxCoords = (ctx?.coords && Number.isFinite(ctx.coords.lat) && Number.isFinite(ctx.coords.lng))
        ? { lat: ctx.coords.lat, lng: ctx.coords.lng }
        : null;
    const sessionLat = session?.session_lat != null ? parseFloat(session.session_lat) : null;
    const sessionLng = session?.session_lng != null ? parseFloat(session.session_lng) : null;
    const sessionCoords = (Number.isFinite(sessionLat) && Number.isFinite(sessionLng))
        ? { lat: sessionLat, lng: sessionLng }
        : null;
    const isLiveFindNearbyCall =
        String(ctx?.body?.meta?.sourceTool || '') === 'find_nearby'
        || String(ctx?.source || '') === 'live_tool:find_nearby'
        || String(ctx?.body?.meta?.channel || '') === 'live_tools';

    // Live: session GPS is source of truth. Gemini hallucinates coordinates (often Warsaw 52.23/21.01),
    // so prefer sessionCoords over bodyCoords from tool args.
    // Non-live: bodyCoords take priority (user-provided location).
    const coords = (isLiveFindNearbyCall && sessionCoords)
        ? sessionCoords
        : (bodyCoords || ctxCoords || sessionCoords || null);

    const hasAnyGpsInput = Boolean(coords);
    const preferGpsForLiveNearby = isLiveFindNearbyCall && hasAnyGpsInput;

    const rawCuisineType = entities?.cuisine || extractCuisineType(text) || session?.pendingDish || null;
    const cuisineType = normalizeCuisineSignal(rawCuisineType);
    if (rawCuisineType && cuisineType && normalizeLooseText(rawCuisineType) !== normalizeLooseText(cuisineType)) {
        console.log('[DISCOVERY_CUISINE_NORMALIZED]', JSON.stringify({
            from: rawCuisineType,
            to: cuisineType,
        }));
    }

    // 1. Extract location parameters
    let rawLocation = entities?.location || null;
    if (!rawLocation && !preferGpsForLiveNearby) {
        rawLocation = extractLocation(text);
    }

    if (rawLocation) {
        const normalizedLocation = normalizeLooseText(rawLocation);
        const normalizedRawCuisine = normalizeLooseText(rawCuisineType || '');
        const normalizedCuisine = normalizeLooseText(cuisineType || '');
        const locationMirrorsCuisine =
            (normalizedRawCuisine && normalizedLocation === normalizedRawCuisine)
            || (normalizedCuisine && normalizedLocation === normalizedCuisine);

        if (locationMirrorsCuisine || looksLikeCuisineLabel(rawLocation)) {
            console.log('[DISCOVERY_LOCATION_REJECTED_AS_CUISINE]', JSON.stringify({
                rawLocation,
                rawCuisineType,
                cuisineType,
            }));
            rawLocation = null;
        }
    }

    if (rawLocation && isAddressLikeLocation(rawLocation)) {
        const fallbackCity = resolveSessionCityFallback(session);
        console.log('[DISCOVERY_LOCATION_SANITIZED]', JSON.stringify({
            rawLocation,
            fallbackCity,
        }));
        rawLocation = fallbackCity;
    }

    // Fallback to session city only when GPS is unavailable.
    // If coordinates exist, keep location empty so resolver can use GPS mode and distance ranking.
    if (!rawLocation && !preferGpsForLiveNearby && !coords) {
        rawLocation = resolveSessionCityFallback(session);
    }

    const normalizedLoc = normalizeLocation(rawLocation);
    const normalizedText = normalizeLooseText(text);
    const nearbyCueFromMeta = Boolean(ctx?.body?.meta?.nearbyCue);
    const hasNearbyIntentSignal =
        nearbyCueFromMeta
        || normalizedText.includes('w poblizu')
        || normalizedText.includes('blisko')
        || normalizedText.includes('nearby')
        || normalizedText.includes('obok')
        || normalizedText.includes('w okolicy');
    const locationLooksLikePlaceholder = rawLocation
        ? normalizeLocation(rawLocation) === null
        : false;

    const shouldForceGpsForLive =
        hasNearbyIntentSignal
        || !normalizedLoc
        || locationLooksLikePlaceholder;

    // Live GPS override:
    // If this is a live find_nearby call with available GPS, prefer GPS whenever
    // nearby intent is present or location is empty/placeholder.
    if (preferGpsForLiveNearby && coords && shouldForceGpsForLive) {
        console.log('[DISCOVERY_GPS_LIVE_OVERRIDE]', JSON.stringify({
            rawLocation,
            normalizedLoc,
            hasNearbyIntentSignal,
            nearbyCueFromMeta,
            locationLooksLikePlaceholder,
            coords,
        }));
        return {
            mode: 'GPS',
            coords,
            cuisine: cuisineType
        };
    }

    // Generic GPS override:
    // Even outside strict live-tool metadata, when we have coordinates and no explicit city,
    // prefer GPS to preserve "nearby" behavior and distance output.
    if (coords && !normalizedLoc && shouldForceGpsForLive) {
        console.log('[DISCOVERY_GPS_OVERRIDE]', JSON.stringify({
            rawLocation,
            normalizedLoc,
            hasNearbyIntentSignal,
            locationLooksLikePlaceholder,
            coords,
        }));
        return {
            mode: 'GPS',
            coords,
            cuisine: cuisineType
        };
    }

    // 2. Determine Mode
    if (normalizedLoc) {
        if (!isSupportedServiceCity(normalizedLoc)) {
            // When GPS is available, silently fall back to GPS instead of rejecting.
            // Gemini ASR often mishears supported city names (e.g. "Piekary" → "Poznań", "piekarnie").
            // The user is almost certainly in the supported city — GPS will find the right restaurants.
            if (coords) {
                console.log(`[UNSUPPORTED_CITY_GPS_FALLBACK] location="${rawLocation}" not supported, falling back to GPS lat=${coords.lat} lng=${coords.lng}`);
                return {
                    mode: 'GPS',
                    coords,
                    cuisine: null  // drop cuisine — likely also from ASR mishear
                };
            }
            return {
                mode: 'UNSUPPORTED_CITY',
                requestedLocation: normalizedLoc,
                cuisine: cuisineType,
                coords
            };
        }

        return {
            mode: 'CITY',
            location: SERVICE_CITY,
            cuisine: cuisineType,
            originalLocation: rawLocation,
            coords
        };
    }

    if (coords) {
        return {
            mode: 'GPS',
            coords,
            cuisine: cuisineType
        };
    }

    // Single-service-city mode:
    // If user did not provide city and we have no GPS, default to the only supported city
    // instead of asking for location again.
    return {
        mode: 'CITY',
        location: SERVICE_CITY,
        cuisine: cuisineType,
        originalLocation: null,
        coords: null,
        inferredServiceCity: true
    };

    // 3. Fallback Analysis (Implicit Order vs General)
    // Regex fix: \b doesn't work well with polish chars like 'ę' in standard JS regex without unicode flag.
    // Using (?:^|\s) ... (?:\s|$) pattern instead.
    const ORDER_VERBS_REGEX = /(?:^|\s)(zamawiam|zamow|zamów|poprosze|poprosz[ęe]|wezme|wezm[ęe]|biore|bior[ęe]|chce|chc[ęe]|chciał(bym|abym))(?:\s|$|[.,?!])/i;
    const isImplicitOrder = ORDER_VERBS_REGEX.test(text);
    const dishEntity = entities?.dish
        || (entities?.items && entities.items[0]?.name)
        || (typeof session?.pendingDish === 'string' ? session.pendingDish : null);

    return {
        mode: 'FALLBACK',
        isImplicitOrder,
        dishEntity
    };
}

function formatDiscoveryReply(result, modeParams) {
    const { restaurants, foundInNearby, nearbySourceCity } = result;
    const { location, cuisine } = modeParams; // modeParams mirrors the resolveDiscoveryMode output structure used during fetch

    const count = restaurants.length;
    const countTxt = pluralPl(count, 'miejsce', 'miejsca', 'miejsc');
    const limit = 3;
    const displayList = restaurants.slice(0, limit);

    // Format list items
    const listTxt = displayList.map((r, i) => {
        let extra = '';
        if (r.distance) {
            extra = r.distance < 1
                ? ` (${Math.round(r.distance * 1000)}m)`
                : ` (${r.distance.toFixed(1)}km)`;
        } else {
            extra = ` (${r.cuisine_type || 'Restauracja'})`;
        }
        return `${i + 1}. ${r.name}${extra}`;
    }).join('\n');

    let intro = '';

    if (foundInNearby) {
        intro = `W ${location} pusto, ale w pobliżu — w ${nearbySourceCity} — znalazłam ${count} ${countTxt}.\n\n`;
    } else if (modeParams.mode === 'GPS') {
        intro = cuisine
            ? `W pobliżu znalazłam ${count} ${countTxt} z kuchnią ${cuisine}:`
            : `W pobliżu znalazłam ${count} ${countTxt}:`;
    } else {
        intro = `Znalazłam ${count} ${countTxt} w ${location}:`;
    }

    const closing = "Którą wybierasz?";
    return `${intro}\n${listTxt}\n\n${closing}`;
}


export class FindRestaurantHandler {
    constructor(repository) {
        this.repo = repository;
    }

    async execute(ctx) {
        // 1. Resolve Mode & Context
        const discoveryParams = resolveDiscoveryMode(ctx);
        const { mode, location, cuisine, coords, isImplicitOrder } = discoveryParams;
        const dishEntity = discoveryParams.dishEntity
            || ctx?.entities?.dish
            || ctx?.entities?.items?.[0]?.name
            || (typeof ctx?.session?.pendingDish === 'string' ? ctx.session.pendingDish : null);
        let usedItemLedDiscovery = false;
        let cityGPSRetry = false; // set true when CITY mode fails and we retry with GPS

        console.log(`🔎 Discovery Mode: ${mode}`, discoveryParams);

        // ── EARLY CHIP PARSING ──────────────────────────────────────
        // Parse the user's text immediately to build taxonomy chips.
        // Chips are emitted with the response so the frontend can show
        // emoji + labels above the Voice Bar alongside results.
        let earlyChips = null;
        let earlyConfidence = 'empty';
        const discoveryEngineReady = await _discoveryPreload;
        if (discoveryEngineReady && _buildChips) {
            const chipText = ctx?.text || cuisine || '';
            if (chipText) {
                try {
                    const earlyParsed = _matchQueryToTaxonomy(chipText);
                    earlyChips = _buildChips(earlyParsed);
                    earlyConfidence = earlyParsed.confidence;
                } catch (chipErr) {
                    console.warn('[Discovery:Chips] build failed:', chipErr?.message);
                }
            }
        }
        // ─────────────────────────────────────────────────────────────

        // 2. Execute Strategy
        let restaurants = [];
        let foundInNearby = false;
        let nearbySourceCity = null;

        if (mode === 'UNSUPPORTED_CITY') {
            return {
                reply: `${buildServiceCityOnlyReply(discoveryParams.requestedLocation)} Powiedz proszę "${SERVICE_CITY}", a pokażę dostępne restauracje.`,
                contextUpdates: {
                    expectedContext: 'find_nearby_ask_location',
                    awaiting: 'location',
                    pendingDish: dishEntity || ctx.session?.pendingDish || null
                }
            };
        }

        if (mode === 'CITY') {
            // ── Parallel GPS pre-fetch ──
            // When coords are available, fire the GPS query in parallel with CITY.
            // If CITY returns 0 results, GPS results are already waiting (no 1-2s retry gap).
            let gpsPromise = null;
            if (coords && !usedItemLedDiscovery) {
                gpsPromise = searchNearbyWithCuisineVariants(this.repo, coords.lat, coords.lng, 15, cuisine)
                    .catch(err => { console.warn('[CITY_GPS_PARALLEL] GPS prefetch failed:', err?.message || err); return []; });
            }

            try {
                const itemQueryCandidate = extractItemQueryCandidate(ctx, discoveryParams);
                if (itemQueryCandidate) {
                    try {
                        const itemLedMatches = await searchRestaurantsByItemInCity({
                            location,
                            coords,
                            itemQuery: itemQueryCandidate,
                        });

                        if (itemLedMatches.length > 0) {
                            restaurants = itemLedMatches;
                            usedItemLedDiscovery = true;
                            gpsPromise = null; // item-led succeeded, discard GPS
                            console.log('[DISCOVERY_ITEM_LED]', JSON.stringify({
                                location,
                                itemQuery: itemQueryCandidate,
                                aliases: buildItemAliases(itemQueryCandidate),
                                matchedRestaurants: itemLedMatches.slice(0, 5).map((restaurant) => ({
                                    id: restaurant.id,
                                    name: restaurant.name,
                                    score: restaurant.item_match_score,
                                    items: restaurant.matched_menu_items,
                                })),
                            }));
                        } else if (requiresMenuLedDiscovery(itemQueryCandidate)) {
                            restaurants = [];
                            usedItemLedDiscovery = true;
                            gpsPromise = null; // strict menu-led query: no menu hit means no broad fallback
                            console.log('[DISCOVERY_ITEM_LED_EMPTY]', JSON.stringify({
                                location,
                                itemQuery: itemQueryCandidate,
                                aliases: buildItemAliases(itemQueryCandidate),
                            }));
                        }
                    } catch (itemErr) {
                        console.warn('[DISCOVERY_ITEM_LED] skip_item_path_error', itemErr?.message || itemErr);
                    }
                }

                // Pizza city-wide query can also run in parallel with main CITY query
                const wantsPizza = !usedItemLedDiscovery && isPizzaDiscoveryQuery(ctx.text, cuisine);
                let pizzaPromise = null;
                if (wantsPizza) {
                    pizzaPromise = this.repo.searchRestaurants(location, null)
                        .catch(() => []);
                }

                if (!usedItemLedDiscovery) {
                    restaurants = await searchRestaurantsWithCuisineVariants(this.repo, location, cuisine);
                }

                // Pizza merge (awaits parallel pizza query if it was fired)
                if (wantsPizza && pizzaPromise) {
                    const cityWide = await pizzaPromise;
                    const pizzaCandidates = (cityWide || []).filter(hasPizzaRestaurantSignal);
                    if (pizzaCandidates.length > 0) {
                        restaurants = rankPizzaFirst(mergeUniqueRestaurants(restaurants, pizzaCandidates));
                        console.log('[DISCOVERY_PIZZA_FIX]', JSON.stringify({
                            location,
                            cuisine,
                            beforeCount: (restaurants || []).length,
                            cityWideCount: cityWide?.length || 0,
                            pizzaCandidates: pizzaCandidates.map(r => r.name),
                            topAfter: restaurants.slice(0, 3).map(r => r.name),
                        }));
                    }
                }

                // Internal Fallback: Nearby Cities
                if (ALLOW_NEARBY_CITY_FALLBACK && !usedItemLedDiscovery && (!restaurants || restaurants.length === 0)) {
                    const normalizedKey = location.toLowerCase();
                    const suggestions = NEARBY_CITY_MAP[normalizedKey] || [];

                    for (const neighbor of suggestions) {
                        console.log(`🔎 Fallback: Checking ${neighbor}...`);
                        const neighborRest = await searchRestaurantsWithCuisineVariants(this.repo, neighbor, cuisine);
                        if (neighborRest && neighborRest.length > 0) {
                            restaurants = neighborRest;
                            foundInNearby = true;
                            nearbySourceCity = neighbor;
                            gpsPromise = null; // nearby found results, discard GPS
                            break;
                        }
                    }
                }

                restaurants = filterRestaurantsToServiceCity(restaurants);
            } catch (error) {
                console.error('Repo Error (City):', error);
                gpsPromise = null;
                return { reply: "Mam problem z bazą danych. Spróbuj później.", error: 'db_error' };
            }

            // Handle "Still No Results" for CITY mode
            if (!restaurants || restaurants.length === 0) {
                if (gpsPromise) {
                    // GPS was already running in parallel — await it now
                    console.log(`[CITY_GPS_PARALLEL] city="${location}" 0 results, awaiting parallel GPS lat=${coords.lat} lng=${coords.lng}`);
                    try {
                        restaurants = await gpsPromise;
                    } catch (gpsErr) {
                        console.warn('[CITY_GPS_PARALLEL] GPS await failed:', gpsErr?.message || gpsErr);
                    }
                    if (restaurants && restaurants.length > 0) {
                        cityGPSRetry = true;
                        discoveryParams.mode = 'GPS';
                        discoveryParams.location = null;
                    } else {
                        const cuisineMsg = cuisine ? ` serwujących ${cuisine}` : '';
                        return {
                            reply: `Nie znalazłam nic w pobliżu${cuisineMsg}. Może inna kuchnia?`,
                            contextUpdates: { pendingDish: dishEntity || ctx.session?.pendingDish || null }
                        };
                    }
                } else if (coords) {
                    // Fallback: no parallel promise but coords available (item-led path failed after setting gpsPromise=null)
                    console.log(`[CITY_GPS_FALLBACK] city="${location}" 0 results, retrying with GPS lat=${coords.lat} lng=${coords.lng}`);
                    try {
                        restaurants = await searchNearbyWithCuisineVariants(this.repo, coords.lat, coords.lng, 15, cuisine);
                    } catch (gpsErr) {
                        console.warn('[CITY_GPS_FALLBACK] GPS retry failed:', gpsErr?.message || gpsErr);
                    }
                    if (restaurants && restaurants.length > 0) {
                        cityGPSRetry = true;
                        discoveryParams.mode = 'GPS';
                        discoveryParams.location = null;
                    } else {
                        const cuisineMsg = cuisine ? ` serwujących ${cuisine}` : '';
                        return {
                            reply: `Nie znalazłam nic w pobliżu${cuisineMsg}. Może inna kuchnia?`,
                            contextUpdates: { pendingDish: dishEntity || ctx.session?.pendingDish || null }
                        };
                    }
                } else {
                    const cuisineMsg = cuisine ? ` serwujących ${cuisine}` : '';
                    return {
                        reply: `Nie znalazłam żadnych restauracji w ${location}${cuisineMsg}. Może inna kuchnia?`,
                        contextUpdates: {
                            last_location: location,
                            pendingDish: dishEntity || ctx.session?.pendingDish || null
                        }
                    };
                }
            }

        } else if (mode === 'GPS') {
            try {
                // Radius: 15km default
                restaurants = await searchNearbyWithCuisineVariants(this.repo, coords.lat, coords.lng, 15, cuisine);
            } catch (error) {
                console.error('Repo Error (GPS):', error);
                return { reply: "Nie udało mi się pobrać lokalizacji.", error: 'db_error' };
            }

            // If GPS+cuisine returns too few hits, enrich with city+cuisine candidates from
            // session context. This helps include restaurants missing valid lat/lng.
            if (cuisine && Array.isArray(restaurants) && restaurants.length < 2) {
                const cityHint = normalizeLocation(ctx?.session?.last_location || null);
                if (cityHint) {
                    try {
                        const cityCandidates = await searchRestaurantsWithCuisineVariants(this.repo, cityHint, cuisine);
                        const knownIds = new Set(restaurants.map(r => r.id));
                        for (const candidate of cityCandidates || []) {
                            if (!knownIds.has(candidate.id)) {
                                restaurants.push(candidate);
                                knownIds.add(candidate.id);
                            }
                        }
                        console.log('[GPS_CITY_ENRICH_TRACE]', JSON.stringify({
                            cuisine,
                            cityHint,
                            resultCount: restaurants.length
                        }));
                    } catch (enrichErr) {
                        console.warn('GPS->CITY enrichment failed:', enrichErr?.message || enrichErr);
                    }
                }
            }

            // GPS Pizza Fix: some pizza places have null/non-standard cuisine_type.
            // Same issue as CITY mode PIZZA_FIX — do a radius search without cuisine filter
            // and merge in pizza-signal candidates.
            if (isPizzaDiscoveryQuery(ctx.text, cuisine) && Array.isArray(restaurants) && restaurants.length < 3) {
                try {
                    const allNearby = await this.repo.searchNearby(coords.lat, coords.lng, 15, null);
                    const pizzaCandidates = (allNearby || []).filter(hasPizzaRestaurantSignal);
                    if (pizzaCandidates.length > 0) {
                        restaurants = rankPizzaFirst(mergeUniqueRestaurants(restaurants, pizzaCandidates));
                        console.log('[GPS_PIZZA_FIX]', JSON.stringify({
                            before: restaurants.length,
                            pizzaCandidates: pizzaCandidates.map(r => r.name),
                        }));
                    }
                } catch (pizzaErr) {
                    console.warn('[GPS_PIZZA_FIX] failed:', pizzaErr?.message || pizzaErr);
                }
            }

            restaurants = filterRestaurantsToServiceCity(restaurants);

            if (!usedItemLedDiscovery && Array.isArray(restaurants) && restaurants.length > 0) {
                const itemQueryCandidate = extractItemQueryCandidate(ctx, discoveryParams);
                if (itemQueryCandidate) {
                    try {
                        const itemLedMatches = await rankRestaurantsByItemFromCandidates({
                            restaurants,
                            coords,
                            itemQuery: itemQueryCandidate,
                        });

                        if (itemLedMatches.length > 0) {
                            restaurants = itemLedMatches;
                            usedItemLedDiscovery = true;
                            console.log('[DISCOVERY_ITEM_LED_GPS]', JSON.stringify({
                                itemQuery: itemQueryCandidate,
                                aliases: buildItemAliases(itemQueryCandidate),
                                matchedRestaurants: itemLedMatches.slice(0, 5).map((restaurant) => ({
                                    id: restaurant.id,
                                    name: restaurant.name,
                                    score: restaurant.item_match_score,
                                    items: restaurant.matched_menu_items,
                                })),
                            }));
                        } else if (requiresMenuLedDiscovery(itemQueryCandidate)) {
                            const cityFallbackMatches = await searchRestaurantsByItemInCity({
                                location: resolveSessionCityFallback(ctx?.session) || SERVICE_CITY,
                                coords,
                                itemQuery: itemQueryCandidate,
                            });

                            if (cityFallbackMatches.length > 0) {
                                restaurants = cityFallbackMatches;
                                console.log('[DISCOVERY_ITEM_LED_GPS_CITY_FALLBACK]', JSON.stringify({
                                    itemQuery: itemQueryCandidate,
                                    aliases: buildItemAliases(itemQueryCandidate),
                                    matchedRestaurants: cityFallbackMatches.slice(0, 5).map((restaurant) => ({
                                        id: restaurant.id,
                                        name: restaurant.name,
                                        score: restaurant.item_match_score,
                                        items: restaurant.matched_menu_items,
                                    })),
                                }));
                            } else {
                                restaurants = [];
                                console.log('[DISCOVERY_ITEM_LED_GPS_EMPTY]', JSON.stringify({
                                    itemQuery: itemQueryCandidate,
                                    aliases: buildItemAliases(itemQueryCandidate),
                                }));
                            }
                            usedItemLedDiscovery = true;
                        }
                    } catch (itemErr) {
                        console.warn('[DISCOVERY_ITEM_LED_GPS] skip_item_path_error', itemErr?.message || itemErr);
                    }
                }
            }

            if (!restaurants || restaurants.length === 0) {
                return {
                    reply: cuisine
                        ? `Nie widzę restauracji ${cuisine} w Twojej okolicy. Może inna kuchnia albo szersze wyszukiwanie?`
                        : `Nie widzę żadnych restauracji w pobliżu. Spróbuj podać miasto albo inną kuchnię.`,
                    contextUpdates: {}
                };
            }

        } else {
            // FALLBACK MODE
            const prompt = (isImplicitOrder && dishEntity)
                ? `Chętnie przyjmę zamówienie ${dishEntity}, ale najpierw podaj miasto. Obecnie obsługuję tylko ${SERVICE_CITY}.`
                : `Gdzie mam szukać? Podaj miasto lub powiedz 'w pobliżu'. Obecnie obsługuję tylko ${SERVICE_CITY}.`;

            return {
                reply: prompt,
                contextUpdates: {
                    expectedContext: 'find_nearby_ask_location',
                    awaiting: 'location',
                    pendingDish: dishEntity || null
                }
            };
        }

        // --- ENRICH RESULTS WITH DISTANCE (Cross-cutting concern) ---
        if (coords && restaurants && restaurants.length > 0) {
            restaurants = restaurants.map(r => {
                if (r.lat && r.lng) {
                    // Calculate distance if missing (City Mode usually misses it)
                    if (r.distance === undefined) {
                        // Coords are from body (user location)
                        const dist = calculateDistance(coords.lat, coords.lng, r.lat, r.lng);
                        return { ...r, distance: dist };
                    }
                }
                return r;
            });
        }

        // ── DISCOVERY RANKING LAYER ───────────────────────────────────
        //
        // FAZA 1 — SHADOW MODE
        //   Uruchamia nowy silnik równolegle ze starym.
        //   Loguje porównanie. Nie zmienia `restaurants`.
        //
        // FAZA 2 — PARTIAL ROUTING
        //   Gdy confidence === 'deterministic': nowy silnik PRZEJMUJE sorting.
        //   Gdy confidence === 'partial'|'empty':  stary flow bez zmian.
        //
        // FAZA 3 — FULL TAKEOVER (TODO: włącz gdy FAZA 2 ustabilizowana)
        //   Wszystkie zapytania przez nowy silnik + LLM fallback signal.
        // ─────────────────────────────────────────────────────────────

        // Pomiń filtr taksonomii gdy brak cuisine — nie ma sygnału do filtrowania.
        // Dla CITY/GPS + cuisine=null restauracje z SQL są poprawne bez filtra.
        const hasCuisineSignal = Boolean(cuisine);
        if (!usedItemLedDiscovery && discoveryEngineReady && restaurants.length > 0 && hasCuisineSignal) {
            // Buduj query tylko z cuisine, nie z pełnego transkryptu.
            const rawText = cuisine || ctx.text || '';
            const parsed = _matchQueryToTaxonomy(rawText);

            // ── FAZA 1: SHADOW LOG ──
            const shadowResult = _runDiscovery(parsed, restaurants);
            console.log('[Discovery:Shadow]', JSON.stringify({
                query: rawText,
                confidence: parsed.confidence,
                topGroups: parsed.topGroups,
                categories: parsed.categories,
                tags: parsed.tags,
                vibes: parsed.vibes,
                dietarys: parsed.dietarys,
                open_now: parsed.open_now,
                fallback: shadowResult.fallback,
                before: shadowResult.totalBeforeFilter,
                after: shadowResult.totalAfterFilter,
                oldOrder: restaurants.slice(0, 3).map(r => r.id),
                newOrder: shadowResult.items.slice(0, 3).map(sr => sr.restaurant.id),
                topScore: shadowResult.items[0]?.score ?? null,
            }));

            // ── FAZA 2: PARTIAL ROUTING ──
            //   Aktywne gdy: confidence === 'deterministic' ORAZ parser znalazł wyniki
            if (parsed.confidence === 'deterministic' && shadowResult.fallback === null && shadowResult.items.length > 0) {
                console.log('[Discovery:Routing] deterministic → nowy silnik aktywny');
                restaurants = shadowResult.items.map(sr => sr.restaurant);

            } else if (shadowResult.fallback === 'llm') {
                // FAZA 2 — LLM fallback signal (logujemy, nie działamy jeszcze)
                // TODO FAZA 3: przekaż do LLM refiner
                console.log('[Discovery:Fallback] LLM signal:', shadowResult.fallbackReason);
                // restaurants bez zmian — stary flow

            } else {
                // confidence partial lub brak wyników → stary flow bez zmian
                console.log(`[Discovery:Routing] ${parsed.confidence} → legacy flow`);
            }
        }

        // ── END DISCOVERY LAYER ───────────────────────────────────────

        restaurants = filterRestaurantsForPublicDemo(restaurants);
        if (isPublicDemoCatalogOnly() && restaurants.length === 0) {
            return {
                reply: 'W publicznym demo pokazuję wyłącznie fikcyjne lokale FreeFlow. Spróbuj innej kuchni albo pokaż wszystkie miejsca demo.',
                restaurants: [],
                menuItems: [],
                contextUpdates: {
                    expectedContext: 'find_nearby',
                    awaiting: null,
                },
            };
        }

        // 3. Format Response (Standard Success Path)
        const resultData = { restaurants, foundInNearby, nearbySourceCity };
        const reply = formatDiscoveryReply(resultData, discoveryParams);

        // Smart Context Hint for Frontend
        const suggestedRestaurants = restaurants.map((r, idx) => ({
            id: r.id, name: r.name, index: idx + 1, city: r.city
        }));

        // Determine resolved location for session
        // cityGPSRetry: CITY failed with garbage name, results found via GPS — don't persist bad city
        const finalLocation = cityGPSRetry ? 'GPS' : (nearbySourceCity || location || (mode === 'GPS' ? 'GPS' : null));

        const events = [];
        if (earlyChips && earlyChips.length > 0) {
            events.push({
                type: 'parser_chips',
                chips: earlyChips,
                confidence: earlyConfidence,
            });
        }

        return {
            reply,
            closing_question: "Którą wybierasz?",
            restaurants: restaurants,
            menuItems: [],
            events: events.length > 0 ? events : undefined,
            contextUpdates: {
                last_location: finalLocation !== 'GPS' ? finalLocation : null, // Don't save "GPS" string as city
                last_restaurants_list: restaurants,
                lastRestaurants: suggestedRestaurants,
                expectedContext: 'select_restaurant',
                awaiting: null,
                pendingDish: dishEntity || ctx.entities?.pendingDish || null
            }
        };
    }
}
