const DIETARY_RULES = {
    vegetarian: {
        positive: ['vegetarian', 'vege', 'vegan', 'plant_based', 'meat_free', 'bez_miesa'],
        negative: ['contains_meat', 'meat', 'pork', 'beef', 'chicken', 'fish', 'gelatin'],
    },
    vegan: {
        positive: ['vegan', 'plant_based'],
        negative: [
            'contains_meat', 'meat', 'pork', 'beef', 'chicken', 'fish',
            'gelatin', 'contains_milk', 'milk', 'contains_eggs', 'eggs',
            'honey', 'contains_honey',
        ],
    },
    gluten_free: {
        positive: ['gluten_free', 'bez_glutenu'],
        negative: ['contains_gluten', 'gluten'],
    },
    lactose_free: {
        positive: ['lactose_free', 'bez_laktozy', 'dairy_free'],
        negative: ['contains_lactose', 'lactose', 'contains_milk', 'milk'],
    },
    keto: {
        positive: ['keto', 'keto_friendly', 'low_carb'],
        negative: [],
    },
    halal: {
        positive: ['halal', 'halal_certified'],
        negative: ['pork', 'contains_pork', 'alcohol'],
    },
};

const PREFERENCE_RULES = {
    light: ['light', 'lighter', 'lekkie'],
    high_protein: ['high_protein', 'protein_rich', 'wysokobialkowe'],
    low_calorie: ['low_calorie', 'low_kcal', 'niskokaloryczne'],
};

const SIZE_ALIASES = {
    small: ['s', 'small', 'mały', 'maly', 'mała', 'mala', 'małe', 'male'],
    medium: ['m', 'medium', 'mid', 'med', 'średni', 'sredni', 'średnia', 'srednia'],
    large: ['l', 'large', 'duży', 'duzy', 'duża', 'duza', 'duże', 'duze'],
    xl: ['xl', 'max', 'maks', 'maxi', 'największy', 'najwiekszy'],
    xxl: ['xxl', 'giga', 'mega'],
};

function normalize(value) {
    return String(value ?? '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function toArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed;
        } catch {
            // Continue with delimiter parsing.
        }
    }
    return trimmed.split(/[,;|]/);
}

function collectSafetySignals(value, output) {
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
        if (entry === true) output.add(normalize(key));
        if (typeof entry === 'string') output.add(normalize(entry));
        if (Array.isArray(entry)) {
            for (const item of entry) output.add(normalize(item));
        }
    }
}

export function collectItemTaxonomySignals(item = {}) {
    const signals = new Set();
    for (const value of [
        ...toArray(item.item_tags),
        ...toArray(item.dietary_flags),
    ]) {
        const normalized = normalize(value);
        if (normalized) signals.add(normalized);
    }
    collectSafetySignals(item.safety_data, signals);
    return signals;
}

function feedback(id, dimension, state, resolvedValue) {
    return {
        id,
        dimension,
        state,
        ...(resolvedValue ? { resolvedValue } : {}),
    };
}

function verifyDietary(item, dietaryId, signals) {
    const rule = DIETARY_RULES[dietaryId];
    if (!rule) return feedback(dietaryId, 'dietary', 'unknown');

    if (dietaryId === 'vegetarian' && item.is_vege === true) {
        return feedback(dietaryId, 'dietary', 'verified');
    }
    if (dietaryId === 'vegetarian' && item.is_vege === false) {
        return feedback(dietaryId, 'dietary', 'no_match');
    }

    if (rule.positive.some(signal => signals.has(signal))) {
        return feedback(dietaryId, 'dietary', 'verified');
    }
    if (rule.negative.some(signal => signals.has(signal))) {
        return feedback(dietaryId, 'dietary', 'no_match');
    }
    return feedback(dietaryId, 'dietary', 'unknown');
}

export function verifyMenuItemAgainstQuery(item = {}, parsedQuery = {}) {
    const checks = [];
    const signals = collectItemTaxonomySignals(item);

    if (Array.isArray(parsedQuery.tags) && parsedQuery.tags.includes('spicy')) {
        const state = item.spicy === true || signals.has('spicy')
            ? 'verified'
            : item.spicy === false
                ? 'no_match'
                : 'unknown';
        checks.push(feedback('spicy', 'tag', state));
    }

    if (Array.isArray(parsedQuery.tags) && parsedQuery.tags.includes('vege')) {
        const state = item.is_vege === true
            || ['vegetarian', 'vege', 'vegan', 'plant_based', 'meat_free', 'bez_miesa'].some(signal => signals.has(signal))
            ? 'verified'
            : item.is_vege === false
                ? 'no_match'
                : 'unknown';
        checks.push(feedback('vege', 'tag', state));
    }

    if (Array.isArray(parsedQuery.tags) && parsedQuery.tags.includes('quick')) {
        const state = ['quick', 'fast', 'express'].some(signal => signals.has(signal))
            ? 'verified'
            : 'unknown';
        checks.push(feedback('quick', 'tag', state));
    }

    for (const dietaryId of parsedQuery.dietarys || []) {
        checks.push(verifyDietary(item, dietaryId, signals));
    }

    for (const preferenceId of parsedQuery.preferences || []) {
        const aliases = PREFERENCE_RULES[preferenceId] || [];
        const state = aliases.some(signal => signals.has(signal)) ? 'verified' : 'unknown';
        checks.push(feedback(preferenceId, 'preference', state));
    }

    if (parsedQuery.priceBand) {
        checks.push(feedback(parsedQuery.priceBand, 'priceBand', 'recognized'));
    }

    const strictChecks = checks.filter(check =>
        check.dimension === 'dietary'
        || check.dimension === 'preference'
        || ['spicy', 'vege', 'quick'].includes(check.id)
    );

    return {
        passes: strictChecks.every(check => check.state === 'verified'),
        feedback: checks,
    };
}

function findAliasToken(text) {
    const words = String(text || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .match(/[a-z0-9]+/g) || [];

    for (const [canonical, aliases] of Object.entries(SIZE_ALIASES)) {
        if (aliases.some(alias => words.includes(normalize(alias)))) {
            return canonical;
        }
    }
    return null;
}

function canonicalAvailableVariants(availableVariants) {
    return (availableVariants || []).map(value => ({
        raw: String(value),
        canonical: findAliasToken(value) || normalize(value),
    }));
}

export function resolveContextualVariant(
    text,
    { availableVariants = [], itemFamily = null, supportsDoneness = false } = {}
) {
    const size = findAliasToken(text);
    if (!size) return null;

    const normalizedFamily = normalize(itemFamily);
    if (size === 'medium' && normalizedFamily === 'steak' && supportsDoneness) {
        return {
            dimension: 'doneness',
            value: 'medium',
            state: 'verified',
        };
    }

    const variants = canonicalAvailableVariants(availableVariants);
    const exact = variants.find(variant => variant.canonical === size);
    if (exact) {
        return {
            dimension: 'size',
            value: size,
            matchedVariant: exact.raw,
            state: 'verified',
        };
    }

    return {
        dimension: 'variant',
        value: size,
        state: 'unresolved',
    };
}
