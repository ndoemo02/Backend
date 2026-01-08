/**
 * Response Policy Resolver
 * 
 * Odpowiedzialność: Decydowanie "JAK mówić", nie "CO mówić".
 * Oddziela politykę odpowiedzi (style, ton, verbosity) od logiki biznesowej handlerów.
 * 
 * Filozofia:
 * - Handler decyduje CO powiedzieć (treść merytoryczna)
 * - Policy decyduje JAK to powiedzieć (styl, długość, emocje)
 * 
 * Punkt integracji dla:
 * - Dev Panel (admin overrides)
 * - A/B testing różnych stylów odpowiedzi
 * - Personalizacja na podstawie profilu użytkownika
 * 
 * @module ResponsePolicyResolver
 */

/**
 * @typedef {Object} ResponsePolicy
 * @property {'professional' | 'casual' | 'enthusiastic' | 'neutral' | 'empathetic'} style - Ton wypowiedzi
 * @property {'concise' | 'normal' | 'detailed'} verbosity - Poziom szczegółowości
 * @property {'subtle' | 'direct' | 'none'} recommendationMode - Jak prezentować sugestie
 * @property {boolean} shouldUseLLM - Czy używać LLM do stylizacji (formatTTSReply)
 * @property {'standard' | 'expressive' | 'fast'} ttsMode - Tryb syntezy mowy
 * @property {Object} metadata - Dodatkowe metadane (np. dla logowania/debugowania)
 */

/**
 * @typedef {Object} PolicyContext
 * @property {string} intent - Intencja użytkownika (np. 'find_nearby', 'create_order')
 * @property {Object} entities - Wyekstrahowane encje (dish, location, quantity)
 * @property {Object} session - Stan sesji (lastIntent, interactionCount, etc.)
 * @property {Object} [adminConfig] - Konfiguracja z Dev Panelu (overrides)
 */

/**
 * Domyślne polityki dla różnych intencji.
 * Mapowanie based on user research & UX best practices.
 */
const DEFAULT_INTENT_POLICIES = {
    // Discovery & Search
    'find_nearby': {
        style: 'enthusiastic',
        verbosity: 'normal',
        recommendationMode: 'direct',
        shouldUseLLM: true,
        ttsMode: 'expressive'
    },
    'find_nearby_confirmation': {
        style: 'neutral',
        verbosity: 'concise',
        recommendationMode: 'subtle',
        shouldUseLLM: false,
        ttsMode: 'standard'
    },
    'show_more_options': {
        style: 'professional',
        verbosity: 'concise',
        recommendationMode: 'direct',
        shouldUseLLM: false,
        ttsMode: 'fast'
    },

    // Selection
    'select_restaurant': {
        style: 'casual',
        verbosity: 'concise',
        recommendationMode: 'none',
        shouldUseLLM: false,
        ttsMode: 'standard'
    },
    'menu_request': {
        style: 'professional',
        verbosity: 'normal',
        recommendationMode: 'subtle',
        shouldUseLLM: true,
        ttsMode: 'standard'
    },

    // Ordering
    'create_order': {
        style: 'professional',
        verbosity: 'normal',
        recommendationMode: 'none',
        shouldUseLLM: false,
        ttsMode: 'standard'
    },
    'confirm_order': {
        style: 'empathetic',
        verbosity: 'detailed',
        recommendationMode: 'none',
        shouldUseLLM: false,
        ttsMode: 'expressive'
    },
    'cancel_order': {
        style: 'empathetic',
        verbosity: 'concise',
        recommendationMode: 'none',
        shouldUseLLM: false,
        ttsMode: 'standard'
    },

    // Errors & Clarifications
    'unknown': {
        style: 'empathetic',
        verbosity: 'normal',
        recommendationMode: 'subtle',
        shouldUseLLM: true,
        ttsMode: 'standard'
    },
    'clarify': {
        style: 'neutral',
        verbosity: 'normal',
        recommendationMode: 'direct',
        shouldUseLLM: false,
        ttsMode: 'standard'
    },

    // Recommendations
    'recommend': {
        style: 'enthusiastic',
        verbosity: 'detailed',
        recommendationMode: 'direct',
        shouldUseLLM: true,
        ttsMode: 'expressive'
    }
};

/**
 * Fallback policy dla nieznanych intencji.
 */
const FALLBACK_POLICY = {
    style: 'neutral',
    verbosity: 'normal',
    recommendationMode: 'none',
    shouldUseLLM: false,
    ttsMode: 'standard'
};

/**
 * Główna funkcja resolvera - decyduje o polityce odpowiedzi.
 * 
 * @param {PolicyContext} context - Kontekst decyzyjny
 * @returns {ResponsePolicy} - Deterministyczna polityka odpowiedzi
 */
export function resolveResponsePolicy(context) {
    const { intent, entities, session, adminConfig } = context;

    // 1. Bazowa polityka z mapowania intencji
    const basePolicy = DEFAULT_INTENT_POLICIES[intent] || FALLBACK_POLICY;

    // 2. Dostosowanie na podstawie kontekstu sesji (adaptive behavior)
    const adaptedPolicy = adaptPolicyToSession(basePolicy, session);

    // 3. Zastosowanie override'ów z Dev Panelu (jeśli istnieją)
    const finalPolicy = applyAdminOverrides(adaptedPolicy, adminConfig);

    // 4. Metadata dla debugowania/logowania
    finalPolicy.metadata = {
        sourceIntent: intent,
        wasAdapted: session?.interactionCount > 5,
        adminOverride: !!adminConfig?.forceStyle
    };

    return finalPolicy;
}

