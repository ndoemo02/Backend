/**
 * Response Controller
 * 
 * JEDYNE ŹRÓDŁO PRAWDY dla generowania odpowiedzi użytkownika.
 * 
 * Odpowiedzialności:
 * - Finalizacja odpowiedzi (single point of exit)
 * - Wywołanie ResponsePolicyResolver (określenie JAK mówić)
 * - Shadow Mode (policy liczona, ale nie wpływa na runtime - dla stopniowej migracji)
 * - Guard mechanism (ochrona przed podwójnymi odpowiedziami)
 * - Logging & Analytics (śledzenie wszystkich odpowiedzi systemu)
 * 
 * Filozofia:
 * - Handler generuje RAW odpowiedź (treść merytoryczna)
 * - ResponseController FINALIZUJE odpowiedź (transformacja zgodnie z policy)
 * - Tylko ResponseController może zwrócić odpowiedź do użytkownika
 * 
 * @module ResponseController
 */

import { resolveResponsePolicy, validatePolicy } from './ResponsePolicyResolver.js';

/**
 * Feature flags (kontrola etapowa włączania policy)
 */
const CONFIG = {
    // Shadow Mode: Policy jest obliczane i logowane, ale NIE wpływa na odpowiedź
    SHADOW_MODE: process.env.RESPONSE_POLICY_SHADOW === 'true' || true,

    // Active Mode: Policy WPŁYWA na odpowiedź (transformacja, stylizacja)
    ACTIVE_MODE: process.env.RESPONSE_POLICY_ACTIVE === 'true' || false,

    // Logging: Czy logować policy decisions do analytics
    ENABLE_LOGGING: process.env.RESPONSE_POLICY_LOGGING !== 'false'
};

/**
 * @typedef {Object} ResponseContext
 * @property {string} intent - Intencja użytkownika
 * @property {Object} entities - Wyekstrahowane encje
 * @property {Object} session - Stan sesji
 * @property {Object} [adminConfig] - Overrides z Dev Panel
 * @property {Object} [meta] - Dodatkowe metadane z handlera
 * @property {boolean} [responseFinalized] - Guard flag (chroni przed podwójną finalizacją)
 */

/**
 * @typedef {Object} FinalizedResponse
 * @property {string} reply - Finalna odpowiedź tekstowa
 * @property {Object} policy - Użyta polityka odpowiedzi
 * @property {string} rawReply - Oryginalna odpowiedź (przed transformacją)
 * @property {Object} metadata - Metadane procesu finalizacji
 */

/**
 * Główna funkcja finalizacji odpowiedzi.
 * To jest JEDYNE miejsce, które powinno generować finalną odpowiedź użytkownika.
 * 
 * @param {string} rawReply - Surowa odpowiedź z handlera (treść merytoryczna)
 * @param {ResponseContext} context - Kontekst odpowiedzi (intent, session, etc.)
 * @returns {Promise<FinalizedResponse>} - Sfinalizowana odpowiedź
 * 
 * @throws {Error} - Jeśli odpowiedź została już sfinalizowana (double finalization guard)
 */
