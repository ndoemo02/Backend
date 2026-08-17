import { getDefault, update } from "../ai/contextState.js";
import {
    loadSession as loadSessionFromAdapter,
    saveSession as saveSessionToAdapter,
    touchSession as touchSessionInAdapter,
} from "./sessionAdapter.js";
import { generateSessionId, requireValidSessionId } from "./sessionIdContract.js";

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2h
const CACHE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const sessions = new Map();
const pendingReads = new Map();
const pendingWrites = new Map();

function nowIso() {
    return new Date().toISOString();
}

function ensureSessionId(sessionId) {
    return requireValidSessionId(sessionId);
}

function parseTimestamp(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : Date.now();
}

function isExpiredByTimestamp(updatedAtMs) {
    return Date.now() - updatedAtMs > SESSION_TTL_MS;
}

function setCache(sessionId, data, updatedAt = nowIso()) {
    sessions.set(sessionId, {
        data,
        updatedAtMs: parseTimestamp(updatedAt),
    });

    return data;
}

function getCache(sessionId) {
    const entry = sessions.get(sessionId);
    if (!entry) return null;

    if (isExpiredByTimestamp(entry.updatedAtMs)) {
        sessions.delete(sessionId);
        return null;
    }

    return entry.data;
}

function queueWrite(sessionId, writer) {
    const previous = pendingWrites.get(sessionId) || Promise.resolve();

    const current = previous
        .catch(() => undefined)
        .then(writer)
        .finally(() => {
            if (pendingWrites.get(sessionId) === current) {
                pendingWrites.delete(sessionId);
            }
        });

    pendingWrites.set(sessionId, current);
    return current;
}

async function loadSessionToCache(sessionId, { createIfMissing = true } = {}) {
    const cached = getCache(sessionId);
    if (cached) {
        return cached;
    }

    const inflight = pendingReads.get(sessionId);
    if (inflight) {
        return inflight;
    }

    const reader = (async () => {
        try {
            const row = await loadSessionFromAdapter(sessionId);

            if (row?.data) {
                return setCache(sessionId, row.data, row.updated_at);
            }

            if (!createIfMissing) {
                return null;
            }

            const fresh = getDefault();
            setCache(sessionId, fresh);

            try {
                const saved = await saveSessionToAdapter({
                    id: sessionId,
                    data: fresh,
                });
                setCache(sessionId, fresh, saved?.updated_at || nowIso());
            } catch (err) {
                console.warn(`[SessionStore] create upsert failed for ${sessionId}: ${err.message}`);
            }

            return fresh;
        } catch (err) {
            console.warn(`[SessionStore] read failed for ${sessionId}: ${err.message}`);

            if (!createIfMissing) {
                return null;
            }

            const fallback = getDefault();
            setCache(sessionId, fallback);
            return fallback;
        } finally {
            pendingReads.delete(sessionId);
        }
    })();

    pendingReads.set(sessionId, reader);
    return reader;
}

function sweepExpiredCache() {
    for (const [sessionId, entry] of sessions.entries()) {
        if (isExpiredByTimestamp(entry.updatedAtMs)) {
            sessions.delete(sessionId);
        }
    }
}

if (!globalThis.__brainSessionStoreSweeper) {
    globalThis.__brainSessionStoreSweeper = setInterval(sweepExpiredCache, CACHE_SWEEP_INTERVAL_MS);
    if (typeof globalThis.__brainSessionStoreSweeper.unref === 'function') {
        globalThis.__brainSessionStoreSweeper.unref();
    }
}

// ============================================================================
// ASYNC PERSISTENT INTERFACE (source of truth)
// ============================================================================

export async function getSessionAsync(sessionId, opts = {}) {
    const normalizedSessionId = ensureSessionId(sessionId);
    const loaded = await loadSessionToCache(normalizedSessionId, opts);

    // Keep ttl warm only for explicit async reads.
    void touchSessionInAdapter(normalizedSessionId).catch(() => { });

    return loaded;
}

export async function setSession(sessionId, data) {
    const normalizedSessionId = ensureSessionId(sessionId);
    const payload = (data && typeof data === 'object') ? data : getDefault();

    setCache(normalizedSessionId, payload);

    const updatedAt = await queueWrite(normalizedSessionId, async () => {
        try {
            const saved = await saveSessionToAdapter({
                id: normalizedSessionId,
                data: payload,
            });
            return saved?.updated_at || nowIso();
        } catch (err) {
            console.warn(`[SessionStore] upsert failed for ${normalizedSessionId}: ${err.message}`);
            return nowIso();
        }
    });

    setCache(normalizedSessionId, payload, updatedAt);
    return payload;
}

export async function closeSession(sessionId, reason) {
    const normalizedSessionId = ensureSessionId(sessionId);
    const session = await getSessionAsync(normalizedSessionId, { createIfMissing: true });

    update(session, {
        status: 'closed',
        closedReason: reason,
        closedAt: nowIso(),
        pendingDish: null,
        awaiting: null,
        expectedContext: null,
        pendingOrder: null,
    });

    await setSession(normalizedSessionId, session);
    return session;
}

