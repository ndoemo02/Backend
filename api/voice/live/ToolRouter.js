import { pipeline as brainPipeline } from '../../brain/brainV2.js';
import { getSession, updateSession } from '../../brain/session/sessionStore.js';
import { HandlerDispatcher } from '../../brain/core/pipeline/HandlerDispatcher.js';
import { ResponseBuilder } from '../../brain/core/pipeline/ResponseBuilder.js';
import {
    checkRequiredState,
    getFallbackIntent,
    getIntentDomain,
    mutatesCart,
} from '../../brain/core/IntentCapabilityMap.js';
import { liveLog } from './liveObservability.js';
import { liveMetricsRegisterToolCall } from './liveMetrics.js';
import { recordGpsLocationDrop, recordCuisineHallucination, recordCartDesync, recordCartSuccessDowngrade, recordIvlBlock, recordIvlCheck, recordToolResult } from './liveHealth.js';
import { CART_MUTATION_WHITELIST } from '../../brain/core/pipeline/IntentGroups.js';
import { ORDER_MODE_EVENT, ORDER_MODE_STATE, transitionOrderMode } from '../../brain/core/pipeline/OrderModeFSM.js';
import { RESTAURANT_CATALOG, findRestaurantInText } from '../../brain/data/restaurantCatalog.js';
import { sanitizeLocation } from '../../brain/core/ConversationGuards.js';
import { verifyToolCall } from './IntentVerificationLayer.js';
import { verifyCartMutationIntent } from './CartMutationIntentGuard.js';
import { compareRestaurantsForLive } from './restaurantCompareService.js';
import { searchGroundedMenuItems } from '../../brain/grounding/menuGrounding.js';
import { loadMenuPreview } from '../../brain/menuService.js';
import {
    applyHandlerDecision,
    applyRouterDecision,
    buildToolRouterTrace,
    finalizeTurnTrace,
} from './liveTurnLedger.js';

const TOOL_TO_INTENT = Object.freeze({
    find_nearby: 'find_nearby',
    select_restaurant: 'select_restaurant',
    show_menu: 'menu_request',
    show_more_options: 'show_more_options',
    compare_restaurants: 'find_nearby',
    add_item_to_cart: 'create_order',
    add_items_to_cart: 'create_order',
    update_cart_item_quantity: 'create_order',
    remove_item_from_cart: 'create_order',
    replace_cart_item: 'create_order',
    confirm_add_to_cart: 'confirm_add_to_cart',
    open_checkout: 'open_checkout',
    confirm_order: 'confirm_order',
    cancel_order: 'cancel_order',
    get_cart_state: 'get_cart_state',
    search_menu_items: 'search_menu_items',
});

const CART_COMPANION_QUERY = /\b(napoj|napoje|napoju|pici|kaw|herbat|wod|sok|cola|coca|pepsi|fanta|sprite|lemoniad|piw|win|drink|beverage|deser|frytk|sos|dodatek|dodatki)\b/i;

function getCartRestaurantScope(session = {}) {
    const cart = session?.cart || {};
    const items = Array.isArray(cart.items) ? cart.items : [];
    if (items.length === 0) return null;

    const firstItem = items[0] || {};
    const restaurantId = cart.restaurantId
        || cart.restaurant_id
        || firstItem.restaurantId
        || firstItem.restaurant_id
        || firstItem.restaurant?.id
        || null;
    const restaurantName = firstItem.restaurant_name
        || firstItem.restaurantName
        || firstItem.restaurant?.name
        || (String(session?.currentRestaurant?.id || '') === String(restaurantId || '')
            ? session.currentRestaurant?.name
            : null)
        || (String(session?.lastRestaurant?.id || '') === String(restaurantId || '')
            ? session.lastRestaurant?.name
            : null)
        || null;

    return restaurantId ? { restaurantId, restaurantName, items } : null;
}

function isCartCompanionQuery(value) {
    const normalized = String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return CART_COMPANION_QUERY.test(normalized);
}

function getOrderModeEvent(intent, preState, domainResponse) {
    const expectedContext = domainResponse?.contextUpdates?.expectedContext || null;

    if (intent === 'confirm_order') return ORDER_MODE_EVENT.CONFIRM_ORDER;
    if (intent === 'open_checkout') return ORDER_MODE_EVENT.OPEN_CHECKOUT;
    if (intent === 'cancel_order') return ORDER_MODE_EVENT.CANCEL_ORDER;

    if (intent === 'find_nearby' || intent === 'show_more_options') {
        return ORDER_MODE_EVENT.RESET_TO_NEUTRAL;
    }

    if (intent === 'select_restaurant' || intent === 'menu_request') {
        return ORDER_MODE_EVENT.SELECT_RESTAURANT;
    }

    if (expectedContext === 'confirm_order') return ORDER_MODE_EVENT.REQUEST_CONFIRM;

    if (intent === 'create_order' || intent === 'confirm_add_to_cart') {
        if (
            preState === ORDER_MODE_STATE.NEUTRAL
            || preState === ORDER_MODE_STATE.RESTAURANT_SELECTED
            || preState === ORDER_MODE_STATE.COMPLETED
            || preState === ORDER_MODE_STATE.CANCELLED
        ) {
            return ORDER_MODE_EVENT.START_ORDER;
        }
        return ORDER_MODE_EVENT.ADD_ITEM;
    }

    return ORDER_MODE_EVENT.NOOP;
}

function mapToolPayload(toolName, args = {}, options = {}) {
    const transcriptHint = String(options?.transcriptText || '').trim();
    // Keep tool args as source of truth for discovery calls.
    // Transcript hint remains enabled for non-discovery tools where it helps order phrasing.
    const allowTranscriptHint = toolName !== 'find_nearby';
    const pickText = (fallbackText) => (allowTranscriptHint && transcriptHint) ? transcriptHint : fallbackText;
    switch (toolName) {
        case 'find_nearby':
            {
                const itemQuery = String(args.query || args.dish || '').trim();
                const fallbackText = args.location
                    ? (itemQuery
                        ? `szukam ${itemQuery} w ${args.location}`
                        : (args.cuisine ? `szukam ${args.cuisine} w ${args.location}` : `pokaz restauracje w ${args.location}`))
                    : (itemQuery ? `szukam ${itemQuery}` : (args.cuisine ? `szukam ${args.cuisine}` : 'gdzie zamowic'));
            return {
                text: pickText(fallbackText),
                entities: {
                    location: args.location || null,
                    cuisine: args.cuisine || null,
                    quantity: 1,
                    restaurant: null,
                    restaurantId: null,
                    dish: itemQuery || null,
                    items: null,
                },
                coords: (Number.isFinite(args.lat) && Number.isFinite(args.lng))
                    ? { lat: Number(args.lat), lng: Number(args.lng) }
                    : null,
            };
            }
        case 'select_restaurant':
            return {
                text: pickText(args.selection_text || args.restaurant_name || 'wybieram restauracje'),
                entities: {
                    restaurant: args.restaurant_name || null,
                    restaurantId: args.restaurant_id || null,
                },
            };
        case 'show_menu':
            return {
                text: pickText(args.restaurant_name ? `pokaz menu ${args.restaurant_name}` : 'pokaz menu'),
                entities: {
                    restaurant: args.restaurant_name || null,
                    restaurantId: args.restaurant_id || null,
                },
            };
        case 'show_more_options':
            return {
                text: pickText('pokaz wiecej opcji'),
                entities: {},
            };
        case 'compare_restaurants': {
            const query = String(args.query || args.category || '').trim();
            return {
                text: pickText(query ? `porownaj ${query}` : 'porownaj restauracje'),
                entities: {
                    location: args.city || null,
                    dish: args.query || null,
                    cuisine: args.category || null,
                },
            };
        }
        case 'add_item_to_cart': {
            const quantity = Math.max(1, Math.floor(Number(args.quantity || 1)));
            return {
                text: pickText(quantity > 1 ? `${quantity} ${args.dish}` : `${args.dish}`),
                entities: {
                    dish: args.dish || null,
                    quantity,
                    hasExplicitNumber: quantity > 1,
                    restaurant: args.restaurant_name || null,
                    restaurantId: args.restaurant_id || null,
                    items: null,
                    special_instructions: args.special_instructions || null,
                },
            };
        }
        case 'add_items_to_cart': {
            const sourceItems = Array.isArray(args.items) ? args.items : [];
            const normalizedItems = sourceItems
                .map((item) => ({
                    dish: item?.dish,
                    quantity: Math.max(1, Math.floor(Number(item?.quantity || 1))),
                    meta: item?.dish ? {
                        rawLabel: item.dish,
                        ...(item?.special_instructions ? { special_instructions: item.special_instructions } : {}),
                    } : undefined,
                }))
                .filter((item) => typeof item.dish === 'string' && item.dish.trim().length > 0);
            return {
                text: pickText(normalizedItems.map((item) => `${item.quantity} ${item.dish}`).join(' i ')),
                entities: {
                    dish: normalizedItems[0]?.dish || null,
                    quantity: null,
                    items: normalizedItems,
                    compoundSource: 'live_tool',
                    hasExplicitNumber: normalizedItems.some((item) => item.quantity > 1),
                    skipCategoryClarify: normalizedItems.length > 1,
                    skipGenericTokenBlock: normalizedItems.length > 1,
                    restaurant: args.restaurant_name || null,
                    restaurantId: args.restaurant_id || null,
                },
            };
        }
        case 'update_cart_item_quantity': {
            const quantity = Math.max(1, Math.floor(Number(args.quantity || 1)));
            return {
                text: pickText(`zmien ilosc ${args.dish || 'pozycji'} na ${quantity}`),
                entities: {
                    dish: args.dish || null,
                    quantity,
                    restaurant: args.restaurant_name || null,
                    restaurantId: args.restaurant_id || null,
                    items: null,
                },
            };
        }
        case 'remove_item_from_cart': {
            const quantity = args.quantity == null ? null : Math.max(1, Math.floor(Number(args.quantity || 1)));
            return {
                text: pickText(quantity ? `usun ${quantity} ${args.dish || 'pozycji'}` : `usun ${args.dish || 'pozycje'}`),
                entities: {
                    dish: args.dish || null,
                    quantity,
                    restaurant: args.restaurant_name || null,
                    restaurantId: args.restaurant_id || null,
                    items: null,
                },
            };
        }
        case 'replace_cart_item': {
            const quantity = args.quantity == null ? null : Math.max(1, Math.floor(Number(args.quantity || 1)));
            return {
                text: pickText(`zamien ${args.from_dish || 'pozycje'} na ${args.to_dish || 'inna pozycje'}`),
                entities: {
                    dish: args.to_dish || null,
                    quantity,
                    restaurant: args.restaurant_name || null,
                    restaurantId: args.restaurant_id || null,
                    items: null,
                },
            };
        }
        case 'confirm_add_to_cart':
            return { text: pickText('potwierdz dodanie do koszyka'), entities: {} };
        case 'open_checkout':
            return { text: pickText('przejdz do checkoutu'), entities: {} };
        case 'confirm_order':
            return { text: pickText('potwierdzam zamowienie'), entities: {} };
        case 'cancel_order':
            return { text: pickText('anuluj zamowienie'), entities: {} };
        case 'get_cart_state':
            return { text: pickText('pokaz koszyk'), entities: {} };
        default:
            return { text: '', entities: {} };
    }
}

function hasNearbyCue(text = '') {
    const t = String(text || '').toLowerCase();
    return /\b(w pobliżu|w poblizu|w okolicy|blisko|nearby|obok)\b/i.test(t);
}

function hasLastMenuContext(session = {}) {
    if (Array.isArray(session?.lastMenu) && session.lastMenu.length > 0) return true;
    if (Array.isArray(session?.last_menu) && session.last_menu.length > 0) return true;
    if (Array.isArray(session?.last_menu?.items) && session.last_menu.items.length > 0) return true;
    return false;
}

