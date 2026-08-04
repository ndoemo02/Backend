const EXPLICIT_CART_ACTION_RE =
    /\b(dodaj|dodasz|dorzu[cć]|dorzucisz|zamawiam|zam[oó]w(?:\s+mi)?|poprosz[eę]|wezm[eę]|bior[eę]|chc[eę]\s+(?:zam[oó]wi[cć]|wzi[aą][cć])|chcia[lł](?:bym|abym)\s+(?:zam[oó]wi[cć]|z[lł]o[zż]y[cć]\s+zam[oó]wienie)|prosz[eę]\s+(?:o|doda[cć]))\b/i;

const CONDITIONAL_ACTION_RE =
    /\b(je[sś]li|jak)\s+(?:tak|to|jest|je|s[aą])\b.*\b(dodaj|dorzu[cć]|zam[oó]w)\b/i;

const INFORMATION_QUESTION_RE = [
    /(?:^|\s)\S+(?:\s+\S+){0,4}\s+to\s+(?:jest|je)\b/i,
    /\b(?:co|c[oó][zż])\s+to\s+(?:jest|je)\b/i,
    /\bczym\s+(?:jest|je)\b/i,
    /\bco\s+(?:to\s+)?znaczy\b/i,
    /\bjak\s+(?:to\s+)?rozumie[cć]\b/i,
    /\bz\s+czego\s+(?:to\s+)?(?:jest|je|s[aą])\b/i,
    /\bjakie?\s+(?:ma|maj[aą])\s+(?:sk[lł]adniki|alergeny)\b/i,
    /\bile\s+(?:to\s+)?kosztuje\b/i,
    /\bczy\b.*\b(?:to|jest|je|s[aą]|ma|maj[aą]|zawiera|kosztuje|ostre|pikantne|wege|wega[nń]skie|bezglutenowe)\b/i,
    /\bczy\s+(?:mog[eę]|mo[zż]na)\s+(?:to\s+)?zam[oó]wi[cć]\b/i,
];

const QUANTITY_ORDER_RE =
    /^(?:to\s+)?(?:po\s+)?(?:\d+|jedn(?:a|o|[aą])?|dwa|dwie|trzy|cztery|pi[eę][cć]|sze[sś][cć]|siedem|osiem|dziewi[eę][cć]|dziesi[eę][cć])(?:\s*x)?\s+(?:\S+\s*)+$/i;

const CONFIRMATION_RE = /^(?:tak|ja|dobrze|dobra|okej|ok|zgadza\s+si[eę]|potwierdzam|dawaj|jasne|leci)$/i;
const CART_REJECTION_RE = /^(?:nie|nie\s+(?:dodawaj|bior[eę]|chc[eę])|anuluj|odpu[sś][cć]|zostaw|rezygnuj[eę])(?:\s+.*)?$/i;
const CONFIRMATION_CONTEXTS = new Set([
    'confirm_add_to_cart',
    'clarify_order',
    'order_continue',
]);

export function normalizeCartUtterance(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}\s?!]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function isInformationalCartQuestion(value) {
    const text = normalizeCartUtterance(value);
    if (!text) return false;
    if (CONDITIONAL_ACTION_RE.test(text)) return true;
    return INFORMATION_QUESTION_RE.some((pattern) => pattern.test(text));
}

/**
 * Cart mutations need evidence in the user's turn, not only coherent tool args.
 * A valid menu item proves catalog grounding; it does not prove purchase intent.
 */
export function verifyCartMutationIntent({ text, session, allowReversibleCartDraft = false } = {}) {
    const normalized = normalizeCartUtterance(text);

    if (!normalized) {
        return {
            allowed: false,
            reason: 'cart_mutation_missing_user_evidence',
            informationalQuestion: false,
        };
    }

    if (CONDITIONAL_ACTION_RE.test(normalized)) {
        return {
            allowed: false,
            reason: 'cart_mutation_informational_question',
            informationalQuestion: true,
        };
    }

    if (CART_REJECTION_RE.test(normalized)) {
        return {
            allowed: false,
            reason: 'cart_mutation_explicitly_rejected',
            informationalQuestion: false,
            explicitRejection: true,
        };
    }

    if (EXPLICIT_CART_ACTION_RE.test(normalized)) {
        return {
            allowed: true,
            reason: 'explicit_cart_action',
            informationalQuestion: false,
        };
    }

    if (isInformationalCartQuestion(normalized) || normalized.includes('?')) {
        return {
            allowed: false,
            reason: 'cart_mutation_informational_question',
            informationalQuestion: true,
        };
    }

    if (QUANTITY_ORDER_RE.test(normalized)) {
        return {
            allowed: true,
            reason: 'explicit_quantity_selection',
            informationalQuestion: false,
        };
    }

    const expectedContext = String(session?.expectedContext || '').trim();
    if (CONFIRMATION_CONTEXTS.has(expectedContext) && CONFIRMATION_RE.test(normalized)) {
        return {
            allowed: true,
            reason: 'expected_cart_confirmation',
            informationalQuestion: false,
        };
    }

    // The cart is a reversible review surface. A grounded Live tool call may
    // prepare and commit a validated cart draft without requiring the noisy
    // auxiliary transcript to repeat the full dish name. Questions and
    // explicit rejection remain blocked above.
    if (allowReversibleCartDraft) {
        return {
            allowed: true,
            reason: 'reversible_cart_draft_selection',
            informationalQuestion: false,
            explicitRejection: false,
        };
    }

    return {
        allowed: false,
        reason: 'cart_mutation_without_explicit_action',
        informationalQuestion: false,
    };
}
