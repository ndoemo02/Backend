import {
    buildChips,
    CATEGORY_KEYWORDS,
    matchQueryToTaxonomy,
} from './queryUnderstanding.js';
import { verifyMenuItemAgainstQuery } from './itemTaxonomyVerification.js';

const ITEM_SCOPED_TAGS = new Set(['spicy', 'vege', 'quick']);
const CLEAR_FILTER_PHRASES = new Set([
    'pokaz cale menu',
    'pokaz pelne menu',
    'cale menu',
    'pelne menu',
    'wyczysc filtry',
    'usun filtry',
]);
const CANCEL_CLARIFICATION_PHRASES = new Set(['anuluj', 'niewazne', 'niewazne juz', 'stop']);

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function itemId(item) {
    const value = item?.id ?? item?.menuItemId ?? item?.menu_item_id;
    return value == null ? null : String(value);
}

function itemHaystack(item) {
    return normalizeText([
        item?.name,
        item?.base_name,
        item?.description,
        item?.category,
        item?.item_family,
        ...(Array.isArray(item?.item_tags) ? item.item_tags : []),
        ...(Array.isArray(item?.item_aliases) ? item.item_aliases : []),
    ].filter(Boolean).join(' '));
}

function matchesCategory(item, categoryId) {
    const haystack = itemHaystack(item);
    if (!haystack) return false;

    const normalizedCategory = normalizeText(categoryId).replace(/\s+/g, '_');
    const explicitCategory = normalizeText(item?.category).replace(/\s+/g, '_');
    const explicitFamily = normalizeText(item?.item_family).replace(/\s+/g, '_');
    if (explicitCategory === normalizedCategory || explicitFamily === normalizedCategory) return true;

    return (CATEGORY_KEYWORDS[categoryId] || [])
        .map(normalizeText)
        .filter(Boolean)
        .some(keyword => haystack.includes(keyword));
}

export function shouldClearActiveDiscoveryFilter(text) {
    return CLEAR_FILTER_PHRASES.has(normalizeText(text));
}

export function shouldCancelDiscoveryClarification(text) {
    const normalized = normalizeText(text);
    return shouldClearActiveDiscoveryFilter(normalized)
        || CANCEL_CLARIFICATION_PHRASES.has(normalized);
}

export function hasPendingDiscoveryClarification(session = {}) {
    return Boolean(
        session?.pendingDiscoveryClarification?.clarification?.blocking
        && session?.awaiting === 'discovery_preference'
    );
}

export function shouldRoutePendingDiscoveryClarification(session = {}, text = '') {
    return hasPendingDiscoveryClarification(session)
        && !shouldCancelDiscoveryClarification(text);
}

export function resolveDiscoveryQueryForSession(session = {}, text = '', source = 'text') {
    const pending = session?.pendingDiscoveryClarification;
    const current = matchQueryToTaxonomy(text, source);

    if (!hasPendingDiscoveryClarification(session)) {
        return { parsed: current, rawText: text, resolvedPending: false };
    }

    if (shouldCancelDiscoveryClarification(text)) {
        return { parsed: current, rawText: text, resolvedPending: false, cancelledPending: true };
    }

    if (Array.isArray(current.preferences) && current.preferences.length > 0) {
        const combinedText = `${pending.rawText || ''} ${text}`.trim();
        return {
            parsed: matchQueryToTaxonomy(combinedText, pending.source || source),
            rawText: combinedText,
            resolvedPending: true,
        };
    }

    const originalText = String(pending.rawText || text).trim();
    return {
        parsed: matchQueryToTaxonomy(originalText, pending.source || source),
        rawText: originalText,
        resolvedPending: false,
    };
}

export function buildActiveDiscoveryFilter(parsed = {}, options = {}) {
    const queryId = options.queryId || `discovery_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
        version: 1,
        queryId,
        rawText: String(options.rawText ?? parsed.rawText ?? '').trim(),
        source: options.source || parsed.source || 'text',
        criteria: {
            topGroups: [...(parsed.topGroups || [])],
            categories: [...(parsed.categories || [])],
            tags: [...(parsed.tags || [])],
            vibes: [...(parsed.vibes || [])],
            dietary: [...(parsed.dietarys || [])],
            preferences: [...(parsed.preferences || [])],
            priceBand: parsed.priceBand || undefined,
            sort: parsed.sort || undefined,
            proximity: parsed.proximity || undefined,
        },
        unresolved: [...(parsed.unresolved || [])],
        chips: buildChips(parsed),
    };
}

export function hasActiveDiscoveryCriteria(filter = null) {
    if (!filter?.criteria) return false;
    const criteria = filter.criteria;
    return Boolean(
        criteria.topGroups?.length
        || criteria.categories?.length
        || criteria.tags?.length
        || criteria.vibes?.length
        || criteria.dietary?.length
        || criteria.preferences?.length
        || criteria.priceBand
        || criteria.sort
        || criteria.proximity
    );
}

export function hasMenuItemDiscoveryCriteria(filter = null) {
    if (!filter?.criteria) return false;
    const criteria = filter.criteria;
    return Boolean(
        criteria.categories?.length
        || criteria.dietary?.length
        || criteria.preferences?.length
        || (criteria.tags || []).some(tag => ITEM_SCOPED_TAGS.has(tag))
    );
}

function parsedQueryFromFilter(filter) {
    const criteria = filter?.criteria || {};
    return {
        categories: criteria.categories || [],
        tags: (criteria.tags || []).filter(tag => ITEM_SCOPED_TAGS.has(tag)),
        dietarys: criteria.dietary || [],
        preferences: criteria.preferences || [],
        priceBand: criteria.priceBand || null,
    };
}

export function applyActiveDiscoveryFilterToMenu(menuItems = [], filter = null) {
    const sourceItems = Array.isArray(menuItems) ? menuItems : [];
    if (!hasMenuItemDiscoveryCriteria(filter)) {
        return {
            menu: [...sourceItems],
            matchedItems: [],
            matchedMenuItemIds: [],
            hasItemCriteria: false,
        };
    }

    const parsedQuery = parsedQueryFromFilter(filter);
    const matchedItems = [];
    const remainingItems = [];

    for (const item of sourceItems) {
        const categoryMatch = parsedQuery.categories.length === 0
            || parsedQuery.categories.some(categoryId => matchesCategory(item, categoryId));
        const taxonomyMatch = verifyMenuItemAgainstQuery(item, parsedQuery).passes;
        if (categoryMatch && taxonomyMatch) matchedItems.push(item);
        else remainingItems.push(item);
    }

    return {
        menu: [...matchedItems, ...remainingItems],
        matchedItems,
        matchedMenuItemIds: matchedItems.map(itemId).filter(Boolean),
        hasItemCriteria: true,
    };
}