export async function finalizeResponse(rawReply, context) {
    const startTime = Date.now();

    // ========================================
    // 1. GUARD: Ochrona przed podwójną finalizacją
    // ========================================
    if (context.responseFinalized) {
        const error = new Error(
            '🚨 CRITICAL: Response already finalized! ' +
            'Tylko ResponseController może finalizować odpowiedzi. ' +
            'Handler próbował wygenerować odpowiedź poza kontrolerem.'
        );
        console.error(error.message);
        console.trace('Double finalization attempted at:');
        throw error;
    }

    // Ustaw flagę (mutuje context - guard dla reszty pipeline)
    context.responseFinalized = true;

    // ========================================
    // 2. Walidacja inputów
    // ========================================
    if (!rawReply || typeof rawReply !== 'string') {
        console.warn('⚠️ ResponseController: Invalid rawReply, using fallback');
        rawReply = 'Przepraszam, wystąpił problem.';
    }

    if (!context.intent) {
        console.warn('⚠️ ResponseController: Missing intent in context');
        context.intent = 'unknown';
    }

    // ========================================
    // 3. Resolve Policy (zawsze, nawet w Shadow Mode)
    // ========================================
    let policy = null;
    let policyError = null;

    try {
        policy = resolveResponsePolicy({
            intent: context.intent,
            entities: context.entities || {},
            session: context.session || {},
            adminConfig: context.adminConfig || null
        });

        // Walidacja policy (defensive programming)
        if (!validatePolicy(policy)) {
            throw new Error('Invalid policy structure returned from resolver');
        }

    } catch (err) {
        console.error('❌ ResponseController: Policy resolution failed:', err.message);
        policyError = err.message;

        // Fallback policy (safe defaults)
        policy = {
            style: 'neutral',
            verbosity: 'normal',
            recommendationMode: 'none',
            shouldUseLLM: false,
            ttsMode: 'standard',
            metadata: { error: policyError }
        };
    }

    // ========================================
    // 4. Transformacja odpowiedzi (jeśli ACTIVE_MODE)
    // ========================================
    let finalReply = rawReply;
    let transformationApplied = false;

    if (CONFIG.ACTIVE_MODE && !policyError) {
        try {
            finalReply = await applyPolicyTransformations(rawReply, policy, context);
            transformationApplied = true;
        } catch (transformError) {
            console.error('❌ ResponseController: Transformation failed:', transformError.message);
            // Fallback: użyj raw reply
            finalReply = rawReply;
        }
    }

    // ========================================
    // 5. Metadata & Logging
    // ========================================
    const metadata = {
        mode: CONFIG.ACTIVE_MODE ? 'active' : 'shadow',
        policyUsed: policy,
        transformationApplied,
        processingTimeMs: Date.now() - startTime,
        timestamp: new Date().toISOString()
    };

    if (CONFIG.ENABLE_LOGGING) {
        await logResponseDecision({
            intent: context.intent,
            rawReply,
            finalReply,
            policy,
            metadata,
            sessionId: context.session?.id || 'unknown'
        }).catch(err => {
            console.warn('⚠️ ResponseController: Logging failed:', err.message);
        });
    }

    // ========================================
    // 6. Zwróć sfinalizowaną odpowiedź
    // ========================================
    return {
        reply: finalReply,
        policy,
        rawReply,
        metadata
    };
}

/**
 * Aplikuje transformacje na podstawie policy.
 * W ACTIVE_MODE to faktycznie zmienia odpowiedź.
 * W SHADOW_MODE ta funkcja NIE jest wywoływana.
 * 
 * @param {string} rawReply - Oryginalna odpowiedź
 * @param {Object} policy - Polityka odpowiedzi
 * @param {Object} context - Kontekst
 * @returns {Promise<string>} - Przekształcona odpowiedź
 */
async function applyPolicyTransformations(rawReply, policy, context) {
    let transformed = rawReply;

    // Transformacja 1: Verbosity (skracanie/rozszerzanie)
    if (policy.verbosity === 'concise') {
        // Weź tylko pierwsze zdanie
        const firstSentence = transformed.split(/[.!?]/)[0];
        if (firstSentence) {
            transformed = firstSentence.trim() + '.';
        }
    } else if (policy.verbosity === 'detailed') {
        // Możesz tutaj dodać kontekstowe rozszerzenie (future work)
        // Na razie: no-op
    }

    // Transformacja 2: LLM Stylization (jeśli włączona)
    if (policy.shouldUseLLM && process.env.NODE_ENV !== 'test') {
        // Import dynamiczny, aby uniknąć circular dependency
        const { stylizeWithGPT4o } = await import('../tts/ttsClient.js');
        transformed = await stylizeWithGPT4o(transformed, policy.style);
    }

    // Transformacja 3: Recommendation Mode (modyfikacja tonu)
    // (Future work: dodanie sugestii na podstawie recommendationMode)

    return transformed;
}