function normalizeLoose(value = '') {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const COMPARE_CUE_RE = /\b(porown|porownaj|porownac|porownanie|kilku restaurac|kilka restaurac|w wielu restaurac|najtans|najtaniej|cheapest|lowest|po\s+\d+\s+(dani|pozycj)|\d+\s+restaurac)\b/i;
const GENERIC_COMPARE_QUERY_RE = /\b(cena|ceny|cen|miedzy nimi|miedzy nimi|nimi|tymi|tych restaurac|porownanie|ranking)\b/i;
const PLACEHOLDER_LOCATION_RE = /\b(current location|my location|here|nearby|w poblizu|blisko|biezaca lokalizacja)\b/i;
const ORDER_LOCATIONISH_RE = /\b(piekar\w*|slask\w*|bytom\w*|katowic\w*|zabrz\w*|gliwic\w*|chorzow\w*|siemianowic\w*|tarnowsk\w*|miast\w*)\b/i;
const DISH_COMPARE_CUISINE_HINTS = new Set([
    'pierogi',
    'pierog',
    'pierogr',
    'nalesnik',
    'nalesniki',
    'zurek',
    'schabowy',
]);
const DISCOVERY_CATEGORIES = new Set([
    'pizza', 'kebab', 'burger', 'burgery', 'sushi', 'tajska', 'indyjska',
    'meksykanska', 'wloska', 'amerykanska', 'azjatycka', 'wege',
    'wegetarianska', 'napoje', 'deser', 'obiad', 'sniadanie',
]);
const POLISH_NUMBER_WORDS = Object.freeze({
    jeden: 1, jedna: 1, jedno: 1, jednej: 1,
    dwa: 2, dwoch: 2, dwuch: 2, dwu: 2,
    trzy: 3, trzech: 3,
});

function clampRange(value, min, max, fallback) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < min) return min;
    if (parsed > max) return max;
    return parsed;
}

function extractCountFromWord(word = '', fallback = null) {
    const normalized = normalizeLoose(word);
    if (!normalized) return fallback;
    return POLISH_NUMBER_WORDS[normalized] ?? fallback;
}

function parseMaxRestaurants(text = '') {
    const source = normalizeLoose(text);
    if (!source) return 3;

    const numeric = source.match(/\b(\d+)\s+restaurac\w*/i);
    if (numeric?.[1]) return clampRange(Number(numeric[1]), 1, 3, 3);

    const byWord = source.match(/\bw\s+([a-z]+)\s+restaurac\w*/i);
    if (byWord?.[1]) return clampRange(extractCountFromWord(byWord[1], 3), 1, 3, 3);

    return 3;
}

function parseMaxItemsPerRestaurant(text = '') {
    const source = normalizeLoose(text);
    if (!source) return 2;

    const numeric = source.match(/\bpo\s+(\d+)\s*(?:dani\w*|pozycj\w*)?/i);
    if (numeric?.[1]) return clampRange(Number(numeric[1]), 1, 3, 2);

    const byWord = source.match(/\bpo\s+([a-z]+)\s*(?:dani\w*|pozycj\w*)?/i);
    if (byWord?.[1]) return clampRange(extractCountFromWord(byWord[1], 2), 1, 3, 2);

    return 2;
}

function cleanCompareTarget(text = '') {
    if (!text) return '';
    return String(text)
        .replace(/\b(porownaj|porownac|porownanie|w kilku restauracjach?|w kilku lokalach?|w wielu restauracjach?|z \d+ restauracji)\b/gi, ' ')
        .replace(/\b(miedzy nimi|mi[eę]dzy nimi|miedzy tymi|mi[eę]dzy tymi|tych restauracjach?|tymi restauracjami)\b/gi, ' ')
        .replace(/\bpo\s+\d+\s*(?:dani\w*|pozycj\w*)?\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

function isGenericCompareQuery(text = '') {
    const normalized = normalizeLoose(text);
    if (!normalized) return true;
    if (GENERIC_COMPARE_QUERY_RE.test(normalized)) return true;
    return normalized.length < 4;
}

function pickSessionCompareSeed(session = {}) {
    const candidates = [
        session?.last_compare_query,
        session?.pendingDish,
        session?.last_requested_item,
    ];

    for (const candidate of candidates) {
        const cleaned = cleanCompareTarget(String(candidate || '').trim());
        if (!cleaned) continue;
        if (isGenericCompareQuery(cleaned)) continue;
        return cleaned;
    }
    return '';
}

function shouldAutoRouteFindNearbyToCompare({ transcriptText = '', args = {} }) {
    const signalSource = [transcriptText, args?.cuisine, args?.location].filter(Boolean).join(' ');
    const normalized = normalizeLoose(signalSource);
    const cuisineNormalized = normalizeLoose(args?.cuisine || '');
    const hasDishCuisineHint = cuisineNormalized
        ? cuisineNormalized.split(' ').some((token) => DISH_COMPARE_CUISINE_HINTS.has(token))
        : false;
    if (!normalized) return hasDishCuisineHint;
    return COMPARE_CUE_RE.test(normalized) || hasDishCuisineHint;
}

function buildCompareArgsFromFindNearby({ transcriptText = '', args = {}, session = {} }) {
    if (!shouldAutoRouteFindNearbyToCompare({ transcriptText, args })) {
        return null;
    }

    const rawCuisine = String(args?.cuisine || '').trim();
    const cleanedCuisine = cleanCompareTarget(rawCuisine);
    const normalizedCuisine = normalizeLoose(cleanedCuisine);

    let query = '';
    let category = '';
    if (cleanedCuisine) {
        if (DISCOVERY_CATEGORIES.has(normalizedCuisine)) {
            category = cleanedCuisine;
        } else {
            query = cleanedCuisine;
        }
    }

    if (!query && !category) {
        const transcriptCandidate = cleanCompareTarget(transcriptText);
        if (transcriptCandidate) query = transcriptCandidate;
    }

    const sessionSeed = pickSessionCompareSeed(session);
    if ((!query || isGenericCompareQuery(query)) && sessionSeed) {
        query = sessionSeed;
    }

    if (!query && !category) {
        return null;
    }

    const signalSource = [transcriptText, rawCuisine].filter(Boolean).join(' ');
    const normalizedSignal = normalizeLoose(signalSource);
    const metric = /\b(najtans|najtaniej|cheapest|lowest|cen|cena|ceny)\b/i.test(normalizedSignal)
        ? 'lowest_price'
        : 'best_match';

    const rawLocation = String(args?.location || '').trim();
    const normalizedLocation = normalizeLoose(rawLocation);
    const city = rawLocation && !PLACEHOLDER_LOCATION_RE.test(normalizedLocation)
        ? rawLocation.slice(0, 120)
        : null;

    return {
        query: query || undefined,
        category: category || undefined,
        city: city || undefined,
        metric,
        max_restaurants: parseMaxRestaurants(signalSource),
        max_items_per_restaurant: parseMaxItemsPerRestaurant(signalSource),
    };
}

function shouldDropLocationForGps({ locationCandidate, cuisineCandidate, transcriptText, locationLooksLikeRestaurant }) {
    if (!locationCandidate) return false;

    const normalizedLocation = normalizeLoose(locationCandidate);
    const normalizedCuisine = normalizeLoose(cuisineCandidate);

    const isPlaceholder = /\b(current location|my location|here|nearby|w poblizu|blisko|biezaca lokalizacja)\b/i.test(normalizedLocation);
    const mirrorsCuisine = !!normalizedCuisine && normalizedLocation === normalizedCuisine;
    const transcriptNearbyCue = hasNearbyCue(transcriptText);

    return Boolean(
        locationLooksLikeRestaurant
        || isPlaceholder
        || mirrorsCuisine
        || transcriptNearbyCue
    );
}

function transcriptMentionsLocation(transcriptText = '', locationCandidate = '') {
    const transcript = normalizeLoose(transcriptText);
    const location = normalizeLoose(locationCandidate);
    if (!transcript || !location) return false;
    if (transcript.includes(location) || location.includes(transcript)) return true;

    const locationTokens = location.split(' ').filter((token) => token.length >= 4);
    if (locationTokens.length === 0) return false;
    return locationTokens.some((token) => transcript.includes(token));
}

function findCatalogRestaurantById(restaurantId, datasetId = null) {
    const id = String(restaurantId || '').trim();
    if (!id) return null;
    return RESTAURANT_CATALOG.find((restaurant) => (
        String(restaurant?.id || '') === id
        && (!datasetId || restaurant?.datasetId === datasetId)
    )) || null;
}

function getExplicitRestaurantArgs(args = {}, entities = {}) {
    return {
        restaurantId: String(args?.restaurant_id || entities?.restaurantId || '').trim(),
        restaurantName: String(args?.restaurant_name || entities?.restaurant || '').trim(),
    };
}

function resolveCatalogRestaurantFromArgs(args = {}, entities = {}, { datasetId = null } = {}) {
    const { restaurantId, restaurantName } = getExplicitRestaurantArgs(args, entities);
    const byId = findCatalogRestaurantById(restaurantId, datasetId);
    const byName = restaurantName
        ? findRestaurantInText(restaurantName, { demoOnly: Boolean(datasetId), datasetId })
        : null;

    if (restaurantId && !byId) {
        return {
            ok: false,
            reason: 'restaurant_id_not_in_catalog',
            restaurantId,
            restaurantName,
        };
    }

    if (restaurantName && !byName) {
        return {
            ok: false,
            reason: 'restaurant_name_not_in_catalog',
            restaurantId,
            restaurantName,
        };
    }

    if (byId && byName && String(byId.id) !== String(byName.id)) {
        return {
            ok: false,
            reason: 'restaurant_name_id_mismatch',
            restaurantId,
            restaurantName,
            expectedName: byId.name,
        };
    }

    const restaurant = byId || byName || null;
    return { ok: true, restaurant };
}

function canonicalizeRestaurantArgs(args = {}, entities = {}, restaurant) {
    if (!restaurant) return;
    args.restaurant_id = restaurant.id;
    args.restaurant_name = restaurant.name;
    entities.restaurantId = restaurant.id;
    entities.restaurant = restaurant.name;
}

const CUISINE_TRANSCRIPT_ALIASES = Object.freeze([
    {
        cuisines: ['dessert', 'desserts', 'deser', 'desery', 'sweet', 'sweets'],
        transcriptTerms: ['deser', 'desery', 'slodkie', 'slodkiego', 'ciasto', 'ciasta', 'lody', 'lodow'],
    },
    {
        cuisines: ['ice cream', 'icecream', 'lody'],
        transcriptTerms: ['lody', 'lodow', 'loda', 'lodowe', 'lodowy'],
    },
    {
        cuisines: ['drink', 'drinks', 'beverage', 'beverages', 'napoje', 'napoj', 'cola', 'coca cola'],
        transcriptTerms: ['napoj', 'napoje', 'napoju', 'picia', 'picie', 'cola', 'cole', 'coli', 'coca cola', 'coca'],
    },
]);

const TRANSCRIPT_CUISINE_RECOVERY_RULES = Object.freeze([
    {
        canonical: 'ice cream',
        terms: ['lody', 'lodow', 'loda', 'lodowe', 'lodowy', 'gelato', 'ice cream', 'icecream'],
    },
    {
        canonical: 'drinks',
        terms: ['napoj', 'napoje', 'napoju', 'picia', 'picie', 'cola', 'cole', 'coli', 'coca cola', 'coca'],
    },
    {
        canonical: 'dessert',
        terms: ['deser', 'desery', 'slodkie', 'slodkiego', 'ciasto', 'ciasta', 'brownie', 'tiramisu', 'panna cotta'],
    },
]);

const BAKERY_FALSE_POSITIVE_CUISINES = Object.freeze([
    'bakery',
    'cake bakery',
    'cake_bakery',
    'piekarnia',
    'cukiernia',
]);

const EXPLICIT_BAKERY_CUE_RE = /\b(piekarnia|piekarni|piekarnie|cukiernia|cukierni|cukiernie|croissant|croissanty|chleb|chleba|bulka|bulki|bulek|muffin|muffiny|drozdzowk\w*)\b/i;
const PIEKARY_LOCATION_RE = /\bpiekar(?:y|ach|ami|om|a|e|ow)?\b/i;

function isMenuLedCuisineCandidate(cuisineCandidate = '') {
    const cuisine = normalizeLoose(cuisineCandidate);
    if (!cuisine) return false;

    return CUISINE_TRANSCRIPT_ALIASES.some((group) =>
        group.cuisines.some((term) => {
            const normalizedTerm = normalizeLoose(term);
            return cuisine === normalizedTerm
                || cuisine.includes(normalizedTerm)
                || normalizedTerm.includes(cuisine);
        })
    );
}

function transcriptMentionsCuisine(transcriptText = '', cuisineCandidate = '') {
    const transcript = normalizeLoose(transcriptText);
    const cuisine = normalizeLoose(cuisineCandidate);
    if (!transcript || !cuisine) return false;
    if (transcript.includes(cuisine)) return true;

    const cuisineTokens = cuisine.split(/[,\s]+/).filter((token) => token.length >= 3);
    if (cuisineTokens.some((token) => transcript.includes(token))) return true;

    return CUISINE_TRANSCRIPT_ALIASES.some((group) => {
        const cuisineMatches = group.cuisines.some((term) => {
            const normalizedTerm = normalizeLoose(term);
            return cuisine === normalizedTerm
                || cuisine.includes(normalizedTerm)
                || normalizedTerm.includes(cuisine);
        });
        if (!cuisineMatches) return false;
        return group.transcriptTerms.some((term) => transcript.includes(normalizeLoose(term)));
    });
}

function recoverCuisineFromTranscript(transcriptText = '') {
    const transcript = normalizeLoose(transcriptText);
    if (!transcript) return null;

    for (const rule of TRANSCRIPT_CUISINE_RECOVERY_RULES) {
        const matched = rule.terms.some((term) => transcript.includes(normalizeLoose(term)));
        if (matched) return rule.canonical;
    }

    return null;
}

function isBakeryCuisineFalsePositive({ transcriptText = '', locationCandidate = '', cuisineCandidate = '' }) {
    const cuisine = normalizeLoose(cuisineCandidate);
    if (!cuisine) return false;

    const isBakeryLike = BAKERY_FALSE_POSITIVE_CUISINES.some((term) => {
        const normalizedTerm = normalizeLoose(term);
        return cuisine === normalizedTerm || cuisine.includes(normalizedTerm) || normalizedTerm.includes(cuisine);
    });
    if (!isBakeryLike) return false;

    const transcript = normalizeLoose(transcriptText);
    const location = normalizeLoose(locationCandidate);
    const mentionsPiekary = PIEKARY_LOCATION_RE.test(transcript) || PIEKARY_LOCATION_RE.test(location);
    if (!mentionsPiekary) return false;

    const transcriptWithoutPiekary = transcript.replace(PIEKARY_LOCATION_RE, ' ').replace(/\s+/g, ' ').trim();
    return !EXPLICIT_BAKERY_CUE_RE.test(transcriptWithoutPiekary);
}

function looksLikeOrderLocationPhrase(value = '') {
    const normalized = normalizeLoose(value);
    if (!normalized) return false;
    if (PLACEHOLDER_LOCATION_RE.test(normalized)) return true;
    if (ORDER_LOCATIONISH_RE.test(normalized)) return true;
    if (/\b[a-z]{4,}(?:skich|skiej|skim)\b/i.test(normalized)) return true;
    return false;
}

function buildClarifyResponse(activeSessionId, intent, reason, trace = []) {
    const fallbackReply = reason === 'state_requirements_not_met'
        ? 'Brakuje wymaganego kontekstu tej akcji. Najpierw wybierz restaurację lub menu.'
        : 'Ta akcja została zablokowana przez politykę bezpieczeństwa.';

    return {
        ok: true,
        session_id: activeSessionId,
        intent,
        text: fallbackReply,
        reply: fallbackReply,
        should_reply: true,
        actions: [],
        events: [],
        recommendations: [],
        meta: {
            source: 'live_tool_guard',
            liveTool: {
                blocked: true,
                reason,
                trace,
            },
        },
        context: getSession(activeSessionId) || {},
        timestamp: new Date().toISOString(),
    };
}

function toEntitiesResolved(entities = {}) {
    if (!entities || typeof entities !== 'object') return [];
    return Object.entries(entities)
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .slice(0, 12)
        .map(([key, value]) => ({ key, value }));
}

function coercePositiveInt(value, fallback = 1) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return parsed;
}

function readItemQty(item = {}) {
    return coercePositiveInt(item.qty ?? item.quantity ?? 1, 1);
}

function readItemUnitPrice(item = {}) {
    const directCandidates = [item.price_pln, item.price, item.unit_price, item.unitPrice];
    for (const candidate of directCandidates) {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed)) return parsed;
    }
    const cents = Number(item.unit_price_cents ?? item.price_cents);
    if (Number.isFinite(cents)) return cents / 100;
    return 0;
}

