// Food Domain: Order Handler
// Odpowiada za proces skÄąâ€šadania zamÄ‚Ĺ‚wienia (Parsowanie -> Koszyk -> Potwierdzenie).

import { extractQuantity, normalizeDish, findBestDishMatch, levenshtein } from '../../helpers.js';
import { canonicalizeDish } from '../../nlu/dishCanon.js';
import { resolveMenuItemConflict, DISAMBIGUATION_RESULT } from '../../services/DisambiguationService.js';
import { resolveRestaurantByName } from '../../services/restaurantResolver.js';
import { loadMenuPreview } from '../../menuService.js';
import { buildClarifyOrderMessage, ORDER_REQUESTED_CATEGORY, resolveRequestedCategory } from './clarifyOrderMessage.js';
import { resolveUniqueGroundedMenuItem } from '../../grounding/menuGrounding.js';



function hasExplicitQuantityInText(text = '') {
    const normalized = normalizeDish(String(text || ''));
    if (!normalized) return false;

    // Only treat quantity as explicit when it is part of order syntax.
    // This avoids false positives from dish names like "6 szt.".
    const prefixPattern = /^\s*(?:\d+|jeden|jedna|jedno|dwa|dwie|trzy|cztery|piec|szesc|siedem|osiem|dziewiec|dziesiec|kilka|pare|podwojny|podwojna|podwojne|podwojnie)\b(?:\s*(?:x|razy|szt|szt\.|sztuk|porcj))?/i;
    const verbPattern = /\b(dodaj|zamawiam|wezme|chce|poprosze|poprosz)\b\s+(?:mi\s+)?(?:\d+|jeden|jedna|jedno|dwa|dwie|trzy|cztery|piec|szesc|siedem|osiem|dziewiec|dziesiec|kilka|pare|podwojny|podwojna|podwojne|podwojnie)\b/i;
    const repetitionPattern = /\b(?:\d+|jeden|jedna|jedno|dwa|dwie|trzy|cztery|piec|szesc|siedem|osiem|dziewiec|dziesiec|kilka|pare)\b\s*(?:x|razy|porcj(?:a|e|i)?)\b/i;
    return prefixPattern.test(normalized) || verbPattern.test(normalized) || repetitionPattern.test(normalized);
}

function hasLikelyMultiQuantityCue(text = '') {
    const normalized = normalizeDish(String(text || ''));
    if (!normalized) return false;

    const quantityWordPattern = /\b(dwa|dwie|trzy|cztery|piec|szesc|siedem|osiem|dziewiec|dziesiec|kilka|pare|podwojny|podwojna|podwojne|podwojnie)\b/i;
    const xPattern = /\b(?:\d+\s*x|x\s*\d+|\d+\s*razy|razy\s*\d+)\b/i;
    // Ignore serving-size units like "6 szt." in dish names.
    const plainNumberPattern = /\b\d+\b(?!\s*(?:szt|szt\.|sztuk|ml|l|cm|g|kg)\b)/i;

    return quantityWordPattern.test(normalized)
        || xPattern.test(normalized)
        || plainNumberPattern.test(normalized);
}

function isExplicitQuantitySource(quantitySource = '') {
    const source = String(quantitySource || '').trim();
    if (!source || source === 'default' || source === 'unknown') return false;
    // trailing_number often comes from menu labels like "6 szt." and should not force qty>1.
    return source !== 'trailing_number';
}

function formatSzt(quantity) {
    const q = Math.max(1, Math.floor(Number(quantity) || 1));
    const mod10 = q % 10;
    const mod100 = q % 100;
    let form = 'sztuk';

    if (q === 1) {
        form = 'sztuka';
    } else if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
        form = 'sztuki';
    }

    return `${q} ${form}`;
}

function stripTrailingRestaurantReference(value = '') {
    const text = String(value || '').trim();
    if (!text) return '';
    const normalized = text
        .replace(/\s+z\s+restauracj[ia]\s+.+$/i, '')
        // Safe, deterministic micro-normalization for common drink inflections
        .replace(/\bco(?:le|li)\b/gi, 'cola')
        .replace(/\bcoca[\s-]?cole\b/gi, 'coca cola')
        .replace(/\s{2,}/g, ' ')
        .trim();

    return normalized;
}

function getSessionMenu(session = {}) {
    const candidates = [
        session?.last_menu,
        session?.lastMenu,
        session?.menu,
        session?.menuItems,
        session?.currentRestaurant?.menu,
        session?.lastRestaurant?.menu
    ];

    for (const candidate of candidates) {
        if (Array.isArray(candidate) && candidate.length > 0) {
            return candidate;
        }

        if (candidate && Array.isArray(candidate.items) && candidate.items.length > 0) {
            return candidate.items;
        }

        if (candidate && Array.isArray(candidate.menu) && candidate.menu.length > 0) {
            return candidate.menu;
        }
    }

    return [];
}

async function hydrateScopedMenuIfNeeded(session = {}, restaurantId = null) {
    const menu = getSessionMenu(session);
    if (menu.length > 0 || !restaurantId) return menu;

    try {
        const preview = await loadMenuPreview(restaurantId);
        const hydratedMenu = Array.isArray(preview?.menu) ? preview.menu : [];

        if (hydratedMenu.length > 0) {
            session.last_menu = hydratedMenu;
            session.lastMenuItems = hydratedMenu;
        }

        return hydratedMenu;
    } catch (error) {
        console.warn('[ORDER_MENU_HYDRATE_FAIL]', {
            restaurantId,
            message: error?.message || String(error || ''),
        });
        return menu;
    }
}

const NON_MAIN_CATEGORY_HINTS = [
    'dodatek',
    'dodatki',
    'sos',
    'sosy',
    'napoj',
    'napoje',
    'drink',
    'drinki',
    'alkohol',
    'extra',
    'modifier',
    'modyfik',
    'topping',
    'dip',
];

const EXPLICIT_ADDON_HINTS = [
    'sos',
    'dodatek',
    'dodatk',
    'extra',
    'modyfik',
    'dip',
    'topping',
];

const EXPLICIT_DRINK_HINTS = [
    'napoj',
    'napoje',
    'woda',
    'cola',
    'pepsi',
    'sprite',
    'fanta',
    'sok',
    'lemoniada',
    'kawa',
    'herbata',
];

const GENERIC_DISH_TOKENS = new Set([
    'sos',
    'sosy',
    'napoj',
    'napoje',
    'napoj gazowany',
    'pizza',
    'pizze',
    'burger',
    'burgery',
    'kawa',
    'herbata',
    'dodatek',
    'dodatki',
    'frytki',
]);

const MODIFIER_SYNONYM_GROUPS = [
    ['pikantny', 'pikantna', 'pikantne', 'ostry', 'ostra', 'ostre', 'spicy', 'chili', 'chilli'],
    ['lagodny', 'lagodna', 'lagodne', 'mild', 'jogurtowy', 'jogurtowa', 'jogurtowe'],
    ['czosnkowy', 'czosnkowa', 'czosnkowe', 'garlic'],
];

const DISH_SIGNAL_STOPWORDS = new Set([
    'lub',
    'oraz',
    'szt',
    'szt.',
    'sztuk',
    'sztuka',
    'ml',
    'cm',
    'kg',
    'g',
    'l',
    'x',
    'razy',
    'porcja',
    'porcje',
    'porcji',
]);

const FALLBACK_MATCH_MODIFIER_TOKENS = new Set([
    'bita',
    'smietana',
    'owoc',
    'owoce',
    'owocami',
    'owocowy',
    'owocowa',
    'sos',
    'sosy',
    'sosem',
    'sosu',
]);

const DISH_HEAD_FAMILY_GROUPS = [
    ['ice_cream', ['lody', 'lodow', 'lodowy', 'lodowa', 'lodowe', 'puchar']],
    ['pancake', ['nalesnik', 'nalesniki', 'nalesnika', 'nalesnikiem']],
    ['pizza', ['pizza', 'pizze', 'pizzy']],
    ['burger', ['burger', 'burgera', 'burgery']],
];

