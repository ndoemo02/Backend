function cleanText(value) {
    return typeof value === 'string'
        ? value.replace(/\s+/g, ' ').trim()
        : '';
}

function comparableText(value) {
    return cleanText(value)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Keeps the full user/tool query and only appends structured entities that are
 * not already present. Longest candidates win, so a cuisine label can never
 * replace the complete request.
 */
export function buildDiscoveryRawText(ctx = {}, cuisine = null) {
    const candidates = [
        ctx?.rawText,
        ctx?.text,
        ctx?.entities?.query,
        ctx?.entities?.dish,
        cuisine,
    ]
        .map(cleanText)
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);

    const selected = [];
    const selectedComparable = [];

    for (const candidate of candidates) {
        const normalized = comparableText(candidate);
        if (!normalized) continue;
        if (selectedComparable.some(existing => existing.includes(normalized))) continue;

        selected.push(candidate);
        selectedComparable.push(normalized);
    }

    return selected.join(' ');
}

export function resolveDiscoverySource(ctx = {}) {
    const source = String(ctx?.source || '');
    const channel = String(ctx?.body?.meta?.channel || '');
    return source.startsWith('live_tool:') || channel === 'live_tools'
        ? 'live'
        : 'text';
}
