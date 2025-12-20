/**
 * Core Pipeline Orchestrator (V2)
 * Odpowiada za przepływ danych: Request -> Hydration -> NLU -> Domain -> Response
 */

import { getSession, updateSession } from '../session/sessionStore.js';
import { FindRestaurantHandler } from '../domains/food/findHandler.js';
import { MenuHandler } from '../domains/food/menuHandler.js';
import { OrderHandler } from '../domains/food/orderHandler.js';
import { ConfirmOrderHandler } from '../domains/food/confirmHandler.js';
import { SelectRestaurantHandler } from '../domains/food/selectHandler.js';
import { BrainLogger } from '../../../utils/logger.js';
import { playTTS, stylizeWithGPT4o } from '../tts/ttsClient.js';
import { EventLogger } from '../services/EventLogger.js';
import { supabase } from '../../_supabase.js';

// Mapa handlerów domenowych (Bezpośrednie mapowanie)
// Kluczem jest "domain", a wewnątrz "intent"

// Default Handlers Map
const defaultHandlers = {
    food: {
        find_nearby: new FindRestaurantHandler(),
        menu_request: new MenuHandler(), // Correct NLU mapping
        show_menu: new MenuHandler(),    // Alias
        create_order: new OrderHandler(),
        confirm_order: new ConfirmOrderHandler(),
        select_restaurant: new SelectRestaurantHandler(),
        find_nearby_confirmation: new FindRestaurantHandler(),
    },
    ordering: {
        create_order: new OrderHandler(),
        confirm_order: new ConfirmOrderHandler(),
    },
    system: {
        health_check: { execute: async () => ({ reply: 'System działa', meta: {} }) },
        fallback: { execute: async () => ({ reply: 'Nie rozumiem tego polecenia.', fallback: true }) }
    },
};

export class BrainPipeline {
    constructor(deps = {}) {
        this.nlu = deps.nlu;
        this.handlers = deps.handlers || defaultHandlers;
    }


    /**
     * Główny punkt wejścia dla każdego zapytania
     * @param {string} sessionId
     * @param {string} text
     * @param {Object} options - { includeTTS: boolean, stylize: boolean, ttsOptions: Object }
     * @returns {Promise<Object>} Finalna odpowiedź dla API
     */
    async process(sessionId, text, options = {}) {
        const startTime = Date.now();

        // 1. Hydration & Validation (Core)
        if (!text || !text.trim()) {
            return this.createErrorResponse('brak_tekstu', 'Nie usłyszałam, możesz powtórzyć?');
        }

        const EXPERT_MODE = process.env.EXPERT_MODE === 'true';

        // --- Event Logging: Received ---
        if (EXPERT_MODE) {
            const initialWorkflowStep = this._mapWorkflowStep('request_received');
            EventLogger.logConversation(sessionId).catch(() => { });
            EventLogger.logEvent(sessionId, 'request_received', { text }, null, initialWorkflowStep).catch(() => { });
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
            if (!this.handlers[context.domain]) {
                BrainLogger.pipeline(`Unknown domain: ${context.domain} (intent: ${intent})`);
                // Fallback to system domain or generic error
                return this.createErrorResponse('unknown_domain', 'Nie wiem jak to obsłużyć (błąd domeny).');
            }

            const handler = this.handlers[context.domain][intent] || this.handlers.system.fallback;

            if (!handler) {
                console.warn(`No handler for ${context.domain}/${intent}`);
                return this.createErrorResponse('missing_handler', 'Przepraszam, jeszcze nie umiem tego zrobić.');
            }

            // 4. Execution
            BrainLogger.pipeline(`Dispatcher: ${intent} [${context.domain}] -> Handler`);
            const domainResponse = await handler.execute(context);

            // Apply state changes from handler
            if (domainResponse.contextUpdates) {
                updateSession(sessionId, domainResponse.contextUpdates);
            }

            // 4.5 Synthesis (Expert Layer)
            let speechText = domainResponse.reply;
            let audioContent = null;
            let stylingMs = 0;
            let ttsMs = 0;

            if (EXPERT_MODE && options.stylize && domainResponse.reply) {
                const t0 = Date.now();
                speechText = await stylizeWithGPT4o(domainResponse.reply, intent);
                stylingMs = Date.now() - t0;
                BrainLogger.pipeline(`Stylization took ${stylingMs}ms`);
            }

            if (EXPERT_MODE && options.includeTTS && speechText) {
                try {
                    const t0 = Date.now();
                    audioContent = await playTTS(speechText, options.ttsOptions || {});
                    ttsMs = Date.now() - t0;
                    BrainLogger.pipeline(`TTS generation took ${ttsMs}ms`);
                } catch (err) {
                    BrainLogger.pipeline(`TTS failed: ${err.message}`);
                }
            }

            const totalLatency = Date.now() - startTime;

            // 5. Response Synthesis
            // Budowanie finalnego formatu (ETAP 4 Contract)
            const turnId = `turn_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

            // Clean domain response for public consumption
            const { contextUpdates, meta: domainMeta, ...cleanDomainResponse } = domainResponse;

            const response = {
                session_id: sessionId,
                reply: speechText,
                should_reply: domainResponse.should_reply ?? true,
                actions: domainResponse.actions || [],
                // Data payload (restaurants list or menu)
                ...cleanDomainResponse,
                reply: speechText, // Safety overwrite
            };

            // Expert metadata added ONLY if explicitly enabled
            if (EXPERT_MODE) {
                response.turn_id = turnId;
                response.audioContent = audioContent;
                response.intent = intent;
                response.context = getSession(sessionId);
                response.timestamp = new Date().toISOString();
                response.meta = {
                    latency_total_ms: totalLatency,
                    source: domainMeta?.source || source || 'llm',
                    styling_ms: stylingMs,
                    tts_ms: ttsMs,
                    ...(domainMeta || {})
                };

                // --- Background Analytics ---
                const wStep = this._mapWorkflowStep(intent);
                EventLogger.logEvent(sessionId, 'intent_resolved', {
                    intent,
                    reply: speechText,
                    confidence,
                    source,
                    domain: context.domain
                }, confidence, wStep).catch(() => { });

                this.persistAnalytics({
                    intent,
                    reply: speechText,
                    durationMs: totalLatency,
                    confidence,
                    ttsMs: ttsMs
                }).catch(() => { });
            }

            return response;

        } catch (error) {
            BrainLogger.pipeline('Error:', error.message);
            return this.createErrorResponse('internal_error', 'Coś poszło nie tak w moich obwodach. Spróbujmy jeszcze raz.');
        }
    }

    _mapWorkflowStep(intentName) {
        if (!intentName) return 'unknown';
        if (['find_nearby', 'show_city_results'].includes(intentName)) return 'find_nearby';
        if (intentName === 'menu_request' || intentName === 'show_menu') return 'show_menu';
        if (intentName === 'create_order') return 'create_order';
        if (intentName === 'confirm_order') return 'confirm_order';
        return intentName;
    }

    async persistAnalytics(p) {
        if (process.env.NODE_ENV === 'test') return;
        try {
            await supabase.from('amber_intents').insert({
                intent: p.intent,
                reply: typeof p.reply === 'string' ? p.reply.slice(0, 1000) : JSON.stringify(p.reply).slice(0, 1000),
                duration_ms: p.durationMs,
                confidence: p.confidence || 1.0,
                // breakdowns
                tts_ms: p.ttsMs || 0
            });
        } catch (e) {
            if (!e.message?.includes("relation \"amber_intents\" does not exist")) {
                console.warn('⚠️ Analytics Log Error:', e.message);
            }
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
