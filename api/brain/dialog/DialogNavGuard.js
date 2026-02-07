/**
 * DialogNavGuard.js
 * 
 * Meta-Intent Layer for Dialog Navigation
 * Handles: BACK, REPEAT, NEXT, STOP, CANCEL, HELP, CORRECT
 * 
 * ❌ Does NOT touch FSM
 * ❌ Does NOT change session state (except dialogStackIndex)
 * ✅ Operates ONLY on dialog history
 * ✅ Returns nav_action flags only
 * 
 * This runs BEFORE NLU - if matched, SHORT-CIRCUITS the pipeline.
 */

// ═══════════════════════════════════════════════════════════════════════════
// DIALOG NAVIGATION INTENTS (Lexical only, no LLM)
// ═══════════════════════════════════════════════════════════════════════════

export const DIALOG_NAV_INTENTS = {
    BACK: 'DIALOG_BACK',
    REPEAT: 'DIALOG_REPEAT',
    NEXT: 'DIALOG_NEXT',
    STOP: 'DIALOG_STOP',
    CANCEL: 'DIALOG_CANCEL',
    HELP: 'DIALOG_HELP',
    CORRECT: 'DIALOG_CORRECT'
};

// Phrase mappings (Polish)
// Note: Using (^|\\s) and ($|\\s) instead of \\b because word boundaries don't work with Polish chars
const NAV_PATTERNS = {
    BACK: [
        /(^|\s)(cofnij|wroc|wróć|poprzedni[ea]?|wczesniej|wcześniej|wstecz)(\s|$)/i,
        /(^|\s)pokaż\s+(poprzedni[ea]?|wcześniejsz[ea]?)(\s|$)/i
    ],
    REPEAT: [
        /(^|\s)(powtórz|powtorz|powiedz\s+jeszcze\s+raz|jeszcze\s+raz|pokaż\s+jeszcze\s+raz)(\s|$)/i,
        /(^|\s)co\s+(powiedziała[sś]?|mówiła[sś]?)(\s|$)/i
    ],
    NEXT: [
        /(^|\s)(dalej|następn[eya]|nastepn[eya]|kolejn[eya]|więcej|wiecej|pokaż\s+więcej)(\s|$)/i
    ],
    STOP: [
        /(^|\s)(stop|wystarczy|cisza|przestań|przestan|zamilknij|cicho)(\s|$)/i,
        /(^|\s)nie\s+mów(\s|$)/i
    ],
    CANCEL: [
        /(^|\s)(anuluj|rezygnuj[eę]?|nie\s+chc[eę]|zrezygnuj|odwołaj|kasuj)(\s|$)/i,
        /(^|\s)jednak\s+nie(\s|$)/i,
        /(^|\s)nie,?\s*dziękuję(\s|$)/i
    ],
    HELP: [
        /(^|\s)(pomoc|pomocy|help|co\s+mogę|co\s+mog[eę]\s+powiedzieć|jak\s+to\s+działa|instrukcja)(\s|$)/i,
        /(^|\s)jakie\s+(mam\s+)?opcje(\s|$)/i,
        /(^|\s)co\s+um[ie]esz(\s|$)/i
    ],
    CORRECT: [
        /(^|\s)(nie,?\s+chodziło\s+mi\s+o|nie,?\s+miałem\s+na\s+myśli|popraw|źle\s+zrozumiała?[sś]?)(\s|$)/i,
        /(^|\s)nie\s+to\s+miałem(\s|$)/i,
        /(^|\s)nie,?\s+chodzi\s+o(\s|$)/i
    ]
};

/**
 * Detect dialog navigation intent from raw text
 * @param {string} text - User input
 * @returns {{ navIntent: string | null, confidence: number }}
 */