/**
 * Loguje decyzję policy do analytics (background task).
 * Używane do A/B testingu i optymalizacji policy.
 * 
 * @param {Object} data - Dane do zalogowania
 */
async function logResponseDecision(data) {
    // W rzeczywistości to byłoby zapisywane do Supabase lub innej bazy
    // Na razie: console log w trybie debug

    if (process.env.BRAIN_DEBUG) {
        console.log('📊 [ResponseController] Policy Decision:', {
            intent: data.intent,
            style: data.policy?.style,
            verbosity: data.policy?.verbosity,
            transformationApplied: data.metadata?.transformationApplied,
            processingMs: data.metadata?.processingTimeMs
        });
    }

    // TODO: Implementacja zapisu do tabeli analytics
    // await supabase.from('response_policy_analytics').insert({
    //     session_id: data.sessionId,
    //     intent: data.intent,
    //     raw_reply: data.rawReply,
    //     final_reply: data.finalReply,
    //     policy_style: data.policy.style,
    //     policy_verbosity: data.policy.verbosity,
    //     used_llm: data.policy.shouldUseLLM,
    //     processing_time_ms: data.metadata.processingTimeMs,
    //     timestamp: data.metadata.timestamp
    // });
}

/**
 * Helper: Sprawdź czy odpowiedź została już sfinalizowana.
 * Użyteczne dla handlerów, aby sprawdzić stan przed próbą finalizacji.
 * 
 * @param {ResponseContext} context - Kontekst do sprawdzenia
 * @returns {boolean} - Czy odpowiedź została sfinalizowana
 */
export function isResponseFinalized(context) {
    return !!context.responseFinalized;
}

/**
 * Helper: Reset flagi finalizacji (tylko dla testów!).
 * W produkcji ten helper NIE POWINIEN być używany.
 * 
 * @param {ResponseContext} context - Kontekst do zresetowania
 */
export function resetFinalizationFlag(context) {
    if (process.env.NODE_ENV !== 'test') {
        console.warn('⚠️ resetFinalizationFlag called in production! This should only be used in tests.');
    }
    context.responseFinalized = false;
}

/**
 * Helper: Pobierz aktualną konfigurację ResponseController.
 * 
 * @returns {Object} - Aktualna konfiguracja
 */
export function getResponseControllerConfig() {
    return { ...CONFIG };
}

/**
 * ========================================
 * PRZYKŁAD UŻYCIA (Integration Point)
 * ========================================
 * 
 * // W handlerze (np. FindRestaurantHandler):
 * 
 * import { finalizeResponse } from '../core/ResponseController.js';
 * 
 * async execute(ctx) {
 *   const { text, session, entities } = ctx;
 *   
 *   // 1. Handler generuje RAW odpowiedź (logika biznesowa)
 *   const restaurants = await this.searchRestaurants(...);
 *   const rawReply = `Znalazłam ${restaurants.length} restauracji.`;
 *   
 *   // 2. Finalizacja przez ResponseController (JEDYNE miejsce)
 *   const finalized = await finalizeResponse(rawReply, {
 *     intent: 'find_nearby',
 *     entities,
 *     session,
 *     adminConfig: session.adminOverrides,
 *     meta: { restaurantCount: restaurants.length }
 *   });
 *   
 *   // 3. Zwróć sfinalizowaną odpowiedź
 *   return {
 *     reply: finalized.reply,
 *     restaurants,
 *     meta: {
 *       policy: finalized.policy,
 *       rawReply: finalized.rawReply // Debug
 *     }
 *   };
 * }
 * 
 * ========================================
 * TRYBY DZIAŁANIA
 * ========================================
 * 
 * SHADOW_MODE (domyślny):
 * - Policy jest obliczane i logowane
 * - Odpowiedź NIE jest transformowana
 * - reply === rawReply (backward compatible)
 * - Bezpieczna migracja (zero risk)
 * 
 * ACTIVE_MODE (po włączeniu):
 * - Policy wpływa na odpowiedź
 * - Transformacje są aplikowane
 * - reply może się różnić od rawReply
 * - Wymaga testów A/B przed włączeniem
 */
