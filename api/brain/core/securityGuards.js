import { validateSessionId } from '../session/sessionIdContract.js';

const ROLE_GUARD_FALLBACK_REPLY = 'Pomagam w zamówieniu. Powiedz proszę, co chcesz dodać lub zmienić.';
const SUBMITTED_ORDER_FALLBACK_REPLY = 'Zamówienie jest już złożone. Mogę dodać nowe.';

const META_PATTERNS = [
    /\b(?:jak|w jaki sposob)\b.*\b(?:dziala|funkcjonuje)\b.*\b(?:system|backend|ai|model)\b/i,
    /\b(?:jakie|co)\b.*\b(?:narzedzia|tooly|uprawnienia|dostepy)\b/i,
    /\b(?:ignoruj|pomin|omin)\b.*\b(?:zasady|instrukcje|reguly)\b/i,
    /\b(?:jestem|to ja)\b.*\b(?:wlasciciel|admin|administrator|owner)\b/i,
    /\b(?:pokaz|ujawnij|wyswietl|podaj)\b.*\b(?:dane|backend|klucze|klucz|tokeny|token|sekrety|sekret|prompt)\b/i,
    /\b(?:ignore previous|system prompt|developer message|jailbreak|prompt injection)\b/i,
    /\b(?:czego ci brakuje|rag|globalny dostep|brakuje narzedzi)\b/i,
];

const INTENT_CAPABILITY_MAP = new Map([
    ['add_item', 'add_item'],
    ['create_order', 'add_item'],
    ['confirm_add_to_cart', 'add_item'],
    ['clarify_order', 'add_item'],

    ['remove_item', 'remove_item'],
    ['clear_cart', 'remove_item'],
    ['cancel_order', 'remove_item'],

    ['update_quantity', 'update_quantity'],
    ['replace_item', 'replace_item'],

    ['show_menu', 'show_menu'],
    ['menu_request', 'show_menu'],
    ['show_more_options', 'show_menu'],
    ['select_restaurant', 'show_menu'],
    ['find_nearby', 'show_menu'],
    ['choose_restaurant', 'show_menu'],
    ['show_city_results', 'show_menu'],
    ['greeting', 'show_menu'],
    ['restaurant_hours', 'show_menu'],
    ['recommend', 'show_menu'],

    ['show_cart', 'show_cart'],
    ['open_checkout', 'show_cart'],

    ['confirm_order', 'confirm_order'],
    ['confirm', 'confirm_order'],
    ['confirm_restaurant_switch', 'confirm_order'],
]);

const ALLOWED_CAPABILITIES = new Set([
    'add_item',
    'remove_item',
    'update_quantity',
    'replace_item',
    'show_menu',
    'show_cart',
    'confirm_order',
]);

const MUTATION_CAPABILITIES = new Set([
    'add_item',
    'remove_item',
    'update_quantity',
    'replace_item',
]);

const ORDER_STATE_RANK = new Map([
    ['draft', 0],
    ['active', 0],
    ['pending', 1],
    ['submitted', 2],
    ['confirmed', 3],
    ['completed', 4],
    ['closed', 4],
]);

const TOKEN_PREFIX_RE = /\b(?:sk_live_|pk_live_|whsec_)[A-Za-z0-9_-]+\b/gi;
const LONG_TOKEN_RE = /\b(?=[A-Za-z0-9_=-]{25,}\b)(?=[A-Za-z0-9_=-]*\d)[A-Za-z0-9_=-]+\b/g;
const RAW_JSON_RE = /^\s*[{[][\s\S]*[}\]]\s*$/;
const BACKEND_OBJECT_HINT_RE = /"(?:session|context|pendingOrder|expectedContext|token|secret|backend)"/i;

function normalizeGuardText(value = '') {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[łŁ]/g, 'l')
        .replace(/\s+/g, ' ')
        .trim();
}

function getStateRank(status = '') {
    const normalized = normalizeGuardText(status);
    return ORDER_STATE_RANK.get(normalized) ?? -1;
}

