import { createClient } from '@supabase/supabase-js';

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2h

const memoryStore = new Map();
let supabaseClient = null;
let supabaseMode = 'auto'; // auto | id_data | session_payload | memory
let supabaseDisabledReason = null;

function nowIso() {
    return new Date().toISOString();
}

function ensureSessionId(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
        const err = new Error('missing_session_id');
        err.statusCode = 400;
        throw err;
    }

    return sessionId.trim();
}

function parseTimestamp(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : Date.now();
}

function isExpired(updatedAt) {
    return Date.now() - parseTimestamp(updatedAt) > SESSION_TTL_MS;
}

function hasSupabaseConfig() {
    return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getSupabase() {
    if (!hasSupabaseConfig()) return null;
    if (supabaseMode === 'memory') return null;

    if (!supabaseClient) {
        supabaseClient = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY,
            { auth: { persistSession: false } }
        );
    }

    return supabaseClient;
}

function getErrorMessage(error) {
    return String(error?.message || error?.details || error?.hint || '').toLowerCase();
}

function isMissingTableError(error) {
    const msg = getErrorMessage(error);
    if (!msg) return false;
    return msg.includes('brain_sessions')
        && (msg.includes('not find table') || msg.includes('does not exist') || msg.includes('relation'));
}

function isSchemaMismatchError(error) {
    const msg = getErrorMessage(error);
    if (!msg) return false;
    return msg.includes('column') && msg.includes('does not exist');
}

function isPermissionDeniedError(error) {
    if (error?.code === '42501') return true;
    const msg = getErrorMessage(error);
    if (!msg) return false;
    return msg.includes('permission denied') || msg.includes('row-level security policy');
}

function disableSupabase(error) {
    supabaseMode = 'memory';
    if (!supabaseDisabledReason) {
        supabaseDisabledReason = getErrorMessage(error) || 'unknown';
        console.warn(`[SessionAdapter] Supabase disabled, fallback to in-memory store: ${supabaseDisabledReason}`);
    }
}

function modeCandidates() {
    if (supabaseMode === 'id_data') return ['id_data'];
    if (supabaseMode === 'session_payload') return ['session_payload'];
    return ['id_data', 'session_payload'];
}

function mapFromMemory(sessionId, entry = null) {
    if (!entry) return null;
    return {
        id: sessionId,
        data: entry.data,
        updated_at: entry.updated_at,
    };
}

function readFromMemory(sessionId) {
    const entry = memoryStore.get(sessionId);
    if (!entry) return null;

    if (isExpired(entry.updated_at)) {
        memoryStore.delete(sessionId);
        return null;
    }

    return mapFromMemory(sessionId, entry);
}

function writeToMemory(sessionId, data, updatedAt = nowIso()) {
    memoryStore.set(sessionId, {
        data,
        updated_at: updatedAt,
    });

    return {
        id: sessionId,
        data,
        updated_at: updatedAt,
    };
}

async function loadFromSupabase(supabase, sessionId) {
    for (const mode of modeCandidates()) {
        let data = null;
        let error = null;

        if (mode === 'id_data') {
            ({ data, error } = await supabase
                .from('brain_sessions')
                .select('data, updated_at')
                .eq('id', sessionId)
                .maybeSingle());
        } else {
            ({ data, error } = await supabase
                .from('brain_sessions')
                .select('payload, updated_at')
                .eq('session_id', sessionId)
                .maybeSingle());
        }

        if (error) {
            if (isMissingTableError(error) || isPermissionDeniedError(error)) {
                disableSupabase(error);
                return null;
            }
            if (isSchemaMismatchError(error)) {
                continue;
            }
            throw error;
        }

        supabaseMode = mode;
        if (!data) return null;

        return {
            id: sessionId,
            data: mode === 'id_data' ? data.data : data.payload,
            updated_at: data.updated_at,
        };
    }

    return null;
}

