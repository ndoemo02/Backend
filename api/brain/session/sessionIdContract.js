export const SESSION_ID_MAX_LENGTH = 128;
export const SESSION_ID_PATTERN = /^sess_[a-z0-9_]+$/;

export function validateSessionId(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return { ok: false, error: 'missing_session_id' };
    }

    const sessionId = value.trim();
    if (sessionId.length > SESSION_ID_MAX_LENGTH || !SESSION_ID_PATTERN.test(sessionId)) {
        return { ok: false, error: 'invalid_session_id' };
    }

    return { ok: true, sessionId };
}

export function requireValidSessionId(value) {
    const verdict = validateSessionId(value);
    if (verdict.ok) return verdict.sessionId;

    const error = new Error(verdict.error);
    error.statusCode = 400;
    throw error;
}

export function generateSessionId(namespace = '') {
    const safeNamespace = String(namespace || '').trim().toLowerCase();
    if (safeNamespace && !/^[a-z0-9_]+$/.test(safeNamespace)) {
        throw new Error('invalid_session_namespace');
    }

    const random = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
    const prefix = safeNamespace ? `sess_${safeNamespace}_` : 'sess_';
    return `${prefix}${Date.now()}_${random}`;
}