function sanitizeStringValue(value = '', key = '') {
    let sanitized = String(value || '');
    const keyLower = String(key || '').toLowerCase();
    const isUrlField =
        keyLower.includes('url') ||
        keyLower.includes('image') ||
        keyLower.includes('photo') ||
        keyLower.includes('gallery') ||
        keyLower.includes('src') ||
        keyLower.includes('href') ||
        keyLower.includes('thumbnail') ||
        keyLower.includes('cover') ||
        keyLower.includes('background');

    if (!isUrlField) {
        sanitized = sanitized.replace(TOKEN_PREFIX_RE, '[redacted]');
        sanitized = sanitized.replace(LONG_TOKEN_RE, '[redacted]');
    } else if (process.env.NODE_ENV !== 'production' && value !== sanitized) {
        console.warn('[sanitize] URL field skipped:', key);
    }

    const isReplyField = keyLower === 'reply' || keyLower === 'text';
    if (isReplyField && RAW_JSON_RE.test(sanitized) && (sanitized.length > 30 || BACKEND_OBJECT_HINT_RE.test(sanitized))) {
        return ROLE_GUARD_FALLBACK_REPLY;
    }
    return sanitized;
}

function sanitizeValue(value, key = '') {
    if (value == null) return value;
    if (typeof value === 'string') return sanitizeStringValue(value, key);
    if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, key));
    if (typeof value === 'object') {
        const output = {};
        for (const [childKey, childValue] of Object.entries(value)) {
            output[childKey] = sanitizeValue(childValue, childKey);
        }
        return output;
    }
    return value;
}

function getIntentCapability(intent = '') {
    const normalized = normalizeGuardText(intent);
    return INTENT_CAPABILITY_MAP.get(normalized) || null;
}

function isIntentWhitelisted(intent = '') {
    const capability = getIntentCapability(intent);
    return capability ? ALLOWED_CAPABILITIES.has(capability) : false;
}

function isMutationCapabilityIntent(intent = '') {
    const capability = getIntentCapability(intent);
    return capability ? MUTATION_CAPABILITIES.has(capability) : false;
}

function isMutationRequestText(inputText = '') {
    const text = normalizeGuardText(inputText);
    if (!text) return false;
    return /\b(?:zmien|zamien|podmien|usun|skasuj|edytuj|aktualizuj|dodaj)\b/.test(text);
}

function isSubmittedOrLater(sessionSnapshot = null) {
    const session = sessionSnapshot || {};
    const sessionStatus = normalizeGuardText(session?.status || '');
    const closedReason = normalizeGuardText(session?.closedReason || '');
    const orderStatus = session?.order?.status || session?.lastOrder?.status || session?.meta?.orderStatus || '';

    if (sessionStatus === 'closed') {
        return closedReason === 'order_confirmed' || closedReason === 'order_submitted';
    }

    if (getStateRank(sessionStatus) >= getStateRank('submitted')) {
        return true;
    }

    return getStateRank(orderStatus) >= getStateRank('submitted');
}

function isMetaRequest(inputText = '') {
    const text = normalizeGuardText(inputText);
    if (!text) return false;
    return META_PATTERNS.some((pattern) => pattern.test(text));
}

function sanitizeAssistantResponse(payload) {
    const sanitized = sanitizeValue(payload, '');

    // session_id is a canonical runtime correlation handle, not a credential.
    // The generic long-token guard used to replace generated
    // IDs (for example `sess_...`) with "[redacted]", which made the client
    // switch to a different session after the first response.
    if (payload && typeof payload === 'object' && 'session_id' in payload) {
        if (typeof payload.session_id === 'string' && validateSessionId(payload.session_id).ok) {
            sanitized.session_id = payload.session_id;
        } else {
            delete sanitized.session_id;
        }
    }
    if (payload && typeof payload === 'object' && 'newSessionId' in payload) {
        if (typeof payload.newSessionId === 'string' && validateSessionId(payload.newSessionId).ok) {
            sanitized.newSessionId = payload.newSessionId;
        } else {
            delete sanitized.newSessionId;
        }
    }

    return sanitized;
}

export {
    ROLE_GUARD_FALLBACK_REPLY,
    SUBMITTED_ORDER_FALLBACK_REPLY,
    isMetaRequest,
    isIntentWhitelisted,
    isMutationCapabilityIntent,
    isMutationRequestText,
    isSubmittedOrLater,
    sanitizeAssistantResponse,
};