export function detectDialogNav(text) {
    if (!text || typeof text !== 'string') {
        return { navIntent: null, confidence: 0 };
    }

    const normalized = text.toLowerCase().trim();

    // Check each nav intent
    for (const [navType, patterns] of Object.entries(NAV_PATTERNS)) {
        for (const pattern of patterns) {
            if (pattern.test(normalized)) {
                return {
                    navIntent: DIALOG_NAV_INTENTS[navType],
                    confidence: 0.95
                };
            }
        }
    }

    return { navIntent: null, confidence: 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
// DIALOG STACK MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Push a new surface to the dialog stack
 * @param {object} session - Session object (mutable)
 * @param {object} surfaceEntry - { surfaceKey, facts, renderedText }
 */
export function pushDialogStack(session, surfaceEntry) {
    if (!session.dialogStack) {
        session.dialogStack = [];
    }
    if (!session.dialogStackIndex) {
        session.dialogStackIndex = -1;
    }

    // Limit stack size to prevent memory bloat
    const MAX_STACK_SIZE = 10;
    if (session.dialogStack.length >= MAX_STACK_SIZE) {
        session.dialogStack.shift(); // Remove oldest
    }

    session.dialogStack.push({
        surfaceKey: surfaceEntry.surfaceKey,
        facts: surfaceEntry.facts,
        renderedText: surfaceEntry.renderedText,
        timestamp: Date.now()
    });

    // Always point to the latest
    session.dialogStackIndex = session.dialogStack.length - 1;
}

/**
 * Get current dialog entry
 */
export function getCurrentDialogEntry(session) {
    if (!session.dialogStack || session.dialogStack.length === 0) {
        return null;
    }
    const idx = session.dialogStackIndex ?? session.dialogStack.length - 1;
    return session.dialogStack[idx] || null;
}

/**
 * Move back in dialog history
 */
export function goBackInDialog(session) {
    if (!session.dialogStack || session.dialogStack.length === 0) {
        return null;
    }

    if (session.dialogStackIndex === undefined) {
        session.dialogStackIndex = session.dialogStack.length - 1;
    }

    if (session.dialogStackIndex > 0) {
        session.dialogStackIndex--;
    }

    return session.dialogStack[session.dialogStackIndex] || null;
}

/**
 * Move forward in dialog history (if user went back)
 */
export function goForwardInDialog(session) {
    if (!session.dialogStack || session.dialogStack.length === 0) {
        return null;
    }

    if (session.dialogStackIndex === undefined) {
        session.dialogStackIndex = session.dialogStack.length - 1;
        return session.dialogStack[session.dialogStackIndex];
    }

    if (session.dialogStackIndex < session.dialogStack.length - 1) {
        session.dialogStackIndex++;
    }

    return session.dialogStack[session.dialogStackIndex] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// DIALOG NAV HANDLER (Called when nav intent detected)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle dialog navigation intent
 * @param {string} navIntent - DIALOG_BACK, DIALOG_REPEAT, etc.
 * @param {object} sessionContext - Current session state
 * @returns {{ reply: string, shouldSpeak: boolean, skipPipeline: boolean, contextUpdates?: object }}
 */
export function handleDialogNav(navIntent, sessionContext) {
    const session = sessionContext || {};

    switch (navIntent) {
        case DIALOG_NAV_INTENTS.BACK: {
            const prev = goBackInDialog(session);
            if (prev) {
                return {
                    reply: prev.renderedText,
                    shouldSpeak: true,
                    skipPipeline: true,
                    contextUpdates: { dialogStackIndex: session.dialogStackIndex },
                    meta: { navAction: 'BACK', surfaceKey: prev.surfaceKey }
                };
            }
            return {
                reply: 'Nie mam wcześniejszej odpowiedzi do pokazania.',
                shouldSpeak: true,
                skipPipeline: true,
                meta: { navAction: 'BACK', empty: true }
            };
        }

        case DIALOG_NAV_INTENTS.REPEAT: {
            const current = getCurrentDialogEntry(session);
            if (current) {
                return {
                    reply: current.renderedText,
                    shouldSpeak: true,
                    skipPipeline: true,
                    meta: { navAction: 'REPEAT', surfaceKey: current.surfaceKey }
                };
            }
            return {
                reply: 'Nie mam czego powtórzyć.',
                shouldSpeak: true,
                skipPipeline: true,
                meta: { navAction: 'REPEAT', empty: true }
            };
        }

        case DIALOG_NAV_INTENTS.NEXT: {
            const next = goForwardInDialog(session);
            if (next && session.dialogStackIndex < session.dialogStack.length - 1) {
                // Actually moved forward
                return {
                    reply: next.renderedText,
                    shouldSpeak: true,
                    skipPipeline: true,
                    contextUpdates: { dialogStackIndex: session.dialogStackIndex },
                    meta: { navAction: 'NEXT', surfaceKey: next.surfaceKey }
                };
            }
            // At the end or no pagination context
            return {
                reply: 'To już wszystko co mam.',
                shouldSpeak: true,
                skipPipeline: true,
                meta: { navAction: 'NEXT', atEnd: true }
            };
        }

        case DIALOG_NAV_INTENTS.STOP: {
            // STOP only stops TTS - doesn't change dialog state
            return {
                reply: '', // Empty reply = no TTS
                shouldSpeak: false,
                skipPipeline: true,
                stopTTS: true, // Signal to frontend
                meta: { navAction: 'STOP' }
            };
        }

        case DIALOG_NAV_INTENTS.CANCEL: {
            // CANCEL signals intent to abort current action
            // Does NOT mutate state - FSM decides what to do with this signal
            return {
                reply: 'Rozumiem, anuluję.',
                shouldSpeak: true,
                skipPipeline: true,
                cancelRequested: true, // Signal for FSM to handle
                meta: { navAction: 'CANCEL' }
            };
        }

        case DIALOG_NAV_INTENTS.HELP: {
            // HELP shows available commands - pure info, no state change
            const helpMessage = 'Możesz powiedzieć: „pokaż menu", „zamów pizzę", ' +
                '„cofnij", „powtórz", „anuluj", „stop". ' +
                'Powiedz numer aby wybrać opcję z listy.';
            return {
                reply: helpMessage,
                shouldSpeak: true,
                skipPipeline: true,
                meta: { navAction: 'HELP' }
            };
        }

        case DIALOG_NAV_INTENTS.CORRECT: {
            // CORRECT signals user wants to fix something
            // This just flags it - doesn't decide what to do
            return {
                reply: 'Przepraszam, spróbujmy jeszcze raz. Co chciałeś zamówić?',
                shouldSpeak: true,
                skipPipeline: true,
                correctionRequested: true,
                meta: { navAction: 'CORRECT', clearLastIntent: true }
            };
        }

        default:
            return {
                reply: null,
                shouldSpeak: false,
                skipPipeline: false
            };
    }
}

/**
 * Main guard function - call this at the start of pipeline
 * @param {string} text - User input
 * @param {object} sessionContext - Session state
 * @param {object} config - Runtime config (from getConfig())
 * @returns {{ handled: boolean, response?: object }}
 */
export function dialogNavGuard(text, sessionContext, config = {}) {
    const { navIntent, confidence } = detectDialogNav(text);

    if (!navIntent || confidence < 0.8) {
        return { handled: false };
    }

    // STOP always works (safety) - even when dialog nav is disabled
    const isStop = navIntent === DIALOG_NAV_INTENTS.STOP;

    // Check if dialog navigation is enabled (SIMPLE mode or explicit disable)
    const isSimpleMode = config.fallback_mode === 'SIMPLE';
    const navDisabled = config.dialog_navigation_enabled === false;

    if (!isStop && (navDisabled || isSimpleMode)) {
        console.log(`🔀 DialogNavGuard: ${navIntent} skipped (disabled in config)`);
        return { handled: false };
    }

    console.log(`🔀 DialogNavGuard: Detected ${navIntent} (confidence: ${confidence})`);

    const result = handleDialogNav(navIntent, sessionContext);

    if (result.skipPipeline) {
        return {
            handled: true,
            response: {
                ok: true,
                intent: navIntent,
                reply: result.reply,
                should_reply: result.shouldSpeak,
                stopTTS: result.stopTTS || false,
                meta: {
                    source: 'dialog_nav_guard',
                    ...result.meta
                },
                contextUpdates: result.contextUpdates
            }
        };
    }

    return { handled: false };
}