function recalcCartTotal(items = []) {
    const total = items.reduce((sum, item) => {
        return sum + readItemUnitPrice(item) * readItemQty(item);
    }, 0);
    return Number(total.toFixed(2));
}

function ensureCartShape(session = {}) {
    const rawCart = (session?.cart && typeof session.cart === 'object') ? session.cart : {};
    const items = Array.isArray(rawCart.items) ? rawCart.items.map((item) => ({ ...item })) : [];
    const rawTotal = Number(rawCart.total);
    const total = Number.isFinite(rawTotal) ? rawTotal : recalcCartTotal(items);
    return {
        ...rawCart,
        items,
        total,
    };
}

function findCartItemIndexByDish(items = [], dish = '') {
    const needle = normalizeLoose(dish);
    if (!needle) return -1;

    let bestIndex = -1;
    let bestScore = 0;

    for (let i = 0; i < items.length; i += 1) {
        const haystack = normalizeLoose(items[i]?.name || items[i]?.base_name || items[i]?.dish || '');
        if (!haystack) continue;

        let score = 0;
        if (haystack === needle) {
            score = 5;
        } else if (haystack.includes(needle)) {
            score = 4;
        } else if (needle.includes(haystack)) {
            score = 3;
        } else {
            const needleTokens = needle.split(' ').filter(Boolean);
            const hayTokens = haystack.split(' ').filter(Boolean);
            const overlap = needleTokens.filter((token) => hayTokens.includes(token)).length;
            if (overlap >= 2) score = 2;
            else if (overlap >= 1) score = 1;
        }

        if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
        }
    }

    return bestScore > 0 ? bestIndex : -1;
}

export class ToolRouter {
    constructor(deps = {}) {
        this.pipeline = deps.pipeline || brainPipeline;
        this.handlers = deps.handlers || this.pipeline.handlers;
        this.getSession = deps.getSession || getSession;
        this.updateSession = deps.updateSession || updateSession;
        this.compareProvider = deps.compareProvider || compareRestaurantsForLive;
        // Rapid-fire protection: śledzi czas ostatniego wywołania narzędzia per sesja
        // Map<sessionId, { toolName: string, timestamp: number, argsKey: string }>
        this._lastToolCallBySession = new Map();
    }

    async _executeCompareRestaurantsTool({
        sessionId,
        toolName,
        args = {},
        requestId = null,
        trace = [],
    }) {
        const snapshot = this.getSession(sessionId) || {};
        const compareResult = await this.compareProvider({ args, session: snapshot });
        const restaurants = Array.isArray(compareResult?.restaurants) ? compareResult.restaurants : [];

        const sessionPatch = {
            lastIntent: 'find_nearby',
            expectedContext: null,
            last_compare_query: compareResult?.comparison?.query || null,
            last_compare_category: compareResult?.comparison?.category || null,
            last_compare_city: compareResult?.comparison?.city || null,
            last_compare_metric: compareResult?.comparison?.metric || null,
        };
        if (compareResult?.comparison?.query) {
            sessionPatch.pendingDish = compareResult.comparison.query;
        }
        if (restaurants.length > 0) {
            sessionPatch.last_restaurants_list = restaurants.map((restaurant) => ({
                id: restaurant?.id || null,
                name: restaurant?.name || null,
                city: restaurant?.city || null,
            })).filter((restaurant) => restaurant.id && restaurant.name);
            sessionPatch.expectedContext = 'select_restaurant';
        }

        const nextSession = this.updateSession(sessionId, sessionPatch);
        const reply = String(compareResult?.reply || 'Nie znalazlam dopasowan do porownania.').trim();
        const safeScore = Number(compareResult?.score);

        const response = {
            ok: compareResult?.ok !== false,
            session_id: sessionId,
            intent: 'find_nearby',
            reply,
            text: reply,
            should_reply: true,
            actions: [],
            restaurants,
            comparison: compareResult?.comparison || null,
            meta: {
                source: 'live_tool:compare_restaurants',
                match: {
                    candidateCount: Number(compareResult?.candidateCount || restaurants.length || 0),
                    topMatch: compareResult?.topMatch || null,
                    score: Number.isFinite(safeScore) ? safeScore : 0,
                },
                comparison: compareResult?.comparison || null,
            },
            context: nextSession,
            timestamp: new Date().toISOString(),
        };

        return {
            ok: response.ok,
            tool: toolName,
            request_id: requestId,
            response,
            trace: [...trace, 'compare_restaurants:executed'],
        };
    }

    _buildCartEditResult({ sessionId, toolName, requestId, reply, cart, context, trace = [] }) {
        return {
            ok: true,
            tool: toolName,
            request_id: requestId,
            response: {
                ok: true,
                session_id: sessionId,
                intent: 'create_order',
                reply,
                text: reply,
                cart,
                meta: {
                    source: `live_tool:${toolName}`,
                    trace,
                },
                context,
                timestamp: new Date().toISOString(),
            },
            trace,
        };
    }