async function saveToSupabase(supabase, sessionId, data, updatedAt) {
    for (const mode of modeCandidates()) {
        let error = null;

        if (mode === 'id_data') {
            ({ error } = await supabase
                .from('brain_sessions')
                .upsert(
                    {
                        id: sessionId,
                        data,
                        updated_at: updatedAt,
                    },
                    { onConflict: 'id' }
                ));
        } else {
            ({ error } = await supabase
                .from('brain_sessions')
                .upsert(
                    {
                        session_id: sessionId,
                        payload: data,
                        updated_at: updatedAt,
                    },
                    { onConflict: 'session_id' }
                ));
        }

        if (error) {
            if (isMissingTableError(error) || isPermissionDeniedError(error)) {
                disableSupabase(error);
                return null;
            }
            if (isSchemaMismatchError(error)) {
                continue;
            }
            throw error;
        }

        supabaseMode = mode;
        return {
            id: sessionId,
            data,
            updated_at: updatedAt,
        };
    }

    return null;
}

async function touchInSupabase(supabase, sessionId, updatedAt) {
    for (const mode of modeCandidates()) {
        let data = null;
        let error = null;

        if (mode === 'id_data') {
            ({ data, error } = await supabase
                .from('brain_sessions')
                .update({ updated_at: updatedAt })
                .eq('id', sessionId)
                .select('data, updated_at')
                .maybeSingle());
        } else {
            ({ data, error } = await supabase
                .from('brain_sessions')
                .update({ updated_at: updatedAt })
                .eq('session_id', sessionId)
                .select('payload, updated_at')
                .maybeSingle());
        }

        if (error) {
            if (isMissingTableError(error) || isPermissionDeniedError(error)) {
                disableSupabase(error);
                return null;
            }
            if (isSchemaMismatchError(error)) {
                continue;
            }
            throw error;
        }

        supabaseMode = mode;
        if (!data) return null;
        return {
            id: sessionId,
            data: mode === 'id_data' ? data.data : data.payload,
            updated_at: data.updated_at,
        };
    }

    return null;
}

export async function loadSession(sessionId) {
    const normalizedSessionId = ensureSessionId(sessionId);
    const supabase = getSupabase();

    if (!supabase) {
        return readFromMemory(normalizedSessionId);
    }

    const row = await loadFromSupabase(supabase, normalizedSessionId);
    if (!row) {
        return readFromMemory(normalizedSessionId);
    }

    if (isExpired(row.updated_at)) {
        try {
            if (supabaseMode === 'session_payload') {
                await supabase.from('brain_sessions').delete().eq('session_id', normalizedSessionId);
            } else {
                await supabase.from('brain_sessions').delete().eq('id', normalizedSessionId);
            }
        } catch {
            // Best effort ttl cleanup.
        }
        memoryStore.delete(normalizedSessionId);
        return null;
    }

    writeToMemory(normalizedSessionId, row.data, row.updated_at);
    return row;
}

export async function saveSession(session) {
    const normalizedSessionId = ensureSessionId(session?.id);
    const data = (session?.data && typeof session.data === 'object') ? session.data : {};
    const updatedAt = nowIso();
    const supabase = getSupabase();

    if (!supabase) {
        return writeToMemory(normalizedSessionId, data, updatedAt);
    }

    const saved = await saveToSupabase(supabase, normalizedSessionId, data, updatedAt);
    if (!saved) {
        return writeToMemory(normalizedSessionId, data, updatedAt);
    }

    writeToMemory(normalizedSessionId, data, updatedAt);
    return saved;
}

export async function touchSession(sessionId) {
    const normalizedSessionId = ensureSessionId(sessionId);
    const updatedAt = nowIso();
    const supabase = getSupabase();

    if (!supabase) {
        const fromMemory = readFromMemory(normalizedSessionId);
        if (!fromMemory) return null;
        return writeToMemory(normalizedSessionId, fromMemory.data, updatedAt);
    }

    const touched = await touchInSupabase(supabase, normalizedSessionId, updatedAt);
    if (!touched) {
        const fromMemory = readFromMemory(normalizedSessionId);
        if (!fromMemory) return null;
        return writeToMemory(normalizedSessionId, fromMemory.data, updatedAt);
    }

    writeToMemory(normalizedSessionId, touched.data, touched.updated_at || updatedAt);
    return touched;
}