/**
 * Adaptacja polityki na podstawie stanu sesji.
 * Przykłady:
 * - Po wielu interakcjach -> bardziej casual
 * - W przypadku błędów -> bardziej empathetic
 * - Nowi użytkownicy -> bardziej detailed
 * 
 * @param {ResponsePolicy} policy - Polityka bazowa
 * @param {Object} session - Stan sesji
 * @returns {ResponsePolicy} - Dostosowana polityka
 */
function adaptPolicyToSession(policy, session) {
    const adapted = { ...policy };

    if (!session) return adapted;

    // Więcej niż 10 interakcji -> użytkownik jest "oswojony", może być bardziej casual
    if (session.interactionCount > 10 && adapted.style === 'professional') {
        adapted.style = 'casual';
    }

    // Jeśli ostatnia intencja to 'unknown' lub błąd -> zwiększ empatię
    if (session.lastIntent === 'unknown' || session.lastIntent === 'clarify') {
        adapted.style = 'empathetic';
        adapted.verbosity = 'detailed'; // Wyjaśnij więcej
    }

    // Szybkie zamówienia (< 3 interakcje) -> bardziej concise
    if (session.interactionCount < 3 && policy.verbosity === 'normal') {
        adapted.verbosity = 'concise';
    }

    // Jeśli użytkownik już wybrał restaurację -> mniej rekomendacji
    if (session.lastRestaurant && adapted.recommendationMode === 'direct') {
        adapted.recommendationMode = 'subtle';
    }

    return adapted;
}

/**
 * Zastosowanie nadpisań z Admin Panel (Dev Panel overrides).
 * Pozwala na ręczne testowanie różnych stylów odpowiedzi.
 * 
 * @param {ResponsePolicy} policy - Polityka po adaptacji
 * @param {Object} adminConfig - Konfiguracja z panelu admina
 * @returns {ResponsePolicy} - Finalna polityka
 */
function applyAdminOverrides(policy, adminConfig) {
    if (!adminConfig) return policy;

    const overridden = { ...policy };

    // Override style (np. z Dev Panel: "Force Enthusiastic Mode")
    if (adminConfig.forceStyle) {
        overridden.style = adminConfig.forceStyle;
    }

    // Override verbosity (np. dla testów A/B)
    if (adminConfig.forceVerbosity) {
        overridden.verbosity = adminConfig.forceVerbosity;
    }

    // Disable LLM (np. dla benchmarków wydajności)
    if (adminConfig.disableLLM === true) {
        overridden.shouldUseLLM = false;
    }

    // Force fast TTS (np. dla demo)
    if (adminConfig.fastTTS === true) {
        overridden.ttsMode = 'fast';
    }

    return overridden;
}

/**
 * Helper: Pobierz policy dla danej intencji (bez kontekstu sesji).
 * Użyteczne dla testów jednostkowych.
 * 
 * @param {string} intent - Nazwa intencji
 * @returns {ResponsePolicy} - Polityka bazowa
 */
export function getDefaultPolicyForIntent(intent) {
    return DEFAULT_INTENT_POLICIES[intent] || FALLBACK_POLICY;
}

/**
 * Helper: Walidacja policy object (guard against corruption).
 * 
 * @param {ResponsePolicy} policy - Policy do walidacji
 * @returns {boolean} - Czy policy jest poprawny
 */
export function validatePolicy(policy) {
    if (!policy || typeof policy !== 'object') return false;

    const validStyles = ['professional', 'casual', 'enthusiastic', 'neutral', 'empathetic'];
    const validVerbosity = ['concise', 'normal', 'detailed'];
    const validRecommendationModes = ['subtle', 'direct', 'none'];
    const validTtsModes = ['standard', 'expressive', 'fast'];

    return (
        validStyles.includes(policy.style) &&
        validVerbosity.includes(policy.verbosity) &&
        validRecommendationModes.includes(policy.recommendationMode) &&
        typeof policy.shouldUseLLM === 'boolean' &&
        validTtsModes.includes(policy.ttsMode)
    );
}

/**
 * ========================================
 * PRZYKŁAD UŻYCIA (Integration Point)
 * ========================================
 * 
 * // W przyszłości, w handlerze (np. FindRestaurantHandler):
 * 
 * import { resolveResponsePolicy } from '../core/ResponsePolicyResolver.js';
 * 
 * async execute(ctx) {
 *   const { text, session, entities } = ctx;
 *   
 *   // 1. Handler decyduje CO powiedzieć (logika biznesowa)
 *   const restaurants = await this.searchRestaurants(...);
 *   const rawReply = `Znalazłam ${restaurants.length} restauracji.`;
 *   
 *   // 2. Policy decyduje JAK to powiedzieć
 *   const policy = resolveResponsePolicy({
 *     intent: 'find_nearby',
 *     entities,
 *     session,
 *     adminConfig: session.adminOverrides // z Dev Panel
 *   });
 *   
 *   // 3. Użyj policy do adaptacji odpowiedzi
 *   let finalReply = rawReply;
 *   if (policy.shouldUseLLM) {
 *     finalReply = await stylizeWithGPT4o(rawReply, policy.style);
 *   }
 *   
 *   return {
 *     reply: finalReply,
 *     restaurants,
 *     meta: { policy } // Przekaż policy do TTS/Logging
 *   };
 * }
 */
