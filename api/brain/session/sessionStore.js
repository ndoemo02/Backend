import { getDefault, update } from "../ai/contextState.js";

const sessions = new Map();

export function getSession(sessionId) {
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, getDefault());
    }
    return sessions.get(sessionId);
}

export function updateSession(sessionId, patch) {
    const sess = getSession(sessionId);
    return update(sess, patch);
}

// Alias dla kompatybilności z poleceniem użytkownika "saveSession"
export const saveSession = updateSession;

