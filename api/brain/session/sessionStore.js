import { getDefault, update } from "../ai/contextState.js";

const sessions = new Map();

// ═══════════════════════════════════════════════════════════════════════════
// SESSION LIFECYCLE HELPERS (Conversation Isolation)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a new unique session ID for a fresh conversation.
 * Format: sess_{timestamp}_{random}
 */
export function generateNewSessionId() {
    const ts = Date.now();
    const rand = Math.random().toString(36).substring(2, 8);
    return `sess_${ts}_${rand}`;
}

/**
 * Check if a session is closed (conversation ended).
 */
export function isSessionClosed(sessionId) {
    const session = sessions.get(sessionId);
    return session?.status === 'closed';
}

/**
 * Close a conversation. After this:
 * - pendingDish, awaiting, expectedContext are cleared
 * - session.status = 'closed'
 * - session cannot be reused for new inputs
 * 
 * @param {string} sessionId - Current session ID
 * @param {'CART_ITEM_ADDED' | 'ORDER_CONFIRMED'} reason - Why conversation ended
 * @returns {{ closedSessionId: string, newSessionId: string }}
 */
export function closeConversation(sessionId, reason) {
    const session = getSession(sessionId);
    
    // Mark session as closed
    update(session, {
        status: 'closed',
        closedReason: reason,
        closedAt: new Date().toISOString(),
        // Clear transient state
        pendingDish: null,
        awaiting: null,
        expectedContext: null,
        pendingOrder: null
    });
    
    console.log(`🔒 CONVERSATION CLOSED: ${sessionId} (reason: ${reason})`);
    
    // Generate new session ID for next conversation
    const newSessionId = generateNewSessionId();
    
    return {
        closedSessionId: sessionId,
        newSessionId
    };
}

/**
 * Get or create a session. If session is closed, returns null.
 * Use getOrCreateActiveSession() for auto-creating new session on closed.
 */
export function getSession(sessionId) {
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, getDefault());
    }
    return sessions.get(sessionId);
}

/**
 * Get active session or create new one if current is closed.
 * Returns { session, sessionId, isNew }
 */
export function getOrCreateActiveSession(sessionId) {
    const existing = sessions.get(sessionId);
    
    // If no session exists, create new
    if (!existing) {
        const newSession = getDefault();
        sessions.set(sessionId, newSession);
        return { session: newSession, sessionId, isNew: true };
    }
    
    // If session is closed, generate new ID and session
    if (existing.status === 'closed') {
        const newId = generateNewSessionId();
        const newSession = getDefault();
        sessions.set(newId, newSession);
        console.log(`🔄 AUTO-NEW SESSION: ${sessionId} was closed, created ${newId}`);
        return { session: newSession, sessionId: newId, isNew: true };
    }
    
    // Active session exists
    return { session: existing, sessionId, isNew: false };
}

export function updateSession(sessionId, patch) {
    const sess = getSession(sessionId);
    return update(sess, patch);
}

// Alias dla kompatybilności z poleceniem użytkownika "saveSession"
export const saveSession = updateSession;