function stripQuantityOperators(phrase = '') {
    const normalized = normalizeDish(phrase || '');
    if (!normalized) return '';

    return normalized
        .replace(/^\s*x\s*\d+\b/, '')
        .replace(/^\s*\d+\s*(?:x|razy|szt|sztuk|szt\.|porcj(?:a|e|i)?)?\b/, '')
        .replace(/^\s*(?:jeden|jedna|jedno|dwa|dwie|trzy|cztery|piec|szesc|siedem|osiem|dziewiec|dziesiec|kilka|pare)\s*(?:x|razy)?\b/, '')
        .replace(/\b(?:x\s*\d+|\d+\s*x|\d+\s*razy|razy\s*\d+)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isGenericTokenOnly(phrase = '') {
    const stripped = stripQuantityOperators(phrase);
    if (!stripped) return false;
    return GENERIC_DISH_TOKENS.has(stripped);
}

function extractDishSignalTokens(value = '') {
    const normalized = normalizeDish(value || '');
    if (!normalized) return [];

    return normalized
        .replace(/[()\/,+.-]/g, ' ')
        .replace(/\b\d+\b/g, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !DISH_SIGNAL_STOPWORDS.has(token));
}

function extractFallbackCoreTokens(value = '') {
    return extractDishSignalTokens(value)
        .filter((token) => !FALLBACK_MATCH_MODIFIER_TOKENS.has(token));
}

function collectDishHeadFamilies(value = '') {
    const tokens = extractDishSignalTokens(value);
    if (tokens.length === 0) return new Set();

    const families = new Set();
    for (const token of tokens) {
        for (const [family, variants] of DISH_HEAD_FAMILY_GROUPS) {
            if (variants.some((variant) => token === variant || token.startsWith(variant) || variant.startsWith(token))) {
                families.add(family);
            }
        }
    }
    return families;
}

function hasCompatibleDishHeadFamily(searchPhrase = '', candidate = null) {
    if (!candidate) return false;

    const searchFamilies = collectDishHeadFamilies(searchPhrase);
    if (searchFamilies.size === 0) return true;

    const candidateFamilies = collectDishHeadFamilies(`${candidate?.base_name || ''} ${candidate?.name || ''}`);
    if (candidateFamilies.size === 0) return true;

    for (const family of searchFamilies) {
        if (candidateFamilies.has(family)) return true;
    }
    return false;
}

function hasDishSignalCompatibility(searchPhrase = '', candidate = null) {
    if (!candidate) return false;

    if (!hasCompatibleDishHeadFamily(searchPhrase, candidate)) {
        return false;
    }

    const searchTokens = extractFallbackCoreTokens(searchPhrase);
    if (searchTokens.length === 0) {
        return extractDishSignalTokens(searchPhrase).length === 0;
    }

    const candidateTokens = new Set(
        extractFallbackCoreTokens(`${candidate?.base_name || ''} ${candidate?.name || ''}`)
    );

    if (candidateTokens.size === 0) {
        return false;
    }

    const searchFamilies = collectDishHeadFamilies(searchPhrase);
    const candidateFamilies = collectDishHeadFamilies(`${candidate?.base_name || ''} ${candidate?.name || ''}`);
    for (const family of searchFamilies) {
        if (candidateFamilies.has(family)) return true;
    }

    const overlap = searchTokens.filter((token) => candidateTokens.has(token));
    if (overlap.length === 0) {
        return false;
    }

    if (searchTokens.length === 1) {
        return true;
    }

    const overlapRatio = overlap.length / searchTokens.length;
    return overlapRatio >= 0.34;
}

function isRichSpecificDishPhrase(value = '') {
    return extractDishSignalTokens(value).length >= 2;
}

function resolveItemType(item = {}) {
    const rawType = String(item?.type || item?.item_type || item?.kind || '').trim();
    if (rawType) {
        return rawType.toUpperCase();
    }

    const category = normalizeDish(item?.category || '');
    if (category && NON_MAIN_CATEGORY_HINTS.some((hint) => category.includes(hint))) {
        return 'ADDON';
    }

    return 'MAIN';
}

function isMainMenuItem(item = {}) {
    return resolveItemType(item) === 'MAIN';
}

function isExplicitAddonRequest(text = '') {
    const normalized = normalizeDish(text || '');
    if (!normalized) return false;
    return EXPLICIT_ADDON_HINTS.some((hint) => normalized.includes(hint));
}

function isExplicitDrinkRequest(text = '') {
    const normalized = normalizeDish(text || '');
    if (!normalized) return false;
    return EXPLICIT_DRINK_HINTS.some((hint) => normalized.includes(hint));
}

function isDrinkMenuItem(item = {}) {
    const category = normalizeDish(item?.category || '');
    const name = normalizeDish(item?.name || '');

    if (category.includes('napoj') || category.includes('drink') || category.includes('beverage')) {
        return true;
    }

    return EXPLICIT_DRINK_HINTS.some((hint) => name.includes(hint));
}

function summarizeCandidates(candidates = []) {
    return (candidates || []).slice(0, 5).map((item) => ({
        id: item?.id || null,
        name: item?.name || null,
        type: isDrinkMenuItem(item)
            ? ORDER_REQUESTED_CATEGORY.DRINK
            : resolveItemType(item),
    }));
}

function collectMenuCandidates(menu = [], requestedDish = '') {
    if (!Array.isArray(menu) || menu.length === 0) return [];

    const normalizedDish = normalizeDish(requestedDish || '');
    if (!normalizedDish) return [];

    return menu.filter((item) => {
        const base = normalizeDish(item?.base_name || '');
        const name = normalizeDish(item?.name || '');
        return (base && (base.includes(normalizedDish) || normalizedDish.includes(base)))
            || (name && (name.includes(normalizedDish) || normalizedDish.includes(name)));
    });
}

function dedupeMenuItems(items = []) {
    const seen = new Set();
    const out = [];

    for (const item of items || []) {
        if (!item) continue;
        const key = item?.id != null
            ? `id:${String(item.id)}`
            : `name:${normalizeDish(item?.name || item?.base_name || '')}`;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }

    return out;
}

function evaluateSharedBaseAmbiguity({
    query = '',
    menu = [],
}) {
    const normalizedQuery = normalizeDish(query || '');
    const queryTokens = extractDishSignalTokens(normalizedQuery);

    if (!normalizedQuery || !Array.isArray(menu) || menu.length === 0 || queryTokens.length === 0) {
        console.log(`[AMBIGUITY_GUARD] query=${normalizedQuery || ''}`);
        console.log('[AMBIGUITY_GUARD] candidates=[]');
        console.log('[AMBIGUITY_GUARD] clarify=false');
        return { clarify: false, candidates: [], query: normalizedQuery };
    }

    const hasExactMainMatch = menu.some((item) => {
        if (!isMainMenuItem(item)) return false;
        const label = normalizeDish(item?.base_name || item?.name || '');
        return Boolean(label) && label === normalizedQuery;
    });

    if (hasExactMainMatch) {
        console.log(`[AMBIGUITY_GUARD] query=${normalizedQuery}`);
        console.log('[AMBIGUITY_GUARD] candidates=[]');
        console.log('[AMBIGUITY_GUARD] clarify=false');
        return { clarify: false, candidates: [], query: normalizedQuery };
    }

    const tokenSet = new Set(queryTokens);
    const candidates = dedupeMenuItems(menu.filter((item) => {
        if (!isMainMenuItem(item)) return false;

        const label = normalizeDish(item?.base_name || item?.name || '');
        if (!label) return false;

        const itemTokens = extractDishSignalTokens(label);
        if (itemTokens.length === 0) return false;

        const coversQuery = queryTokens.every((token) => itemTokens.includes(token));
        if (!coversQuery) return false;

        const hasDistinguishingTokens = itemTokens.some((token) => !tokenSet.has(token));
        return hasDistinguishingTokens;
    }));

    const clarify = candidates.length > 1;
    const candidateNames = candidates.map((item) => String(item?.name || item?.base_name || '').trim()).filter(Boolean);

    console.log(`[AMBIGUITY_GUARD] query=${normalizedQuery}`);
    console.log(`[AMBIGUITY_GUARD] candidates=${JSON.stringify(candidateNames)}`);
    console.log(`[AMBIGUITY_GUARD] clarify=${clarify}`);

    return {
        clarify,
        candidates,
        query: normalizedQuery,
    };
}

function buildSharedBaseClarifyReply(query = '', candidates = []) {
    const options = [...new Set(
        (candidates || [])
            .map((item) => String(item?.name || item?.base_name || '').trim())
            .filter(Boolean)
    )].slice(0, 4);

    if (options.length === 0) {
        return 'Potrzebuje doprecyzowania tej pozycji. Podaj pelna nazwe wariantu z menu.';
    }

    if (options.length === 1) {
        return `Czy chodzi o "${options[0]}"?`;
    }

    const quoted = options.map((name) => `"${name}"`);
    const last = quoted[quoted.length - 1];
    const head = quoted.slice(0, -1).join(', ');
    const base = query || 'tej pozycji';
    return `Mam kilka wariantow dla "${base}": ${head} lub ${last}. Ktory wariant wybierasz?`;
}

function normalizeItemClarifyOptions(options = []) {
    return (options || [])
        .map((option) => ({
            id: option?.id || null,
            name: String(option?.name || option?.base_name || '').trim() || null,
            restaurant: option?.restaurant || option?.restaurants || null,
            score: Number(option?.score ?? option?.matchScore ?? 0),
        }))
        .filter((option) => Boolean(option.name))
        .slice(0, 2);
}

function buildItemClarifyReply(options = []) {
    const normalized = normalizeItemClarifyOptions(options);
    if (normalized.length === 0) {
        return 'Potrzebuje doprecyzowania pozycji. Podaj pelna nazwe z menu.';
    }
    if (normalized.length === 1) {
        return `Czy chodziło Ci o "${normalized[0].name}"?`;
    }
    return `Czy chodziło Ci o "${normalized[0].name}" czy "${normalized[1].name}"?`;
}

function buildItemClarifyResponse({
    options = [],
    query = '',
}) {
    const normalizedOptions = normalizeItemClarifyOptions(options);
    return {
        intent: 'clarify_order',
        reply: buildItemClarifyReply(normalizedOptions),
        meta: {
            source: 'order_item_disambiguation',
            clarify: {
                status: 'AMBIGUOUS',
                clarifyType: 'item',
                expectedContext: 'clarify_order',
                query: normalizeDish(query || ''),
                options: normalizedOptions,
            },
        },
        contextUpdates: {
            expectedContext: 'clarify_order',
        },
    };
}

function inferRequestedCategory({
    requestedDish = '',
    rawUserText = '',
    addonContext = false,
    candidates = [],
}) {
    if (addonContext || isExplicitAddonRequest(rawUserText) || isExplicitAddonRequest(requestedDish)) {
        return ORDER_REQUESTED_CATEGORY.ADDON;
    }

    if (isExplicitDrinkRequest(rawUserText) || isExplicitDrinkRequest(requestedDish)) {
        return ORDER_REQUESTED_CATEGORY.DRINK;
    }

    if (Array.isArray(candidates) && candidates.length > 0) {
        const hasMain = candidates.some((item) => resolveItemType(item) === ORDER_REQUESTED_CATEGORY.MAIN);
        if (hasMain) return ORDER_REQUESTED_CATEGORY.MAIN;

        const hasDrink = candidates.some((item) => isDrinkMenuItem(item));
        if (hasDrink) return ORDER_REQUESTED_CATEGORY.DRINK;

        const hasAddon = candidates.some((item) => resolveItemType(item) === ORDER_REQUESTED_CATEGORY.ADDON);
        if (hasAddon) return ORDER_REQUESTED_CATEGORY.ADDON;
    }

    return ORDER_REQUESTED_CATEGORY.UNKNOWN;
}

function getCartRestaurantLock(session = {}) {
    const cart = session?.cart || {};
    const cartItems = Array.isArray(cart?.items) ? cart.items : [];
    const firstItemRestaurantId = cartItems[0]?.restaurant_id || null;

    return {
        hasItems: cartItems.length > 0,
        lockedRestaurantId: cart?.restaurantId || firstItemRestaurantId || null,
        cartRestaurantName:
            cartItems[0]?.restaurant_name
            || session?.currentRestaurant?.name
            || session?.lastRestaurant?.name
            || 'innej restauracji',
    };
}

function buildRestaurantSwitchConflictResponse({
    currentRestaurantName,
    targetRestaurant,
    lockedRestaurantId = null,
}) {
    const restaurantLockTrace = {
        conflict: true,
        lockedRestaurantId: lockedRestaurantId || null,
        currentRestaurantName: currentRestaurantName || null,
        targetRestaurantId: targetRestaurant?.id || null,
        targetRestaurantName: targetRestaurant?.name || null,
    };
    console.log('[RESTAURANT_LOCK_TRACE]', JSON.stringify(restaurantLockTrace));

    return {
        reply: `Masz juĹĽ pozycje z ${currentRestaurantName}. Czy wyczyĹ›ciÄ‡ koszyk i przejĹ›Ä‡ do ${targetRestaurant?.name}?`,
        contextUpdates: {
            expectedContext: 'confirm_restaurant_switch',
            pendingRestaurantSwitch: targetRestaurant
                ? {
                    id: targetRestaurant.id,
                    name: targetRestaurant.name,
                    city: targetRestaurant.city || null,
                }
                : null,
        },
        meta: {
            source: 'restaurant_switch_conflict_from_order',
            restaurantLockTrace,
        },
    };
}

function buildAmbiguousResolution({
    requestedCategory,
    candidates = [],
}) {
    return {
        status: 'AMBIGUOUS',
        requestedCategory: resolveRequestedCategory(requestedCategory),
        candidates: summarizeCandidates(candidates),
    };
}

function resolveCategoryFromItem(item = {}) {
    if (isDrinkMenuItem(item)) return ORDER_REQUESTED_CATEGORY.DRINK;

    const type = resolveItemType(item);
    if (type === 'ADDON') return ORDER_REQUESTED_CATEGORY.ADDON;
    if (type === 'MAIN') return ORDER_REQUESTED_CATEGORY.MAIN;
    return ORDER_REQUESTED_CATEGORY.UNKNOWN;
}

function resolveSessionItemAgainstMenu(item = {}, menu = []) {
    if (!item || !Array.isArray(menu) || menu.length === 0) return null;

    const itemId = item?.id != null ? String(item.id) : null;
    if (itemId) {
        const byId = menu.find((menuItem) => String(menuItem?.id ?? '') === itemId);
        if (byId) return byId;
    }

    const itemName = normalizeDish(item?.name || item?.item_name || '');
    if (!itemName) return null;

    return menu.find((menuItem) => {
        const menuName = normalizeDish(menuItem?.name || '');
        const menuBaseName = normalizeDish(menuItem?.base_name || '');
        return (menuName && menuName === itemName) || (menuBaseName && menuBaseName === itemName);
    }) || null;
}

function hasMainInActiveOrderContext(session = {}, menu = []) {
    const pools = [
        Array.isArray(session?.pendingOrder?.items) ? session.pendingOrder.items : [],
        Array.isArray(session?.cart?.items) ? session.cart.items : [],
    ];

    for (const pool of pools) {
        for (const item of pool) {
            const resolvedFromMenu = resolveSessionItemAgainstMenu(item, menu);
            const hasDirectCategory =
                Boolean(item?.type)
                || Boolean(item?.item_type)
                || Boolean(item?.kind)
                || Boolean(item?.category);
            const categorySource = resolvedFromMenu || (hasDirectCategory ? item : null);
            if (!categorySource) continue;

            if (resolveCategoryFromItem(categorySource) === ORDER_REQUESTED_CATEGORY.MAIN) {
                return true;
            }
        }
    }

    return false;
}

function buildClarifyResponse({
    ambiguousMeta,
    addonContext = false,
    sessionRestaurant = null,
    reason = 'ambiguous_resolution',
}) {
    const candidateCount = Array.isArray(ambiguousMeta?.candidates) ? ambiguousMeta.candidates.length : 0;
    const expectedContext = addonContext ? 'order_addon' : 'clarify_order';
    const clarifyMeta = {
        ...(ambiguousMeta || {}),
        status: 'AMBIGUOUS',
        expectedContext,
        candidateCount,
        restaurantName: sessionRestaurant,
    };

    console.log('[CLARIFY_REASON_TRACE]', JSON.stringify({
        reason,
        category: clarifyMeta.requestedCategory || ORDER_REQUESTED_CATEGORY.UNKNOWN,
        candidateCount,
        expectedContext,
        restaurantName: sessionRestaurant,
    }));

    return {
        intent: 'clarify_order',
        reply: buildClarifyOrderMessage(clarifyMeta),
        meta: { clarify: clarifyMeta },
        contextUpdates: {
            expectedContext,
        },
    };
}

function normalizeOrderItemCandidates(rawItems = []) {
    if (!Array.isArray(rawItems)) return [];

    return rawItems
        .map((item) => {
            if (typeof item === 'string') {
                const dish = item.trim();
                if (!dish) return null;
                return { dish, quantity: 1 };
            }

            if (item && typeof item === 'object') {
                const dish = String(item.dish || item.name || '').trim();
                if (!dish) return null;

                const quantity = Math.max(1, Math.floor(Number(item.quantity ?? item.qty ?? 1) || 1));
                return {
                    dish,
                    quantity,
                    meta: (item.meta && typeof item.meta === 'object') ? { ...item.meta } : undefined,
                };
            }

            return null;
        })
        .filter(Boolean);
}

function isSingleCompoundQuantityAllowed(entities = {}, itemCandidates = []) {
    const singleItem = Array.isArray(itemCandidates) && itemCandidates.length === 1
        ? itemCandidates[0]
        : null;

    if (!singleItem) return false;
    if (Number(singleItem.quantity || 1) <= 1) return false;
    if (entities?.compoundSource !== 'compound_parser') return false;
    if (!entities?.skipCategoryClarify || !entities?.skipGenericTokenBlock) return false;

    const lookupDish = singleItem?.meta?.rawLabel || singleItem?.dish || entities?.dish || '';
    if (isGenericTokenOnly(lookupDish)) {
        return false;
    }

    return true;
}

function buildModifierVariants(modifier = '') {
    const normalized = normalizeDish(modifier || '');
    if (!normalized) return [];

    const variants = new Set([normalized]);
    const tokens = normalized.split(' ').filter(Boolean);

    for (const group of MODIFIER_SYNONYM_GROUPS) {
        const groupSet = new Set(group.map((token) => normalizeDish(token)));
        for (const token of tokens) {
            if (groupSet.has(token)) {
                for (const synonym of groupSet) {
                    variants.add(synonym);
                }
            }
        }
    }

    if (tokens.length > 1) {
        const canonicalTokens = [...tokens];
        for (let i = 0; i < canonicalTokens.length; i += 1) {
            for (const group of MODIFIER_SYNONYM_GROUPS) {
                const groupSet = new Set(group.map((token) => normalizeDish(token)));
                if (groupSet.has(canonicalTokens[i])) {
                    canonicalTokens[i] = normalizeDish(group[0]);
                }
            }
        }
        variants.add(canonicalTokens.join(' ').trim());
    }

    return [...variants].filter(Boolean);
}

function computeModifierMatchQuality(item = {}, modifierVariants = []) {
    if (!Array.isArray(modifierVariants) || modifierVariants.length === 0) {
        return { score: 0, mode: 'none' };
    }

    const normalizedName = normalizeDish(item?.name || '');
    const normalizedBase = normalizeDish(item?.base_name || '');
    const haystack = `${normalizedName} ${normalizedBase}`.trim();
    if (!haystack) return { score: 0, mode: 'none' };

    let bestExact = 0;
    let bestFuzzy = 0;
    const hayTokens = haystack.split(' ').filter(Boolean);

    for (const variant of modifierVariants) {
        const normalizedVariant = normalizeDish(variant || '');
        if (!normalizedVariant) continue;

        if (
            normalizedName.includes(normalizedVariant)
            || normalizedBase.includes(normalizedVariant)
            || ` ${haystack} `.includes(` ${normalizedVariant} `)
        ) {
            bestExact = Math.max(bestExact, 1);
            continue;
        }

        const variantTokens = normalizedVariant.split(' ').filter(Boolean);
        if (variantTokens.length === 0) continue;

        let fuzzyScore = 0;
        for (const vt of variantTokens) {
            let bestToken = 0;
            for (const ht of hayTokens) {
                if (!ht || !vt) continue;
                if (ht === vt) {
                    bestToken = 1;
                    break;
                }
                const distance = levenshtein(ht, vt);
                if (distance <= 1) {
                    bestToken = Math.max(bestToken, 0.85);
                } else if (distance <= 2 && Math.min(ht.length, vt.length) >= 5) {
                    bestToken = Math.max(bestToken, 0.65);
                }
            }
            fuzzyScore += bestToken;
        }

        bestFuzzy = Math.max(bestFuzzy, fuzzyScore / variantTokens.length);
    }

    if (bestExact > 0) return { score: 220, mode: 'exact_modifier' };
    if (bestFuzzy >= 0.7) return { score: 160 * bestFuzzy, mode: 'fuzzy_modifier' };
    return { score: 0, mode: 'none' };
}

function resolveAddonWithModifierPriority({
    menu = [],
    requestedDish = '',
    rawModifier = '',
    allowGenericFallback = false,
}) {
    if (!Array.isArray(menu) || menu.length === 0) return null;

    const addonPool = menu.filter((item) => resolveItemType(item) === 'ADDON');
    const candidatePool = addonPool.length > 0 ? addonPool : menu;
    const modifierVariants = buildModifierVariants(rawModifier);
    const normalizedRequestedDish = normalizeDish(requestedDish || '');
    const genericRequestedToken = normalizeDish(stripQuantityOperators(requestedDish || ''));

    let bestMatch = null;
    let bestScore = -1;
    let bestMode = 'none';

    for (const item of candidatePool) {
        const modifierQuality = computeModifierMatchQuality(item, modifierVariants);
        let score = modifierQuality.score;
        let mode = modifierQuality.mode;

        const normalizedName = normalizeDish(item?.name || '');
        const normalizedBase = normalizeDish(item?.base_name || '');

        if (score === 0 && allowGenericFallback && genericRequestedToken) {
            if (
                normalizedName.includes(genericRequestedToken)
                || normalizedBase.includes(genericRequestedToken)
            ) {
                score = 40;
                mode = 'generic_fallback';
            }
        }

        if (score === 0 && allowGenericFallback && normalizedRequestedDish) {
            if (
                normalizedName.includes(normalizedRequestedDish)
                || normalizedBase.includes(normalizedRequestedDish)
            ) {
                score = 30;
                mode = 'generic_fallback';
            }
        }

        if (score > bestScore) {
            bestScore = score;
            bestMatch = item;
            bestMode = mode;
        }
    }

    if (!bestMatch || bestScore <= 0) {
        return null;
    }

    return {
        item: bestMatch,
        scoreBoost: Number(bestScore.toFixed(2)),
        mode: bestMode,
    };
}

function resolveMainItemStrict({ menu = [], rawRequestedDish = '', requestedDish = '', canonicalDish = '', session = null }) {
    if (!Array.isArray(menu) || menu.length === 0) {
        return null;
    }

    const mainItems = menu.filter(isMainMenuItem);
    // Only search MAIN items â€” do NOT fall back to full menu.
    // When menu has only ADDONs, returning null here lets canPromoteSingleAddon
    // evaluate the item properly in the caller (execute()).
    const candidatePool = mainItems;
    if (candidatePool.length === 0) return null;

    const exactAttempts = [rawRequestedDish, canonicalDish, requestedDish]
        .map((value) => normalizeDish(value || ''))
        .filter(Boolean);

    for (const attempt of exactAttempts) {
        const exact = candidatePool.find((item) => {
            const normalizedName = normalizeDish(item?.name || '');
            const normalizedBase = normalizeDish(item?.base_name || '');
            return normalizedName === attempt || normalizedBase === attempt;
        });

        if (exact) {
            return {
                item: exact,
                fallbackUsed: false,
            };
        }
    }

    const fuzzy = findDirectMenuMatch(canonicalDish || requestedDish, candidatePool, session);
    if (fuzzy) {
        return {
            item: fuzzy,
            fallbackUsed: true,
        };
    }

    const looseAttempts = [...new Set(exactAttempts.filter((attempt) => attempt.length >= 3))];
    for (const attempt of looseAttempts) {
        const looseMatches = candidatePool.filter((item) => {
            const normalizedName = normalizeDish(item?.name || '');
            const normalizedBase = normalizeDish(item?.base_name || '');

            return (
                (normalizedName && (normalizedName.includes(attempt) || attempt.includes(normalizedName))) ||
                (normalizedBase && (normalizedBase.includes(attempt) || attempt.includes(normalizedBase)))
            );
        });

        if (looseMatches.length === 1) {
            return {
                item: looseMatches[0],
                fallbackUsed: true,
            };
        }
    }

    return null;
}

function findDirectMenuMatch(searchPhrase, menu = [], session = null) {
    if (!searchPhrase || !Array.isArray(menu) || menu.length === 0) {
        return null;
    }

    const attempts = [];
    const rawPhrase = String(searchPhrase || '').trim();
    const normalizedPhrase = normalizeDish(rawPhrase);
    const canonicalPhrase = canonicalizeDish(rawPhrase, session);
    const normalizedCanonical = normalizeDish(canonicalPhrase);

    if (rawPhrase) attempts.push(rawPhrase);
    if (normalizedPhrase && !attempts.includes(normalizedPhrase)) attempts.push(normalizedPhrase);
    if (canonicalPhrase && !attempts.includes(canonicalPhrase)) attempts.push(canonicalPhrase);
    if (normalizedCanonical && !attempts.includes(normalizedCanonical)) attempts.push(normalizedCanonical);

    for (const attempt of attempts) {
        const match = findBestDishMatch(attempt, menu);
        if (match && hasDishSignalCompatibility(rawPhrase, match)) {
            return match;
        }
    }

    return null;
}
function detectVariantMismatch(requestedDish, matchedItem, menu = []) {
    if (!requestedDish || !matchedItem?.name || !Array.isArray(menu) || menu.length === 0) {
        return null;
    }

    const req = normalizeDish(requestedDish);
    const match = normalizeDish(matchedItem.name);

    // Exact match or near-exact — no mismatch
    if (req === match) return null;
    if (match.includes(req)) return null;
    if (req.includes(match)) return null;
    if (levenshtein(req, match) <= 2) return null;

    const reqWords = req.split(/\s+/).filter(w => w.length > 0);
    const matchWords = match.split(/\s+/).filter(w => w.length > 0);

    // Find common word-level prefix
    let commonLen = 0;
    for (let i = 0; i < Math.min(reqWords.length, matchWords.length); i++) {
        if (reqWords[i] === matchWords[i]) {
            commonLen++;
        } else {
            break;
        }
    }

    if (commonLen === 0) return null;

    const reqVariant = reqWords.slice(commonLen).join(' ');
    const matchVariant = matchWords.slice(commonLen).join(' ');

    if (reqVariant === matchVariant) return null;

    // Only flag when user explicitly specified a variant that differs meaningfully
    if (!reqVariant) return null; // User was generic, system picked best match
    if (levenshtein(reqVariant, matchVariant) <= 2) return null; // Diacritics/typo tolerance

    const commonBase = reqWords.slice(0, commonLen).join(' ');

    // Find all other menu items sharing the same base
    const otherVariants = menu.filter(item => {
        const itemName = normalizeDish(item?.name || '');
        return itemName.startsWith(commonBase) && normalizeDish(item.name) !== match;
    });

    return {
        commonBase,
        requestedVariant: reqVariant || '(brak)',
        matchedName: matchedItem.name,
        allVariants: [matchedItem, ...otherVariants],
    };
}

function guardVariantMismatch(requestedDish, directMatch, menu) {
    const mismatch = detectVariantMismatch(requestedDish, directMatch, menu);
    if (!mismatch) return null;

    console.log('[VARIANT_MISMATCH]', JSON.stringify({
        requestedDish: normalizeDish(requestedDish),
        matchedName: mismatch.matchedName,
        commonBase: mismatch.commonBase,
        requestedVariant: mismatch.requestedVariant,
        variantCount: mismatch.allVariants.length,
    }));

    return buildItemClarifyResponse({
        options: mismatch.allVariants,
        query: requestedDish,
    });
}

function isStaraKamienicaSession(session = {}) {
    const restaurantName =
        session?.currentRestaurant?.name ||
        session?.lastRestaurant?.name ||
        '';
    return normalizeDish(restaurantName) === normalizeDish('Restauracja Stara Kamienica');
}

function resolveScopedZurekFallback(menu = []) {
    if (!Array.isArray(menu) || menu.length === 0) {
        return null;
    }

    const normalizedSoupCandidates = menu.filter((item) => {
        const normalized = normalizeDish(item?.base_name || item?.name || '');
        return normalized.includes('zupa') || normalized.includes('rosol');
    });

    if (normalizedSoupCandidates.length === 0) {
        return null;
    }

    const zupaDnia = normalizedSoupCandidates.find((item) =>
        normalizeDish(item?.base_name || item?.name || '').includes('zupa dnia')
    );
    return zupaDnia || normalizedSoupCandidates[0];
}

async function resolveOrderCandidate({
    candidateText,
    candidateMeta = null,
    rawUserText,
    session,
    entities,
    menu,
    currentRestaurantId,
    addonContext,
}) {
    const rawRequestedDish = String(candidateText || '').trim();
    const normalizedMeta = (candidateMeta && typeof candidateMeta === 'object') ? candidateMeta : {};
    const resolverRawLabel = String(normalizedMeta.rawLabel || rawRequestedDish).trim() || rawRequestedDish;
    const useRawResolverLabel = Boolean(normalizedMeta.canonicalAliasBundle);
    const resolverInputDish = useRawResolverLabel ? resolverRawLabel : rawRequestedDish;
    const canonicalDish = useRawResolverLabel ? resolverInputDish : canonicalizeDish(resolverInputDish, session);
    const requestedDish = canonicalDish || resolverInputDish;
    const token = normalizeDish(requestedDish);
    const modifierHint = normalizeDish(normalizedMeta.modifier || '');
    const modifierSourceText = resolverRawLabel || rawRequestedDish || requestedDish;
    const modifierBaseIsAddon =
        isExplicitAddonRequest(modifierSourceText) ||
        isGenericTokenOnly(modifierSourceText);

    const explicitAddonRequest =
        addonContext ||
        isExplicitAddonRequest(rawUserText) ||
        isExplicitAddonRequest(requestedDish);
    const explicitDrinkRequest =
        isExplicitDrinkRequest(rawRequestedDish) ||
        isExplicitDrinkRequest(requestedDish);
    const genericTokenBlocked =
        isGenericTokenOnly(rawRequestedDish) ||
        isGenericTokenOnly(requestedDish);

    const shouldApplyModifierPriority =
        Boolean(modifierHint) &&
        (addonContext || explicitAddonRequest || modifierBaseIsAddon || genericTokenBlocked);
    const shouldBlockGenericToken = genericTokenBlocked && !modifierHint;

    if (shouldBlockGenericToken) {
        const requestedCategory = inferRequestedCategory({
            requestedDish,
            rawUserText,
            addonContext,
            candidates: [],
        });
        const ambiguousMeta = buildAmbiguousResolution({
            requestedCategory,
            candidates: [],
        });

        console.log('[GENERIC_TOKEN_BLOCK_TRACE]', JSON.stringify({
            requestedDish,
            rawRequestedDish,
            requestedCategory,
            addonContext,
            sessionRestaurant: session?.currentRestaurant?.name || session?.lastRestaurant?.name || null,
        }));

        return {
            rawRequestedDish,
            requestedDish,
            canonicalDish,
            resolution: { status: DISAMBIGUATION_RESULT.ITEM_NOT_FOUND, item: null, restaurant: null },
            ambiguousMeta,
            requestedCategory,
            resolvedCategory: null,
            addonContext,
            genericTokenBlocked: true,
        };
    }

    if (!explicitAddonRequest && !explicitDrinkRequest && menu.length > 0) {
        const ambiguityGuard = evaluateSharedBaseAmbiguity({
            query: resolverRawLabel || rawRequestedDish || requestedDish,
            menu,
        });

        if (ambiguityGuard.clarify) {
            const requestedCategory = inferRequestedCategory({
                requestedDish,
                rawUserText,
                addonContext,
                candidates: ambiguityGuard.candidates,
            });
            const ambiguousMeta = buildAmbiguousResolution({
                requestedCategory,
                candidates: ambiguityGuard.candidates,
            });

            return {
                rawRequestedDish,
                requestedDish,
                canonicalDish,
                resolution: {
                    status: DISAMBIGUATION_RESULT.DISAMBIGUATION_REQUIRED,
                    item: null,
                    restaurant: null,
                },
                ambiguousMeta,
                requestedCategory,
                resolvedCategory: null,
                addonContext,
                candidateMeta: normalizedMeta,
                clarifyReason: 'shared_base_ambiguity',
                ambiguityCandidates: ambiguityGuard.candidates,
                ambiguityQuery: ambiguityGuard.query || normalizeDish(resolverRawLabel || rawRequestedDish || requestedDish),
            };
        }
    }

    let directMatch = null;
    let fallbackUsed = false;

    if (!explicitAddonRequest && !explicitDrinkRequest && menu.length > 0) {
        const strictMainResolution = resolveMainItemStrict({
            menu,
            rawRequestedDish,
            requestedDish,
            canonicalDish,
            session,
        });

        if (strictMainResolution?.item) {
            directMatch = strictMainResolution.item;
            fallbackUsed = strictMainResolution.fallbackUsed;
        }
    }

    if (!directMatch && token && menu.length > 0) {
        directMatch = findDirectMenuMatch(requestedDish, menu, session);
    }

    if (shouldApplyModifierPriority && menu.length > 0) {
        const prioritizedAddon = resolveAddonWithModifierPriority({
            menu,
            requestedDish: resolverRawLabel || requestedDish,
            rawModifier: modifierHint,
            allowGenericFallback: false,
        });

        console.log('[ADDON_MODIFIER_TRACE]', JSON.stringify({
            rawModifier: modifierHint,
            resolvedItemName: prioritizedAddon?.item?.name || null,
            scoreBoost: prioritizedAddon?.scoreBoost || 0,
        }));

        if (!prioritizedAddon?.item) {
            const requestedCategory = inferRequestedCategory({
                requestedDish,
                rawUserText,
                addonContext,
                candidates: [],
            });
            const ambiguousMeta = buildAmbiguousResolution({
                requestedCategory,
                candidates: [],
            });
            return {
                rawRequestedDish,
                requestedDish,
                canonicalDish,
                resolution: { status: DISAMBIGUATION_RESULT.ITEM_NOT_FOUND, item: null, restaurant: null },
                ambiguousMeta,
                requestedCategory,
                resolvedCategory: null,
                addonContext,
                candidateMeta: normalizedMeta,
            };
        }

        directMatch = prioritizedAddon.item;
        fallbackUsed = fallbackUsed || prioritizedAddon.mode !== 'exact_modifier';
    }

    if (!directMatch && explicitAddonRequest && isStaraKamienicaSession(session)) {
        const normalizedRequestedDish = normalizeDish(requestedDish);
        const isZurekRequest =
            normalizedRequestedDish.includes('zurek') ||
            normalizedRequestedDish.includes('urek') ||
            normalizedRequestedDish === 'zur' ||
            normalizedRequestedDish.includes('zur ');

        if (isZurekRequest) {
            const scopedFallback = resolveScopedZurekFallback(menu);
            if (scopedFallback) {
                directMatch = scopedFallback;
                fallbackUsed = true;
            }
        }
    }

    // Guard: detect variant mismatch before silently substituting
    if (directMatch && menu.length > 0) {
        const variantClarify = guardVariantMismatch(rawRequestedDish, directMatch, menu);
        if (variantClarify) {
            return {
                rawRequestedDish,
                requestedDish,
                canonicalDish,
                resolution: null,
                ambiguousMeta: null,
                requestedCategory: null,
                resolvedCategory: null,
                addonContext,
                candidateMeta: normalizedMeta,
                variantClarify,
            };
        }
    }

    const resolution = directMatch
        ? {
            status: DISAMBIGUATION_RESULT.ADD_ITEM,
            item: directMatch,
            restaurant: session?.currentRestaurant || session?.lastRestaurant,
        }
        : await resolveMenuItemConflict(requestedDish, {
            restaurant_id: currentRestaurantId,
            entities,
            session: {
                ...session,
                last_menu: menu,
            },
            last_menu: menu,
            // Hard-lock when restaurant was explicitly mentioned — prevents cross-restaurant fallback
            hardLock: Boolean(entities?.restaurant || entities?.restaurantId),
        });

    const candidatesForCategory =
        resolution?.status === DISAMBIGUATION_RESULT.DISAMBIGUATION_REQUIRED
            ? []
            : collectMenuCandidates(menu, requestedDish);
    const requestedCategory = inferRequestedCategory({
        requestedDish,
        rawUserText,
        addonContext,
        candidates: candidatesForCategory,
    });
    const ambiguousMeta = buildAmbiguousResolution({
        requestedCategory,
        candidates: candidatesForCategory,
    });

    const resolvedCategory = resolution?.item ? resolveCategoryFromItem(resolution.item) : null;
    console.log('[ORDER_CATEGORY_TRACE]', JSON.stringify({
        requestedDish,
        requestedCategory,
        resolvedCategory,
        resolvedItemId: resolution?.item?.id || null,
        fallbackUsed,
    }));

    return {
        rawRequestedDish,
        requestedDish,
        canonicalDish,
        resolution,
        ambiguousMeta,
        requestedCategory,
        resolvedCategory,
        addonContext,
        candidateMeta: normalizedMeta,
    };
}

export class OrderHandler {

    async execute(ctx) {
        const { text, session, entities } = ctx;
        console.log('[KROK5-DEBUG] order entry', JSON.stringify({
            text,
            dish: entities?.dish || null,
            quantity: entities?.quantity || null,
            currentRestaurant: session?.currentRestaurant?.name || null,
            lastRestaurant: session?.lastRestaurant?.name || null,
            lastMenuCount: Array.isArray(session?.last_menu) ? session.last_menu.length : (Array.isArray(session?.last_menu?.items) ? session.last_menu.items.length : 0)
        }));
        console.log("Ä‘ĹşÂ§Â  OrderHandler executing with disambiguation...");

        // --- EXPLICIT RESTAURANT LOCK (P0 fix) ---
        // If entities carry an explicit restaurant mention (name or id) but the session
        // has no currentRestaurant yet, resolve it before item search so that
        // DisambiguationService is scoped to the correct restaurant and never
        // substitutes an item from a different one.
        const explicitRestaurantName = entities?.restaurant || null;
        const explicitRestaurantIdRaw = entities?.restaurantId || null;
        const restaurantMentioned = Boolean(explicitRestaurantName || explicitRestaurantIdRaw);
        let explicitRestaurant = null; // {id, name} if resolved

        if (restaurantMentioned) {
            if (explicitRestaurantIdRaw) {
                // Already have an ID â€” use it; supplement name from entity or session
                explicitRestaurant = {
                    id: explicitRestaurantIdRaw,
                    name: explicitRestaurantName || session?.currentRestaurant?.name || session?.lastRestaurant?.name || null,
                };
            } else if (explicitRestaurantName) {
                // Name only â€” try to resolve to ID via cache / DB
                if (!session?.currentRestaurant && !session?.lastRestaurant) {
                    explicitRestaurant = await resolveRestaurantByName(
                        explicitRestaurantName,
                        session?.entityCache?.restaurants
                    );
                } else {
                    // Session already has a restaurant context â€” honour it
                    explicitRestaurant = session.currentRestaurant || session.lastRestaurant;
                }
            }
        }

        // If resolution succeeded, inject into session context for this request
        // (local only â€” not persisted here; SelectRestaurantHandler owns persistence)
        if (explicitRestaurant?.id && !session.currentRestaurant) {
            session.currentRestaurant = explicitRestaurant;
            if (!session.lastRestaurant) session.lastRestaurant = explicitRestaurant;
            console.log('[EXPLICIT_RESTAURANT_LOCK] Injected restaurant "' + explicitRestaurant.name + '" (id=' + explicitRestaurant.id + ') from entities');
        }

        // P1: restaurant mentioned but could not be resolved â†’ block all item resolution.
        // This covers: name not in entity cache, not in DB, or malformed.
        // Without this guard, DisambiguationService receives restaurant_id=null and
        // performs a global search despite hardLock=true (hardLock only fires when restaurantId
        // is non-null in DisambiguationService).
        if (restaurantMentioned && !explicitRestaurant) {
            const unresolvableName = explicitRestaurantName || String(explicitRestaurantIdRaw || '');
            console.log('[EXPLICIT_RESTAURANT_UNRESOLVED] restaurant="' + unresolvableName + '" â€” blocking item resolution');
            return {
                reply: `Nie znam restauracji "${unresolvableName}". SprĂłbuj powiedzieÄ‡ "znajdĹş restauracje" lub podaj peĹ‚nÄ… nazwÄ™.`,
                intent: 'clarify_order',
                contextUpdates: { expectedContext: 'clarify_order' },
                meta: { source: 'explicit_restaurant_unresolved' },
            };
        }

        const rawUserText = ctx?.body?.text || text || '';
        const rawExtractedQuantity = extractQuantity(rawUserText);
        let hasExplicitNumber = hasExplicitQuantityInText(rawUserText);

        // 0. Extract quantity Ă˘â‚¬â€ť normalize primitive/object/string forms safely.
        let quantity = entities?.quantity;

        if (typeof quantity === 'object' && quantity !== null) {
            quantity = quantity.value ?? 1;
        }

        if (quantity == null) {
            quantity = hasExplicitNumber ? rawExtractedQuantity : 1;
        }

        quantity = Number(quantity ?? 1);

        if (!Number.isFinite(quantity) || quantity < 1) {
            quantity = 1;
        }

        const hasPortionInDish = /\b\d+\s*(?:szt|szt\.|sztuk|ml|l|cm|g|kg)\b/i.test(String(entities?.dish || ''));

        // Prefer quantity explicitly provided by user text over canonized entity quantity.
        if (rawExtractedQuantity > 1 && hasExplicitNumber) {
            quantity = rawExtractedQuantity;
            hasExplicitNumber = true;
        }

        // If quantity likely came from canonicalized dish name (e.g. "6 szt.")
        // and user didn't provide quantity explicitly, default to single item.
        if (!hasExplicitNumber && hasPortionInDish) {
            quantity = 1;
            hasExplicitNumber = false;
        }

        // Use the dish resolved by NLU (e.g. from ordinal selection) or fallback to raw text
        let searchPhrase = entities?.dish || text || "";

        if (typeof searchPhrase === "string") {
            // Remove only trailing parenthetical alias hints, preserving menu names like
            // "Pierogi (ruskie lub z miÄ™sem) 6 szt."
            searchPhrase = searchPhrase.replace(/\s*\([^)]*\)\s*$/g, "").trim();

            // B-QTY FIX: Strip leading quantities (digits or words) from the search phrase
            // so that "2 wege burger" becomes "wege burger" for matching.
            searchPhrase = searchPhrase.replace(/^(?:\d+\s*|jeden|jedna|jedno|dwa|dwie|trzy|cztery|pi[eĂ„â„˘][cĂ„â€ˇ][u]?|sze[sÄąâ€ş][cĂ„â€ˇ][u]?|siedem|osiem|dziewi[eĂ„â„˘][cĂ„â€ˇ][u]?|dziesi[eĂ„â„˘][cĂ„â€ˇ][u]?|kilka|par[Ă„â„˘e])\s+/i, '').trim();
            searchPhrase = stripTrailingRestaurantReference(searchPhrase);
        }

        const itemCandidates = normalizeOrderItemCandidates(entities?.items);
        const singleCompoundQuantityAllowed = isSingleCompoundQuantityAllowed(entities, itemCandidates);
        const singleCompoundCandidate = itemCandidates.length === 1 ? itemCandidates[0] : null;
        const hasSingleCompoundCandidate =
            entities?.compoundSource === 'compound_parser' &&
            Boolean(singleCompoundCandidate);

        if (hasSingleCompoundCandidate && singleCompoundCandidate) {
            searchPhrase =
                singleCompoundCandidate.dish
                || singleCompoundCandidate.meta?.rawLabel
                || searchPhrase;
            searchPhrase = stripTrailingRestaurantReference(searchPhrase);
        }

        if (singleCompoundQuantityAllowed && singleCompoundCandidate) {
            quantity = Math.max(1, Math.floor(Number(singleCompoundCandidate.quantity || quantity || 1)));
            hasExplicitNumber = true;
            searchPhrase = singleCompoundCandidate.dish || singleCompoundCandidate.meta?.rawLabel || searchPhrase;
            searchPhrase = stripTrailingRestaurantReference(searchPhrase);

            console.log('[SINGLE_COMPOUND_ALLOW_TRACE]', JSON.stringify({
                source: entities?.compoundSource || 'unknown',
                dish: searchPhrase,
                quantity,
                skipCategoryClarify: Boolean(entities?.skipCategoryClarify),
                skipGenericTokenBlock: Boolean(entities?.skipGenericTokenBlock),
            }));
        }

        if (itemCandidates.length > 1) {
            const currentRestaurantId = session?.currentRestaurant?.id || session?.lastRestaurant?.id;
            const menu = await hydrateScopedMenuIfNeeded(
                session,
                currentRestaurantId || explicitRestaurant?.id || explicitRestaurantIdRaw
            );
            const addonContext = session?.expectedContext === 'order_addon';
            const sessionRestaurant = session?.currentRestaurant?.name || session?.lastRestaurant?.name || null;
            const resolvedItems = [];
            const resolvedBatchEntries = [];
            const unresolvedBatchEntries = [];
            let targetRestaurant = session?.currentRestaurant || session?.lastRestaurant || null;
            const hasAnyMultiQuantityCue = hasExplicitNumber || hasLikelyMultiQuantityCue(rawUserText);

            for (const candidate of itemCandidates) {
                const candidateTextRaw = candidate.dish;
                const candidateText =
                    stripTrailingRestaurantReference(candidateTextRaw)
                    || String(candidateTextRaw || '').trim();
                const candidateQuantityRaw = Math.max(1, Math.floor(Number(candidate.quantity || 1)));
                const candidateQuantitySource = String(candidate?.meta?.quantitySource || 'default');
                const candidateHasExplicitQuantity = isExplicitQuantitySource(candidateQuantitySource);
                let candidateQuantity = candidateQuantityRaw;

                // Safety guard: for multi-item utterances without explicit quantity in user text,
                // never trust accidental qty>1 propagated from intermediate parsing.
                if (candidateQuantityRaw > 1 && !hasAnyMultiQuantityCue && !candidateHasExplicitQuantity) {
                    candidateQuantity = 1;
                    console.log('[QTY_GUARD] multi_no_explicit_qty_clamped=true');
                    console.log(`[QTY_GUARD] item=${candidateText}`);
                    console.log(`[QTY_GUARD] raw=${candidateQuantityRaw} final=${candidateQuantity}`);
                    console.log(`[QTY_GUARD] source=${candidateQuantitySource}`);
                }

                const candidateResult = await resolveOrderCandidate({
                    candidateText,
                    candidateMeta: candidate.meta,
                    rawUserText,
                    session,
                    entities,
                    menu,
                    currentRestaurantId,
                    addonContext,
                });

                if (candidateResult?.variantClarify) {
                    return candidateResult.variantClarify;
                }

                if (candidateResult?.resolution?.status !== DISAMBIGUATION_RESULT.ADD_ITEM || !candidateResult?.resolution?.item) {
                    if (
                        candidateResult?.resolution?.status === DISAMBIGUATION_RESULT.DISAMBIGUATION_REQUIRED
                        && candidateResult?.resolution?.clarifyType === 'item'
                    ) {
                        return buildItemClarifyResponse({
                            options: candidateResult?.resolution?.options || [],
                            query:
                                candidateResult?.resolution?.query
                                || candidateResult?.rawRequestedDish
                                || candidateResult?.requestedDish
                                || candidateText,
                        });
                    }

                    const clarifyResponse = buildClarifyResponse({
                        ambiguousMeta: {
                            ...(candidateResult?.ambiguousMeta || {}),
                            requestedCategory:
                                candidateResult?.clarifyReason === 'shared_base_ambiguity'
                                    ? (candidateResult?.requestedCategory || ORDER_REQUESTED_CATEGORY.MAIN)
                                    : ORDER_REQUESTED_CATEGORY.MULTI,
                        },
                        addonContext,
                        sessionRestaurant,
                        reason: 'multi_item_not_resolved',
                    });

                    if (candidateResult?.clarifyReason === 'shared_base_ambiguity') {
                        const blockedItemLabel =
                            candidateResult?.rawRequestedDish
                            || candidateResult?.requestedDish
                            || candidateText
                            || 'ta pozycja';
                        const options = candidateResult?.ambiguityCandidates || candidateResult?.ambiguousMeta?.candidates || [];
                        clarifyResponse.ok = false;
                        clarifyResponse.reply = buildSharedBaseClarifyReply(
                            blockedItemLabel,
                            options
                        );
                        clarifyResponse.meta = {
                            ...(clarifyResponse.meta || {}),
                            clarify: {
                                ...(clarifyResponse.meta?.clarify || {}),
                                clarifyReason: 'shared_base_ambiguity',
                                query: candidateResult?.ambiguityQuery || normalizeDish(blockedItemLabel),
                                options: summarizeCandidates(options),
                            },
                        };
                        // Keep strict behavior for variant ambiguity:
                        // user must choose exact variant before batch commit.
                        return clarifyResponse;
                    }

                    const unresolvedLabel =
                        candidateResult?.rawRequestedDish
                        || candidateResult?.requestedDish
                        || candidateText
                        || 'ta pozycja';
                    unresolvedBatchEntries.push({
                        label: unresolvedLabel,
                        candidateResult,
                    });
                    continue;
                }

                const resolvedRestaurant = candidateResult?.resolution?.restaurant || targetRestaurant;
                if (targetRestaurant && resolvedRestaurant && String(targetRestaurant.id || '') !== String(resolvedRestaurant.id || '')) {
                    return buildClarifyResponse({
                        ambiguousMeta: {
                            status: 'AMBIGUOUS',
                            requestedCategory: ORDER_REQUESTED_CATEGORY.MULTI,
                            candidates: [],
                        },
                        addonContext,
                        sessionRestaurant,
                        reason: 'multi_restaurant_conflict',
                    });
                }

                targetRestaurant = resolvedRestaurant || targetRestaurant;
                const item = candidateResult.resolution.item;
                resolvedBatchEntries.push({
                    item,
                    quantity: candidateQuantity,
                    candidateText,
                    candidateResult,
                    candidateMeta: candidate.meta || null,
                    resolvedCategory: candidateResult.resolvedCategory || ORDER_REQUESTED_CATEGORY.UNKNOWN,
                    blockedItemLabel:
                        candidateResult.rawRequestedDish
                        || candidateResult.requestedDish
                        || candidateText
                        || item?.name
                        || 'ta pozycja',
                });
            }

            const hasMainInBatch = resolvedBatchEntries.some(
                (entry) => entry.resolvedCategory === ORDER_REQUESTED_CATEGORY.MAIN
            );
            const hasMainInContext = addonContext || hasMainInActiveOrderContext(session, menu);

            for (const entry of resolvedBatchEntries) {
                const addonBlocked =
                    entry.resolvedCategory === ORDER_REQUESTED_CATEGORY.ADDON
                    && !hasMainInBatch
                    && !hasMainInContext;

                console.log(`[CATEGORY_BATCH] hasMainInBatch=${hasMainInBatch}`);
                console.log(`[CATEGORY_BATCH] addonBlocked=${addonBlocked}`);
                console.log(`[CATEGORY_BATCH] item=${entry.blockedItemLabel}`);

                if (addonBlocked) {
                    const requestedCategoryForLog = entry.candidateResult.requestedCategory || ORDER_REQUESTED_CATEGORY.UNKNOWN;
                    const resolvedCategoryForLog = entry.resolvedCategory || ORDER_REQUESTED_CATEGORY.UNKNOWN;
                    console.log(`[CATEGORY_GUARD] requestedDish=${entry.blockedItemLabel}`);
                    console.log(`[CATEGORY_GUARD] requestedCategory=${requestedCategoryForLog}`);
                    console.log(`[CATEGORY_GUARD] resolvedCategory=${resolvedCategoryForLog}`);
                    console.log('[CATEGORY_GUARD] clarifyReason=addon_without_context');

                    const clarifyResponse = buildClarifyResponse({
                        ambiguousMeta: {
                            ...(entry.candidateResult.ambiguousMeta || {}),
                            requestedCategory: ORDER_REQUESTED_CATEGORY.ADDON,
                        },
                        addonContext,
                        sessionRestaurant,
                        reason: 'addon_without_context',
                    });
                    clarifyResponse.ok = false;
                    clarifyResponse.reply = `Pozycja "${entry.blockedItemLabel}" wyglada jak dodatek i wymaga dania glownego. Czy chcesz najpierw wybrac danie glowne?`;
                    clarifyResponse.meta = {
                        ...(clarifyResponse.meta || {}),
                        clarify: {
                            ...(clarifyResponse.meta?.clarify || {}),
                            blockedItem: entry.blockedItemLabel,
                            clarifyReason: 'addon_without_context',
                            requestedCategory: requestedCategoryForLog,
                            resolvedCategory: resolvedCategoryForLog,
                        },
                    };
                    return clarifyResponse;
                }

                const item = entry.item;
                const candidateQuantity = entry.quantity;

                // Safety Guard (multi-item): validate removed ingredients
                const multiRemoved = entry?.candidateMeta?.special_instructions?.removed;
                if (Array.isArray(multiRemoved) && multiRemoved.length > 0) {
                    const multiRemovable = Array.isArray(item?.safety_data?.removable_ingredients)
                        ? item.safety_data.removable_ingredients.map((s) => String(s).toLowerCase().trim())
                        : [];
                    const multiForbidden = multiRemoved.filter(
                        (ing) => !multiRemovable.includes(String(ing).toLowerCase().trim())
                    );
                    if (multiForbidden.length > 0) {
                        return {
                            reply: `Niestety, nie mogę usunąć "${multiForbidden.join(', ')}" z "${item.name}". ${multiRemovable.length > 0 ? `Możesz usunąć tylko: ${multiRemovable.join(', ')}.` : 'Ten składnik nie może być usunięty.'}`,
                            contextUpdates: {
                                expectedContext: 'order_continue',
                                lastIntent: 'create_order'
                            }
                        };
                    }
                }

                const existingIndex = resolvedItems.findIndex((candidateItem) => String(candidateItem.id) === String(item.id));
                if (existingIndex >= 0) {
                    resolvedItems[existingIndex].quantity += candidateQuantity;
                    resolvedItems[existingIndex].hasExplicitNumber = resolvedItems[existingIndex].hasExplicitNumber || candidateQuantity > 1;
                    // Merge special_instructions: new overrides old for the same keys
                    if (entry?.candidateMeta?.special_instructions) {
                        resolvedItems[existingIndex].special_instructions = {
                            ...(resolvedItems[existingIndex].special_instructions || {}),
                            ...entry.candidateMeta.special_instructions,
                        };
                    }
                } else {
                    resolvedItems.push({
                        id: item.id,
                        name: item.name,
                        price: parseFloat(item.price_pln ?? item.price ?? 0),
                        quantity: candidateQuantity,
                        hasExplicitNumber: candidateQuantity > 1,
                        is_vege: item.is_vege ?? false,
                        spicy: item.spicy ?? false,
                        item_tags: item.item_tags ?? [],
                        dietary_flags: item.dietary_flags ?? [],
                        special_instructions: entry.candidateMeta?.special_instructions || null,
                        safety_data: item.safety_data ?? null,
                    });
                }
            }

            if (unresolvedBatchEntries.length > 0) {
                const unresolvedList = unresolvedBatchEntries
                    .map((entry) => String(entry.label || '').trim())
                    .filter(Boolean);
                const unresolvedTxt = unresolvedList.length > 0
                    ? unresolvedList.join(', ')
                    : 'podanych pozycji';
                return {
                    intent: 'clarify_order',
                    reply: `Nie znalazlam w menu: ${unresolvedTxt}. Niczego jeszcze nie dodalam. Podaj pelne nazwy z menu albo wybierz je na ekranie.`,
                    meta: {
                        source: 'order_handler_multi_atomic_reject',
                        addedToCart: false,
                        clarify: {
                            status: 'AMBIGUOUS',
                            requestedCategory: ORDER_REQUESTED_CATEGORY.MULTI,
                            expectedContext: 'clarify_order',
                            unresolvedItems: unresolvedList,
                        },
                    },
                    contextUpdates: {
                        expectedContext: 'clarify_order',
                        pendingOrder: null,
                        cart: session.cart,
                    },
                };
            }

            if (!targetRestaurant?.id || resolvedItems.length === 0) {
                if (unresolvedBatchEntries.length > 0) {
                    const unresolvedList = unresolvedBatchEntries
                        .map((entry) => String(entry.label || '').trim())
                        .filter(Boolean);
                    const unresolvedTxt = unresolvedList.length > 0
                        ? unresolvedList.join(', ')
                        : 'podanych pozycji';
                    return {
                        intent: 'clarify_order',
                        reply: `Nie znalazlam w menu: ${unresolvedTxt}. Podaj pelne nazwy z menu albo wybierz je na ekranie.`,
                        meta: {
                            clarify: {
                                status: 'AMBIGUOUS',
                                requestedCategory: ORDER_REQUESTED_CATEGORY.MULTI,
                                expectedContext: 'clarify_order',
                                unresolvedItems: unresolvedList,
                            },
                        },
                        contextUpdates: {
                            expectedContext: 'clarify_order',
                        },
                    };
                }
                return buildClarifyResponse({
                    ambiguousMeta: {
                        status: 'AMBIGUOUS',
                        requestedCategory: ORDER_REQUESTED_CATEGORY.MULTI,
                        candidates: [],
                    },
                    addonContext,
                    sessionRestaurant,
                    reason: 'multi_missing_restaurant',
                });
            }

            const total = resolvedItems
                .reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity || 1)), 0)
                .toFixed(2);
            const totalPieces = resolvedItems.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
            const hydratedMenu = menu.length > 0 ? menu : getSessionMenu(session);
            const cartLock = getCartRestaurantLock(session);
            const restaurantLockTrace = {
                conflict: false,
                lockedRestaurantId: cartLock.lockedRestaurantId || null,
                currentRestaurantName: cartLock.cartRestaurantName || null,
                targetRestaurantId: targetRestaurant?.id || null,
                targetRestaurantName: targetRestaurant?.name || null,
            };

            if (
                cartLock.hasItems &&
                cartLock.lockedRestaurantId &&
                String(cartLock.lockedRestaurantId) !== String(targetRestaurant.id)
            ) {
                return buildRestaurantSwitchConflictResponse({
                    currentRestaurantName: cartLock.cartRestaurantName,
                    targetRestaurant,
                    lockedRestaurantId: cartLock.lockedRestaurantId,
                });
            }
            console.log('[RESTAURANT_LOCK_TRACE]', JSON.stringify(restaurantLockTrace));

            session.pendingOrder = {
                restaurant_id: targetRestaurant.id,
                restaurant: targetRestaurant.name,
                items: resolvedItems,
                total,
                createdAt: Date.now(),
            };

            session.expectedContext = 'confirm_add_to_cart';
            if (Array.isArray(hydratedMenu) && hydratedMenu.length > 0) {
                session.lastMenuItems = hydratedMenu;
                session.last_menu = hydratedMenu;
            }

            return {
                reply: `Przygotowalam ${resolvedItems.length} pozycje (${totalPieces} szt.) z ${targetRestaurant.name}. Razem ${total} zl. Potwierdzasz dodanie calego zestawu do koszyka?`,
                meta: {
                    source: 'order_handler_multi_pending',
                    addedToCart: false,
                    cart: session.cart,
                    pendingOrder: session.pendingOrder,
                    orderMode: 'multi_candidate',
                    restaurant: { id: targetRestaurant.id, name: targetRestaurant.name },
                    restaurantLockTrace,
                    unresolvedItems: [],
                    focusedMenuItemId: resolvedItems[0]?.id || null,
                },
                contextUpdates: {
                    lastRestaurant: targetRestaurant,
                    currentRestaurant: targetRestaurant,
                    expectedContext: 'confirm_add_to_cart',
                    pendingOrder: session.pendingOrder,
                    conversationPhase: 'ordering',
                    cart: session.cart,
                    lastIntent: 'create_order',
                    lastMenuItems: hydratedMenu,
                    last_menu: hydratedMenu,
                }
            };
        }

        // 1. DISAMBIGUATION CHECK
        // Use the new service to resolve what item user wants
        // We pass the current restaurant context if available
        const currentRestaurantId = session?.currentRestaurant?.id || session?.lastRestaurant?.id;

        const menu = await hydrateScopedMenuIfNeeded(
            session,
            currentRestaurantId || explicitRestaurant?.id || explicitRestaurantIdRaw
        );
        let rawRequestedDish = searchPhrase;
        if (!entities?.dish && menu.length > 0) {
            const restaurantName = session?.currentRestaurant?.name
                || session?.lastRestaurant?.name
                || explicitRestaurant?.name
                || explicitRestaurantName
                || '';
            const groundedFallback = resolveUniqueGroundedMenuItem(menu, rawUserText, {
                restaurantName,
            });

            if (groundedFallback.item) {
                rawRequestedDish = groundedFallback.item.name || groundedFallback.item.base_name || rawRequestedDish;
                console.log('[GROUNDED_ORDER_QUERY]', JSON.stringify({
                    source: 'raw_text_fallback',
                    restaurantName: restaurantName || null,
                    input: rawUserText,
                    resolvedItemId: groundedFallback.item.id || null,
                    resolvedItemName: groundedFallback.item.name || null,
                    score: groundedFallback.score,
                }));
            } else if (groundedFallback.ambiguous) {
                console.log('[GROUNDED_ORDER_QUERY]', JSON.stringify({
                    source: 'raw_text_fallback',
                    restaurantName: restaurantName || null,
                    input: rawUserText,
                    ambiguous: true,
                    candidates: groundedFallback.candidates.map((entry) => ({
                        id: entry.item?.id || null,
                        name: entry.item?.name || null,
                        score: entry.score,
                    })),
                }));
            }
        }
        const singleCandidateMeta = singleCompoundCandidate?.meta && typeof singleCompoundCandidate.meta === 'object'
            ? singleCompoundCandidate.meta
            : null;
        const compoundResolvedDish = String(singleCompoundCandidate?.dish || '').trim();
        const singleResolverRaw = singleCandidateMeta?.rawLabel || rawRequestedDish;
        const useRawLabelForSingle = Boolean(singleCandidateMeta?.canonicalAliasBundle);
        const resolverBaseDish = compoundResolvedDish || singleResolverRaw || rawRequestedDish;
        const canonicalDish = useRawLabelForSingle
            ? singleResolverRaw
            : canonicalizeDish(resolverBaseDish, session);
        const requestedDish = canonicalDish || resolverBaseDish || rawRequestedDish;
        const token = normalizeDish(requestedDish);
        const addonContext = session?.expectedContext === 'order_addon';
        const explicitAddonRequest =
            addonContext ||
            isExplicitAddonRequest(rawUserText) ||
            isExplicitAddonRequest(requestedDish);
        const explicitDrinkRequest =
            isExplicitDrinkRequest(rawRequestedDish) ||
            isExplicitDrinkRequest(requestedDish);
        const genericTokenBlocked =
            isGenericTokenOnly(rawRequestedDish) ||
            isGenericTokenOnly(requestedDish);
        const modifierHint = normalizeDish(singleCandidateMeta?.modifier || '');
        const shouldBlockGenericToken = genericTokenBlocked && !singleCompoundQuantityAllowed && !modifierHint;
        const modifierSourceText = singleCandidateMeta?.rawLabel || rawRequestedDish || requestedDish;
        const modifierBaseIsAddon =
            isExplicitAddonRequest(modifierSourceText) ||
            isGenericTokenOnly(modifierSourceText);
        const shouldApplyModifierPriority =
            Boolean(modifierHint) &&
            (addonContext || explicitAddonRequest || modifierBaseIsAddon || genericTokenBlocked);

        if (singleCandidateMeta) {
            console.log('[SAFE_CANON_ITEM_TRACE]', JSON.stringify({
                source: entities?.compoundSource || 'single_item',
                inputDish: rawRequestedDish || null,
                outputDish: requestedDish || null,
                quantity: quantity || null,
                canonicalAliasBundle: Boolean(singleCandidateMeta?.canonicalAliasBundle),
                rawLabel: singleCandidateMeta?.rawLabel || null,
            }));
        }

        if (shouldBlockGenericToken) {
            const sessionRestaurant = session?.currentRestaurant?.name || session?.lastRestaurant?.name || null;
            const requestedCategory = inferRequestedCategory({
                requestedDish,
                rawUserText,
                addonContext,
                candidates: [],
            });
            const ambiguousMeta = buildAmbiguousResolution({
                requestedCategory,
                candidates: [],
            });

            console.log('[GENERIC_TOKEN_BLOCK_TRACE]', JSON.stringify({
                requestedDish,
                rawRequestedDish,
                requestedCategory,
                addonContext,
                sessionRestaurant,
            }));

            return buildClarifyResponse({
                ambiguousMeta,
                addonContext,
                sessionRestaurant,
                reason: 'generic_token_block',
            });
        }

        if (!explicitAddonRequest && !explicitDrinkRequest && menu.length > 0) {
            const ambiguityGuard = evaluateSharedBaseAmbiguity({
                query: singleResolverRaw || rawRequestedDish || requestedDish,
                menu,
            });

            if (ambiguityGuard.clarify) {
                const sessionRestaurant = session?.currentRestaurant?.name || session?.lastRestaurant?.name || null;
                const requestedCategory = inferRequestedCategory({
                    requestedDish,
                    rawUserText,
                    addonContext,
                    candidates: ambiguityGuard.candidates,
                });
                const ambiguousMeta = buildAmbiguousResolution({
                    requestedCategory,
                    candidates: ambiguityGuard.candidates,
                });
                const clarifyResponse = buildClarifyResponse({
                    ambiguousMeta,
                    addonContext,
                    sessionRestaurant,
                    reason: 'shared_base_ambiguity',
                });
                clarifyResponse.ok = false;
                clarifyResponse.reply = buildSharedBaseClarifyReply(
                    singleResolverRaw || rawRequestedDish || requestedDish,
                    ambiguityGuard.candidates
                );
                clarifyResponse.meta = {
                    ...(clarifyResponse.meta || {}),
                    clarify: {
                        ...(clarifyResponse.meta?.clarify || {}),
                        clarifyReason: 'shared_base_ambiguity',
                        query: ambiguityGuard.query,
                        options: summarizeCandidates(ambiguityGuard.candidates),
                    },
                };
                return clarifyResponse;
            }
        }

        let directMatch = null;
        let menuCandidates = [];
        let fallbackUsed = false;
        let allowSpecificAddonWithoutContext = false;

        if (!explicitAddonRequest && !explicitDrinkRequest && menu.length > 0) {
            if (compoundResolvedDish) {
                const compoundResolvedDirect = findDirectMenuMatch(compoundResolvedDish, menu, session);
                if (compoundResolvedDirect && isMainMenuItem(compoundResolvedDirect)) {
                    directMatch = compoundResolvedDirect;
                    fallbackUsed = true;
                }
            }

            const strictMainResolution = resolveMainItemStrict({
                menu,
                rawRequestedDish,
                requestedDish,
                canonicalDish,
                session,
            });

            if (!directMatch && strictMainResolution?.item) {
                directMatch = strictMainResolution.item;
                fallbackUsed = strictMainResolution.fallbackUsed;
            }

            if (!directMatch) {
                const fallbackMainMatch = findDirectMenuMatch(
                    compoundResolvedDish || rawRequestedDish || requestedDish,
                    menu,
                    session
                );
                if (fallbackMainMatch && isMainMenuItem(fallbackMainMatch)) {
                    directMatch = fallbackMainMatch;
                    fallbackUsed = true;
                }
            }

            if (!directMatch) {
                if (isStaraKamienicaSession(session)) {
                    const normalizedRequestedDish = normalizeDish(requestedDish);
                    const isZurekRequest =
                        normalizedRequestedDish.includes('zurek') ||
                        normalizedRequestedDish.includes('urek') ||
                        normalizedRequestedDish === 'zur' ||
                        normalizedRequestedDish.includes('zur ');

                    if (isZurekRequest) {
                        const scopedFallback = resolveScopedZurekFallback(menu);
                        if (scopedFallback) {
                            directMatch = scopedFallback;
                            menuCandidates = [scopedFallback];
                            fallbackUsed = true;
                        }
                    }
                }
            }

            if (!directMatch) {
                const sessionRestaurant = session?.currentRestaurant?.name || session?.lastRestaurant?.name || null;
                const clarifyCandidates = collectMenuCandidates(menu, requestedDish);
                const singleCandidate = clarifyCandidates.length === 1 ? clarifyCandidates[0] : null;
                const hasRichCanonicalSignal = isRichSpecificDishPhrase(canonicalDish);
                const canPromoteSingleAddon =
                    Boolean(singleCandidate) &&
                    resolveCategoryFromItem(singleCandidate) === ORDER_REQUESTED_CATEGORY.ADDON &&
                    !addonContext &&
                    !explicitAddonRequest &&
                    !genericTokenBlocked &&
                    (isRichSpecificDishPhrase(rawRequestedDish || requestedDish) || hasRichCanonicalSignal) &&
                    hasDishSignalCompatibility(rawRequestedDish || requestedDish, singleCandidate);

                if (canPromoteSingleAddon) {
                    directMatch = singleCandidate;
                    fallbackUsed = true;
                    allowSpecificAddonWithoutContext = true;
                    console.log('[ORDER_CATEGORY_TRACE]', JSON.stringify({
                        requestedDish,
                        requestedCategory: ORDER_REQUESTED_CATEGORY.ADDON,
                        resolvedCategory: ORDER_REQUESTED_CATEGORY.ADDON,
                        promotedFromClarify: true,
                    }));
                }

                if (!directMatch) {
                    const orderResolveTrace = {
                        canonical: canonicalDish || requestedDish || null,
                        resolvedItemId: null,
                        resolvedType: null,
                        fallbackUsed: false,
                    };
                    console.log('[ORDER_RESOLVE_TRACE]', JSON.stringify(orderResolveTrace));
                    const requestedCategory = inferRequestedCategory({
                        requestedDish,
                        rawUserText,
                        addonContext,
                        candidates: clarifyCandidates,
                    });
                    const ambiguousMeta = buildAmbiguousResolution({
                        requestedCategory,
                        candidates: clarifyCandidates,
                    });
                    console.log('[ORDER_CLARIFY_TRACE]', JSON.stringify({
                        category: ambiguousMeta.requestedCategory,
                        candidateCount: ambiguousMeta.candidates.length,
                        sessionRestaurant,
                    }));
                    return buildClarifyResponse({
                        ambiguousMeta,
                        addonContext,
                        sessionRestaurant,
                        reason: 'strict_main_not_found',
                    });
                }
            }
        }

        if (!directMatch && explicitAddonRequest && token && menu.length > 0) {
            directMatch = findDirectMenuMatch(requestedDish, menu, session);

            if (!directMatch) {
                menuCandidates = menu.filter((item) => {
                    const base = normalizeDish(item?.base_name || '');
                    const name = normalizeDish(item?.name || '');
                    return (base && base.includes(token)) || (name && name.includes(token));
                });

                if (menuCandidates.length === 1) {
                    directMatch = menuCandidates[0];
                    fallbackUsed = true;
                }
            }
        }

        if (!directMatch && explicitDrinkRequest && token && menu.length > 0) {
            directMatch = findDirectMenuMatch(requestedDish, menu, session);
        }

        if (shouldApplyModifierPriority && menu.length > 0) {
            const prioritizedAddon = resolveAddonWithModifierPriority({
                menu,
                requestedDish: singleCandidateMeta?.rawLabel || requestedDish,
                rawModifier: modifierHint,
                allowGenericFallback: false,
            });

            console.log('[ADDON_MODIFIER_TRACE]', JSON.stringify({
                rawModifier: modifierHint,
                resolvedItemName: prioritizedAddon?.item?.name || null,
                scoreBoost: prioritizedAddon?.scoreBoost || 0,
            }));

            if (!prioritizedAddon?.item) {
                const sessionRestaurant = session?.currentRestaurant?.name || session?.lastRestaurant?.name || null;
                const requestedCategory = inferRequestedCategory({
                    requestedDish,
                    rawUserText,
                    addonContext,
                    candidates: [],
                });
                const ambiguousMeta = buildAmbiguousResolution({
                    requestedCategory,
                    candidates: [],
                });
                return buildClarifyResponse({
                    ambiguousMeta,
                    addonContext,
                    sessionRestaurant,
                    reason: 'modifier_not_found',
                });
            }

            directMatch = prioritizedAddon.item;
            fallbackUsed = fallbackUsed || prioritizedAddon.mode !== 'exact_modifier';
        }

        if (!directMatch && isStaraKamienicaSession(session)) {
            const normalizedRequestedDish = normalizeDish(requestedDish);
            const isZurekRequest =
                normalizedRequestedDish.includes('zurek') ||
                normalizedRequestedDish.includes('urek') ||
                normalizedRequestedDish === 'zur' ||
                normalizedRequestedDish.includes('zur ');

            if (isZurekRequest) {
                const scopedFallback = resolveScopedZurekFallback(menu);
                if (scopedFallback) {
                    directMatch = scopedFallback;
                    menuCandidates = [scopedFallback];
                    fallbackUsed = true;
                }
            }
        }

        console.log('[KROK5-DEBUG] match state', JSON.stringify({
            searchPhrase: requestedDish,
            token,
            menuLength: menu.length,
            directMatch: directMatch?.name || null
        }));

        // Guard: detect variant mismatch before silently substituting
        if (directMatch && menu.length > 0) {
            const variantClarify = guardVariantMismatch(rawRequestedDish, directMatch, menu);
            if (variantClarify) return variantClarify;
        }

        const resolution = directMatch
            ? {
                status: DISAMBIGUATION_RESULT.ADD_ITEM,
                item: directMatch,
                restaurant: session?.currentRestaurant || session?.lastRestaurant
            }
            : await resolveMenuItemConflict(requestedDish, {
                restaurant_id: currentRestaurantId,
                entities,
                session: {
                    ...session,
                    last_menu: menu
                },
                last_menu: menu,
                // Hard-lock when restaurant was explicitly mentioned
                hardLock: restaurantMentioned,
            });

        console.log(`Ä‘ĹşÂ§Â  Disambiguation Result: ${resolution.status} for "${searchPhrase}"`);

        const resolvedItemCategory = resolution?.item ? resolveCategoryFromItem(resolution.item) : null;
        if (resolution?.item && !explicitAddonRequest && resolvedItemCategory === ORDER_REQUESTED_CATEGORY.ADDON && !singleCompoundQuantityAllowed && !allowSpecificAddonWithoutContext) {
            const sessionRestaurant = session?.currentRestaurant?.name || session?.lastRestaurant?.name || null;
            const clarifyCandidates = [resolution.item, ...collectMenuCandidates(menu, requestedDish)]
                .filter(Boolean)
                .filter((item, index, arr) => {
                    const key = item?.id
                        ? String(item.id)
                        : `${normalizeDish(item?.name || '')}:${resolveItemType(item)}`;
                    return arr.findIndex((candidate) => {
                        const candidateKey = candidate?.id
                            ? String(candidate.id)
                            : `${normalizeDish(candidate?.name || '')}:${resolveItemType(candidate)}`;
                        return candidateKey === key;
                    }) === index;
                });
            const requestedCategory = inferRequestedCategory({
                requestedDish,
                rawUserText,
                addonContext,
                candidates: clarifyCandidates,
            });
            const ambiguousMeta = buildAmbiguousResolution({
                requestedCategory,
                candidates: clarifyCandidates,
            });
            const blockedOrderResolveTrace = {
                canonical: canonicalDish || requestedDish || null,
                resolvedItemId: resolution.item.id || null,
                resolvedType: resolvedItemCategory,
                fallbackUsed,
            };
            console.log('[ORDER_RESOLVE_TRACE]', JSON.stringify(blockedOrderResolveTrace));
            console.log('[ORDER_CLARIFY_TRACE]', JSON.stringify({
                category: ambiguousMeta.requestedCategory,
                candidateCount: ambiguousMeta.candidates.length,
                sessionRestaurant,
            }));
            return buildClarifyResponse({
                ambiguousMeta,
                addonContext,
                sessionRestaurant,
                reason: 'resolved_non_main_without_addon_context',
            });

        }

        const orderResolveTrace = {
            canonical: canonicalDish || requestedDish || null,
            resolvedItemId: resolution?.item?.id || null,
            resolvedType: resolvedItemCategory,
            fallbackUsed,
        };
        console.log('[ORDER_RESOLVE_TRACE]', JSON.stringify(orderResolveTrace));
        console.log('[ORDER_CATEGORY_TRACE]', JSON.stringify({
            requestedDish,
            requestedCategory: inferRequestedCategory({
                requestedDish,
                rawUserText,
                addonContext,
                candidates: collectMenuCandidates(menu, requestedDish),
            }),
            resolvedCategory: resolution?.item ? resolveCategoryFromItem(resolution.item) : null,
        }));

        // CASE A: Item Not Found
        if (resolution.status === DISAMBIGUATION_RESULT.ITEM_NOT_FOUND) {
            console.log('[KROK5-DEBUG] fallback triggered - dish not matched', JSON.stringify({ searchPhrase, dish: entities?.dish || null, menuLength: menu.length }));
            const sessionRestaurant = session?.currentRestaurant?.name || session?.lastRestaurant?.name || null;
            const clarifyCandidates = collectMenuCandidates(menu, requestedDish);
            const requestedCategory = inferRequestedCategory({
                requestedDish,
                rawUserText,
                addonContext,
                candidates: clarifyCandidates,
            });
            const ambiguousMeta = buildAmbiguousResolution({
                requestedCategory,
                candidates: clarifyCandidates,
            });
            console.log('[ORDER_CLARIFY_TRACE]', JSON.stringify({
                category: ambiguousMeta.requestedCategory,
                candidateCount: ambiguousMeta.candidates.length,
                sessionRestaurant,
            }));
            return buildClarifyResponse({
                ambiguousMeta,
                addonContext,
                sessionRestaurant,
                reason: 'item_not_found',
            });

        }

        // CASE B: Disambiguation Required (Multi-match, no context)
        if (resolution.status === DISAMBIGUATION_RESULT.DISAMBIGUATION_REQUIRED) {
            if (resolution?.clarifyType === 'item') {
                return buildItemClarifyResponse({
                    options: resolution?.options || [],
                    query: resolution?.query || requestedDish || searchPhrase,
                });
            }

            const options = resolution.candidates.slice(0, 3); // Limit to 3
            const optionNames = options.map(o => o.restaurant.name).join(", ");

            return {
                reply: `To danie jest dostĂ„â„˘pne w: ${optionNames}. Z ktÄ‚Ĺ‚rej restauracji chcesz zamÄ‚Ĺ‚wiĂ„â€ˇ?`,
                contextUpdates: {
                    expectedContext: 'choose_restaurant',
                    pendingDisambiguation: resolution.candidates // Store for next turn
                }
            };
            // Note: NLU needs to handle 'choose_restaurant' context next
        }

        // CASE C: Success (Single Item Resolved)
        if (resolution.status === DISAMBIGUATION_RESULT.ADD_ITEM) {
            const item = resolution.item;
            const restaurant = resolution.restaurant || session?.currentRestaurant || session?.lastRestaurant;
            const hydratedMenu = menu.length > 0 ? menu : getSessionMenu(session);
            const cartLock = getCartRestaurantLock(session);
            const restaurantLockTrace = {
                conflict: false,
                lockedRestaurantId: cartLock.lockedRestaurantId || null,
                currentRestaurantName: cartLock.cartRestaurantName || null,
                targetRestaurantId: restaurant?.id || null,
                targetRestaurantName: restaurant?.name || null,
            };

            if (
                cartLock.hasItems &&
                cartLock.lockedRestaurantId &&
                String(cartLock.lockedRestaurantId) !== String(restaurant?.id || '')
            ) {
                return buildRestaurantSwitchConflictResponse({
                    currentRestaurantName: cartLock.cartRestaurantName,
                    targetRestaurant: restaurant,
                    lockedRestaurantId: cartLock.lockedRestaurantId,
                });
            }
            console.log('[RESTAURANT_LOCK_TRACE]', JSON.stringify(restaurantLockTrace));

            // Determine if we are switching restaurants
            const isSwitch = currentRestaurantId && currentRestaurantId !== restaurant.id;

            // Safety Guard: validate special_instructions.removed against removable_ingredients
            const removedIngredients = entities?.special_instructions?.removed;
            if (Array.isArray(removedIngredients) && removedIngredients.length > 0) {
                const removable = Array.isArray(item?.safety_data?.removable_ingredients)
                    ? item.safety_data.removable_ingredients.map((s) => String(s).toLowerCase().trim())
                    : [];
                const forbidden = removedIngredients.filter(
                    (ing) => !removable.includes(String(ing).toLowerCase().trim())
                );
                if (forbidden.length > 0) {
                    return {
                        reply: `Niestety, nie mogę usunąć "${forbidden.join(', ')}" z tej pozycji. ${removable.length > 0 ? `Możesz usunąć tylko: ${removable.join(', ')}.` : 'Ten składnik nie może być usunięty.'}`,
                        contextUpdates: {
                            expectedContext: 'order_continue',
                            lastRestaurant: restaurant,
                            currentRestaurant: restaurant,
                            lastIntent: 'create_order'
                        }
                    };
                }
            }

            // Build Item Payload
            const orderItem = {
                id: item.id,
                name: item.name,
                price: parseFloat(item.price_pln ?? item.price ?? 0),
                quantity: quantity,
                hasExplicitNumber,
                special_instructions: entities.special_instructions || null,
                is_vege: item.is_vege ?? false,
                spicy: item.spicy ?? false,
                item_tags: item.item_tags ?? [],
                dietary_flags: item.dietary_flags ?? [],
                safety_data: item.safety_data ?? null,
            };
            const total = (orderItem.price * quantity).toFixed(2);

            // Build an atomic draft. Only ConfirmAddToCartHandler may mutate the cart.
            session.pendingOrder = {
                restaurant_id: restaurant.id,
                restaurant: restaurant.name,
                items: [orderItem],
                total: total,
                ...(isSwitch ? { warning: 'switch_restaurant' } : {}),
                createdAt: Date.now()
            };

            session.expectedContext = 'confirm_add_to_cart';
            if (Array.isArray(hydratedMenu) && hydratedMenu.length > 0) {
                session.lastMenuItems = hydratedMenu;
                session.last_menu = hydratedMenu;
            }

            const switchPrefix = isSwitch ? `Znaleziono "${item.name}" w ${restaurant.name}. ` : '';
            return {
                reply: `${switchPrefix}Przygotowalam ${formatSzt(quantity)} ${item.name} z ${restaurant.name}. Razem ${total} zl. Potwierdzasz dodanie do koszyka?`,
                meta: {
                    source: 'order_handler_pending',
                    addedToCart: false,
                    cart: session.cart,
                    pendingOrder: session.pendingOrder,
                    restaurant: { id: restaurant.id, name: restaurant.name },
                    restaurantLockTrace,
                    focusedMenuItemId: item.id,
                },
                contextUpdates: {
                    lastRestaurant: restaurant,
                    currentRestaurant: restaurant,
                    expectedContext: 'confirm_add_to_cart',
                    pendingOrder: session.pendingOrder,
                    conversationPhase: 'ordering',
                    cart: session.cart,
                    lastIntent: 'create_order',
                    lastMenuItems: hydratedMenu,
                    last_menu: hydratedMenu,
                }
            };
        }

        return { reply: "Przepraszam, wystĂ„â€¦piÄąâ€š nieoczekiwany bÄąâ€šĂ„â€¦d przy wyszukiwaniu dania." };
    }
}