    async _executeCartEditTool({
        sessionId,
        toolName,
        args = {},
        requestId = null,
        turnId = null,
        transcript = null,
        userText = null,
        trace = [],
    }) {
        const snapshot = this.getSession(sessionId) || {};
        const cart = ensureCartShape(snapshot);
        const dish = String(args?.dish || '').trim();
        const quantityArg = args?.quantity == null ? null : coercePositiveInt(args.quantity, 1);

        if (!Array.isArray(cart.items) || cart.items.length === 0) {
            return this._buildCartEditResult({
                sessionId,
                toolName,
                requestId,
                reply: 'Koszyk jest pusty.',
                cart: { ...cart, items: [], total: 0 },
                context: snapshot,
                trace,
            });
        }

        if (toolName === 'update_cart_item_quantity') {
            const matchIndex = findCartItemIndexByDish(cart.items, dish);
            if (matchIndex < 0) {
                return this._buildCartEditResult({
                    sessionId,
                    toolName,
                    requestId,
                    reply: `Nie widze pozycji "${dish}" w koszyku.`,
                    cart,
                    context: snapshot,
                    trace,
                });
            }

            const nextQty = coercePositiveInt(quantityArg ?? 1, 1);
            const matchedItem = { ...cart.items[matchIndex] };
            matchedItem.qty = nextQty;
            matchedItem.quantity = nextQty;
            cart.items[matchIndex] = matchedItem;
            cart.total = recalcCartTotal(cart.items);

            const updatedSession = this.updateSession(sessionId, { cart });
            const itemName = String(matchedItem.name || matchedItem.base_name || dish || 'pozycja').trim();

            return this._buildCartEditResult({
                sessionId,
                toolName,
                requestId,
                reply: `Zmienilam ilosc "${itemName}" na ${nextQty}.`,
                cart,
                context: updatedSession,
                trace,
            });
        }

        if (toolName === 'remove_item_from_cart') {
            const matchIndex = findCartItemIndexByDish(cart.items, dish);
            if (matchIndex < 0) {
                return this._buildCartEditResult({
                    sessionId,
                    toolName,
                    requestId,
                    reply: `Nie widze pozycji "${dish}" w koszyku.`,
                    cart,
                    context: snapshot,
                    trace,
                });
            }

            const matchedItem = { ...cart.items[matchIndex] };
            const currentQty = readItemQty(matchedItem);
            const removeQty = quantityArg == null ? currentQty : quantityArg;
            const nextQty = currentQty - removeQty;
            const itemName = String(matchedItem.name || matchedItem.base_name || dish || 'pozycja').trim();
            let reply = '';

            if (nextQty > 0) {
                matchedItem.qty = nextQty;
                matchedItem.quantity = nextQty;
                cart.items[matchIndex] = matchedItem;
                reply = `Zmniejszylam ilosc "${itemName}" do ${nextQty}.`;
            } else {
                cart.items.splice(matchIndex, 1);
                reply = `Usunelam "${itemName}" z koszyka.`;
            }

            cart.total = recalcCartTotal(cart.items);
            const updatedSession = this.updateSession(sessionId, { cart });

            return this._buildCartEditResult({
                sessionId,
                toolName,
                requestId,
                reply,
                cart,
                context: updatedSession,
                trace,
            });
        }

        if (toolName === 'replace_cart_item') {
            const fromDish = String(args?.from_dish || '').trim();
            const toDish = String(args?.to_dish || '').trim();
            if (!fromDish || !toDish) {
                return this._buildCartEditResult({
                    sessionId,
                    toolName,
                    requestId,
                    reply: 'Podaj pozycje do zamiany i nowa pozycje.',
                    cart,
                    context: snapshot,
                    trace,
                });
            }

            const fromIndex = findCartItemIndexByDish(cart.items, fromDish);
            if (fromIndex < 0) {
                return this._buildCartEditResult({
                    sessionId,
                    toolName,
                    requestId,
                    reply: `Nie widze pozycji "${fromDish}" w koszyku.`,
                    cart,
                    context: snapshot,
                    trace,
                });
            }

            if (normalizeLoose(fromDish) === normalizeLoose(toDish)) {
                const passthrough = await this._executeCartEditTool({
                    sessionId,
                    toolName: 'update_cart_item_quantity',
                    args: { dish: fromDish, quantity: quantityArg ?? readItemQty(cart.items[fromIndex]) },
                    requestId,
                    turnId,
                    transcript,
                    userText,
                    trace,
                });
                return passthrough;
            }

            const originalItem = cart.items[fromIndex];
            const replaceQty = quantityArg ?? readItemQty(originalItem);
            const sessionRestaurant = snapshot?.currentRestaurant || snapshot?.lastRestaurant || {};
            const restaurant_id = args?.restaurant_id || originalItem?.restaurant_id || sessionRestaurant?.id || null;
            const restaurant_name = args?.restaurant_name || originalItem?.restaurant_name || sessionRestaurant?.name || null;

            const addArgs = {
                dish: toDish,
                quantity: replaceQty,
                ...(restaurant_id ? { restaurant_id } : {}),
                ...(restaurant_name ? { restaurant_name } : {}),
            };

            const addRequestId = requestId ? `${requestId}:replace_add` : null;
            const addResult = await this.executeToolCall({
                sessionId,
                toolName: 'add_item_to_cart',
                args: addArgs,
                requestId: addRequestId,
                turnId,
                transcript,
                userText,
            });

            if (!addResult?.ok) {
                return addResult;
            }

            const afterAddSnapshot = this.getSession(sessionId) || {};
            const afterAddCart = ensureCartShape(afterAddSnapshot);
            const removeByIdIndex = originalItem?.id
                ? afterAddCart.items.findIndex((item) => String(item?.id || '') === String(originalItem.id))
                : -1;
            const removeIndex = removeByIdIndex >= 0
                ? removeByIdIndex
                : findCartItemIndexByDish(afterAddCart.items, fromDish);

            if (removeIndex >= 0) {
                afterAddCart.items.splice(removeIndex, 1);
                afterAddCart.total = recalcCartTotal(afterAddCart.items);
                this.updateSession(sessionId, { cart: afterAddCart });
            }

            const finalSnapshot = this.getSession(sessionId) || {};
            const finalCart = ensureCartShape(finalSnapshot);

            return this._buildCartEditResult({
                sessionId,
                toolName,
                requestId,
                reply: `Zamienilam "${fromDish}" na "${toDish}".`,
                cart: finalCart,
                context: finalSnapshot,
                trace,
            });
        }

        return this._buildCartEditResult({
            sessionId,
            toolName,
            requestId,
            reply: 'Nie obsluguje jeszcze tej edycji koszyka.',
            cart,
            context: snapshot,
            trace,
        });
    }

