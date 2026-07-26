/**
 * Core Pipeline Orchestrator (V2)
 * Odpowiada za przepływ danych: Request -> Hydration -> NLU -> Domain -> Response
 */

import { getEngineMode, isDev, isStrict, devLog, devWarn, devError, strictAssert, strictRequireSession, sanitizeResponse as engineSanitizeResponse } from './engineMode.js';

import { getSession, getSessionAsync, updateSession, getOrCreateActiveSessionAsync, closeConversation } from '../session/sessionStore.js';
import { FindRestaurantHandler } from '../domains/food/findHandler.js';
import { MenuHandler } from '../domains/food/menuHandler.js';
import { OrderHandler } from '../domains/food/orderHandler.js';
import { buildClarifyOrderMessage, ORDER_REQUESTED_CATEGORY } from '../domains/food/clarifyOrderMessage.js';
import { ConfirmOrderHandler } from '../domains/food/confirmHandler.js';
import { SelectRestaurantHandler } from '../domains/food/selectHandler.js';
import { OptionHandler } from '../domains/food/optionHandler.js';
import { ConfirmAddToCartHandler } from '../domains/food/confirmAddToCartHandler.js';
import { BrainLogger } from '../../../utils/logger.js';
import { playTTS, stylizeWithGPT4o } from '../tts/ttsClient.js';
import { EventLogger } from '../services/EventLogger.js';
import { getConfig } from '../../config/configService.js';
import {
    checkRequiredState,
    getFallbackIntent,
    isHardBlockedFromLegacy,
    mutatesCart,
    getIntentDomain
} from './IntentCapabilityMap.js';
import { renderSurface, detectSurface } from '../dialog/SurfaceRenderer.js';
import { dialogNavGuard, pushDialogStack } from '../dialog/DialogNavGuard.js';
import { resolveMenuItemConflict, DISAMBIGUATION_RESULT } from '../services/DisambiguationService.js';
import { ORDER_INTENTS, TRANSACTION_ALLOWED_INTENTS, ORDER_INTENTS_CLEANUP, ESCAPE_INTENTS, CONFIDENT_SOURCES, EXPLICIT_ESCAPE_SOURCES, CART_MUTATION_WHITELIST, CONFIRMATION_CONTEXTS } from './pipeline/IntentGroups.js';
import { GUARD_CHAIN } from './pipeline/guards/index.js';
import { ResponseBuilder } from './pipeline/ResponseBuilder.js';
import { MenuHydrationService } from './pipeline/MenuHydrationService.js';
import { SessionHydrator } from './pipeline/SessionHydrator.js';
import { HandlerDispatcher } from './pipeline/HandlerDispatcher.js';
import { finalizeEntities } from './pipeline/finalizeEntities.js';
import { applyMultiItemParsing } from './pipeline/multiItemOrderParser.js';
import { ORDER_MODE_STATE, ORDER_MODE_EVENT, transitionOrderMode } from './pipeline/OrderModeFSM.js';
import { parseCompoundOrder } from '../nlu/compoundOrderParser.js';

// Reco V1 â€” rule-based recommendation layer (no extra DB calls)
import { getRecommendations } from '../recommendations/recoEngine.js';
import { recoTelemetry } from '../recommendations/recoTelemetry.js';

//   Passive Memory Layer (read-only context, no FSM impact)
import { initTurnBuffer, pushUserTurn, pushAssistantTurn } from '../memory/TurnBuffer.js';
import { initEntityCache, cacheRestaurants, cacheItems } from '../memory/EntityCache.js';

//  Phrase Generator (optional LLM paraphrasing, fallback to templates)
import { generatePhrase } from '../dialog/PhraseGenerator.js';

//   TTS Chunking (stream first sentence, barge-in support)
import { getFirstChunk, createBargeInController } from '../tts/TtsChunker.js';

//  Conversation Guards (UX improvements, no FSM changes)
import {
    hasLockedRestaurant,
    isOrderingContext,
    containsDishLikePhrase,
    recoverRestaurantFromFullText,
    calculatePhase,
    resolveRestaurantFromMenuRequest,
    sanitizeLocation,
    containsOrderingIntent
} from './ConversationGuards.js';

//  Dish Canonicalization (alias resolution before NLU)
import { canonicalizeDish } from '../nlu/dishCanon.js';

//   Phonetic Dish Matcher (STT error recovery before NLU)
import { matchDishPhonetic } from '../nlu/phoneticDishMatch.js';
import {
    ROLE_GUARD_FALLBACK_REPLY,
    SUBMITTED_ORDER_FALLBACK_REPLY,
    isMetaRequest,
    isIntentWhitelisted,
    isMutationCapabilityIntent,
    isMutationRequestText,
    isSubmittedOrLater,
    sanitizeAssistantResponse,
} from './securityGuards.js';

export { isMetaRequest } from './securityGuards.js';

//  Intelligent TTS Summaries
function buildRestaurantSummaryForTTS(restaurants, location) {
    if (!restaurants || restaurants.length === 0) return null;

    const count = restaurants.length;

    const sample = restaurants
        .slice(0, 3)
        .map(r => r.name)
        .join(', ');

    return `Znalazłam ${count} miejsc${location ? ' w ' + location : ''}. Między innymi: ${sample}. Którą wybierasz?`;
}

function buildMenuSummaryForTTS(menuItems) {
    if (!menuItems || menuItems.length === 0) return null;

    const categories = [...new Set(menuItems.map(i => i.category).filter(Boolean))];

    const hasVege = menuItems.some(i => i.is_vege);
    const hasSpicy = menuItems.some(i => i.spicy);

    let summary = "W karcie są m.in. ";

    if (categories.length > 0) {
        summary += categories.join(', ');
    }

    if (hasVege && !summary.includes('wegetariańskie')) summary += ", opcje wegetariańskie";
    if (hasSpicy && !summary.includes('ostre')) summary += ", dania ostre";

    // Deduplicate base_name and use it for examples
    const baseNames = [...new Set(menuItems.map(i => i.base_name || i.name).filter(Boolean))];
    const sample = baseNames.slice(0, 3).join(', ');

    if (sample) {
        summary += `. Na przykład: ${sample}. Co wybierasz?`;
    } else {
        summary += `. Co wybierasz?`;
    }

    return summary;
}

// UTF-8 safe replacements for legacy mojibake summaries.
function buildRestaurantSummaryForTTSV2(restaurants, location) {
    if (!restaurants || restaurants.length === 0) return null;

    const count = restaurants.length;
    const locationPart = location ? ` w okolicy: ${location}` : '';
    const nearest = restaurants
        .slice(0, 3)
        .map((r) => r?.name)
        .filter(Boolean);

    if (nearest.length === 0) {
        return `Mam ${count} propozycji${locationPart}. Którą wybierasz?`;
    }

    return `Mam ${count} propozycji${locationPart}. Najbliżej są: ${nearest.join(', ')}. Którą wybierasz?`;
}

function buildMenuSummaryForTTSV2(menuItems) {
    if (!menuItems || menuItems.length === 0) return null;

    const categories = [...new Set(menuItems.map((i) => i.category).filter(Boolean))];
    const hasVege = menuItems.some((i) => i.is_vege);
    const hasSpicy = menuItems.some((i) => i.spicy);

    let summary = 'W menu są między innymi: ';
    if (categories.length > 0) {
        summary += categories.join(', ');
    }

    if (hasVege && !summary.includes('wegetariańskie')) summary += ', opcje wegetariańskie';
    if (hasSpicy && !summary.includes('ostre')) summary += ', dania ostre';

    const baseNames = [...new Set(menuItems.map((i) => i.base_name || i.name).filter(Boolean))];
    const sample = baseNames.slice(0, 3).join(', ');

    if (sample) {
        summary += `. Na przykład: ${sample}. Co wybierasz?`;
    } else {
        summary += '. Co wybierasz?';
    }

    return summary;
}


function isExplicitRestaurantNavigation(text = '') {
    const normalized = String(text || '').toLowerCase();
    const ascii = normalized
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ł/g, 'l');
    return [
        'restaurac',
        'pokaz restauracje',
        'znajdz restauracje',
        'dostepne restauracje',
        'w poblizu',
        'gdzie moge zjesc',
        'gdzie zjem'
    ].some((phrase) => ascii.includes(phrase));
}

function isExplicitClearCartCommand(text = '') {
    const normalized = String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();

    return (
        /\b(wyczysc|oproznij|usun)\b.*\b(koszyk|cart)\b/i.test(normalized) ||
        /\b(koszyk|cart)\b.*\b(wyczysc|oproznij|usun)\b/i.test(normalized)
    );
}

function createGuardedFallbackResponse({
    activeSessionId,
    sessionContext,
    intent = 'safety_guard_blocked',
    reply = ROLE_GUARD_FALLBACK_REPLY,
    source = 'role_guard',
}) {
    return sanitizeAssistantResponse({
        ok: true,
        session_id: activeSessionId,
        intent,
        reply,
        should_reply: true,
        stopTTS: false,
        meta: { source },
        context: getSession(activeSessionId) || sessionContext,
    });
}

