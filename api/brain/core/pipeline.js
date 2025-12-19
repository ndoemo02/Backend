/**
 * Core Pipeline Orchestrator (V2)
 * Odpowiada za przepływ danych: Request -> Hydration -> NLU -> Domain -> Response
 */

import { getSession, updateSession } from '../session/sessionStore.js';
import { FindRestaurantHandler } from '../domains/food/findHandler.js';
import { MenuHandler } from '../domains/food/menuHandler.js';
import { OrderHandler } from '../domains/food/orderHandler.js';
import { ConfirmOrderHandler } from '../domains/food/confirmHandler.js';

// Mapa handlerów domenowych (Bezpośrednie mapowanie)
// Kluczem jest "domain", a wewnątrz "intent"
const handlers = {
    food: {
        find_nearby: new FindRestaurantHandler(),
        show_menu: new MenuHandler(),
        create_order: new OrderHandler(),
        confirm_order: new ConfirmOrderHandler(), // New handler for finalization
        select_restaurant: new FindRestaurantHandler(), // Use find handler logic or context logic
        // Add aliases/fallbacks
        find_nearby_confirmation: new FindRestaurantHandler(),
    },
    system: {
        health_check: { execute: async () => ({ reply: 'System działa', meta: {} }) },
        fallback: { execute: async () => ({ reply: 'Nie rozumiem tego polecenia.', fallback: true }) }
    },
}

export class BrainPipeline {
    constructor(deps = {}) {
        this.nlu = deps.nlu;
        // Dispatcher usunięty na rzecz mapy handlers
    }

    /**
     * Główny punkt wejścia dla każdego zapytania
     * @param {string} sessionId
     * @param {string} text
     * @returns {Promise<Object>} Finalna odpowiedź dla API
     */
    async process(sessionId, text) {
        const startTime = Date.now();

        // 1. Hydration & Validation (Core)
        if (!text || !text.trim()) {
            return this.createErrorResponse('brak_tekstu', 'Nie usłyszałam, możesz powtórzyć?');
        }

        const session = getSession(sessionId);
        const context = {
            sessionId,
            text,
            session,
            startTime,
            meta: {}
        };

        try {
            // 2. NLU Decision (Brain Layer)
            // "Co użytkownik chce zrobić?"
            const intentResult = await this.nlu.detect(context);

            const { intent, domain, confidence, source, entities } = intentResult;

            context.intent = intent;
            context.domain = domain || 'food'; // Default domain fallback
            context.entities = entities || {};
            context.confidence = confidence;
            context.source = source;

            // --- ZOMBIE KILL SWITCH ---
            // Jeśli sesja jest zamknięta (zamówienie złożone), blokuj wszystko oprócz nowego startu
            if (session?.status === 'COMPLETED') {
                if (['new_order', 'start_over', 'help'].includes(intent)) {
                    // Reset session for new order
                    updateSession(sessionId, {
                        status: 'active',
                        pendingOrder: null,
                        lockedRestaurantId: null,
                        context: 'neutral'
                    });
                    // Proceed to handler (new_order logic needs to be handled or we just reply "OK")
                } else {
                    return {
                        ok: true,
                        intent: 'session_locked',
                        reply: "Twoje zamówienie zostało już zakończone. Powiedz 'nowe zamówienie', aby zacząć od początku.",
                        meta: { latency_ms: Date.now() - startTime, source: 'guard_lock' }
                    };
                }
            }

            // Update session with last intent info (Short-term memory)
            updateSession(sessionId, {
                lastIntent: intent,
                lastUpdated: Date.now()
            });

            // 3. Domain Dispatching (Orchestration)
            if (!handlers[context.domain]) {
                console.warn(`Unknown domain: ${context.domain} (intent: ${intent})`);
                // Fallback to system domain or generic error
                return this.createErrorResponse('unknown_domain', 'Nie wiem jak to obsłużyć (błąd domeny).');
            }

            const handler = handlers[context.domain][intent] || handlers.system.fallback;

            if (!handler) {
                console.warn(`No handler for ${context.domain}/${intent}`);
                return this.createErrorResponse('missing_handler', 'Przepraszam, jeszcze nie umiem tego zrobić.');
            }

            // 4. Execution
            console.log(`🚀 Dispatching ${intent} (Domain: ${context.domain})`);
            const domainResponse = await handler.execute(context);

            // Apply state changes from handler
            if (domainResponse.contextUpdates) {
                updateSession(sessionId, domainResponse.contextUpdates);
            }

            // 5. Response Synthesis
            // Budowanie finalnego formatu
            const turnId = `turn_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

            const response = {
                ok: true,
                intent: intent,
                turn_id: turnId, // Unique turn ID for ASM
                should_reply: true, // Default to true, allow handlers to override via domainResponse
                ...domainResponse, // reply, data, audioContent etc.
                context: getSession(sessionId), // Return fresh state (now updated)
                timestamp: new Date().toISOString(),
                meta: {
                    latency_ms: Date.now() - startTime, // Legacy compatible
                    latency_total_ms: Date.now() - startTime, // Task 4: Explicit requirement
                    nlu_source: source,
                    source: domainResponse.meta?.source || 'llm', // Task 4: Source tracking (default to llm/db if unknown)
                    ...(domainResponse.meta || {})
                }
            };

            return response;

        } catch (error) {
            console.error('Pipeline Error:', error);
            return this.createErrorResponse('internal_error', 'Coś poszło nie tak w moich obwodach. Spróbujmy jeszcze raz.');
        }
    }

    createErrorResponse(errorCode, message) {
        return {
            ok: false,
            error: errorCode,
            reply: message,
            timestamp: new Date().toISOString()
        };
    }
}
