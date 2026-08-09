/**
 * D2 - sessionAdapter: klasyfikacja odmowy uprawnien (42501) do memory-fallback
 * ===========================================================================
 * Bramka dla zadania D2 z docs/HANDOFF_EXEC_SONNET5_2026-08-08.md sekcja 6.
 *
 * Przed fixem: permission denied / row-level security policy (42501) nie byly
 * lapane przez isMissingTableError/isSchemaMismatchError, wiec sessionAdapter
 * rzucal wyjatek zamiast degradowac do memoryStore, tak jak juz dzis robi to
 * dla "missing table". sessionStore.js maskuje ten wyjatek try/catchem, ale
 * skutkiem jest cicha utrata realnego stanu sesji na zimnym wywolaniu
 * serverless (powrot do pustej domyslnej sesji zamiast realnych danych).
 *
 * Kazdy test importuje modul na swiezo (vi.resetModules + vi.doMock), zeby
 * modulowy stan (supabaseMode/supabaseClient/memoryStore) nie przeciekal
 * miedzy przypadkami - sessionAdapter.js nie eksportuje zadnego resetu.
 * ===========================================================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const savedEnv = {};

beforeEach(() => {
    for (const key of ENV_KEYS) {
        savedEnv[key] = process.env[key];
    }
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
});

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
    }
    vi.doUnmock('@supabase/supabase-js');
    vi.resetModules();
});

const PERMISSION_DENIED = {
    code: '42501',
    message: 'permission denied for table brain_sessions',
};

const RLS_POLICY_DENIED = {
    code: '42501',
    message: 'new row violates row-level security policy for table "brain_sessions"',
};

const SCHEMA_MISMATCH = {
    message: 'column "data" does not exist',
};

/**
 * Buduje mock klienta Supabase, gdzie kazde wywolanie terminalne
 * (maybeSingle / upsert) konsumuje kolejny wpis z `responses` w kolejnosci
 * wywolan - pozwala symulowac np. "id_data mismatch -> session_payload perm.denied"
 * w ramach jednej petli modeCandidates().
 */
function buildSupabaseMock(responses) {
    let callIndex = 0;
    const next = () => {
        const response = responses[Math.min(callIndex, responses.length - 1)];
        callIndex += 1;
        return Promise.resolve(response);
    };

    const chain = {
        select: () => chain,
        eq: () => chain,
        update: () => chain,
        upsert: () => next(),
        maybeSingle: () => next(),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    };

    return {
        client: { from: () => chain },
        callCount: () => callIndex,
    };
}

async function importAdapterWithResponses(responses) {
    const mock = buildSupabaseMock(responses);
    vi.resetModules();
    vi.doMock('@supabase/supabase-js', () => ({
        createClient: () => mock.client,
    }));
    const adapter = await import('../session/sessionAdapter.js');
    return { adapter, callCount: mock.callCount };
}

describe('D2 / sessionAdapter - permission denied (42501) degraduje do memory-fallback', () => {
    describe('loadSession', () => {
        it('42501 "permission denied for table" na wariancie id_data -> resolves null, brak throw', async () => {
            const { adapter, callCount } = await importAdapterWithResponses([
                { data: null, error: PERMISSION_DENIED },
            ]);

            await expect(adapter.loadSession('sess_perm_load_1')).resolves.toBeNull();
            // Klasyfikacja jako permission-denied wywoluje disableSupabase() i
            // przerywa petle modeCandidates() natychmiast - session_payload
            // nie jest juz probowany (identycznie jak dla isMissingTableError).
            expect(callCount()).toBe(1);
        });

        it('42501 "row-level security policy" na wariancie id_data -> resolves null, brak throw', async () => {
            const { adapter, callCount } = await importAdapterWithResponses([
                { data: null, error: RLS_POLICY_DENIED },
            ]);

            await expect(adapter.loadSession('sess_perm_load_2')).resolves.toBeNull();
            expect(callCount()).toBe(1);
        });

        it('schema-mismatch na id_data, potem 42501 na session_payload -> resolves null, brak throw', async () => {
            const { adapter, callCount } = await importAdapterWithResponses([
                { data: null, error: SCHEMA_MISMATCH },
                { data: null, error: RLS_POLICY_DENIED },
            ]);

            await expect(adapter.loadSession('sess_perm_load_3')).resolves.toBeNull();
            expect(callCount()).toBe(2);
        });

        it('po klasyfikacji jako permission-denied kolejne wywolanie NIE odpytuje juz Supabase (supabaseMode=memory)', async () => {
            const { adapter, callCount } = await importAdapterWithResponses([
                { data: null, error: PERMISSION_DENIED },
            ]);

            await adapter.loadSession('sess_perm_load_4');
            expect(callCount()).toBe(1);

            await adapter.loadSession('sess_perm_load_4');
            expect(callCount()).toBe(1);
        });
    });

    describe('saveSession', () => {
        it('42501 "permission denied for table" na wariancie id_data -> degraduje do memory, zwraca zapisane dane, brak throw', async () => {
            const { adapter, callCount } = await importAdapterWithResponses([
                { error: PERMISSION_DENIED },
            ]);

            const result = await adapter.saveSession({
                id: 'sess_perm_save_1',
                data: { cart: ['kebab'] },
            });

            expect(result).toMatchObject({
                id: 'sess_perm_save_1',
                data: { cart: ['kebab'] },
            });
            expect(callCount()).toBe(1);
        });

        it('schema-mismatch na id_data, potem 42501 "row-level security policy" na session_payload -> degraduje do memory, brak throw', async () => {
            const { adapter, callCount } = await importAdapterWithResponses([
                { error: SCHEMA_MISMATCH },
                { error: RLS_POLICY_DENIED },
            ]);

            const result = await adapter.saveSession({
                id: 'sess_perm_save_2',
                data: { cart: ['pizza'] },
            });

            expect(result).toMatchObject({
                id: 'sess_perm_save_2',
                data: { cart: ['pizza'] },
            });
            expect(callCount()).toBe(2);
        });
    });

    describe('touchSession', () => {
        it('42501 "permission denied for table" na wariancie id_data -> nie rzuca (brak wpisu w memory = null)', async () => {
            const { adapter, callCount } = await importAdapterWithResponses([
                { data: null, error: PERMISSION_DENIED },
            ]);

            await expect(adapter.touchSession('sess_perm_touch_1')).resolves.toBeNull();
            expect(callCount()).toBe(1);
        });

        it('42501 "row-level security policy" na wariancie session_payload -> nie rzuca', async () => {
            const { adapter, callCount } = await importAdapterWithResponses([
                { data: null, error: SCHEMA_MISMATCH },
                { data: null, error: RLS_POLICY_DENIED },
            ]);

            await expect(adapter.touchSession('sess_perm_touch_2')).resolves.toBeNull();
            expect(callCount()).toBe(2);
        });
    });
});