function mapOrderModeEvent({ intent = '', preState = ORDER_MODE_STATE.NEUTRAL, domainResponse = null }) {
    const normalizedIntent = String(intent || '').trim();
    const expectedContext = domainResponse?.contextUpdates?.expectedContext || null;

    if (normalizedIntent === 'confirm_order') return ORDER_MODE_EVENT.CONFIRM_ORDER;
    if (normalizedIntent === 'open_checkout') return ORDER_MODE_EVENT.OPEN_CHECKOUT;
    if (normalizedIntent === 'cancel_order') return ORDER_MODE_EVENT.CANCEL_ORDER;

    if (
        normalizedIntent === 'find_nearby'
        || normalizedIntent === 'find_nearby_ask_location'
        || normalizedIntent === 'DIALOG_CANCEL'
    ) {
        return ORDER_MODE_EVENT.RESET_TO_NEUTRAL;
    }

    if (
        normalizedIntent === 'select_restaurant'
        || normalizedIntent === 'menu_request'
        || normalizedIntent === 'show_menu'
    ) {
        return ORDER_MODE_EVENT.SELECT_RESTAURANT;
    }

    if (expectedContext === 'confirm_order') return ORDER_MODE_EVENT.REQUEST_CONFIRM;

    if (normalizedIntent === 'create_order' || normalizedIntent === 'confirm_add_to_cart') {
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

const RECO_ORDER_COMPLETED_COOLDOWN_MS = 12000;

function resolveRecoContextPolicy({
    sessionSnapshot = {},
    orderMode = ORDER_MODE_STATE.NEUTRAL,
    intent = '',
}) {
    const normalizedIntent = String(intent || '').trim();
    const effectiveOrderMode = orderMode || ORDER_MODE_STATE.NEUTRAL;
    const lastOrderCompletedAt = Number(sessionSnapshot?.lastOrderCompletedAt || 0);
    const elapsedSinceCompletion = lastOrderCompletedAt > 0 ? Date.now() - lastOrderCompletedAt : Number.POSITIVE_INFINITY;
    const cooldownRemainingMs = Number.isFinite(elapsedSinceCompletion)
        ? Math.max(0, RECO_ORDER_COMPLETED_COOLDOWN_MS - elapsedSinceCompletion)
        : 0;

    if (cooldownRemainingMs > 0) {
        return {
            context: 'order_confirmed',
            mode: 'off',
            allowReco: false,
            reason: 'order_completed_cooldown',
            cooldownRemainingMs,
        };
    }

    if (effectiveOrderMode === ORDER_MODE_STATE.CHECKOUT_FORM) {
        return {
            context: 'checkout_form',
            mode: 'off',
            allowReco: false,
            reason: 'checkout_focus',
            cooldownRemainingMs: 0,
        };
    }

    if (
        effectiveOrderMode === ORDER_MODE_STATE.BUILDING
        || effectiveOrderMode === ORDER_MODE_STATE.AWAITING_CONFIRMATION
    ) {
        return {
            context: 'building_cart',
            mode: 'subtle',
            allowReco: true,
            reason: 'cart_building',
            cooldownRemainingMs: 0,
        };
    }

    if (
        effectiveOrderMode === ORDER_MODE_STATE.RESTAURANT_SELECTED
        || ['menu_request', 'show_menu', 'show_more_options', 'select_restaurant'].includes(normalizedIntent)
    ) {
        return {
            context: 'browsing_menu',
            mode: 'ok',
            allowReco: true,
            reason: 'menu_browsing',
            cooldownRemainingMs: 0,
        };
    }

    return {
        context: 'general',
        mode: 'subtle',
        allowReco: true,
        reason: 'default',
        cooldownRemainingMs: 0,
    };
}
// Mapa handlerów domenowych (Bezpośrednie mapowanie)
// Kluczem jest "domain", a wewnątrz "intent"

// Default Handlers Map
import { SupabaseRestaurantRepository } from './repository.js';

export class BrainPipeline {
    constructor(deps = {}) {
        this.nlu = deps.nlu;
        // Repository Injection: Use provided or default Supabase
        this.repository = deps.repository || new SupabaseRestaurantRepository();

        // Dynamic Handler Initialization with DI
        this.handlers = this.createHandlers(this.repository, deps.handlers);
    }

    createHandlers(repository, overrides = {}) {
        const defaults = {
            food: {
                find_nearby: new FindRestaurantHandler(repository),
                menu_request: new MenuHandler(), // Need repo injection too if MenuHandler refactored
                show_menu: new MenuHandler(),
                create_order: new OrderHandler(),
                choose_restaurant: new OrderHandler(),
                confirm_order: new ConfirmOrderHandler(),
                confirm_add_to_cart: new ConfirmAddToCartHandler(), // NEW
                select_restaurant: new SelectRestaurantHandler(),
                show_more_options: new OptionHandler(),
                find_nearby_confirmation: new FindRestaurantHandler(repository),
                recommend: {
                    execute: async (ctx) => ({
                        reply: 'Co polecam? W okolicy masz świetne opcje! Powiedz gdzie szukać.',
                        intent: 'recommend',
                        contextUpdates: { expectedContext: 'find_nearby' }
                    })
                },
                cancel_order: {
                    execute: async (ctx) => ({
                        reply: 'Anulowalam zamawianie. Wracam do ekranu glownego.',
                        intent: 'cancel_order',
                        contextUpdates: { pendingOrder: null, expectedContext: null, conversationPhase: 'idle', currentRestaurant: null, lastRestaurant: null, pendingDish: null }
                    })
                },
                confirm: new FindRestaurantHandler(repository),
            },
            ordering: {
                create_order: new OrderHandler(),
                confirm_order: new ConfirmOrderHandler(),
                confirm_add_to_cart: new ConfirmAddToCartHandler(),
                open_checkout: {
                    execute: async (ctx) => {
                        const sessionCart = ctx?.session?.cart || { items: [], total: 0 };
                        const cartItems = Array.isArray(sessionCart.items) ? sessionCart.items : [];

                        if (cartItems.length === 0) {
                            return {
                                reply: 'Koszyk jest pusty. Dodaj cos do koszyka, a potem przejde do checkoutu.',
                                intent: 'open_checkout',
                                cart: sessionCart,
                                contextUpdates: {
                                    conversationPhase: 'ordering',
                                    expectedContext: 'create_order',
                                },
                                meta: {
                                    source: 'open_checkout_bridge_empty',
                                    checkoutUi: false,
                                    cartEmpty: true,
                                }
                            };
                        }

                        return {
                            reply: 'Otwieram checkout. Uzupelnij dane dostawy i potwierdz zamowienie.',
                            intent: 'open_checkout',
                            cart: sessionCart,
                            actions: [
                                {
                                    type: 'SHOW_CART',
                                    payload: { mode: 'checkout' }
                                }
                            ],
                            contextUpdates: {
                                conversationPhase: 'checkout',
                                expectedContext: 'confirm_order',
                            },
                            meta: {
                                source: 'open_checkout_bridge',
                                checkoutUi: true,
                                menuBehavior: 'preserve',
                            }
                        };
                    }
                },
                clarify_order: {
                    execute: async (ctx) => {
                        const expectedContext = ctx?.session?.expectedContext || null;
                        const isMulti = ctx?.meta?.orderMode === 'multi_candidate' || Array.isArray(ctx?.entities?.items);
                        const requestedCategory = isMulti
                            ? ORDER_REQUESTED_CATEGORY.MULTI
                            : expectedContext === 'order_addon'
                                ? ORDER_REQUESTED_CATEGORY.ADDON
                                : ORDER_REQUESTED_CATEGORY.UNKNOWN;
                        const clarifyMeta = {
                            status: 'AMBIGUOUS',
                            requestedCategory,
                            candidates: [],
                            expectedContext,
                        };
                        console.log('[CLARIFY_REASON_TRACE]', JSON.stringify({
                            category: clarifyMeta.requestedCategory,
                            candidateCount: 0,
                            expectedContext,
                            restaurantName: ctx?.session?.currentRestaurant?.name || ctx?.session?.lastRestaurant?.name || null,
                        }));

                        const hasRestaurant = !!(ctx?.session?.currentRestaurant || ctx?.session?.lastRestaurant);
                        return {
                            reply: buildClarifyOrderMessage(clarifyMeta),
                            intent: 'clarify_order',
                            meta: { clarify: clarifyMeta },
                            contextUpdates: {
                                // Without restaurant context, guide to discovery instead of looping on create_order
                                expectedContext: expectedContext === 'order_addon'
                                    ? 'order_addon'
                                    : hasRestaurant ? 'create_order' : 'find_nearby'
                            }
                        };
                    }
                }
            },
            system: {
                health_check: { execute: async () => ({ reply: 'System działa', meta: {} }) },
                fallback: { execute: async () => ({ reply: 'Nie rozumiem tego polecenia.', fallback: true }) }
            },
        };

        // Deep merge overrides if any (simplified)
        // For now, if overrides provided, we might just replace. 
        // But tests usually provide mocks via repo, not handler overrides.
        // If 'handlers' passed in deps, assume it's full map replacement (legacy support).
        if (overrides && Object.keys(overrides).length > 0) return overrides;

        return defaults;
    }

    /**
     * Główny punkt wejścia dla każdego zapytania
     *
     * SINGLE-ROUTING INVARIANT:
     * Only one process() per sessionId may run at a time.
     * Concurrent duplicate calls are rejected immediately to prevent
     * double intent resolution (e.g. due to React StrictMode double-invoke
     * or accidental parallel HTTP calls from the same client).
     */
    async process(sessionId, text, options = {}) {
        const startTime = Date.now();
        const IS_SHADOW = options.shadow === true;
        let activeSessionId = sessionId;

        // 
        // SINGLE-ROUTING INVARIANT: In-flight deduplication guard
        // 
        const inflightKey = `${sessionId}::${text.trim()}`;
        if (!IS_SHADOW) {
            if (BrainPipeline._inFlight.has(inflightKey)) {
                console.warn(` [Pipeline] DUPLICATE_REQUEST blocked: ${sessionId}   "${text.trim().substring(0, 40)}". Single-routing invariant enforced.`);
                return {
                    ok: false,
                    session_id: activeSessionId,
                    intent: 'duplicate_request',
                    reply: null,
                    should_reply: false,
                    meta: { source: 'duplicate_blocked', routing: 'single_invariant' }
                };
            }
            BrainPipeline._inFlight.add(inflightKey);
        }

        const config = await getConfig();

        // 1. Hydration & Validation
        if (!text || !text.trim()) {
            if (!IS_SHADOW) BrainPipeline._inFlight.delete(inflightKey);
            return this.createErrorResponse('brak_tekstu', 'Nie usłyszałam, możesz powtórzyć?');
        }

        const incomingSessionSnapshot = await getSessionAsync(sessionId, { createIfMissing: false }).catch(() => null);
        const submittedBoundaryFromIncomingSession = isSubmittedOrLater(incomingSessionSnapshot);

        if (submittedBoundaryFromIncomingSession && isMutationRequestText(text)) {
            if (!IS_SHADOW) BrainPipeline._inFlight.delete(inflightKey);
            return createGuardedFallbackResponse({
                activeSessionId,
                sessionContext: incomingSessionSnapshot || {},
                intent: 'order_already_submitted',
                reply: SUBMITTED_ORDER_FALLBACK_REPLY,
                source: 'order_submitted_boundary',
            });
        }

        if (isMetaRequest(text)) {
            if (!IS_SHADOW) BrainPipeline._inFlight.delete(inflightKey);
            return createGuardedFallbackResponse({
                activeSessionId,
                sessionContext: incomingSessionSnapshot || {},
                intent: 'safety_guard_blocked',
                reply: ROLE_GUARD_FALLBACK_REPLY,
                source: 'meta_guard',
            });
        }

        const ENGINE_MODE = getEngineMode();
        const EXPERT_MODE = ENGINE_MODE === 'dev'; // backward compat alias
        const requestId = `${sessionId.substring(0, 8)}-${startTime.toString(36)}`;
        devLog(`  [Pipeline] START ${requestId} | session=${sessionId} | text="${text.trim().substring(0, 60)}" | mode=${ENGINE_MODE}`);

        // --- Event Logging: Received (dev only) ---
        if (EXPERT_MODE && !IS_SHADOW) {
            const initialWorkflowStep = this._mapWorkflowStep('request_received');
            EventLogger.logConversation(sessionId).catch(() => { });
            EventLogger.logEvent(sessionId, 'request_received', { text }, null, initialWorkflowStep).catch(() => { });
        }

        // 
        // CONVERSATION ISOLATION: Auto-create new session if previous was closed
        // 
        const hydratedSession = await SessionHydrator.hydrate({
            sessionId,
            activeSessionId,
            isShadow: IS_SHADOW,
            getOrCreateActiveSessionAsync,
            logger: BrainLogger,
        });

        const sessionResult = hydratedSession.sessionResult;
        activeSessionId = hydratedSession.activeSessionId;
        const session = hydratedSession.session;
        const sessionContext = hydratedSession.sessionContext;

        const requestBody = options?.requestBody || {};
        const parsedLat = requestBody?.lat != null ? parseFloat(requestBody.lat) : null;
        const parsedLng = requestBody?.lng != null ? parseFloat(requestBody.lng) : null;
        const coords = (Number.isFinite(parsedLat) && Number.isFinite(parsedLng))
            ? { lat: parsedLat, lng: parsedLng }
            : (sessionContext?.coords || null);

        if (coords && !IS_SHADOW) {
            // FIX: enable distance calculation when GPS available
            updateSession(activeSessionId, { coords });
        }

        const context = {
            sessionId: activeSessionId,  // Use active (possibly new) session ID
            originalSessionId: sessionId, // Keep original for tracking
            text,
            rawText: text,
            session: sessionContext,
            startTime,
            meta: { conversationNew: sessionResult.isNew },
            body: requestBody,
            coords,
            trace: ['hydrated'],
        };

        //   Initialize Passive Memory (no FSM impact)
        initTurnBuffer(sessionContext);
        initEntityCache(sessionContext);

        try {
            // Fast-path guard: explicit clear cart command should bypass menu hydration + NLU.
            if (isExplicitClearCartCommand(text)) {
                const clearedCart = { items: [], total: 0 };
                const nextPhase = sessionContext?.currentRestaurant ? 'restaurant_selected' : 'idle';

                if (!IS_SHADOW) {
                    updateSession(activeSessionId, {
                        cart: clearedCart,
                        pendingOrder: null,
                        expectedContext: null,
                        pendingRestaurantSwitch: null,
                        conversationPhase: nextPhase
                    });
                }

                return {
                    ok: true,
                    session_id: activeSessionId,
                    intent: 'clear_cart',
                    reply: 'Wyczyscilam koszyk.',
                    should_reply: true,
                    actions: [{ type: 'CLEAR_CART' }],
                    cart: clearedCart,
                    meta: {
                        source: 'clear_cart_command',
                        cart: clearedCart
                    },
                    context: getSession(activeSessionId) || sessionContext
                };
            }

            await MenuHydrationService.hydrate({
                sessionContext,
                activeSessionId,
                handlers: this.handlers,
                context,
                isShadow: IS_SHADOW,
                updateSession,
                logger: BrainLogger,
            });
            context.trace.push('menu_loaded');

            // 
            // 1. DIALOG NAVIGATION GUARD (Meta-Intent Layer)
            // Handles: BACK, REPEAT, NEXT, STOP
            // SHORT-CIRCUITS pipeline if matched - does NOT touch FSM
            // Config-aware: respects dialog_navigation_enabled and fallback_mode
            // 
            const navResult = dialogNavGuard(text, sessionContext, config);

            if (navResult.handled) {
                BrainLogger.pipeline(` DIALOG NAV: ${navResult.response.intent} - skipping NLU/FSM`);

                // --- Event Logging: Dialog Navigation ---
                if (EXPERT_MODE && !IS_SHADOW) {
                    EventLogger.logEvent(activeSessionId, 'dialog_nav', {
                        navIntent: navResult.response.intent,
                        reply: navResult.response.reply?.substring(0, 100),
                        stopTTS: navResult.response.stopTTS
                    }, null, 'nav').catch(() => { });
                }

                // Apply context updates if any (e.g., dialogStackIndex)
                if (navResult.response.contextUpdates && !IS_SHADOW) {
                    updateSession(activeSessionId, navResult.response.contextUpdates);
                }

                return {
                    ok: true,
                    session_id: activeSessionId,
                    intent: navResult.response.intent,
                    reply: navResult.response.reply,
                    should_reply: navResult.response.should_reply,
                    stopTTS: navResult.response.stopTTS || false,
                    meta: navResult.response.meta,
                    context: getSession(activeSessionId) || sessionContext
                };
            }

            // 
            // PRE-NLU CONTEXT OVERRIDE: Fast-track list selections
            // 
            let intentResult;
            let skipSingleDishCanon = false;
            const executedGuardNames = [];

            const executeGuardChain = (intentContext, guardImplementations, pipelineState = {}) => {
                const state = {
                    ...pipelineState,
                    guardImplementations,
                    mutationApplied: false,
                    firstMutationGuard: null,
                };

                for (const guard of GUARD_CHAIN) {
                    executedGuardNames.push(guard.name);

                    const beforeIntent = intentContext?.intent;
                    const nextIntentContext = guard(intentContext, state) || intentContext;
                    const afterIntent = nextIntentContext?.intent;
                    const intentChanged = beforeIntent !== afterIntent;

                    if (intentChanged) {
                        if (!state.mutationApplied) {
                            state.mutationApplied = true;
                            state.firstMutationGuard = guard.name;
                            intentContext = nextIntentContext;
                        } else {
                            BrainLogger.pipeline(`[GUARD_CHAIN] skipped extra intent mutation by ${guard.name}: "${beforeIntent}" -> "${afterIntent}" (first mutation: ${state.firstMutationGuard})`);
                            intentContext = {
                                ...nextIntentContext,
                                intent: beforeIntent,
                            };
                        }
                    } else {
                        intentContext = nextIntentContext;
                    }

                    if (state.stopGuardChain) break;
                }

                return intentContext;
            };
            const hasList = sessionContext?.last_restaurants_list?.length > 0;
            const uiAction = requestBody?.meta?.ui_action;
            const isUiRestaurantSelection = uiAction?.type === 'select_restaurant';
            const uiRestaurantId = String(uiAction?.restaurant_id ?? '').trim();
            const uiRestaurantName = String(uiAction?.restaurant_name ?? '').trim().slice(0, 160);
            let uiSelectedRestaurant = isUiRestaurantSelection && hasList
                ? sessionContext.last_restaurants_list.find((restaurant) => String(restaurant?.id ?? '') === uiRestaurantId)
                : null;
            if (
                isUiRestaurantSelection
                && !uiSelectedRestaurant
                && uiRestaurantId
                && typeof this.repository?.getRestaurantById === 'function'
            ) {
                try {
                    uiSelectedRestaurant = await this.repository.getRestaurantById(uiRestaurantId);
                    if (uiSelectedRestaurant) {
                        BrainLogger.pipeline(` UI ACTION: Revalidated active restaurant after session-list cache miss (${uiRestaurantId})`);
                    }
                } catch (error) {
                    BrainLogger.pipeline(` UI ACTION: Restaurant revalidation failed (${error?.message || 'unknown error'})`);
                }
            }
            if (
                isUiRestaurantSelection
                && !uiSelectedRestaurant
                && uiRestaurantName
                && typeof this.repository?.getRestaurantByName === 'function'
            ) {
                try {
                    uiSelectedRestaurant = await this.repository.getRestaurantByName(uiRestaurantName);
                    if (uiSelectedRestaurant) {
                        BrainLogger.pipeline(` UI ACTION: Revalidated active restaurant by exact card name after cache miss (${uiRestaurantName})`);
                    }
                } catch (error) {
                    BrainLogger.pipeline(` UI ACTION: Restaurant name revalidation failed (${error?.message || 'unknown error'})`);
                }
            }
            const normOverrideText = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            const isDigitObj = /^\d+$/.test(normOverrideText) || /^wybieram\s+\d+$/.test(normOverrideText);
            const isOrdinalObj = /^(pierwsza|druga|trzecia|czwarta|piata|szosta|siodma|osma|dziewiata|dziesiata|jedynka|dwojka|trojka|czworka|piatka|szostka|siodemka|osemka|dziewiatka|dziesiatka|pierwszy|drugi|trzeci|czwarty|piaty|szosty|siodmy|osmy|dziewiaty|dziesiaty)$/.test(normOverrideText);
            const listNorm = hasList
                ? sessionContext.last_restaurants_list.map((r) => (r?.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim())
                : [];
            const isFragmentSelection = hasList && normOverrideText.length >= 4 && !normOverrideText.includes(' ') && listNorm.some((n) => n.includes(normOverrideText) || n.split(' ').some((w) => w.startsWith(normOverrideText)));

            if (isUiRestaurantSelection && !uiSelectedRestaurant) {
                BrainLogger.pipeline(`[UI_ACTION_BLOCKED] stale or invalid restaurant id="${uiRestaurantId || 'missing'}"`);
                if (!IS_SHADOW) BrainPipeline._inFlight.delete(inflightKey);
                return this.createErrorResponse(
                    'invalid_restaurant_selection',
                    'Ta lista restauracji jest już nieaktualna. Pokaż miejsca w pobliżu jeszcze raz.',
                );
            }

            if (uiSelectedRestaurant) {
                BrainLogger.pipeline(` UI ACTION: Exact restaurant selection -> ${uiSelectedRestaurant.name} (${uiSelectedRestaurant.id})`);
                intentResult = {
                    intent: 'select_restaurant',
                    domain: 'food',
                    confidence: 1.0,
                    source: 'ui_action',
                    entities: {
                        restaurant: uiSelectedRestaurant.name,
                        restaurantId: uiSelectedRestaurant.id,
                        location: uiSelectedRestaurant.city || null,
                    },
                };
            } else if (hasList && (isDigitObj || isOrdinalObj || isFragmentSelection)) {
                BrainLogger.pipeline(` PRE-NLU OVERRIDE: Bypassing NLU for list selection -> select_restaurant`);
                intentResult = {
                    intent: 'select_restaurant',
                    domain: 'food',
                    confidence: 1.0,
                    source: 'context_override',
                    entities: {}
                };
            } else {
                // 
                // PRE-NLU: Dish Canonicalization (resolve aliases before NLU)
                // 
                const rawCompoundPreview = parseCompoundOrder(context.rawText || text, sessionContext?.last_menu || []);
                if (Array.isArray(rawCompoundPreview?.items) && rawCompoundPreview.items.length > 1) {
                    skipSingleDishCanon = true;
                    console.log('[COMPOUND_RAW_TRACE]', JSON.stringify({
                        source: 'pipeline_pre_nlu',
                        sessionId: activeSessionId,
                        count: rawCompoundPreview.items.length,
                        items: rawCompoundPreview.items,
                    }));
                }

                if (!skipSingleDishCanon) {
                    const canonResult = canonicalizeDish(text, sessionContext);
                    if (canonResult && (typeof canonResult === 'string') && canonResult !== text) {
                        BrainLogger.pipeline(` DISH_CANON: "${text}"   "${canonResult}"`);
                        context.canonicalDish = canonResult;
                        text = canonResult; // Override text for NLU
                    }
                } else {
                    context.meta = { ...(context.meta || {}), skipSingleDishCanon: true };
                }

                // 
                // PRE-NLU: Phonetic Dish Matcher (STT error recovery)
                // Runs AFTER canon so canon has first priority.
                // If a phonetic match is found, text is replaced before NLU.
                // 
                const hasExplicitQuantityPrefix = /^\s*(?:\d+|jeden|jedna|jedno|dwa|dwie|trzy|cztery|pięć|pięc|piec|sześć|szesc|siedem|osiem|dziewięć|dziewiec|dziesięć|dziesiec|kilka|parę|pare)\b/i.test(text);
                if (sessionContext?.last_menu?.length > 0 && !isExplicitRestaurantNavigation(text) && !hasExplicitQuantityPrefix && !skipSingleDishCanon) {
                    const phoneticMatch = matchDishPhonetic(text, sessionContext.last_menu);
                    if (phoneticMatch) {
                        BrainLogger.pipeline(`  PHONETIC_MATCH: "${text}"   "${phoneticMatch}"`);
                        text = phoneticMatch;
                        context.text = phoneticMatch;
                    }
                }

                // 2. NLU Decision
                intentResult = await this.nlu.detect(context);
                context.nluResult = intentResult;
            }

            // Entity sealing contract: finalize entities after NLU and before guard chain.
            // This prevents quantity leaks from dish aliases like "6 szt." inside item names.
            if (intentResult) {
                if (intentResult?.entities?.items && Array.isArray(intentResult.entities.items)) {
                    skipSingleDishCanon = true;
                    context.meta = { ...(context.meta || {}), skipSingleDishCanon: true };
                }

                const extractedQuantity = intentResult?.entities?.quantity ?? null;
                const sealing = finalizeEntities({
                    text,
                    entities: intentResult?.entities,
                    intent: intentResult?.intent,
                    session: sessionContext,
                });

                intentResult.entities = sealing.entities;

                if (sealing.qtyRejectedReason) {
                    context.trace.push(`qty_rejected:${sealing.qtyRejectedReason}`);

                    if (!IS_SHADOW) {
                        EventLogger.logEvent(
                            activeSessionId,
                            'qty_rejected_reason',
                            {
                                reason: sealing.qtyRejectedReason,
                                quantityConfidence: sealing.quantityConfidence,
                                extractedQuantity,
                                text,
                                intent: intentResult?.intent,
                            },
                            null,
                            'nlu'
                        ).catch(() => { });
                    }
                }

                if (intentResult?.entities?.items && Array.isArray(intentResult.entities.items)) {
                    const existingItems = intentResult.entities.items;
                    console.log('[COMPOUND_CANON_TRACE]', JSON.stringify({
                        source: 'pipeline_entities_guard',
                        sessionId: activeSessionId,
                        items: existingItems,
                    }));

                    if (existingItems.length > 1 || existingItems.some((item) => Number(item?.quantity || item?.qty || 1) > 1)) {
                        intentResult.meta = {
                            ...(intentResult.meta || {}),
                            orderMode: 'multi_candidate',
                        };
                        context.meta = {
                            ...(context.meta || {}),
                            orderMode: 'multi_candidate',
                        };
                        context.trace.push(`multi_parse:${existingItems.length}`);
                        console.log('[MULTI_PARSE_TRACE]', JSON.stringify({
                            count: existingItems.length,
                            items: existingItems,
                            sessionId: activeSessionId,
                            source: 'entities_guard',
                        }));
                    }
                } else {
                    const multiParsing = applyMultiItemParsing({
                        text: context.rawText || text,
                        intent: intentResult?.intent,
                        entities: intentResult?.entities,
                        menu: sessionContext?.last_menu || [],
                    });
                    intentResult.entities = multiParsing.entities;

                    if (multiParsing.orderMode === 'multi_candidate') {
                        intentResult.meta = {
                            ...(intentResult.meta || {}),
                            orderMode: 'multi_candidate',
                        };
                        context.meta = {
                            ...(context.meta || {}),
                            orderMode: 'multi_candidate',
                        };
                        context.trace.push(`multi_parse:${multiParsing.items.length}`);
                        console.log('[MULTI_PARSE_TRACE]', JSON.stringify({
                            count: multiParsing.items.length,
                            items: multiParsing.items,
                            sessionId: activeSessionId,
                        }));
                    }
                }
            }

            // 
            const normalizedPreGuardInput = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0142/g, 'l').trim();
            const preIntentContext = {
                intent: intentResult?.intent,
                entities: intentResult?.entities,
                text,
                source: intentResult?.source,
                confidence: intentResult?.confidence,
                domain: intentResult?.domain,
            };

            const preIntentGuardImplementations = {
                preNluOverrideGuard: (intentContext) => intentContext,
                transactionLockGuard: (intentContext) => {
                    if (
                        (sessionContext?.pendingOrder || sessionContext?.expectedContext === 'confirm_add_to_cart') &&
                        intentContext.intent &&
                        !ORDER_INTENTS.includes(intentContext.intent) &&
                        !ESCAPE_INTENTS.includes(intentContext.intent)
                    ) {
                        const lockedIntent = sessionContext.expectedContext || 'create_order';
                        BrainLogger.pipeline(`[GUARD] TRANSACTION_LOCK: "${intentContext.intent}" -> "${lockedIntent}" (pendingOrder=${!!sessionContext.pendingOrder})`);
                        return {
                            ...intentContext,
                            intent: lockedIntent,
                            source: 'transaction_lock_override',
                            confidence: 1.0,
                            domain: 'ordering',
                        };
                    }
                    return intentContext;
                },
                orderingAffirmationGuard: (intentContext) => {
                    // P0 guard: if session expects a confirmation context, let expectedContextGuard handle it.
                    if (CONFIRMATION_CONTEXTS.includes(sessionContext?.expectedContext)) {
                        return intentContext;
                    }
                    const isOrderingAffirmation = /^(tak|ok|okej|potwierdzam|zgadza sie|dawaj|dobra|jasne|leci)$/i.test(normalizedPreGuardInput);
                    const hasCartItems = Array.isArray(sessionContext?.cart?.items) && sessionContext.cart.items.length > 0;
                    if (isOrderingAffirmation && sessionContext?.conversationPhase === 'ordering' && hasCartItems && !sessionContext?.pendingOrder) {
                        const lastCartItem = sessionContext.cart.items[sessionContext.cart.items.length - 1];
                        if (lastCartItem?.name) {
                            BrainLogger.pipeline(`ORDERING_AFFIRMATION_GUARD: repeating last cart item "${lastCartItem.name}"`);
                            return {
                                ...intentContext,
                                intent: 'create_order',
                                domain: 'ordering',
                                source: 'ordering_affirmation_repeat',
                                confidence: 1.0,
                                entities: {
                                    ...(intentContext.entities || {}),
                                    dish: lastCartItem.name,
                                    quantity: 1,
                                    restaurant: sessionContext?.currentRestaurant || sessionContext?.lastRestaurant || null,
                                    restaurantId: sessionContext?.currentRestaurant?.id || sessionContext?.lastRestaurant?.id || null,
                                },
                                text: lastCartItem.name,
                            };
                        }
                    }
                    return intentContext;
                },
                escapeOverrideGuard: (intentContext) => {
                    const hasExplicitRestaurantTarget = Boolean(
                        intentContext?.entities?.restaurantId ||
                        intentContext?.entities?.restaurant
                    );
                    if (
                        /\bpokaz\s+restaurac/.test(normalizedPreGuardInput) &&
                        intentContext.intent !== 'find_nearby' &&
                        !hasExplicitRestaurantTarget
                    ) {
                        BrainLogger.pipeline(`ESCAPE_OVERRIDE: "${intentContext.intent}" -> "find_nearby" (phrase="${intentContext.text}")`);
                        return {
                            ...intentContext,
                            intent: 'find_nearby',
                            source: 'escape_phrase_override',
                            confidence: 1.0,
                            domain: 'food',
                        };
                    }
                    return intentContext;
                },
                expectedContextGuard: (intentContext) => {
                    if (
                        sessionContext?.expectedContext &&
                        /^(tak|ok|okej|potwierdzam|zgadza sie|dawaj|dobra|jasne|leci)$/i.test(normalizedPreGuardInput) &&
                        intentContext.intent !== sessionContext.expectedContext
                    ) {
                        BrainLogger.pipeline(` EXPECTED_CONTEXT_OVERRIDE: "${intentContext.intent}"  â€™ "${sessionContext.expectedContext}" (user said "${intentContext.text}")`);
                        return {
                            ...intentContext,
                            intent: sessionContext.expectedContext,
                            source: 'expected_context_override',
                            confidence: 1.0,
                            domain: ['confirm_add_to_cart', 'confirm_order', 'create_order'].includes(sessionContext.expectedContext)
                                ? 'ordering'
                                : intentContext.domain,
                        };
                    }
                    return intentContext;
                },
            };

            const guardedPreIntentContext = executeGuardChain(preIntentContext, preIntentGuardImplementations);
            intentResult.intent = guardedPreIntentContext.intent;
            intentResult.source = guardedPreIntentContext.source ?? intentResult.source;
            intentResult.confidence = guardedPreIntentContext.confidence ?? intentResult.confidence;
            intentResult.domain = guardedPreIntentContext.domain ?? intentResult.domain;
            intentResult.entities = guardedPreIntentContext.entities ?? intentResult.entities;
            text = guardedPreIntentContext.text;
            context.text = guardedPreIntentContext.text;
            context.trace.push(`intent_resolved:${intentResult?.intent || 'unknown'}`);
            const guardOverride = guardedPreIntentContext.intent !== preIntentContext.intent ? guardedPreIntentContext.intent : 'none';
            context.trace.push(`guard_override:${guardOverride}`);

            if (!isIntentWhitelisted(intentResult?.intent)) {
                BrainLogger.pipeline(`[INTENT_WHITELIST_BLOCK] intent="${intentResult?.intent || 'unknown'}" source="${intentResult?.source || 'unknown'}"`);
                return createGuardedFallbackResponse({
                    activeSessionId,
                    sessionContext,
                    intent: 'safety_guard_blocked',
                    reply: ROLE_GUARD_FALLBACK_REPLY,
                    source: 'intent_whitelist_block',
                });
            }

            const submittedBoundaryInSession = submittedBoundaryFromIncomingSession || isSubmittedOrLater(sessionContext);
            if (submittedBoundaryInSession && isMutationCapabilityIntent(intentResult?.intent)) {
                return createGuardedFallbackResponse({
                    activeSessionId,
                    sessionContext,
                    intent: 'order_already_submitted',
                    reply: SUBMITTED_ORDER_FALLBACK_REPLY,
                    source: 'order_submitted_boundary',
                });
            }

            // EARLY EXITS (Greetings) - Skip everything else
            // 
            if (intentResult?.intent === 'greeting') {
                BrainLogger.pipeline(` GREETING DETECTED: Returning friendly greeting`);
                // Detect capabilities questions: "co potrafisz?", "co umiesz?", "co mozesz?"
                const CAPABILITIES_PATTERN = /co\s+(potrafisz|umiesz|mo[żz]esz|robisz|oferujesz)|jakie\s+masz\s+(funkcje|opcje|mo[żz]liwo[śs]ci)|czym\s+mo[żz]esz\s+(mi\s+)?pom[oó][cg]/i;
                const isCapabilitiesQuery = CAPABILITIES_PATTERN.test(text);
                const replyText = isCapabilitiesQuery
                    ? 'Cześć! Jestem Amber â€” Twój asystent do zamawiania jedzenia. Mogę: znajdować restauracje w okolicy, pokazywać menu, przyjmować zamówienia głosowo i tekstowo. Powiedz np. "Znajdź pizzerię w Katowicach" albo "Chcę burgera".'
                    : 'Cześć! W czym mogę pomóc?';
                let audioContent = null;
                const wantsTTS = options?.includeTTS === true;
                const EX_MODE = process.env.EXPERT_MODE === 'true'; // Pipeline constant
                const ttsEnabled = config?.tts_enabled === true;

                if ((wantsTTS || EX_MODE) && ttsEnabled) {
                    try {
                        const t0 = Date.now();
                        audioContent = await playTTS(replyText, options?.ttsOptions || {});
                        BrainLogger.pipeline(`  TTS Gen (Greeting): "${replyText}" (${Date.now() - t0}ms)`);
                    } catch (err) {
                        BrainLogger.pipeline(` TTS failed: ${err.message}`);
                    }
                }

                return {
                    ok: true,
                    session_id: activeSessionId,
                    intent: 'greeting',
                    reply: replyText,
                    text: replyText,
                    audioContent: audioContent,
                    should_reply: true,
                    stopTTS: false,
                    meta: { source: 'pipeline_greeting_handler' },
                    context: getSession(activeSessionId) || sessionContext
                };
            }

            // 
            // RESTAURANT HOURS HANDLER
            // 

            if (intentResult?.intent === 'restaurant_hours') {
                const currentRestaurant = sessionContext?.lastRestaurant || sessionContext?.currentRestaurant;

                if (!currentRestaurant) {
                    return {
                        ok: true,
                        session_id: activeSessionId,
                        intent: 'restaurant_hours',
                        reply: 'Której restauracji mam sprawdzić godziny?',
                        should_reply: true,
                        stopTTS: false,
                        context: getSession(activeSessionId) || sessionContext
                    };
                }

                const hours = currentRestaurant.opening_hours || 'Nie mam informacji o godzinach.';

                return {
                    ok: true,
                    session_id: activeSessionId,
                    intent: 'restaurant_hours',
                    reply: `${currentRestaurant.name} jest otwarta: ${hours}.`,
                    should_reply: true,
                    stopTTS: false,
                    context: getSession(activeSessionId) || sessionContext
                };
            }

            // 
            // UNKNOWN INTENT SAFE FALLBACK
            // 

            const isExplicitClearCartCommandBeforeUnknown = isExplicitClearCartCommand(text);

            if (isExplicitClearCartCommandBeforeUnknown) {
                const clearedCart = { items: [], total: 0 };
                const nextPhase = sessionContext?.currentRestaurant ? 'restaurant_selected' : 'idle';

                if (!IS_SHADOW) {
                    updateSession(activeSessionId, {
                        cart: clearedCart,
                        pendingOrder: null,
                        expectedContext: null,
                        pendingRestaurantSwitch: null,
                        conversationPhase: nextPhase
                    });
                }

                return {
                    ok: true,
                    session_id: activeSessionId,
                    intent: 'clear_cart',
                    reply: 'Wyczyscilam koszyk.',
                    should_reply: true,
                    actions: [{ type: 'CLEAR_CART' }],
                    cart: clearedCart,
                    meta: {
                        source: 'clear_cart_command',
                        cart: clearedCart
                    },
                    context: getSession(activeSessionId) || sessionContext
                };
            }
if (intentResult?.intent === 'UNKNOWN_INTENT') {

                const phase = sessionContext?.conversationPhase || 'idle';

                let reply;

                if (phase === 'ordering') {
                    reply = 'Nie jestem pewna, o co chodzi. Kontynuujemy zamówienie czy chcesz coś zmienić?';
                } else if (phase === 'restaurant_selected') {
                    reply = 'Możesz wybrać coś z menu albo zapytać o szczegóły.';
                } else {
                    reply = 'Mogę pokazać restauracje w pobliżu albo pomóc w wyborze dania.';
                }

                return {
                    ok: true,
                    session_id: activeSessionId,
                    intent: 'UNKNOWN_INTENT',
                    reply,
                    should_reply: true,
                    stopTTS: false,
                    meta: { source: 'safe_unknown_handler' },
                    context: getSession(activeSessionId) || sessionContext
                };
            }

            // 
            // SINGLE ROUTING INVARIANT  hard guard
            // If this fires, a classic path leaked through the NLU layer.
            // 
            if (intentResult?.source?.includes('classic')) {
                console.error(' CLASSIC_ROUTE_INVARIANT_VIOLATED', {
                    source: intentResult.source,
                    intent: intentResult.intent,
                    sessionId: activeSessionId
                });
                // Downgraded to warn because smartIntent allows classic source bypass
                console.warn(`CLASSIC ROUTE DETECTED  ${intentResult.source}`);
            }

            let { intent, domain, confidence, source, entities } = intentResult;

            // --- Event Logging: NLU Result ---
            if (EXPERT_MODE && !IS_SHADOW) {
                const entitiesResolved = entities && typeof entities === 'object'
                    ? Object.entries(entities)
                        .filter(([, value]) => value !== null && value !== undefined && value !== '')
                        .map(([key, value]) => ({ key, value }))
                    : [];
                EventLogger.logEvent(activeSessionId, 'nlu_result', {
                    intent, domain, confidence, source,
                    entities: entities ? Object.keys(entities) : [],
                    entities_resolved: entitiesResolved,
                }, confidence, 'nlu').catch(() => { });
            }

            //   Record user turn (passive memory, no FSM impact)
            if (!IS_SHADOW) {
                pushUserTurn(sessionContext, text, { intent, entities });
            }

            // 
            // CONFIDENCE FLOOR: Low-confidence intents trigger disambiguation
            // Instead of guessing wrong, ask the user what they meant
            // Skip for rule-based sources (guards, overrides) which are always confident
            // 
            if (
                confidence < 0.5 &&
                domain === 'food' &&
                !CONFIDENT_SOURCES.includes(source) &&
                !sessionContext?.pendingOrder
            ) {
                const hasRestaurant = !!(sessionContext?.currentRestaurant);
                const disambiguationReply = hasRestaurant
                    ? `Nie jestem pewna, o co chodzi. Czy chcesz zamówić coś z menu ${sessionContext.currentRestaurant.name}?`
                    : 'Nie bardzo rozumiem. Mogę pokazać restauracje w pobliżu albo pomóc w zamówieniu.';

                BrainLogger.pipeline(` CONFIDENCE_FLOOR: ${intent} (${(confidence * 100).toFixed(0)}%)   disambiguation`);

                return {
                    ok: true,
                    session_id: activeSessionId,
                    intent: 'disambiguation',
                    reply: disambiguationReply,
                    should_reply: true,
                    stopTTS: false,
                    meta: {
                        source: 'confidence_floor',
                        originalIntent: intent,
                        confidence
                    },
                    context: getSession(activeSessionId) || sessionContext
                };
            }

            // 
            // TRANSACTION LOCK: Active ordering prevents foreign intents
            // If user is mid-transaction (pendingOrder or awaiting confirmation),
            // only ordering-related intents are allowed through.
            // 

            if (
                (sessionContext?.pendingOrder || sessionContext?.expectedContext === 'confirm_add_to_cart') &&
                !TRANSACTION_ALLOWED_INTENTS.includes(intent)
            ) {
                // If the user explicitly asks to find a restaurant or esc lock, allow it and clear pending
                const isExplicitEscape = EXPLICIT_ESCAPE_SOURCES.includes(source) ||
                    ['find_nearby', 'select_restaurant', 'show_menu', 'cancel_order', 'cancel'].includes(intent);

                if (isExplicitEscape && confidence >= 0.8) {
                    BrainLogger.pipeline(` TRANSACTION_LOCK: User explicitly escaped lock with intent: ${intent} (source: ${source})`);
                    // Session cleanup is owned by handlers (guard path remains pure).
                } else {
                    const lockedIntent = sessionContext.expectedContext || 'create_order';
                    BrainLogger.pipeline(` TRANSACTION_LOCK: "${intent}" blocked mid-transaction   "${lockedIntent}"`);
                    intent = lockedIntent;
                    source = 'transaction_lock_override';
                    domain = 'ordering';
                }
            }

            // 
            // FIX 2: RESTAURANT SEMANTIC RECOVERY
            // Recover restaurant from full text if NLU missed the entity
            // 
            if (!entities?.restaurant && text && sessionContext.entityCache?.restaurants) {
                const recovered = await recoverRestaurantFromFullText(
                    text,
                    sessionContext.entityCache.restaurants
                );

                if (recovered) {
                    entities = entities || {};
                    entities.restaurant = recovered.name;
                    entities.restaurantId = recovered.id;
                    BrainLogger.nlu(`  SEMANTIC_RESTAURANT_RECOVERY: Detected "${recovered.name}" from full text`);
                }
            }

            // 
            // FIX A1: MENU RESOLVER BRIDGE
            // Fuzzy-match restaurant from menu-request phrasing, BEFORE ICM gate
            // Sets entities + session lock so ICM lets menu_request through cleanly
            // 
            const menuResolvedRestaurant = resolveRestaurantFromMenuRequest(
                text,
                sessionContext,
                sessionContext.entityCache
            );

            if (menuResolvedRestaurant && !entities?.restaurantId) {
                entities = entities || {};
                entities.restaurant = menuResolvedRestaurant.name;
                entities.restaurantId = menuResolvedRestaurant.id;
                intent = 'menu_request';
                domain = 'food';
                source = 'menu_resolver';
                BrainLogger.pipeline(` MENU_RESOLVER_BRIDGE: locked to "${menuResolvedRestaurant.name}", forcing menu_request`);
                // Persist the restaurant lock immediately
                if (!IS_SHADOW) {
                    updateSession(activeSessionId, {
                        currentRestaurant: {
                            id: menuResolvedRestaurant.id,
                            name: menuResolvedRestaurant.name
                        },
                        lockedRestaurantId: menuResolvedRestaurant.id
                    });
                }
            }

            // 
            // FIX: allow implicit dish ordering without keyword
            // If we are in a restaurant context and NLU is unknown, try menu disambiguation.
            // 
            if (intent === 'unknown' && sessionContext?.currentRestaurant?.id) {
                try {
                    const resolution = await resolveMenuItemConflict(text, {
                        restaurant_id: sessionContext.currentRestaurant.id
                    });

                    if (resolution?.status === DISAMBIGUATION_RESULT.ADD_ITEM) {
                        intent = 'create_order';
                        domain = 'food';
                        source = 'implicit_dish_guard';
                        BrainLogger.pipeline(' IMPLICIT_DISH_GUARD: unknown   create_order via menu match');
                    }
                } catch (err) {
                    BrainLogger.pipeline(` IMPLICIT_DISH_GUARD failed: ${err.message}`);
                }
            }

            // 
            // ICM GATE: Validate FSM state requirements BEFORE executing intent
            // This ensures NO intent (regex/legacy/LLM) can bypass FSM
            // 
            const stateCheck = checkRequiredState(intent, sessionContext, entities);
            const originalIntent = intent; // Remember for soft dialog bridge

            if (!stateCheck.met) {
                // 
                // SOFT DIALOG BRIDGE (KROK 1 & 4): Instead of hard reset, show dialog
                // If user wants menu/order but no restaurant, and we have candidates   ASK
                // 
                const hasRestaurantsList = sessionContext?.last_restaurants_list?.length > 0;

                if (originalIntent === 'menu_request' && hasRestaurantsList) {
                    // User wants menu, we have restaurants   ask which one
                    BrainLogger.pipeline(` SOFT DIALOG BRIDGE: menu_request blocked, showing restaurant picker`);

                    const surfaceResult = renderSurface({
                        key: 'ASK_RESTAURANT_FOR_MENU',
                        facts: {
                            restaurants: sessionContext.last_restaurants_list.slice(0, 5)
                        }
                    });

                    // Set dialog focus for context tracking (KROK 2)
                    if (!IS_SHADOW) {
                        updateSession(activeSessionId, {
                            dialog_focus: 'CHOOSING_RESTAURANT_FOR_MENU',
                            expectedContext: 'select_restaurant'
                        });
                    }

                    return {
                        ok: true,
                        session_id: activeSessionId,
                        intent: 'menu_request', // Keep original intent for tracking
                        reply: surfaceResult.reply,
                        uiHints: surfaceResult.uiHints,
                        restaurants: sessionContext.last_restaurants_list.slice(0, 5),
                        should_reply: true,
                        meta: { source: 'soft_dialog_bridge', originalIntent: 'menu_request' },
                        context: getSession(activeSessionId) || sessionContext
                    };
                }

                if (originalIntent === 'create_order' && hasRestaurantsList) {
                    // User wants to order, we have restaurants   ask which one
                    BrainLogger.pipeline(` SOFT DIALOG BRIDGE: create_order blocked, showing restaurant picker`);

                    const surfaceResult = renderSurface({
                        key: 'ASK_RESTAURANT_FOR_ORDER',
                        facts: {
                            restaurants: sessionContext.last_restaurants_list.slice(0, 5),
                            dishNames: entities.dish ? [entities.dish] : []
                        }
                    });

                    // Set dialog focus and preserve pending dish (KROK 2)
                    if (!IS_SHADOW) {
                        updateSession(activeSessionId, {
                            dialog_focus: 'CHOOSING_RESTAURANT_FOR_ORDER',
                            expectedContext: 'select_restaurant',
                            pendingDish: entities.dish || sessionContext.pendingDish
                        });
                    }

                    return {
                        ok: true,
                        session_id: activeSessionId,
                        intent: 'create_order', // Keep original intent for tracking
                        reply: surfaceResult.reply,
                        uiHints: surfaceResult.uiHints,
                        restaurants: sessionContext.last_restaurants_list.slice(0, 5),
                        should_reply: true,
                        meta: { source: 'soft_dialog_bridge', originalIntent: 'create_order' },
                        context: getSession(activeSessionId) || sessionContext
                    };
                }

                // Standard fallback for other cases
                const fallbackIntent = getFallbackIntent(originalIntent);
                BrainLogger.pipeline(` ICM GATE: ${originalIntent} blocked (${stateCheck.reason}). Fallback   ${fallbackIntent}`);

                // --- Event Logging: ICM Blocked ---
                if (EXPERT_MODE && !IS_SHADOW) {
                    EventLogger.logEvent(activeSessionId, 'icm_blocked', {
                        originalIntent,
                        blockedReason: stateCheck.reason,
                        fallbackIntent
                    }, null, 'icm').catch(() => { });
                }

                intent = fallbackIntent;
                domain = getIntentDomain(fallbackIntent) || 'food';
                source = 'icm_fallback';
            }

            // 
            // CART MUTATION GUARD: Only whitelisted intents can mutate cart
            // 
            if (mutatesCart(intent) && !CART_MUTATION_WHITELIST.includes(intent)) {
                BrainLogger.pipeline(` CART GUARD: ${intent} tried to mutate cart - BLOCKED`);
                intent = 'find_nearby';
                source = 'cart_mutation_blocked';
            }

            // 
            // FIX 1: CONTEXT-AWARE LEGACY UNLOCK (SMART SAFE)
            // If restaurant context exists, allow ordering even from legacy source
            // 
            if (source === 'legacy_hard_blocked') {
                if (hasLockedRestaurant(sessionContext)) {
                    BrainLogger.pipeline(' SMART_SAFE_UNLOCK: Legacy ordering allowed (restaurant locked)');
                    intent = 'create_order';
                    source = 'smart_safe_unlock';
                } else {
                    BrainLogger.pipeline(' HARD_BLOCK: No restaurant context   fallback idle');
                    intent = 'find_nearby';
                }
            }

            // 
            // FIX 3: CONVERSATION CONTINUITY GUARD
            // Prevent idle reset when user mentions dish in ordering context
            // 
            if (
                intent === 'find_nearby' &&
                isOrderingContext(sessionContext) &&
                containsDishLikePhrase(text) &&
                !entities?.location  // EXEMPTION: explicit idle always wins
            ) {
                BrainLogger.pipeline(' CONTINUITY_GUARD_TRIGGERED: Preventing idle reset   create_order');
                intent = 'create_order';
                source = 'continuity_guard';
            }

            // 
            // FIX A3: STRONG ORDERING CONTINUITY GUARD
            // If user has a locked restaurant AND uses ordering phrases, NEVER drop to find_nearby
            // This runs AFTER FIX 3 to catch cases with explicit ordering verbs (skuszę, poprosę, etc.)
            // SAFETY: Does NOT override confirm_order
            // 
            if (
                intent === 'find_nearby' &&
                sessionContext?.currentRestaurant &&
                containsOrderingIntent(text) &&
                !entities?.location  // EXEMPTION: explicit location = user wants new idle
            ) {
                BrainLogger.pipeline(' STRONG_CONTINUITY_GUARD: ordering phrase + locked restaurant   create_order');
                intent = 'create_order';
                source = 'strong_continuity_guard';
            }

            // 
            // FIX 4: LIGHT PHASE TRACKING (MOVED  executed after handler + contextUpdates)
            // Phase is computed AFTER handler execution and contextUpdates are applied,
            // so it reflects the true updated session state (e.g. currentRestaurant from
            // SelectRestaurantHandler). See phase calculation block below.
            // 

            // 
            // FLOATING pendingOrder GUARD: Clear stale transaction state
            // If intent diverged from ordering, wipe ghost pendingOrder
            // Prevents old "tak" from adding stale items to cart
            // 
            if (sessionContext?.pendingOrder && !ORDER_INTENTS_CLEANUP.includes(intent)) {
                BrainLogger.pipeline(` FLOATING_ORDER_CLEANUP: Cleared stale pendingOrder (intent=${intent})`);
                if (!IS_SHADOW) {
                    updateSession(activeSessionId, {
                        pendingOrder: null,
                        expectedContext: null
                    });
                }
                sessionContext.pendingOrder = null;
                sessionContext.expectedContext = null;
            }

            // 
            // SAFETY TIMEOUT: Clear pendingOrder older than 60 seconds
            // Prevents ghost transactions from lingering across long pauses
            // 
            const PENDING_ORDER_TIMEOUT_MS = 60_000;
            if (sessionContext?.pendingOrder?.createdAt) {
                const age = Date.now() - sessionContext.pendingOrder.createdAt;
                if (age > PENDING_ORDER_TIMEOUT_MS) {
                    BrainLogger.pipeline(` PENDING_ORDER_TIMEOUT: Cleared after ${Math.round(age / 1000)}s`);
                    if (!IS_SHADOW) {
                        updateSession(activeSessionId, {
                            pendingOrder: null,
                            expectedContext: null
                        });
                    }
                    sessionContext.pendingOrder = null;
                    sessionContext.expectedContext = null;
                }
            }

            // 
            // IDLE RESET: find_nearby resets restaurant context
            // SAFETY: Skip reset if intent came from a blocked source (preserve context)
            // 
            const isFromBlock = source?.endsWith('_blocked') || source === 'icm_fallback';
            if (intent === 'find_nearby' && !IS_SHADOW && !isFromBlock) {
                const sessionSnap = getSession(activeSessionId);
                const hasOrphanedCart = sessionSnap?.cart && Array.isArray(sessionSnap.cart.items) && sessionSnap.cart.items.length > 0;
                const isCompleted = sessionSnap?.orderMode === 'completed';

                const resetData = {
                    currentRestaurant: null,
                    lastRestaurant: null,
                    lockedRestaurantId: null
                };

                // Clear orphaned cart when starting fresh discovery after a completed order
                if (hasOrphanedCart && isCompleted) {
                    resetData.cart = { items: [], total: 0 };
                    resetData.orderMode = 'neutral';
                    resetData.expectedContext = null;
                    resetData.pendingOrder = null;
                    BrainLogger.pipeline('🧹 IDLE RESET: Cleared orphaned cart from completed order');
                }

                updateSession(activeSessionId, resetData);
                BrainLogger.pipeline(' IDLE RESET: Cleared restaurant context for find_nearby');
            }

            // 
            // CHOOSE_RESTAURANT DIALOG: When ambiguous restaurants, show picker
            // 
            if (intent === 'choose_restaurant' && entities?.options?.length > 0) {
                BrainLogger.pipeline(` CHOOSE_RESTAURANT: Showing picker for ${entities.options.length} restaurants`);

                const restaurants = entities.options.map(opt => ({
                    id: opt.restaurant_id,
                    name: opt.restaurant_name,
                    items: opt.items
                }));

                const surfaceResult = renderSurface({
                    key: 'ASK_RESTAURANT_FOR_ORDER',
                    facts: {
                        restaurants: restaurants,
                        dishNames: entities.parsedOrder?.available?.map(i => i.name) || []
                    }
                });

                // Set dialog focus and save restaurants list
                if (!IS_SHADOW) {
                    updateSession(activeSessionId, {
                        dialog_focus: 'CHOOSING_RESTAURANT_FOR_ORDER',
                        expectedContext: 'select_restaurant',
                        last_restaurants_list: restaurants,
                        pendingDish: entities.parsedOrder?.available?.[0]?.name || sessionContext.pendingDish
                    });
                }

                return {
                    ok: true,
                    session_id: activeSessionId,
                    intent: 'choose_restaurant',
                    reply: surfaceResult.reply,
                    uiHints: surfaceResult.uiHints,
                    restaurants: restaurants,
                    should_reply: true,
                    meta: { source: 'choose_restaurant_dialog', ambiguous: true },
                    context: getSession(activeSessionId) || sessionContext
                };
            }
            // 
            // PRE-HANDLER CONTEXT OVERRIDE: Fast-track clarify_order with location
            // 
            if (intent === 'clarify_order' && !sessionContext?.currentRestaurant && (sessionContext?.conversationPhase === 'idle' || !sessionContext?.conversationPhase)) {
                try {
                    const { supabase } = await import('../../_supabase.js');
                    const { data } = await supabase
                        .from('restaurants')
                        .select('city')
                        .eq('is_active', true);
                    if (data) {
                        const cities = [...new Set(data.map(d => d.city).filter(Boolean))].map(c => c.toLowerCase());
                        const lowerText = text.toLowerCase();
                        if (cities.some(city => lowerText.includes(city))) {
                            BrainLogger.pipeline(` PRE-HANDLER OVERRIDE: Location found in clarify_order -> find_nearby`);
                            intent = 'find_nearby';
                            source = 'context_override_location';
                            if (!context.trace) context.trace = [];
                            context.trace.push('clarify_resolved:find_nearby:location_match');
                        }
                    }
                } catch (e) {
                    BrainLogger.pipeline(` PRE-HANDLER OVERRIDE error: ${e.message}`);
                }
            }

            // SCOPED_ZUREK_ORDER_BRIDGE: keep order path for Stara Kamienica when Zurek is unavailable in parser stage.
            if (intent === 'clarify_order') {
                const restaurantName = (sessionContext?.currentRestaurant?.name || sessionContext?.lastRestaurant?.name || '').toLowerCase();
                const normalizedOrderText = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const isStaraKamienica = restaurantName.includes('restauracja stara kamienica');
                const isZurekLike = normalizedOrderText.includes('zurek') || normalizedOrderText.includes('urek') || normalizedOrderText.includes('zur');

                if (isStaraKamienica && isZurekLike) {
                    BrainLogger.pipeline('SCOPED_ZUREK_ORDER_BRIDGE: clarify_order -> create_order');
                    intent = 'create_order';
                    source = 'scoped_zurek_order_bridge';
                    entities = {
                        ...(entities || {}),
                        dish: entities?.dish || text
                    };
                    if (!context.trace) context.trace = [];
                    context.trace.push('clarify_resolved:create_order:zurek_bridge');
                }
            }



            context.intent = intent;
            context.domain = getIntentDomain(intent) || domain || 'food';
            context.entities = entities || {};
            context.confidence = confidence;
            context.source = source;

            // --- RESTAURANT PRIORITY RESOLUTION (Utterance > Session) ---
            const resolvedRestaurant =
                entities?.restaurant ||           // 1. Utterance (explicit mention)
                entities?.restaurantId ||         // 2. Catalog match ID
                session?.currentRestaurant ||     // 3. Session persistent
                session?.lastRestaurant;          // 4. Fallback

            context.resolvedRestaurant = resolvedRestaurant;

            // --- UX GUARDS (Dialog State Polish) ---

            // UX Guard 1: Menu-Scoped Ordering
            // If user is in menu flow with restaurant context, allow ordering
            // SAFETY: NEVER upgrade if intent was BLOCKED (source ends with '_blocked' or 'icm_fallback')
            const isBlocked = context.source?.endsWith('_blocked') || context.source === 'icm_fallback';
            if (context.intent === 'find_nearby' && !isBlocked) {
                const hasRestaurantContext = session?.currentRestaurant || session?.lastRestaurant;
                const wasMenuFlow = session?.lastIntent === 'menu_request' ||
                    session?.expectedContext === 'restaurant_menu' ||
                    session?.expectedContext === 'continue_order';

                if (hasRestaurantContext && wasMenuFlow) {
                    BrainLogger.pipeline(' UX Guard 1: Menu-scoped ordering. Upgrading find_nearby -> create_order with currentRestaurant.');
                    context.intent = 'create_order';
                    context.source = 'menu_scoped_order';
                    context.resolvedRestaurant = session.currentRestaurant || session.lastRestaurant;
                }
            } else if (isBlocked) {
                BrainLogger.pipeline(` UX Guard 1 SKIPPED: Intent was blocked (source: ${context.source})`);
            }

            // UX Guard 2: Fuzzy Restaurant Confirmation
            // If user mentions a restaurant name similar to currentRestaurant, ask for confirmation
            if (context.intent === 'find_nearby' && session?.currentRestaurant && entities?.restaurant) {
                const currentName = (session.currentRestaurant.name || '').toLowerCase();
                const mentionedName = (entities.restaurant || '').toLowerCase();

                // Simple fuzzy: first 4 chars match or partial include
                const isSimilar = currentName.substring(0, 4) === mentionedName.substring(0, 4) ||
                    currentName.includes(mentionedName.substring(0, 5)) ||
                    mentionedName.includes(currentName.substring(0, 5));

                if (isSimilar && currentName !== mentionedName) {
                    BrainLogger.pipeline(` UX Guard 2: Fuzzy match detected. Asking confirmation for ${session.currentRestaurant.name}`);
                    return {
                        session_id: activeSessionId,
                        reply: `Czy chodziło Ci o ${session.currentRestaurant.name}?`,
                        should_reply: true,
                        intent: 'confirm_restaurant',
                        contextUpdates: {
                            expectedContext: 'confirm_restaurant',
                            pendingRestaurantConfirm: session.currentRestaurant
                        },
                        meta: { source: 'ux_guard_fuzzy_confirm' },
                        context: getSession(activeSessionId) || sessionContext
                    };
                }
            }

            // --- GUARDS ---

            // Rule: Explicit clear cart command (backend session SSoT)
            // Handles "wyczysc koszyk" from UI button so session.cart cannot resurrect after refresh.
            const normalizedInput = (text || "")
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .trim();

            const isClearCartCommand = isExplicitClearCartCommand(text);

            if (isClearCartCommand) {
                const clearedCart = { items: [], total: 0 };
                const nextPhase = sessionContext?.currentRestaurant ? 'restaurant_selected' : 'idle';
                if (!IS_SHADOW) {
                    updateSession(activeSessionId, {
                        cart: clearedCart,
                        pendingOrder: null,
                        expectedContext: null,
                        pendingRestaurantSwitch: null,
                        conversationPhase: nextPhase
                    });
                }

                return {
                    ok: true,
                    session_id: activeSessionId,
                    intent: 'clear_cart',
                    reply: 'Wyczyscilam koszyk.',
                    should_reply: true,
                    actions: [{ type: 'CLEAR_CART' }],
                    cart: clearedCart,
                    meta: {
                        source: 'clear_cart_command',
                        cart: clearedCart
                    },
                    context: getSession(activeSessionId) || sessionContext
                };
            }

            // Rule: Restaurant name should select restaurant, not create order.
            // Fixes cases like "calzone" being interpreted as add dish when cart/context is active.
            if (
                context.intent === 'create_order' &&
                context.entities?.restaurant &&
                context.entities?.restaurantId &&
                !context.entities?.dish
            ) {
                const hasExplicitOrderVerb = /\b(zamawiam|zamow|zamowic|zamowie|dodaj|poprosze|poprosz|wezme|wez|chce|chcialbym|chcialabym|do\s+koszyka)\b/i.test(normalizedInput);
                const hasExplicitQty = /\b\d+\s*(x|razy|szt|szt\.|sztuk)?\b/i.test(normalizedInput);

                if (!hasExplicitOrderVerb && !hasExplicitQty) {
                    BrainLogger.pipeline('Guard: restaurant mention without order verb -> forcing select_restaurant');
                    context.intent = 'select_restaurant';
                    context.domain = 'food';
                    context.source = 'restaurant_name_guard';
                }
            }

            // Rule: Confirm Guard
            // Rule: Confirm Guard (General confirmation words handler)
            if (CONFIRMATION_CONTEXTS.includes(session?.expectedContext)) {
                const normalized = (text || "").toLowerCase();
                const confirmWords = /\b(tak|potwierdzam|ok|dobra|może być|dawaj|pewnie|jasne|super|świetnie)\b/i;
                if (confirmWords.test(normalized)) {
                    const targetIntent = session.expectedContext; // Dynamically use the context name as intent name
                    BrainLogger.pipeline(` Guard: Context is ${targetIntent} and confirmation word detected. Forcing ${targetIntent}.`);
                    context.intent = targetIntent;
                }
            }

            // Rule: Restaurant Switch Confirmation
            if (session?.expectedContext === 'confirm_restaurant_switch') {
                const normalized = (text || "").toLowerCase();
                const confirmWords = /\b(tak|potwierdzam|ok|dobra|może być|dawaj|pewnie|jasne|super|świetnie|zmieniaj|wyczyść)\b/i;
                const negateWords = /\b(nie|pocz[eę]kaj|stop|anuluj|nie\s+chc[eę]|zostaw)\b/i;

                if (confirmWords.test(normalized)) {
                    BrainLogger.pipeline(' Guard: Context is confirm_restaurant_switch and confirmation word detected. Executing clear + switch.');

                    const target = session.pendingRestaurantSwitch;

                    // 1. Clear cart in session
                    if (!IS_SHADOW) {
                        updateSession(sessionId, {
                            cart: { items: [], total: 0 },
                            pendingRestaurantSwitch: null
                        });
                    }

                    // 2. Force select_restaurant intent with target
                    context.intent = 'select_restaurant';
                    context.domain = 'food';
                    context.entities = {
                        ...context.entities,
                        restaurantId: target.id,
                        restaurant: target.name,
                        location: target.city,
                        forceSwitch: true // Bypass safety check in SelectRestaurantHandler
                    };
                } else if (negateWords.test(normalized)) {
                    BrainLogger.pipeline(' Guard: Context is confirm_restaurant_switch and negation word detected. Cancelling switch.');
                    return {
                        ok: true,
                        session_id: activeSessionId,
                        reply: "Dobrze, zostajemy przy obecnym zamówieniu. Co jeszcze chcesz dodać?",
                        should_reply: true,
                        intent: 'cancel_switch',
                        contextUpdates: {
                            expectedContext: 'create_order',
                            pendingRestaurantSwitch: null
                        },
                        meta: { source: 'switch_cancelled' },
                        context: getSession(activeSessionId) || sessionContext
                    };
                }
            }

            // Rule 4: Auto Menu
            if (context.intent === 'select_restaurant') {
                const normalized = (text || "").toLowerCase();
                const wantsToSee = /\b(pokaz|pokaż|zobacz|jakie|co)\b/i.test(normalized);
                const wantsChange = /\b(inn[ea]|zmień|wybierz\s+inne)\b/i.test(normalized);

                if (wantsToSee && !wantsChange) {
                    BrainLogger.pipeline(' Guard Rule 4: "Show" verb detected. Upgrading select_restaurant -> menu_request');
                    context.intent = 'menu_request';
                }
            }

            // Rule 2: Early Dish Detection
            if (context.intent === 'create_order') {
                const ent = context.entities || {};
                const normalized = (text || "").toLowerCase();
                const strictOrderVerbs = /\b(zamawiam|wezm[ęe]|dodaj|poprosz[ęe]|chc[ęe])\b/i;
                const hasOrderVerb = strictOrderVerbs.test(normalized);
                const isAffirmationRepeat = context.source === 'ordering_affirmation_repeat';

                if (!hasOrderVerb && !session?.pendingOrder && !session?.expectedContext && !isAffirmationRepeat) {
                    BrainLogger.pipeline(' Guard Rule 2: Implicit order without verb. Downgrading to find_nearby/menu_request.');
                    if (ent?.dish || ent?.items?.length) {
                        context.intent = 'menu_request';
                    } else {
                        return {
                            session_id: activeSessionId,
                            reply: "Co chciałbyś zamówić?",
                            should_reply: true,
                            intent: 'create_order',
                            meta: { source: 'guard_rule_2_explicit_prompt' },
                            context: getSession(activeSessionId) || sessionContext
                        };
                    }
                }

                // --- RULE 6: Empty Order / Adjective Guard ---
                if (context.intent === 'create_order') {
                    // Check if we have items or dish
                    // Re-read items directly from parser if needed, but entity should have it
                    // Simple check: if ent.items is empty and ent.dish is empty -> Problem
                    const hasItems = ent?.items && ent.items.length > 0;
                    const hasExplicitDish = ent?.dish || (hasItems && ent.items[0]?.name !== 'Unknown');

                    if (!hasExplicitDish && !hasItems && hasOrderVerb) {
                        // Opcja B: Exception for longer text (potential dish name not yet parsed)
                        const stripped = normalized.replace(strictOrderVerbs, '').trim();
                        if (stripped.length > 2) {
                            BrainLogger.pipeline(` Guard Rule 6: Passing potential dish "${stripped}" to handlers despite missing entities.`);
                            // Do NOT return here. Let it pass to OrderHandler which will call parseOrderItems
                        } else {
                            BrainLogger.pipeline(' Guard Rule 6: Order intent with no explicit dish. Asking for details.');
                            return {
                                session_id: activeSessionId,
                                reply: "Co dokładnie chciałbyś zamówić?",
                                should_reply: true,
                                intent: 'create_order',
                                meta: { source: 'guard_rule_6_no_dish' },
                                context: getSession(activeSessionId) || sessionContext
                            };
                        }
                    }
                }
            }

            // Zombie Kill Switch
            if (session?.status === 'COMPLETED' && !IS_SHADOW) {
                if (!['new_order', 'start_over', 'help'].includes(context.intent)) {
                    return {
                        ok: true,
                        intent: 'session_locked',
                        reply: "Twoje zamówienie zostało już zakończone. Powiedz 'nowe zamówienie', aby zacząć od początku.",
                        meta: { source: 'guard_lock' },
                        context: getSession(activeSessionId) || sessionContext
                    };
                }
                // Reset session if intent is allowed
                updateSession(sessionId, { status: 'active', pendingOrder: null, lockedRestaurantId: null, context: 'neutral' });
            }

            // Update session (Short-term memory)
            if (!IS_SHADOW) {
                updateSession(sessionId, { lastIntent: context.intent, lastUpdated: Date.now() });
            }

            // 3. Domain Dispatching
            if (!this.handlers[context.domain]) {
                return this.createErrorResponse('unknown_domain', 'Nie wiem jak to obsłużyć (błąd domeny).');
            }

            // FIX A4: SANITIZE LOCATION before find_nearby dispatch
            if (context.intent === 'find_nearby' && context.entities?.location) {
                const rawLocation = context.entities.location;
                context.entities.location = sanitizeLocation(rawLocation, session);
                if (context.entities.location !== rawLocation) {
                    BrainLogger.pipeline(` LOCATION_SANITIZED: "${rawLocation}"   "${context.entities.location}"`);
                }
            }

            // CLARIFY_ORDER SAFETY GUARD: prevent clarify_order from reaching dispatch
            // when there is no restaurant context (would dead-end the conversation).
            // Must run BEFORE IntentFreeze so the redirect is still possible.
            if (context.intent === 'clarify_order' && !sessionContext?.currentRestaurant && !sessionContext?.lastRestaurant) {
                const hadResolvedClarify = (context.trace || []).some(t => t.startsWith('clarify_resolved:'));
                if (!hadResolvedClarify) {
                    BrainLogger.pipeline('[CLARIFY_GUARD] clarify_order with no restaurant context -> find_nearby');
                    context.intent = 'find_nearby';
                    context.source = 'clarify_guard_no_restaurant';
                    context.trace.push('clarify_resolved:find_nearby:guard_no_restaurant');
                }
            }

            // Deterministic dispatch contract:
            // NLU + guards + bridges may mutate intent up to this point.
            // From here, dispatch intent is locked and cannot be changed.
            const isOrderingTransactionIntent =
                ORDER_INTENTS.includes(context.intent) ||
                (context.intent === 'select_restaurant' && (sessionContext?.pendingOrder || sessionContext?.expectedContext === 'confirm_add_to_cart'));

            context.intentGroup = isOrderingTransactionIntent ? 'ordering_transaction' : 'general';
            context.dispatchIntentLocked = true;
            context.intentFinalized = true;
            context.trace.push(`intent_finalized:${context.intent}`);

            let dispatchIntent = context.intent;
            Object.defineProperty(context, 'intent', {
                configurable: true,
                enumerable: true,
                get() {
                    return dispatchIntent;
                },
                set(nextIntent) {
                    if (nextIntent === dispatchIntent) return true;

                    const stage = context.intentMutationStage || 'post_dispatch_lock';
                    const oldIntent = dispatchIntent;
                    console.warn('[ORDER_INTENT_MUTATION_BLOCKED]', JSON.stringify({
                        from: oldIntent,
                        to: nextIntent,
                        stage,
                        sessionId: activeSessionId,
                        trace: context.trace,
                    }));
                    BrainLogger.pipeline(
                        `[DISPATCH_INTENT_LOCKED] blocked intent mutation "${oldIntent}" -> "${nextIntent}" | stage=${stage} | session=${activeSessionId} | trace=${(context.trace || []).join(' > ')}`
                    );
                    context.trace.push(`intent_mutation_blocked:${stage}:${oldIntent}->${nextIntent}`);
                    return true;
                }
            });

            intent = dispatchIntent;
            domain = context.domain;

            const { domainHandlers, handler } = HandlerDispatcher.resolve({
                handlers: this.handlers,
                context,
            });
            if (!domainHandlers[context.intent]) {
                console.log('[KROK5-DEBUG] missing handler', JSON.stringify({ intent: context.intent, domain: context.domain, entities: context.entities || null }));
            }
            context.trace.push(`handler:${context.intent}`);
            context.stateMutationCompleted = false;

            // â”€â”€ Cart snapshot BEFORE handler (for semantic cartMutated detection) â”€â”€
            const preHandlerSession = getSession(activeSessionId) || {};
            const preCartItemCount = (preHandlerSession.cart?.items || []).length;
            const preCartTotal = preHandlerSession.cart?.total || 0;

            const domainResponse = await HandlerDispatcher.executeTransactional({
                handler,
                context,
                applyContextUpdates: !IS_SHADOW ? (contextUpdates) => {
                    updateSession(activeSessionId, contextUpdates);
                } : null,
            });
            context.stateMutationCompleted = true;

            // OrderMode FSM integration (minimal): transition state after handler dispatch.
            const preOrderMode = preHandlerSession?.orderMode || ORDER_MODE_STATE.NEUTRAL;
            const outcomeIntent = domainResponse?.intent || context.intent;
            const orderModeEvent = mapOrderModeEvent({
                intent: outcomeIntent,
                preState: preOrderMode,
                domainResponse,
            });
            const orderModeTransition = transitionOrderMode(preOrderMode, orderModeEvent, {
                intent: outcomeIntent,
                expectedContext: domainResponse?.contextUpdates?.expectedContext || null,
            });

            context.orderMode = orderModeTransition.state;
            context.trace.push(`order_mode_event:${orderModeEvent}`);
            context.trace.push(`order_mode_state:${orderModeTransition.previousState}->${orderModeTransition.state}`);

            const orderModeTrace = {
                previousState: orderModeTransition.previousState,
                event: orderModeEvent,
                nextState: orderModeTransition.state,
                allowed: orderModeTransition.allowed,
                changed: orderModeTransition.changed,
                intent: outcomeIntent,
            };
            context.orderModeTrace = orderModeTrace;
            context.trace.push(`ORDER_MODE_TRACE:${JSON.stringify(orderModeTrace)}`);

            if (orderModeEvent !== ORDER_MODE_EVENT.NOOP && !orderModeTransition.allowed) {
                BrainLogger.pipeline(
                    `[ORDER_MODE_FSM] blocked ${orderModeTransition.previousState} --${orderModeEvent}--> ${orderModeTransition.state}`
                );
            }

            if (!IS_SHADOW) {
                updateSession(activeSessionId, {
                    orderMode: orderModeTransition.state,
                });
            }

            // 
            // LOCATION COMMIT: Write entities.location to session BEFORE surface detection
            // Prevents ASK_LOCATION from firing when handler already used the location
            // 
            if (context.intent === 'find_nearby' && context.entities?.location && !IS_SHADOW) {
                const confirmedLocation = context.entities.location;
                BrainLogger.pipeline(` LOCATION_COMMIT: "${confirmedLocation}"   session`);
                updateSession(sessionId, {
                    last_location: confirmedLocation,
                    currentLocation: confirmedLocation,
                    awaiting: null,
                    expectedContext: null
                });
                // Also update the in-memory session snapshot so detectSurface sees it
                sessionContext.last_location = confirmedLocation;
                sessionContext.currentLocation = confirmedLocation;
                sessionContext.awaiting = null;
                sessionContext.expectedContext = null;
            }

            // 
            // DIALOG SURFACE LAYER: Transform structured facts to natural Polish
            // Pipeline is SSoT, Surface is presentation only
            // Detect actionable cases and render appropriate reply
            // 
            const detectedSurface = detectSurface(domainResponse, context);

            if (detectedSurface) {
                const surfaceResult = renderSurface(detectedSurface);

                //  PhraseGenerator: LLM paraphrasing with template fallback
                // Constraint: no session access, no intent change, only {spokenText, ssml}
                let finalReply = surfaceResult.reply;
                let ssml = null;

                if (EXPERT_MODE && !IS_SHADOW && config?.phrase_generator_enabled !== false) {
                    try {
                        const phraseResult = await generatePhrase({
                            surfaceKey: detectedSurface.key,
                            facts: detectedSurface.facts,
                            templateText: surfaceResult.reply
                        });
                        if (phraseResult?.spokenText) {
                            finalReply = phraseResult.spokenText;
                            ssml = phraseResult.ssml;
                            BrainLogger.pipeline(` PhraseGenerator: paraphrased to "${finalReply.substring(0, 50)}..."`);
                        }
                    } catch (phraseErr) {
                        // Fallback to template (determinism preserved)
                        BrainLogger.pipeline(` PhraseGenerator fallback: ${phraseErr.message}`);
                    }
                }

                // Override reply with rendered/paraphrased text, keep structured data
                domainResponse.reply = finalReply;
                domainResponse.ssml = ssml;
                domainResponse.uiHints = surfaceResult.uiHints;

                BrainLogger.pipeline(` SurfaceRenderer: ${detectedSurface.key}   "${finalReply.substring(0, 50)}..."`);

                // --- Event Logging: Surface Rendered ---
                if (EXPERT_MODE && !IS_SHADOW) {
                    EventLogger.logEvent(activeSessionId, 'surface_rendered', {
                        surfaceKey: detectedSurface.key,
                        replyPreview: finalReply?.substring(0, 100),
                        usedPhraseGenerator: finalReply !== surfaceResult.reply
                    }, null, 'dialog').catch(() => { });
                }

                // 
                // DIALOG STACK: Push rendered surface for BACK/REPEAT navigation
                // 
                if (!IS_SHADOW) {
                    pushDialogStack(sessionContext, {
                        surfaceKey: detectedSurface.key,
                        facts: detectedSurface.facts,
                        renderedText: surfaceResult.reply
                    });
                    updateSession(sessionId, {
                        dialogStack: sessionContext.dialogStack,
                        dialogStackIndex: sessionContext.dialogStackIndex
                    });
                }
            }
            // 
            // FIX 4: LIGHT PHASE TRACKING (post-handler, post-contextUpdates)
            // Phase is now calculated AFTER:
            //   1) ICM gate determined finalIntent (variable `intent` at this point)
            //   2) handler.execute() ran (may have set currentRestaurant, etc.)
            //   3) contextUpdates were applied to session (state is now fully updated)
            // This prevents conversationPhase='restaurant_selected' while
            // currentRestaurant is still null.
            // 
            if (!IS_SHADOW) {
                // Read updated session state AFTER contextUpdates were applied
                const updatedSessionContext = getSession(activeSessionId) || sessionContext;

                let newPhase = calculatePhase(
                    intent,                                              // finalIntent: post-ICM
                    updatedSessionContext.conversationPhase || 'idle', // current phase from updated session
                    source
                );

                //  BACKEND-SIDED CART INSPECTION (Fix "Dodatkowo: Jeśli restauracja nie istnieje w session, wyciągnąć z cart[0]")
                const requestBody = options?.requestBody || {};
                const cartMeta = requestBody.meta?.state?.cart;

                if (newPhase === 'ordering' && cartMeta?.items?.length > 0) {
                    if (!updatedSessionContext.currentRestaurant) {
                        const fallbackId = cartMeta.restaurantId || cartMeta.items[0].restaurantId || cartMeta.items[0].restaurant_id;
                        const fallbackName = cartMeta.restaurantName || cartMeta.items[0].restaurantName || cartMeta.items[0].restaurant?.name || 'Nieznana restauracja';

                        if (fallbackId || fallbackName) {
                            BrainLogger.pipeline(` PHASE_SAFETY_GUARD: ordering z koszykiem > 0, przywrócono currentRestaurant z koszyka (${fallbackName})`);
                            updatedSessionContext.currentRestaurant = { id: fallbackId, name: fallbackName };
                        }
                    }
                }

                //  SAFETY GUARD: restaurant_selected requires currentRestaurant to be set.
                // If handler did NOT actually persist a restaurant (e.g. select failed) AND we didn't recover from cart,
                // fall back to 'idle' to prevent phase/state desync.
                if (newPhase === 'restaurant_selected' && !updatedSessionContext?.currentRestaurant) {
                    BrainLogger.pipeline(`  PHASE_SAFETY_GUARD: restaurant_selected requested but currentRestaurant=null   fallback to 'idle'`);
                    newPhase = 'idle';
                }

                if (newPhase !== updatedSessionContext.conversationPhase) {
                    updateSession(activeSessionId, { conversationPhase: newPhase });
                    BrainLogger.pipeline(` PHASE_TRANSITION: ${updatedSessionContext.conversationPhase || 'idle'}   ${newPhase}`);
                }
            }

            // --- SHADOW MODE EXIT ---
            if (IS_SHADOW) {
                return {
                    intent: context.intent,
                    domain: context.domain,
                    reply: domainResponse.reply,
                    meta: {
                        latency_ms: Date.now() - startTime,
                        source,
                        confidence,
                        guard_trace: executedGuardNames,
                        pipeline_trace: context.trace,
                    },
                    mockContextUpdates: domainResponse.contextUpdates,
                    rawResponse: domainResponse
                };
            }

            // 4.5 Synthesis (Expert Layer  dev mode only)
            devLog(` PIPELINE FINAL REPLY [${context.intent}]:`, JSON.stringify(domainResponse.reply)?.substring(0, 120));
            let speechText = domainResponse.reply;
            let audioContent = null;
            let stylingMs = 0;
            let ttsMs = 0;

            if ((EXPERT_MODE || options.stylize) && domainResponse.reply) {
                // STYLIZATION GUARD: Skip for data-heavy intents and numbered lists
                const SKIP_STYLIZATION = new Set(['find_nearby', 'menu_request', 'confirm_order', 'show_menu']);
                const hasNumberedList = /\d+\.\s/.test(domainResponse.reply);
                if (SKIP_STYLIZATION.has(intent) || hasNumberedList) {
                    devLog(` STYLIZATION_SKIPPED: intent=${intent}, hasList=${hasNumberedList}`);
                } else {
                    const t0 = Date.now();
                    speechText = await stylizeWithGPT4o(domainResponse.reply, intent);
                    stylingMs = Date.now() - t0;
                }
            }

            // Optimization for Voice Presentations:
            // Intelligent TTS Summary Layer
            let speechPartForTTS = speechText;

            if (domainResponse?.restaurants?.length) {
                const loc = domainResponse.location || (domainResponse.contextUpdates && domainResponse.contextUpdates.last_location) || null;
                const summary = buildRestaurantSummaryForTTSV2(
                    domainResponse.restaurants,
                    loc
                );
                if (summary) {
                    speechPartForTTS = summary;
                    BrainLogger.pipeline(` Smart TTS Restaurant Summary: "${speechPartForTTS.substring(0, 50)}..."`);
                }
            } else if (domainResponse?.menuItems?.length) {
                const summary = buildMenuSummaryForTTSV2(
                    domainResponse.menuItems
                );
                if (summary) {
                    speechPartForTTS = summary;
                    BrainLogger.pipeline(` Smart TTS Menu Summary: "${speechPartForTTS.substring(0, 50)}..."`);
                }
            }

            // Respect options or default to false
            const wantsTTS = options.includeTTS === true;
            const hasReply = domainResponse.should_reply !== false; // Default true
            const ttsEnabled = config?.tts_enabled === true; // Strict check: defaults to false if undefined or null, only true if explicitly true

            if (hasReply && (wantsTTS || EXPERT_MODE) && ttsEnabled) {
                if (speechPartForTTS) {
                    try {
                        //   TTS: Odtwarzamy całe wygenerowane streszczenie (celowo wyłączone chunkowanie)
                        const ttsText = speechPartForTTS;

                        const t0 = Date.now();
                        audioContent = await playTTS(ttsText, options.ttsOptions || {});
                        ttsMs = Date.now() - t0;

                        BrainLogger.pipeline(`  TTS Generated: "${ttsText.substring(0, 30)}..." (${ttsMs}ms)`);
                    } catch (err) {
                        BrainLogger.pipeline(` TTS failed: ${err.message}`);
                    }
                }
            }

            const totalLatency = Date.now() - startTime;
            // 5. Response Synthesis (Legacy Parity)
            const { response, restaurants, menuItems } = ResponseBuilder.build({
                domainResponse,
                activeSessionId,
                speechText,
                speechPartForTTS,
                audioContent,
                intent,
                source,
                totalLatency,
                stylingMs,
                ttsMs,
                getSession,
            });

            response.meta = {
                ...(response.meta || {}),
                guard_trace: executedGuardNames,
                pipeline_trace: context.trace,
                orderModeTrace: context.orderModeTrace || null,
                ORDER_MODE_TRACE: context.orderModeTrace || null,
            };

            const checkoutProgress = response?.meta?.checkoutProgress || null;
            const checkoutProgressTrace = {
                phase: response.phase || null,
                completion: checkoutProgress?.completion ?? null,
                complete: checkoutProgress?.complete ?? null,
                readyToSubmit: checkoutProgress?.readyToSubmit ?? null,
                missingFields: Array.isArray(checkoutProgress?.missingFields) ? checkoutProgress.missingFields : [],
            };
            context.checkoutProgressTrace = checkoutProgressTrace;
            response.meta.checkoutProgressTrace = checkoutProgressTrace;
            response.meta.CHECKOUT_PROGRESS_TRACE = checkoutProgressTrace;
            context.trace.push(`CHECKOUT_PROGRESS_TRACE:${JSON.stringify(checkoutProgressTrace)}`);

            if (domainResponse?.meta?.restaurantLockTrace) {
                response.meta.restaurantLockTrace = domainResponse.meta.restaurantLockTrace;
                response.meta.RESTAURANT_LOCK_TRACE = domainResponse.meta.restaurantLockTrace;
                context.trace.push(`RESTAURANT_LOCK_TRACE:${JSON.stringify(domainResponse.meta.restaurantLockTrace)}`);
            }

            // â”€â”€ Cart Sync Event â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            // After every COMMITTED cart mutation, emit EVENT_CART_UPDATED.
            // Uses SEMANTIC detection: compare cart before/after handler execution.
            // Whitelist kept as secondary signal for handlers that mutate in-place.
            // Guards:
            //   - stateMutationCompleted === true
            //   - cart actually changed (semantic) OR intent in CART_MUTATION_WHITELIST
            const postCartSession = getSession(activeSessionId) || {};
            const postCartItemCount = (postCartSession.cart?.items || []).length;
            const postCartTotal = postCartSession.cart?.total || 0;
            const cartActuallyChanged = postCartItemCount !== preCartItemCount
                || postCartTotal !== preCartTotal;

            context.cartMutated = cartActuallyChanged;
            const cartEventTrace = {
                emitted: false,
                stateMutationCompleted: context.stateMutationCompleted === true,
                intent,
                detectedBy: cartActuallyChanged ? 'snapshot_diff' : 'whitelist',
                pre: { itemCount: preCartItemCount, total: preCartTotal },
                post: { itemCount: postCartItemCount, total: postCartTotal },
                cartVersion: null,
                totalItems: null,
                totalPrice: null,
            };

            if (
                context.stateMutationCompleted === true &&
                (context.cartMutated || CART_MUTATION_WHITELIST.includes(intent))
            ) {
                const cartSnap = postCartSession.cart || { items: [], total: 0 };
                const cartItems = cartSnap.items || [];

                // cartVersion: monotonic counter for optimistic UI / out-of-order rejection
                if (typeof postCartSession.cartVersion !== 'number') {
                    postCartSession.cartVersion = 0;
                }
                postCartSession.cartVersion++;
                const cartVersion = postCartSession.cartVersion;

                const totalItems = cartItems.reduce((s, i) => s + (i.qty || i.quantity || 1), 0);
                const totalPrice = cartSnap.total || 0;
                cartEventTrace.emitted = true;
                cartEventTrace.cartVersion = cartVersion;
                cartEventTrace.totalItems = totalItems;
                cartEventTrace.totalPrice = totalPrice;

                // lastAdded: ONLY from handler-set session.meta.lastCartMutation
                // No items[last] fallback â€” too fragile for batch/merge/reorder
                const lastMutation = postCartSession.meta?.lastCartMutation || null;
                const lastAdded = lastMutation?.name || null;

                response.events = [
                    ...(response.events || []),
                    {
                        type: 'EVENT_CART_UPDATED',
                        channel: 'ui_sync',
                        payload: { totalItems, totalPrice, lastAdded, cartVersion }
                    }
                ];

                // menuBehavior: handler can override (e.g. forceClose after confirm_order)
                // pipeline only provides a safe default
                response.meta.menuBehavior ??= 'preserve';

                EventLogger.logEvent(activeSessionId, 'cart_updated', {
                    intent, totalItems, totalPrice, cartVersion,
                    detectedBy: cartActuallyChanged ? 'snapshot_diff' : 'whitelist'
                }, null, 'cart').catch(() => {});

                context.trace.push(`cart_event:v=${cartVersion}:items=${totalItems}:price=${totalPrice}:by=${cartActuallyChanged ? 'diff' : 'wl'}`);
            }
            context.cartEventTrace = cartEventTrace;
            response.meta.cartEventTrace = cartEventTrace;
            response.meta.CART_EVENT_TRACE = cartEventTrace;
            context.trace.push(`CART_EVENT_TRACE:${JSON.stringify(cartEventTrace)}`);

            // â”€â”€ Order Completed Event â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            // After confirm_order, emit lifecycle event so frontend can:
            //   - clear local cart
            //   - reset ordering FSM
            //   - prompt "Chcesz zamówić jeszcze coś?"
            if (
                intent === 'confirm_order' &&
                context.stateMutationCompleted === true
            ) {
                const orderSession = getSession(activeSessionId) || {};
                const orderCart = orderSession.cart || { items: [], total: 0 };
                const completionSnapshot = domainResponse?.meta?.orderCompletion || {};
                const completedRestaurantId = completionSnapshot.restaurantId
                    ?? orderSession.restaurantContext?.id
                    ?? orderSession.currentRestaurant?.id
                    ?? orderSession.lastRestaurant?.id
                    ?? null;
                const completedRestaurantName = completionSnapshot.restaurantName
                    ?? orderSession.restaurantContext?.name
                    ?? orderSession.currentRestaurant?.name
                    ?? orderSession.lastRestaurant?.name
                    ?? null;
                const completedTotal = completionSnapshot.total ?? orderCart.total ?? 0;
                const completedItemCount = completionSnapshot.itemCount ?? (orderCart.items || []).length;

                response.events = [
                    ...(response.events || []),
                    {
                        type: 'EVENT_ORDER_COMPLETED',
                        channel: 'ui_sync',
                        payload: {
                            restaurantId: completedRestaurantId,
                            restaurantName: completedRestaurantName,
                            total: completedTotal,
                            itemCount: completedItemCount
                        }
                    }
                ];

                // After order completion, UI should close menu
                response.meta.menuBehavior = 'forceClose';

                EventLogger.logEvent(activeSessionId, 'order_completed', {
                    intent, total: completedTotal
                }, null, 'order').catch(() => {});

                // Lifecycle reset: keep cart, but reset restaurant/menu/order mode context.
                updateSession(activeSessionId, {
                    restaurantContext: null,
                    currentRestaurant: null,
                    lastRestaurant: null,
                    lastMenuItems: [],
                    lastMenu: [],
                    pendingOrder: null,
                    pendingDish: null,
                    awaiting: null,
                    expectedContext: null,
                    conversationPhase: 'idle',
                    orderMode: ORDER_MODE_STATE.NEUTRAL,
                    lastOrderCompletedAt: Date.now(),
                });
                context.trace.push('order_completed_event');
                context.trace.push('order_completed_lifecycle_reset');
            }
            // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

            // â”€â”€ Reco V1 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            // Graceful: any error keeps existing behavior (recommendations=[])
            response.recommendations = [];
            const recoSessionSnapshot = getSession(activeSessionId) || {};
            const recoPolicy = resolveRecoContextPolicy({
                sessionSnapshot: recoSessionSnapshot,
                orderMode: recoSessionSnapshot?.orderMode || context.orderMode || ORDER_MODE_STATE.NEUTRAL,
                intent,
            });
            response.meta.recoContext = {
                context: recoPolicy.context,
                mode: recoPolicy.mode,
                reason: recoPolicy.reason,
                cooldownRemainingMs: recoPolicy.cooldownRemainingMs,
            };
            const recoEligible =
                process.env.RECO_V1_ENABLED === 'true' &&
                menuItems?.length &&
                context.stateMutationCompleted === true &&
                context.intentGroup !== 'ordering_transaction' &&
                recoPolicy.allowReco === true;

            if (recoEligible) {
                try {
                    const targetItems = context?.nluResult?.slots?.items
                        || context?.nluResult?.targetItems
                        || [];
                    response.recommendations = getRecommendations(menuItems, {
                        intent,
                        targetItems,
                        topN: 5,
                    });
                    if (response.recommendations.length > 0) {
                        recoTelemetry.logShown(activeSessionId, response.recommendations).catch(() => {});
                    }
                } catch (e) {
                    if (process.env.RECO_V1_DEBUG === 'true') {
                        console.warn('[RECO_V1] scoring error:', e.message);
                    }
                }
            } else {
                if (recoPolicy.allowReco !== true) {
                    context.trace.push(`reco_context_off:${recoPolicy.context}:${recoPolicy.reason}:${recoPolicy.cooldownRemainingMs}`);
                }
                context.trace.push(`reco_skipped:${context.intentGroup || 'unknown'}:${context.stateMutationCompleted === true ? 'state_ok' : 'state_not_committed'}`);
            }
            // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

            if (EXPERT_MODE) {
                const turnId = `turn_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                response.turn_id = turnId;
                // Expert mode allows background analytics
                const wStep = this._mapWorkflowStep(intent);
                EventLogger.logEvent(sessionId, 'intent_resolved', {
                    intent, reply: speechText, confidence, source, domain: context.domain
                }, confidence, wStep).catch(() => { });

                // --- Event Logging: Response Sent ---
                EventLogger.logEvent(sessionId, 'response_sent', {
                    intent,
                    replyPreview: speechText?.substring(0, 150),
                    latency_ms: totalLatency,
                    has_audio: !!audioContent
                }, null, 'response').catch(() => { });

                this.persistAnalytics({
                    intent, reply: speechText, durationMs: totalLatency, confidence, ttsMs
                }).catch(() => { });
            }

            //   Record assistant turn + cache entities (passive memory)
            if (!IS_SHADOW) {
                pushAssistantTurn(sessionContext, speechText, detectedSurface?.key, { restaurants, menuItems });
                if (restaurants?.length) cacheRestaurants(sessionContext, restaurants);
                if (menuItems?.length) cacheItems(sessionContext, menuItems);
            }

            if (!IS_SHADOW) {
                BrainPipeline._inFlight.delete(inflightKey);
                devLog(`  [Pipeline] DONE  ${requestId} | intent=${intent} | source=${source} | ${Date.now() - startTime}ms`);
            }

            // 
            // ENGINE_MODE RESPONSE SANITIZER
            // stable/strict: strip debug meta, session dumps, turn_ids
            // dev: full response passthrough
            // 
            return engineSanitizeResponse(sanitizeAssistantResponse(response));

        } catch (error) {
            BrainLogger.pipeline('Error:', error.message);
            if (!IS_SHADOW) BrainPipeline._inFlight.delete(inflightKey);
            return this.createErrorResponse('internal_error', 'Coś poszło nie tak w moich obwodach.');
        }
    }

    _mapWorkflowStep(intentName) {
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
                tts_ms: p.ttsMs || 0
            });
        } catch (e) {
            // Ignore missing table
        }
    }

    createErrorResponse(errorCode, message) {
        return sanitizeAssistantResponse({
            ok: false,
            error: errorCode,
            reply: message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * In-flight request deduplication guard
 * Key: `${sessionId}::${text}`  prevents double intent resolution
 * for the same message sent concurrently (React StrictMode, retry bugs, etc.)
 */
BrainPipeline._inFlight = new Set();