    async executeToolCall({ sessionId, toolName, args = {}, requestId = null, turnId = null, transcript = null, userText = null, debugLiveFlow = null }) {
        const startedAt = Date.now();
        console.log(`[InteractionBridge] backend_execution_start turn_id=${turnId} session_id=${sessionId} tool=${toolName}`);
        const intent = TOOL_TO_INTENT[toolName] || null;
        let turnTrace = buildToolRouterTrace({
            existingTrace: debugLiveFlow?.turnTrace || null,
            sessionId,
            turnId,
            requestId,
            toolName,
            args: debugLiveFlow?.rawArgs || args,
            transcript: debugLiveFlow?.finalTranscript || transcript,
            userText,
        });

        if (!sessionId || typeof sessionId !== 'string') {
            return {
                ok: false,
                error: 'missing_session_id',
                turn_id: turnId || undefined,
                backend_ms: Date.now() - startedAt,
            };
        }

        if (!intent) {
            return {
                ok: false,
                error: 'unknown_tool',
                turn_id: turnId || undefined,
                tool: toolName,
                backend_ms: Date.now() - startedAt,
            };
        }

        liveMetricsRegisterToolCall({ sessionId, toolName });

        if (intent === 'get_cart_state') {
            const snapshot = this.getSession(sessionId) || {};
            const cart = snapshot.cart || { items: [], total: 0 };
            const reply = `Koszyk ma ${Array.isArray(cart.items) ? cart.items.length : 0} pozycji.`;
            turnTrace = applyRouterDecision(turnTrace, {
                mappedText: 'pokaz koszyk',
                mappedIntent: intent,
                runtimeIntent: intent,
                runtimeDomain: getIntentDomain(intent),
                args,
                session: snapshot,
            });
            turnTrace = applyHandlerDecision(turnTrace, {
                domainResponse: { intent: 'get_cart_state', reply, meta: { source: 'live_tool:get_cart_state' } },
                guardedDomainResponse: { intent: 'get_cart_state', reply, meta: { source: 'live_tool:get_cart_state' } },
                cartBefore: cart,
                cartAfter: cart,
                cartChanged: false,
                cartMutationPath: false,
                responseSuggestsSuccess: true,
            });
            const finalizedTrace = finalizeTurnTrace(turnTrace);
            return {
                ok: true,
                tool: toolName,
                request_id: requestId,
                response: {
                    ok: true,
                    session_id: sessionId,
                    intent: 'get_cart_state',
                    reply,
                    text: reply,
                    cart,
                    meta: {
                        source: 'live_tool:get_cart_state',
                        ...(finalizedTrace ? { liveTool: { turnTrace: finalizedTrace } } : {}),
                    },
                    context: snapshot,
                    timestamp: new Date().toISOString(),
                },
                trace: ['tool:get_cart_state'],
            };
        }

        if (intent === 'search_menu_items') {
            const query = String(args?.query || '').trim();
            if (!query) {
                return {
                    ok: false,
                    error: 'missing_query',
                    backend_ms: Date.now() - startedAt,
                };
            }
            const session = this.getSession(sessionId) || {};
            const cartScope = getCartRestaurantScope(session);
            const selectedRestaurant = cartScope || {
                restaurantId: session?.currentRestaurant?.id || session?.lastRestaurant?.id || null,
                restaurantName: session?.currentRestaurant?.name || session?.lastRestaurant?.name || null,
            };
            const scopedRestaurantId = selectedRestaurant.restaurantId;
            const cachedMenuRestaurantId = session.last_menu_restaurant_id || null;
            let menuItems = Array.isArray(session.last_menu)
                && (!scopedRestaurantId || String(cachedMenuRestaurantId || '') === String(scopedRestaurantId))
                ? session.last_menu
                : (Array.isArray(session.menuItems) ? session.menuItems : []);

            if (scopedRestaurantId && (!menuItems.length || (
                (cartScope || cachedMenuRestaurantId)
                && String(cachedMenuRestaurantId || '') !== String(scopedRestaurantId)
            ))) {
                const preview = await loadMenuPreview(scopedRestaurantId, {});
                menuItems = Array.isArray(preview?.menu) ? preview.menu : [];
                if (menuItems.length) {
                    this.updateSession(sessionId, {
                        last_menu: menuItems,
                        last_menu_restaurant_id: scopedRestaurantId,
                    });
                }
            }
            const rankedMatches = searchGroundedMenuItems(menuItems, query, { limit: 8 });
            const matches = rankedMatches.map((entry) => entry.item);
            const focusedMenuItemId = matches[0]?.id || matches[0]?.menuItemId || matches[0]?.menu_item_id || null;
            const scopeLabel = selectedRestaurant.restaurantName
                ? ` w ${selectedRestaurant.restaurantName}`
                : '';
            const reply = matches.length
                ? `Znalazłam${scopeLabel} ${matches.length} pasujących pozycji: ${matches.map(m => m.name).join(', ')}.`
                : `Nie znalazłam${scopeLabel} pozycji pasujących do "${query}".`;
            turnTrace = applyRouterDecision(turnTrace, {
                mappedText: query,
                mappedIntent: intent,
                runtimeIntent: intent,
                runtimeDomain: getIntentDomain(intent),
                args,
                session,
            });
            turnTrace = applyHandlerDecision(turnTrace, {
                domainResponse: { intent: 'search_menu_items', reply, meta: { source: 'live_tool:search_menu_items' } },
                guardedDomainResponse: { intent: 'search_menu_items', reply, meta: { source: 'live_tool:search_menu_items' } },
                cartBefore: session.cart || {},
                cartAfter: session.cart || {},
                cartChanged: false,
                cartMutationPath: false,
                responseSuggestsSuccess: true,
            });
            const finalizedTrace = finalizeTurnTrace(turnTrace, {
                response_meta_focused: focusedMenuItemId || null,
            });
            return {
                ok: true,
                tool: toolName,
                request_id: requestId,
                response: {
                    ok: true,
                    session_id: sessionId,
                    intent: 'search_menu_items',
                    reply,
                    text: matches.length
                        ? `Znalazłam ${matches.length} pasujących dań.`
                        : `Nie znalazłam dań pasujących do "${query}".`,
                    menuItems: matches.map((x) => ({
                        id: x.id,
                        name: x.base_name || x.name,
                        price: x.price ?? null,
                        tags: Array.isArray(x.item_tags) ? x.item_tags : [],
                        category: x.category || null,
                        description: x.description || null,
                        available: x.available !== false,
                        groundingScore: rankedMatches.find((entry) => entry.item === x)?.score || null,
                        variant: x.size_or_variant || null,
                        spicy: !!x.spicy,
                        is_vege: !!x.is_vege,
                        safety: x.safety_data && typeof x.safety_data === 'object' ? {
                            removable: Array.isArray(x.safety_data.removable_ingredients) ? x.safety_data.removable_ingredients : [],
                        } : null,
                    })),
                    // Keep the complete restaurant card available to the UI while
                    // exposing only grounded matches as the assistant shortlist.
                    menu: menuItems,
                    meta: {
                        source: 'live_tool:search_menu_items',
                        menuPresentationMode: focusedMenuItemId ? 'discovery' : 'full',
                        focusedMenuItemId,
                        restaurantId: scopedRestaurantId,
                        restaurantName: selectedRestaurant.restaurantName || null,
                        cartScoped: Boolean(cartScope),
                        ...(finalizedTrace ? { liveTool: { turnTrace: finalizedTrace } } : {}),
                    },
                    context: session,
                    timestamp: new Date().toISOString(),
                },
                trace: ['tool:search_menu_items'],
            };
        }

        const trace = [`tool:${toolName}`, `intent:${intent}`];
        const transcriptText = String(
            transcript
            || userText
            || debugLiveFlow?.finalTranscript
            || debugLiveFlow?.userText
            || ''
        ).trim();
        const mapped = mapToolPayload(toolName, args, { transcriptText });
        const entities = mapped.entities || {};
        const textCameFromTranscript = Boolean(transcriptText && mapped.text === transcriptText);
        const sessionSnapshotForIVL = this.getSession(sessionId) || {};
        const catalogDatasetId = sessionSnapshotForIVL?.demoDatasetId
            || sessionSnapshotForIVL?.demoContext?.datasetId
            || null;
        const cartScope = getCartRestaurantScope(sessionSnapshotForIVL);
        const discoveryQuery = String(args?.query || args?.dish || transcriptText || '').trim();
        if (toolName === 'find_nearby' && cartScope && isCartCompanionQuery(discoveryQuery)) {
            return this.executeToolCall({
                sessionId,
                toolName: 'search_menu_items',
                args: { query: discoveryQuery },
                requestId,
                turnId,
                transcript,
                userText,
                debugLiveFlow,
            });
        }
        const isAddToCartTool = toolName === 'add_item_to_cart' || toolName === 'add_items_to_cart';
        const isConfirmAddToCartTool = toolName === 'confirm_add_to_cart';
        const catalogScopedTool = [
            'select_restaurant',
            'show_menu',
            'add_item_to_cart',
            'add_items_to_cart',
            'update_cart_item_quantity',
            'remove_item_from_cart',
            'replace_cart_item',
        ].includes(toolName);
        if (textCameFromTranscript) {
            trace.push('live_transcript_hint:used');
        } else if (transcriptText && toolName === 'find_nearby') {
            trace.push('live_transcript_hint:ignored_for_find_nearby');
        }

        if (catalogScopedTool) {
            const { restaurantId, restaurantName } = getExplicitRestaurantArgs(args, entities);
            const allowOrderLocationRecovery =
                isAddToCartTool
                && !restaurantId
                && !!restaurantName
                && looksLikeOrderLocationPhrase(restaurantName);
            if ((restaurantId || restaurantName) && !allowOrderLocationRecovery) {
                const catalogScope = resolveCatalogRestaurantFromArgs(
                    args,
                    entities,
                    { datasetId: catalogDatasetId }
                );
                if (!catalogScope.ok) {
                    const guardReason = catalogScope.reason || 'restaurant_not_in_catalog';
                    trace.push(`catalog_guard_blocked:${guardReason}`);
                    const reply = 'Nie mam tej restauracji w FreeFlow. Mogę korzystać tylko z lokali dostępnych w aplikacji.';
                    const clarify = buildClarifyResponse(sessionId, intent, guardReason, trace);
                    clarify.reply = reply;
                    clarify.text = reply;
                    clarify.meta = {
                        ...(clarify.meta || {}),
                        catalogGuard: {
                            blocked: true,
                            reason: guardReason,
                        },
                    };
                    turnTrace = applyRouterDecision(turnTrace, {
                        mappedText: mapped.text || '',
                        mappedIntent: intent,
                        runtimeIntent: intent,
                        runtimeDomain: getIntentDomain(intent),
                        args,
                        session: sessionSnapshotForIVL,
                    });
                    turnTrace = applyHandlerDecision(turnTrace, {
                        domainResponse: clarify,
                        guardedDomainResponse: clarify,
                        cartBefore: sessionSnapshotForIVL?.cart || {},
                        cartAfter: sessionSnapshotForIVL?.cart || {},
                        cartChanged: false,
                        cartMutationPath: mutatesCart(intent),
                        responseSuggestsSuccess: false,
                    });
                    const finalizedTrace = finalizeTurnTrace(turnTrace);
                    if (finalizedTrace) {
                        clarify.meta = {
                            ...(clarify.meta || {}),
                            liveTool: {
                                ...(clarify.meta?.liveTool || {}),
                                turnTrace: finalizedTrace,
                            },
                        };
                    }
                    return {
                        ok: true,
                        tool: toolName,
                        request_id: requestId,
                        response: clarify,
                        trace,
                    };
                }
                canonicalizeRestaurantArgs(args, entities, catalogScope.restaurant);
                if (catalogScope.restaurant) {
                    trace.push(`catalog_guard_ok:${catalogScope.restaurant.id}`);
                }
            }
        }

        // LIVE order robustness:
        // If model filled restaurant_name with a location-like phrase (e.g. "Piekary Slaskie")
        // but transcript clearly contains a known restaurant alias, recover restaurant scope
        // from transcript before IVL/ICM and downstream handlers.
        if (isAddToCartTool && transcriptText) {
            const explicitRestaurantName = String(args?.restaurant_name || entities?.restaurant || '').trim();
            const explicitRestaurantId = String(args?.restaurant_id || entities?.restaurantId || '').trim();
            const transcriptRestaurant = findRestaurantInText(transcriptText, {
                demoOnly: Boolean(catalogDatasetId),
                datasetId: catalogDatasetId,
            });
            let restaurantFromArgs = null;

            if (explicitRestaurantId) {
                restaurantFromArgs = {
                    id: explicitRestaurantId,
                    name: explicitRestaurantName || null,
                };
            } else if (explicitRestaurantName) {
                restaurantFromArgs = findRestaurantInText(explicitRestaurantName, {
                    demoOnly: Boolean(catalogDatasetId),
                    datasetId: catalogDatasetId,
                });
            }

            if (!restaurantFromArgs && transcriptRestaurant) {
                args.restaurant_name = transcriptRestaurant.name || null;
                args.restaurant_id = transcriptRestaurant.id || null;
                entities.restaurant = transcriptRestaurant.name || null;
                entities.restaurantId = transcriptRestaurant.id || null;
                trace.push(`live_order_restaurant_recovered:${transcriptRestaurant.id || 'name_only'}`);
            } else if (!restaurantFromArgs && explicitRestaurantName && looksLikeOrderLocationPhrase(explicitRestaurantName)) {
                if (Object.prototype.hasOwnProperty.call(args, 'restaurant_name')) delete args.restaurant_name;
                if (Object.prototype.hasOwnProperty.call(args, 'restaurant_id')) delete args.restaurant_id;
                entities.restaurant = null;
                entities.restaurantId = null;
                trace.push('live_order_restaurant_dropped:location_like');
            }
        }

        // LIVE order convenience:
        // If model omits restaurant in add-to-cart args but user transcript contains
        // an explicit restaurant name, infer it from catalog and inject before IVL.
        const canInferOrderRestaurant =
            isAddToCartTool
            && !entities?.restaurant
            && !entities?.restaurantId
            && !args?.restaurant_name
            && !args?.restaurant_id
            && !!transcriptText;
        if (canInferOrderRestaurant) {
            const inferredRestaurant = findRestaurantInText(transcriptText, {
                demoOnly: Boolean(catalogDatasetId),
                datasetId: catalogDatasetId,
            });
            if (inferredRestaurant) {
                if (inferredRestaurant.name) {
                    entities.restaurant = inferredRestaurant.name;
                    args.restaurant_name = inferredRestaurant.name;
                }
                if (inferredRestaurant.id) {
                    entities.restaurantId = inferredRestaurant.id;
                    args.restaurant_id = inferredRestaurant.id;
                }
                console.log(`[LIVE_ORDER_SCOPE_INFER] tool=${toolName} restaurant="${inferredRestaurant.name || 'unknown'}" id=${inferredRestaurant.id || 'n/a'}`);
                trace.push(`live_order_restaurant_inferred:${inferredRestaurant.id || 'name_only'}`);
            }
        }

        // If user says only restaurant name in add_item_to_cart (e.g. "Lawasz Kebab"),
        // reroute to show_menu instead of forcing create_order with an invalid dish.
        if (toolName === 'add_item_to_cart') {
            const dishCandidate = String(args?.dish || entities?.dish || '').trim();
            const dishRestaurantMatch = dishCandidate
                ? findRestaurantInText(dishCandidate, {
                    demoOnly: Boolean(catalogDatasetId),
                    datasetId: catalogDatasetId,
                })
                : null;
            const scopedRestaurantId = String(args?.restaurant_id || entities?.restaurantId || '').trim();
            const menuContextPresent = hasLastMenuContext(sessionSnapshotForIVL);
            const dishLooksLikeRestaurant = Boolean(dishRestaurantMatch)
                && (!scopedRestaurantId || scopedRestaurantId === String(dishRestaurantMatch?.id || ''));

            if (dishLooksLikeRestaurant && !menuContextPresent) {
                const rerouteArgs = {};
                const targetRestaurantId = scopedRestaurantId || String(dishRestaurantMatch?.id || '').trim();
                const targetRestaurantName = String(args?.restaurant_name || entities?.restaurant || dishRestaurantMatch?.name || '').trim();
                if (targetRestaurantId) rerouteArgs.restaurant_id = targetRestaurantId;
                if (targetRestaurantName) rerouteArgs.restaurant_name = targetRestaurantName;
                trace.push(`live_order_dish_is_restaurant:reroute_show_menu:${targetRestaurantId || 'name_only'}`);

                const rerouted = await this.executeToolCall({
                    sessionId,
                    toolName: 'show_menu',
                    args: rerouteArgs,
                    requestId,
                    turnId,
                    transcript,
                    userText,
                });
                rerouted.trace = [...trace, ...(Array.isArray(rerouted?.trace) ? rerouted.trace : [])];
                return rerouted;
            }
        }

        // A coherent catalog item is not evidence that the user wanted to buy it.
        // Keep this after catalog/menu reroutes, but before IVL, FSM and handlers.
        if (isAddToCartTool || isConfirmAddToCartTool) {
            const reversibleDraftHasRestaurantScope = Boolean(
                String(args?.restaurant_id || entities?.restaurantId || '').trim()
            );
            const reversibleDraftHasSelection = Boolean(
                String(args?.dish || entities?.dish || '').trim()
                || (Array.isArray(args?.items) && args.items.length > 0)
            );
            const mutationIntent = verifyCartMutationIntent({
                text: transcriptText,
                session: sessionSnapshotForIVL,
                allowReversibleCartDraft:
                    isAddToCartTool
                    && reversibleDraftHasRestaurantScope
                    && reversibleDraftHasSelection,
            });
            trace.push(`cart_intent_guard:${mutationIntent.reason}`);

            if (!mutationIntent.allowed) {
                const guardReply = isConfirmAddToCartTool
                    ? 'Nie potwierdziłam poprzedniej pozycji. Powiedz „potwierdzam” albo ponownie nazwij pozycję z poleceniem „dodaj”.'
                    : mutationIntent.informationalQuestion
                        ? 'Pytasz o tę pozycję, więc nie dodaję jej do koszyka. Odpowiem na podstawie aktualnego menu.'
                        : 'Nie usłyszałam wyraźnej prośby o dodanie tej pozycji. Nic nie zmieniłam w koszyku.';
                const clarify = buildClarifyResponse(
                    sessionId,
                    'clarify_order',
                    mutationIntent.reason,
                    trace,
                );
                clarify.reply = guardReply;
                clarify.text = guardReply;
                clarify.meta = {
                    ...(clarify.meta || {}),
                    cartMutationIntentGuard: {
                        blocked: true,
                        reason: mutationIntent.reason,
                        informationalQuestion: mutationIntent.informationalQuestion,
                    },
                };
                turnTrace = applyRouterDecision(turnTrace, {
                    mappedText: transcriptText,
                    mappedIntent: intent,
                    runtimeIntent: 'clarify_order',
                    runtimeDomain: getIntentDomain('clarify_order'),
                    args,
                    session: sessionSnapshotForIVL,
                });
                turnTrace = applyHandlerDecision(turnTrace, {
                    domainResponse: clarify,
                    guardedDomainResponse: clarify,
                    cartBefore: sessionSnapshotForIVL?.cart || {},
                    cartAfter: sessionSnapshotForIVL?.cart || {},
                    cartChanged: false,
                    cartMutationPath: true,
                    responseSuggestsSuccess: false,
                });
                const finalizedTrace = finalizeTurnTrace(turnTrace);
                if (finalizedTrace) {
                    clarify.meta = {
                        ...(clarify.meta || {}),
                        liveTool: {
                            ...(clarify.meta?.liveTool || {}),
                            turnTrace: finalizedTrace,
                        },
                    };
                }
                return {
                    ok: true,
                    tool: toolName,
                    request_id: requestId,
                    response: clarify,
                    trace,
                };
            }
        }

        let ivlResultForTrace = null;
        // ─── Intent Verification Layer ────────────────────────────────────────
        // Uruchom PRZED główną logiką — po validateAndSanitize (robi GeminiLiveGateway/tool-call),
        // ale zanim ICM/FSM/handlers. Nie zastępuje istniejących guardów.
        {
            const lastCallRecord = this._lastToolCallBySession.get(sessionId);
            const lastToolCallTimestamp = (lastCallRecord?.toolName === toolName)
                ? lastCallRecord.timestamp
                : undefined;
            const lastToolCallArgsKey = (lastCallRecord?.toolName === toolName)
                ? lastCallRecord.argsKey
                : undefined;

            const ivlResult = verifyToolCall({
                toolName,
                args,
                session: sessionSnapshotForIVL,
                lastToolCallTimestamp,
                lastToolCallArgsKey,
            });
            ivlResultForTrace = ivlResult;

            // Zapisz bieżący timestamp dla ochrony rapid-fire
            this._lastToolCallBySession.set(sessionId, {
                toolName,
                timestamp: Date.now(),
                argsKey: JSON.stringify(args || {}),
            });

            // Dodaj trace z IVL do głównego trace
            for (const entry of ivlResult.trace) {
                trace.push(`ivl:${entry}`);
            }

            console.log(`[IVL] toolName=${toolName} verified=${ivlResult.verified} confidence=${ivlResult.confidence} reason=${ivlResult.reason || '-'}`);
            recordIvlCheck({ sessionId, verified: ivlResult.verified });

            if (!ivlResult.verified || ivlResult.confidence < 0.4) {
                const ivlReason = ivlResult.reason || 'intent_verification_failed';
                trace.push(`ivl_blocked:${ivlReason}`);
                recordIvlBlock({ sessionId, reason: ivlReason });

                // Buduj odpowiedź clarify z komunikatem po polsku
                let ivlReply;
                if (ivlReason === 'duplicate_rapid_fire') {
                    ivlReply = 'Proszę chwilę poczekać — poprzednie polecenie jest jeszcze przetwarzane.';
                } else if (ivlReason === 'restaurant_id_not_in_session_list') {
                    ivlReply = 'Nie rozpoznaję tej restauracji na liście wyników. Proszę powiedzieć nazwę lub numer restauracji.';
                } else if (ivlReason === 'confirm_order_state_missing') {
                    ivlReply = 'Brak aktywnego zamówienia do potwierdzenia. Najpierw dodaj pozycje do koszyka.';
                } else if (ivlReason === 'fsm_escalation_blocked') {
                    ivlReply = 'Nie możemy przeskoczyć kroków — najpierw wybierz restaurację i dodaj pozycje.';
                } else if (ivlReason?.includes('downgraded_to_find_nearby')) {
                    ivlReply = 'Nie znalazłam tej restauracji na liście. Szukam ponownie…';
                } else {
                    ivlReply = 'Nie jestem pewna tej akcji. Czy możesz powtórzyć lub doprecyzować?';
                }

                const clarify = buildClarifyResponse(sessionId, intent, ivlReason, trace);
                clarify.reply = ivlReply;
                clarify.text = ivlReply;
                clarify.meta = {
                    ...(clarify.meta || {}),
                    intentVerification: {
                        verified: ivlResult.verified,
                        confidence: ivlResult.confidence,
                        reason: ivlReason,
                        trace: ivlResult.trace,
                    },
                };
                turnTrace = applyRouterDecision(turnTrace, {
                    mappedText: mapped.text || '',
                    mappedIntent: intent,
                    runtimeIntent: intent,
                    runtimeDomain: getIntentDomain(intent),
                    ivlResult,
                    args,
                    session: sessionSnapshotForIVL,
                });
                turnTrace = applyHandlerDecision(turnTrace, {
                    domainResponse: clarify,
                    guardedDomainResponse: clarify,
                    cartBefore: sessionSnapshotForIVL?.cart || {},
                    cartAfter: sessionSnapshotForIVL?.cart || {},
                    cartChanged: false,
                    cartMutationPath: mutatesCart(intent),
                    responseSuggestsSuccess: false,
                });
                const finalizedTrace = finalizeTurnTrace(turnTrace);
                if (finalizedTrace) {
                    clarify.meta = {
                        ...(clarify.meta || {}),
                        liveTool: {
                            ...(clarify.meta?.liveTool || {}),
                            turnTrace: finalizedTrace,
                        },
                    };
                }

                return {
                    ok: true,
                    tool: toolName,
                    request_id: requestId,
                    response: clarify,
                    trace,
                };
            }

            // Jeśli IVL sugeruje inny tool/args — zastosuj korekty
            if (ivlResult.adjustedTool || ivlResult.adjustedArgs) {
                if (ivlResult.adjustedTool && ivlResult.adjustedTool !== toolName) {
                    trace.push(`ivl_adjusted_tool:${toolName}->${ivlResult.adjustedTool}`);
                    // Re-dispatch jako find_nearby (jedyne obsługiwane downgrade)
                    // Wywołujemy rekurencyjnie z nowym toolName i args
                    return this.executeToolCall({
                        sessionId,
                        toolName: ivlResult.adjustedTool,
                        args: ivlResult.adjustedArgs || {},
                        requestId,
                        turnId,
                        transcript,
                        userText,
                    });
                }
                if (ivlResult.adjustedArgs) {
                    Object.assign(args, ivlResult.adjustedArgs);
                    trace.push('ivl_adjusted_args:applied');
                }
            }
        }
        // ─────────────────────────────────────────────────────────────────────

        const isCartEditTool =
            toolName === 'update_cart_item_quantity'
            || toolName === 'remove_item_from_cart'
            || toolName === 'replace_cart_item';

        if (isCartEditTool) {
            turnTrace = applyRouterDecision(turnTrace, {
                mappedText: mapped.text || '',
                mappedIntent: intent,
                runtimeIntent: intent,
                runtimeDomain: getIntentDomain(intent),
                ivlResult: ivlResultForTrace,
                args,
                session: sessionSnapshotForIVL,
            });
            const beforeCart = sessionSnapshotForIVL?.cart || {};
            const editResult = await this._executeCartEditTool({
                sessionId,
                toolName,
                args,
                requestId,
                turnId,
                transcript,
                userText,
                trace,
            });
            const afterSession = this.getSession(sessionId) || {};
            const afterCart = afterSession.cart || editResult?.response?.cart || {};
            const beforeItems = Array.isArray(beforeCart?.items) ? beforeCart.items.length : 0;
            const afterItems = Array.isArray(afterCart?.items) ? afterCart.items.length : 0;
            const beforeTotal = Number(beforeCart?.total || 0);
            const afterTotal = Number(afterCart?.total || 0);
            const cartChanged = beforeItems !== afterItems || beforeTotal !== afterTotal;
            turnTrace = applyHandlerDecision(turnTrace, {
                domainResponse: editResult?.response,
                guardedDomainResponse: editResult?.response,
                cartBefore: beforeCart,
                cartAfter: afterCart,
                cartChanged,
                cartMutationPath: true,
                responseSuggestsSuccess: editResult?.ok !== false,
            });
            const finalizedTrace = finalizeTurnTrace(turnTrace);
            if (finalizedTrace && editResult?.response) {
                editResult.response.meta = {
                    ...(editResult.response.meta || {}),
                    liveTool: {
                        ...(editResult.response.meta?.liveTool || {}),
                        turnTrace: finalizedTrace,
                    },
                };
            }
            return editResult;
        }

        if (toolName === 'compare_restaurants') {
            turnTrace = applyRouterDecision(turnTrace, {
                mappedText: mapped.text || '',
                mappedIntent: intent,
                runtimeIntent: intent,
                runtimeDomain: getIntentDomain(intent),
                ivlResult: ivlResultForTrace,
                args,
                session: sessionSnapshotForIVL,
            });
            const compareBeforeCart = sessionSnapshotForIVL?.cart || {};
            const compareResult = await this._executeCompareRestaurantsTool({
                sessionId,
                toolName,
                args,
                requestId,
                trace,
            });
            turnTrace = applyHandlerDecision(turnTrace, {
                domainResponse: compareResult?.response,
                guardedDomainResponse: compareResult?.response,
                cartBefore: compareBeforeCart,
                cartAfter: (this.getSession(sessionId) || {}).cart || compareBeforeCart,
                cartChanged: false,
                cartMutationPath: false,
                responseSuggestsSuccess: compareResult?.ok !== false,
            });
            const finalizedTrace = finalizeTurnTrace(turnTrace);
            if (finalizedTrace && compareResult?.response) {
                compareResult.response.meta = {
                    ...(compareResult.response.meta || {}),
                    liveTool: {
                        ...(compareResult.response.meta?.liveTool || {}),
                        turnTrace: finalizedTrace,
                    },
                };
            }
            return compareResult;
        }

        if (toolName === 'find_nearby') {
            const compareArgs = buildCompareArgsFromFindNearby({
                transcriptText,
                args,
                session: sessionSnapshotForIVL,
            });
            if (compareArgs) {
                trace.push('live_find_autoroute:compare_restaurants');
                turnTrace = applyRouterDecision(turnTrace, {
                    mappedText: mapped.text || '',
                    mappedIntent: intent,
                    runtimeIntent: 'find_nearby',
                    runtimeDomain: getIntentDomain('find_nearby'),
                    ivlResult: ivlResultForTrace,
                    args,
                    session: sessionSnapshotForIVL,
                });
                const compareBeforeCart = sessionSnapshotForIVL?.cart || {};
                const compareResult = await this._executeCompareRestaurantsTool({
                    sessionId,
                    toolName,
                    args: compareArgs,
                    requestId,
                    trace,
                });
                turnTrace = applyHandlerDecision(turnTrace, {
                    domainResponse: compareResult?.response,
                    guardedDomainResponse: compareResult?.response,
                    cartBefore: compareBeforeCart,
                    cartAfter: (this.getSession(sessionId) || {}).cart || compareBeforeCart,
                    cartChanged: false,
                    cartMutationPath: false,
                    responseSuggestsSuccess: compareResult?.ok !== false,
                });
                const finalizedTrace = finalizeTurnTrace(turnTrace);
                if (finalizedTrace && compareResult?.response) {
                    compareResult.response.meta = {
                        ...(compareResult.response.meta || {}),
                        liveTool: {
                            ...(compareResult.response.meta?.liveTool || {}),
                            turnTrace: finalizedTrace,
                        },
                    };
                }
                return compareResult;
            }
        }

        let runtimeIntent = intent;
        let runtimeDomain = getIntentDomain(runtimeIntent);

        const latArg = Number(args?.lat);
        const lngArg = Number(args?.lng);
        const hasGeoArgs = Number.isFinite(latArg) && Number.isFinite(lngArg);
        const locationCandidate = String(args?.location || '').trim();
        const locationLooksLikeRestaurant = locationCandidate
            ? findRestaurantInText(locationCandidate, {
                demoOnly: Boolean(catalogDatasetId),
                datasetId: catalogDatasetId,
            })
            : null;
        const canPromoteRestaurantSelection =
            runtimeIntent === 'find_nearby'
            && !!transcriptText
            && (!args?.location || !!locationLooksLikeRestaurant || hasGeoArgs);
        const transcriptRestaurantMatch = canPromoteRestaurantSelection
            ? (findRestaurantInText(transcriptText, {
                demoOnly: Boolean(catalogDatasetId),
                datasetId: catalogDatasetId,
            }) || locationLooksLikeRestaurant)
            : null;
        if (transcriptRestaurantMatch) {
            runtimeIntent = 'select_restaurant';
            runtimeDomain = getIntentDomain(runtimeIntent);
            entities.restaurant = entities.restaurant || transcriptRestaurantMatch.name || null;
            entities.restaurantId = entities.restaurantId || transcriptRestaurantMatch.id || null;
            trace.push(`live_find_promoted:select_restaurant:${transcriptRestaurantMatch.id || 'unknown'}`);
            if (locationLooksLikeRestaurant) {
                entities.location = null;
                trace.push('live_find_location_rejected:restaurant_alias');
            }
        }

        // GPS-first guard for live discovery:
        // if we already have coordinates (from tool args OR session), drop noisy/hallucinated location payloads
        // that would incorrectly force CITY mode in findHandler.
        let sessionSnapshot = this.getSession(sessionId) || {};
        const hasSessionGps = Number.isFinite(sessionSnapshot?.session_lat) && Number.isFinite(sessionSnapshot?.session_lng);
        if (runtimeIntent === 'find_nearby' && (hasGeoArgs || hasSessionGps)) {
            const locationToCheck = String(entities?.location || args?.location || '').trim();
            const shouldDropLocation = shouldDropLocationForGps({
                locationCandidate: locationToCheck,
                cuisineCandidate: entities?.cuisine || args?.cuisine || '',
                transcriptText,
                locationLooksLikeRestaurant: !!locationLooksLikeRestaurant,
            });
            const locationMentionedByUser = transcriptMentionsLocation(transcriptText, locationToCheck);
            const locationLooksHallucinated = Boolean(locationToCheck)
                && Boolean(transcriptText)
                && !locationMentionedByUser
                && !locationLooksLikeRestaurant;

            if (shouldDropLocation || locationLooksHallucinated) {
                entities.location = null;
                if (Object.prototype.hasOwnProperty.call(args, 'location')) delete args.location;
                trace.push(shouldDropLocation ? 'live_find_location_dropped_for_gps' : 'live_find_location_hallucinated_dropped_for_gps');
                recordGpsLocationDrop({ sessionId, reason: shouldDropLocation ? 'gps_available' : 'hallucinated' });

                if (!textCameFromTranscript) {
                    if (entities.cuisine) {
                        mapped.text = `szukam ${entities.cuisine}`;
                    } else {
                        mapped.text = 'gdzie zamowic';
                    }
                }
            }

            // Drop hallucinated cuisine when GPS exists.
            // Gemini Flash often invents cuisines (e.g. "kebab, pizza", "Fast Food") when user
            // never mentioned food. If transcript is empty, cuisine is definitely hallucinated.
            const cuisineToCheck = (entities?.cuisine || args?.cuisine || '').trim();
            if (cuisineToCheck) {
                const recoveredCuisine = recoverCuisineFromTranscript(transcriptText);
                const bakeryFalsePositive = isBakeryCuisineFalsePositive({
                    transcriptText,
                    locationCandidate: locationToCheck,
                    cuisineCandidate: cuisineToCheck,
                });
                if (bakeryFalsePositive) {
                    if (recoveredCuisine) {
                        entities.cuisine = recoveredCuisine;
                        args.cuisine = recoveredCuisine;
                        trace.push(`live_find_cuisine_false_positive_recovered:${recoveredCuisine}`);
                        if (!textCameFromTranscript) {
                            if (entities.location && entities.cuisine) {
                                mapped.text = `szukam ${entities.cuisine} w ${entities.location}`;
                            } else if (entities.cuisine) {
                                mapped.text = `szukam ${entities.cuisine}`;
                            } else {
                                mapped.text = 'gdzie zamowic';
                            }
                        }
                    } else {
                        entities.cuisine = null;
                        if (Object.prototype.hasOwnProperty.call(args, 'cuisine')) delete args.cuisine;
                        trace.push('live_find_cuisine_false_positive_piekary_dropped');
                        recordCuisineHallucination({ sessionId, cuisine: cuisineToCheck });
                        if (!textCameFromTranscript) {
                            if (entities.location) {
                                mapped.text = `pokaz restauracje w ${entities.location}`;
                            } else {
                                mapped.text = 'gdzie zamowic';
                            }
                        }
                    }
                } else {
                    const cuisineMentioned = transcriptMentionsCuisine(transcriptText, cuisineToCheck);
                    const preserveMenuLedCuisine = !cuisineMentioned && isMenuLedCuisineCandidate(cuisineToCheck);
                    if (preserveMenuLedCuisine) {
                        trace.push('live_find_cuisine_menu_led_preserved_for_gps');
                        if (!textCameFromTranscript) {
                            if (entities.location && entities.cuisine) {
                                mapped.text = `szukam ${entities.cuisine} w ${entities.location}`;
                            } else if (entities.cuisine) {
                                mapped.text = `szukam ${entities.cuisine}`;
                            }
                        }
                    } else if (!cuisineMentioned) {
                        entities.cuisine = null;
                        if (Object.prototype.hasOwnProperty.call(args, 'cuisine')) delete args.cuisine;
                        if (!textCameFromTranscript && !entities.location) {
                            mapped.text = 'gdzie zamowic';
                        }
                        trace.push('live_find_cuisine_hallucinated_dropped_for_gps');
                        recordCuisineHallucination({ sessionId, cuisine: cuisineToCheck });
                    }
                }
            }
        }

        if (runtimeIntent === 'find_nearby' && entities?.location) {
            const rawLocation = entities.location;
            const sanitizedLocation = sanitizeLocation(rawLocation, sessionSnapshot);
            if (sanitizedLocation !== rawLocation) {
                entities.location = sanitizedLocation || null;
                trace.push(`live_find_location_sanitized:${sanitizedLocation || 'null'}`);

                // Keep fallback text aligned with sanitized entities when transcript is missing.
                if (!textCameFromTranscript) {
                    if (entities.location && entities.cuisine) {
                        mapped.text = `szukam ${entities.cuisine} w ${entities.location}`;
                    } else if (entities.location) {
                        mapped.text = `pokaz restauracje w ${entities.location}`;
                    } else if (entities.cuisine) {
                        mapped.text = `szukam ${entities.cuisine}`;
                    } else {
                        mapped.text = 'gdzie zamowic';
                    }
                }
            }
        }
        const stateCheck = checkRequiredState(runtimeIntent, sessionSnapshot, entities);
        let fallbackIntentForTrace = null;

        trace.push(`icm_required_state:${stateCheck.met ? 'ok' : 'fail'}`);

        if (!stateCheck.met) {
            const fallbackIntent = getFallbackIntent(runtimeIntent);
            fallbackIntentForTrace = fallbackIntent || null;
            if (fallbackIntent) {
                runtimeIntent = fallbackIntent;
                runtimeDomain = getIntentDomain(runtimeIntent);
                trace.push(`icm_fallback_intent:${fallbackIntent}`);
            } else {
                // Fix #5: confirm_order with null fallback  never redirect to find_nearby,
                // give a cart-aware message instead.
                if (runtimeIntent === 'confirm_order') {
                    const snap = this.getSession(sessionId) || {};
                    const cart = snap.cart || { items: [] };
                    const isEmpty = !Array.isArray(cart.items) || cart.items.length === 0;
                    const reply = isEmpty
                        ? 'Koszyk jest pusty. Najpierw dodaj coś do zamwienia.'
                        : 'Proszę najpierw potwierd pozycje w koszyku, zanim złożysz zamwienie.';
                    trace.push('confirm_order:blocked:no_fallback');
                    const clarify = buildClarifyResponse(sessionId, 'confirm_order_failed', 'state_requirements_not_met', trace);
                    clarify.reply = reply;
                    clarify.text = reply;
                    turnTrace = applyRouterDecision(turnTrace, {
                        mappedText: mapped.text || '',
                        mappedIntent: intent,
                        runtimeIntent,
                        runtimeDomain,
                        ivlResult: ivlResultForTrace,
                        stateCheck,
                        fallbackIntent: fallbackIntentForTrace,
                        args,
                        session: sessionSnapshot,
                    });
                    turnTrace = applyHandlerDecision(turnTrace, {
                        domainResponse: clarify,
                        guardedDomainResponse: clarify,
                        cartBefore: snap.cart || {},
                        cartAfter: snap.cart || {},
                        cartChanged: false,
                        cartMutationPath: mutatesCart(runtimeIntent),
                        responseSuggestsSuccess: false,
                    });
                    const finalizedTrace = finalizeTurnTrace(turnTrace);
                    if (finalizedTrace) {
                        clarify.meta = {
                            ...(clarify.meta || {}),
                            liveTool: {
                                ...(clarify.meta?.liveTool || {}),
                                turnTrace: finalizedTrace,
                            },
                        };
                    }
                    return {
                        ok: true,
                        tool: toolName,
                        request_id: requestId,
                        response: clarify,
                        trace,
                    };
                }
                const clarify = buildClarifyResponse(sessionId, runtimeIntent, 'state_requirements_not_met', trace);
                turnTrace = applyRouterDecision(turnTrace, {
                    mappedText: mapped.text || '',
                    mappedIntent: intent,
                    runtimeIntent,
                    runtimeDomain,
                    ivlResult: ivlResultForTrace,
                    stateCheck,
                    fallbackIntent: fallbackIntentForTrace,
                    args,
                    session: sessionSnapshot,
                });
                turnTrace = applyHandlerDecision(turnTrace, {
                    domainResponse: clarify,
                    guardedDomainResponse: clarify,
                    cartBefore: sessionSnapshot?.cart || {},
                    cartAfter: sessionSnapshot?.cart || {},
                    cartChanged: false,
                    cartMutationPath: mutatesCart(runtimeIntent),
                    responseSuggestsSuccess: false,
                });
                const finalizedTrace = finalizeTurnTrace(turnTrace);
                if (finalizedTrace) {
                    clarify.meta = {
                        ...(clarify.meta || {}),
                        liveTool: {
                            ...(clarify.meta?.liveTool || {}),
                            turnTrace: finalizedTrace,
                        },
                    };
                }
                return {
                    ok: true,
                    tool: toolName,
                    request_id: requestId,
                    response: clarify,
                    trace,
                };
            }
        }

        if (mutatesCart(runtimeIntent) && !CART_MUTATION_WHITELIST.includes(runtimeIntent)) {
            trace.push('cart_mutation_blocked:not_whitelisted');
            const clarify = buildClarifyResponse(sessionId, runtimeIntent, 'cart_mutation_not_whitelisted', trace);
            turnTrace = applyRouterDecision(turnTrace, {
                mappedText: mapped.text || '',
                mappedIntent: intent,
                runtimeIntent,
                runtimeDomain,
                ivlResult: ivlResultForTrace,
                stateCheck,
                fallbackIntent: fallbackIntentForTrace,
                args,
                session: sessionSnapshot,
            });
            turnTrace = applyHandlerDecision(turnTrace, {
                domainResponse: clarify,
                guardedDomainResponse: clarify,
                cartBefore: sessionSnapshot?.cart || {},
                cartAfter: sessionSnapshot?.cart || {},
                cartChanged: false,
                cartMutationPath: true,
                responseSuggestsSuccess: false,
            });
            const finalizedTrace = finalizeTurnTrace(turnTrace);
            if (finalizedTrace) {
                clarify.meta = {
                    ...(clarify.meta || {}),
                    liveTool: {
                        ...(clarify.meta?.liveTool || {}),
                        turnTrace: finalizedTrace,
                    },
                };
            }
            return {
                ok: true,
                tool: toolName,
                request_id: requestId,
                response: clarify,
                trace,
            };
        }

        turnTrace = applyRouterDecision(turnTrace, {
            mappedText: mapped.text || '',
            mappedIntent: intent,
            runtimeIntent,
            runtimeDomain,
            ivlResult: ivlResultForTrace,
            stateCheck,
            fallbackIntent: fallbackIntentForTrace,
            args,
            session: sessionSnapshot,
        });

        const context = {
            sessionId,
            text: mapped.text || '',
            rawText: mapped.text || '',
            entities,
            body: {
                meta: {
                    channel: 'live_tools',
                    sourceTool: toolName,
                    nearbyCue: runtimeIntent === 'find_nearby' ? hasNearbyCue(transcriptText) : false,
                },
                ...(mapped.coords || {}),
            },
            domain: runtimeDomain,
            intent: runtimeIntent,
            source: `live_tool:${toolName}`,
            session: sessionSnapshot,
            meta: {
                requestId,
                turnId,
                liveMode: true,
                toolName,
            },
            trace: [...trace],
        };

        const { handler } = HandlerDispatcher.resolve({
            handlers: this.handlers,
            context,
        });

        const applyContextUpdates = (patch) => {
            if (!patch || typeof patch !== 'object') return;
            const next = this.updateSession(sessionId, patch);
            context.session = next;
            context.trace.push(`context_update:${Object.keys(patch).join(',')}`);
        };

        context.dispatchIntentLocked = true;
        context.trace.push('dispatch_intent_locked:true');

        const preCart = (sessionSnapshot && sessionSnapshot.cart) || {};
        const preCartItemCount = Array.isArray(preCart.items) ? preCart.items.length : 0;
        const preCartTotal = preCart.total ?? 0;
        context.meta.preCartItemCount = preCartItemCount;
        context.meta.preCartTotal = preCartTotal;
        console.log(`[CART_GUARD] preCount=${preCartItemCount}`);
        console.log(`[CART_GUARD] preTotal=${preCartTotal}`);

        let domainResponse = await HandlerDispatcher.executeTransactional({
            handler,
            context,
            applyContextUpdates,
        });

        sessionSnapshot = this.getSession(sessionId) || context.session || {};
        const reversibleDraftPrepared =
            runtimeIntent === 'create_order'
            && domainResponse?.meta?.source === 'order_handler_pending'
            && domainResponse?.meta?.addedToCart === false
            && String(sessionSnapshot?.expectedContext || '') === 'confirm_add_to_cart'
            && Array.isArray(sessionSnapshot?.pendingOrder?.items)
            && sessionSnapshot.pendingOrder.items.length > 0;

        // The cart is the user's manual review step before checkout. Once the
        // order handler has resolved a complete, catalog-grounded draft, reuse
        // the existing confirmation handler to revalidate and commit it
        // atomically. No second voice turn or verbatim dish repetition is
        // required; incomplete or stale drafts still fail closed.
        let autoCommittedCartDraft = false;
        if (reversibleDraftPrepared) {
            const confirmationContext = {
                ...context,
                intent: 'confirm_add_to_cart',
                session: sessionSnapshot,
                entities: {},
                meta: {
                    ...(context.meta || {}),
                    autoCommitReversibleDraft: true,
                },
                trace: context.trace,
            };
            const { handler: confirmationHandler } = HandlerDispatcher.resolve({
                handlers: this.handlers,
                context: confirmationContext,
            });
            const confirmationResponse = await HandlerDispatcher.executeTransactional({
                handler: confirmationHandler,
                context: confirmationContext,
                applyContextUpdates,
            });
            domainResponse = confirmationResponse;
            sessionSnapshot = this.getSession(sessionId) || confirmationContext.session || context.session || {};
            autoCommittedCartDraft = confirmationResponse?.meta?.source === 'confirm_add_to_cart_handler';
            context.trace.push(`cart_review:auto_commit:${autoCommittedCartDraft ? 'committed' : 'not_committed'}`);
        }

        const postCart = (sessionSnapshot && sessionSnapshot.cart) || {};
        const postCartItemCount = Array.isArray(postCart.items) ? postCart.items.length : 0;
        const postCartTotal = postCart.total ?? 0;
        const cartChanged = postCartItemCount !== preCartItemCount || postCartTotal !== preCartTotal;
        const cartMutationPath = runtimeIntent === 'create_order' || mutatesCart(runtimeIntent);
        const isClarifyOrderResponse =
            String(domainResponse?.intent || '').toLowerCase() === 'clarify_order'
            || Boolean(domainResponse?.meta?.clarify);
        const pendingConfirmationPrepared =
            runtimeIntent === 'create_order'
            && !cartChanged
            && domainResponse?.meta?.source === 'order_handler_pending'
            && domainResponse?.meta?.addedToCart === false
            && String(sessionSnapshot?.expectedContext || '') === 'confirm_add_to_cart'
            && Array.isArray(sessionSnapshot?.pendingOrder?.items)
            && sessionSnapshot.pendingOrder.items.length > 0;
        const responseSuggestsSuccess =
            domainResponse?.ok !== false
            && !isClarifyOrderResponse
            && !pendingConfirmationPrepared;
        const successDowngraded = cartMutationPath && responseSuggestsSuccess && !cartChanged;
        const clarifyNotAdded =
            cartMutationPath
            && !pendingConfirmationPrepared
            && (isClarifyOrderResponse || successDowngraded || !cartChanged);

        console.log(`[CART_GUARD] postCount=${postCartItemCount}`);
        console.log(`[CART_GUARD] postTotal=${postCartTotal}`);
        console.log(`[CART_GUARD] cartChanged=${cartChanged}`);
        console.log(`[CART_GUARD] pendingConfirmationPrepared=${pendingConfirmationPrepared}`);
        console.log(`[CART_GUARD] successDowngraded=${successDowngraded}`);

        if (successDowngraded) {
          recordCartSuccessDowngrade({ sessionId, reason: 'reply_suggests_success_but_cart_unchanged' });
        }
        if (cartMutationPath && !cartChanged && !successDowngraded && !pendingConfirmationPrepared) {
          recordCartDesync({ sessionId, preCount: preCartItemCount, postCount: postCartItemCount, preTotal: preCartTotal, postTotal: postCartTotal });
        }

        let guardedDomainResponse = domainResponse || { reply: '', intent: runtimeIntent };
        if (successDowngraded) {
            const guardedReply = 'Nie widze zmiany w koszyku. Powtorz prosze dodanie pozycji albo popros o pokazanie koszyka.';
            guardedDomainResponse = {
                ...guardedDomainResponse,
                ok: false,
                reply: guardedReply,
                text: guardedReply,
                should_reply: true,
                meta: {
                    ...(guardedDomainResponse.meta || {}),
                    cart_guard: 'mutation_not_observed',
                },
            };
            context.trace.push('cart_guard:success_downgraded');
        }

        if (isClarifyOrderResponse) {
            const currentReply = String(guardedDomainResponse?.reply || guardedDomainResponse?.text || '').trim();
            const explicitPrefix = 'Jeszcze nie dodalam tej pozycji do koszyka.';
            const nextReply = /nie dodalam|nie dodano|nie dodane/i.test(currentReply)
                ? currentReply
                : `${explicitPrefix} ${currentReply}`.trim();

            guardedDomainResponse = {
                ...guardedDomainResponse,
                ok: false,
                reply: nextReply,
                text: nextReply,
                should_reply: true,
                meta: {
                    ...(guardedDomainResponse.meta || {}),
                    cart_guard: 'clarify_not_added',
                },
            };
            context.trace.push('cart_guard:clarify_not_added');
        }

        const preOrderMode = sessionSnapshot?.orderMode || ORDER_MODE_STATE.NEUTRAL;
        const orderModeEvent = getOrderModeEvent(runtimeIntent, preOrderMode, guardedDomainResponse);
        const orderModeResult = transitionOrderMode(preOrderMode, orderModeEvent, {
            toolName,
            intent: runtimeIntent,
        });
        if (orderModeResult.changed) {
            this.updateSession(sessionId, { orderMode: orderModeResult.state });
            context.trace.push(`order_mode:${preOrderMode}->${orderModeResult.state}`);
            liveLog.orderModeTrace({ sessionId, toolName, from: preOrderMode, to: orderModeResult.state, fsm_event: orderModeEvent });
        } else {
            context.trace.push(`order_mode:${preOrderMode}(noop)`);
        }

        const speechText = guardedDomainResponse?.reply || '';
        turnTrace = applyHandlerDecision(turnTrace, {
            domainResponse,
            guardedDomainResponse,
            cartBefore: preCart,
            cartAfter: postCart,
            cartChanged,
            cartMutationPath,
            responseSuggestsSuccess,
            successDowngraded,
            clarifyNotAdded,
        });
        const { response } = ResponseBuilder.build({
            domainResponse: guardedDomainResponse,
            activeSessionId: sessionId,
            speechText,
            speechPartForTTS: speechText,
            audioContent: null,
            intent: guardedDomainResponse?.intent || runtimeIntent,
            source: `live_tool:${toolName}`,
            totalLatency: Date.now() - startedAt,
            stylingMs: 0,
            ttsMs: 0,
            getSession: this.getSession,
        });
        const finalizedTrace = finalizeTurnTrace(turnTrace, {
            response_meta_focused: guardedDomainResponse?.meta?.focusedMenuItemId || null,
        });

        response.meta = {
            ...(response.meta || {}),
            liveTool: {
                toolName,
                requestId,
                turnId,
                runtimeIntent,
                runtimeDomain,
                orderMode: orderModeResult.state,
                entitiesResolved: toEntitiesResolved(entities),
                cartBefore: {
                    items: preCartItemCount,
                    total: Number(preCartTotal) || 0,
                },
                cartAfter: {
                    items: postCartItemCount,
                    total: Number(postCartTotal) || 0,
                },
                cartChanged,
                autoCommittedCartDraft,
                pendingConfirmationPrepared,
                successDowngraded,
                clarifyNotAdded,
                ...(finalizedTrace ? { turnTrace: finalizedTrace } : {}),
            },
            trace: context.trace,
        };

        const totalLatency = Date.now() - startedAt;
        // Inject backend timing into response so frontend can read it
        if (typeof response === 'object' && response !== null) {
          response.backend_ms = totalLatency;
        }
        const finalOk = guardedDomainResponse?.ok !== false;
        liveLog.toolComplete({
            sessionId,
            toolName,
            requestId,
            ok: finalOk,
            latencyMs: totalLatency,
            intent: runtimeIntent,
            orderMode: orderModeResult.state,
        });
        recordToolResult({ sessionId, ok: finalOk });

        return {
            ok: finalOk,
            tool: toolName,
            request_id: requestId,
            turn_id: turnId || undefined,
            response,
            trace: context.trace,
            backend_ms: totalLatency,
        };
    }
}