// ============================================================================
// SYNC COMPATIBILITY LAYER (legacy call-sites)
// ============================================================================

/**
 * Generate a new unique session ID for a fresh conversation.
 * Format: sess_{timestamp}_{random}
 */
export function generateNewSessionId() {
    return generateSessionId();
}

/**
 * Sync getter for legacy code paths. Returns cached session and starts
 * background hydration if session was not loaded yet.
 */
export function getSession(sessionId) {
    const normalizedSessionId = ensureSessionId(sessionId);

    const cached = getCache(normalizedSessionId);
    if (cached) {
        return cached;
    }

    const optimistic = getDefault();
    setCache(normalizedSessionId, optimistic);

    void loadSessionToCache(normalizedSessionId, { createIfMissing: true });

    return optimistic;
}

export function isSessionClosed(sessionId) {
    const session = getSession(sessionId);
    return session?.status === 'closed';
}

/**
 * Close a conversation and return new session id for client.
 */
export function closeConversation(sessionId, reason) {
    const normalizedSessionId = ensureSessionId(sessionId);
    const session = getSession(normalizedSessionId);

    update(session, {
        status: 'closed',
        closedReason: reason,
        closedAt: nowIso(),
        pendingDish: null,
        awaiting: null,
        expectedContext: null,
        pendingOrder: null,
    });

    void setSession(normalizedSessionId, session);

    console.log(`🔒 CONVERSATION CLOSED: ${normalizedSessionId} (reason: ${reason})`);

    const newSessionId = generateNewSessionId();

    return {
        closedSessionId: normalizedSessionId,
        newSessionId,
    };
}

/**
 * Legacy sync API.
 */
export function getOrCreateActiveSession(sessionId) {
    const normalizedSessionId = ensureSessionId(sessionId);
    const existing = getSession(normalizedSessionId);

    if (!existing) {
        const newSession = getDefault();
        setCache(normalizedSessionId, newSession);
        void setSession(normalizedSessionId, newSession);
        return { session: newSession, sessionId: normalizedSessionId, isNew: true };
    }

    if (existing.status === 'closed') {
        const newId = generateNewSessionId();
        const newSession = getDefault();

        if (existing.currentRestaurant) {
            newSession.currentRestaurant = existing.currentRestaurant;
        }
        if (existing.lastRestaurant) {
            newSession.lastRestaurant = existing.lastRestaurant;
        }
        if (existing.cart && existing.closedReason !== 'ORDER_CONFIRMED') {
            newSession.cart = existing.cart;
        }

        setCache(newId, newSession);
        void setSession(newId, newSession);

        console.log(`🔄 AUTO-NEW SESSION: ${normalizedSessionId} was closed, created ${newId}. Context carried over.`);

        return { session: newSession, sessionId: newId, isNew: true };
    }

    return { session: existing, sessionId: normalizedSessionId, isNew: false };
}

/**
 * Async variant used by V2 pipeline hydration.
 */
export async function getOrCreateActiveSessionAsync(sessionId) {
    const normalizedSessionId = ensureSessionId(sessionId);
    const existing = await getSessionAsync(normalizedSessionId, { createIfMissing: true });

    if (existing.status === 'closed') {
        const newId = generateNewSessionId();
        const newSession = getDefault();

        if (existing.currentRestaurant) {
            newSession.currentRestaurant = existing.currentRestaurant;
        }
        if (existing.lastRestaurant) {
            newSession.lastRestaurant = existing.lastRestaurant;
        }
        if (existing.cart && existing.closedReason !== 'ORDER_CONFIRMED') {
            newSession.cart = existing.cart;
        }

        await setSession(newId, newSession);

        console.log(`🔄 AUTO-NEW SESSION: ${normalizedSessionId} was closed, created ${newId}. Context carried over.`);

        return { session: newSession, sessionId: newId, isNew: true };
    }

    return { session: existing, sessionId: normalizedSessionId, isNew: false };
}

export function updateSession(sessionId, patch) {
    const normalizedSessionId = ensureSessionId(sessionId);
    const sess = getSession(normalizedSessionId);
    update(sess, patch);
    void setSession(normalizedSessionId, sess);
    return sess;
}

/**
 * Persistent async update for serverless request boundaries.
 *
 * Unlike the legacy sync updateSession(), this hydrates the durable snapshot
 * before applying a patch and waits until the merged state is stored.
 */
export async function updateSessionAsync(sessionId, patch) {
    const normalizedSessionId = ensureSessionId(sessionId);
    const sess = await getSessionAsync(normalizedSessionId, { createIfMissing: true });
    update(sess, patch);
    await setSession(normalizedSessionId, sess);
    return sess;
}

// Alias dla kompatybilności
export const saveSession = updateSession;
