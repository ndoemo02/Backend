/**
 * ownerRestaurants.test.js
 * ===========================================================================
 * B1 owner-read — GET /api/owner/restaurants(/:id) (api/owner/restaurants.js).
 *
 * Zakres: auth (401 bez/z niepoprawnym tokenem), ownership server-side
 * (owner widzi wlasna liste/restauracje, nie widzi cudzej -> 404, nie 200
 * z cudzymi danymi), zero select("*") (asercja na przekazanych polach).
 * ===========================================================================
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getUserMock = vi.fn();
const eqSpy = vi.fn();
const selectSpy = vi.fn();
let queryResult = { data: null, error: null };

function makeQueryBuilder() {
  const qb = {
    eq: (...args) => {
      eqSpy(...args);
      return qb;
    },
    order: () => Promise.resolve(queryResult),
    maybeSingle: () => Promise.resolve(queryResult),
  };
  return qb;
}

vi.mock('../../_supabase.js', () => ({
  supabase: {
    auth: { getUser: (...args) => getUserMock(...args) },
    from: vi.fn(() => ({
      select: (...args) => {
        selectSpy(...args);
        return makeQueryBuilder();
      },
    })),
  },
}));

const { default: handler } = await import('../../owner/restaurants.js');

function createRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createReq({ method = 'GET', url = '/api/owner/restaurants', headers = {}, params = {} }) {
  return { method, url, headers, params };
}

async function call(req) {
  const res = createRes();
  await handler(req, res);
  return res;
}

beforeEach(() => {
  getUserMock.mockReset();
  eqSpy.mockClear();
  selectSpy.mockClear();
  queryResult = { data: null, error: null };
});

describe('GET /api/owner/restaurants — auth', () => {
  it('brak naglowka Authorization -> 401, zero zapytan do Supabase', async () => {
    const res = await call(createReq({}));
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(getUserMock).not.toHaveBeenCalled();
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('naglowek bez prefiksu Bearer -> 401', async () => {
    const res = await call(createReq({ headers: { authorization: 'zly-format-tokenu' } }));
    expect(res.statusCode).toBe(401);
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it('niepoprawny/wygasly token -> 401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } });
    const res = await call(createReq({ headers: { authorization: 'Bearer zly-token' } }));
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('metoda inna niz GET -> 405, zero auth check', async () => {
    const res = await call(createReq({ method: 'POST' }));
    expect(res.statusCode).toBe(405);
    expect(getUserMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/owner/restaurants — lista wlasnych', () => {
  it('poprawny token -> lista filtrowana po owner_id z JWT, nie z requestu', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    queryResult = { data: [{ id: 'r1', name: 'Test', city: 'Piekary' }], error: null };

    const res = await call(createReq({ headers: { authorization: 'Bearer dobry-token' } }));

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, data: [{ id: 'r1', name: 'Test', city: 'Piekary' }] });
    expect(eqSpy).toHaveBeenCalledWith('owner_id', 'owner-1');
    // select("*") niedozwolony — lista pol musi byc jawna i waska.
    expect(selectSpy).toHaveBeenCalledWith('id,name,city');
  });

  it('pusta lista (brak restauracji) -> 200 z pusta tablica, nie blad', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    queryResult = { data: [], error: null };
    const res = await call(createReq({ headers: { authorization: 'Bearer dobry-token' } }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, data: [] });
  });
});

describe('GET /api/owner/restaurants/:id — pojedyncza restauracja', () => {
  it('wlasna restauracja -> 200 z danymi', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    queryResult = { data: { id: 'r1', name: 'Test', city: 'Piekary' }, error: null };

    const res = await call(
      createReq({
        url: '/api/owner/restaurants/r1',
        params: { id: 'r1' },
        headers: { authorization: 'Bearer dobry-token' },
      })
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, data: { id: 'r1', name: 'Test' } });
    expect(eqSpy).toHaveBeenCalledWith('id', 'r1');
    expect(eqSpy).toHaveBeenCalledWith('owner_id', 'owner-1');
  });

  it('cudza restauracja (istniejaca, inny owner_id) -> 404, nie 200 i nie 403 z danymi', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    // Query { id = X, owner_id = 'owner-1' } zwraca zero wierszy, bo X nalezy do kogos innego —
    // z punktu widzenia klienta nieodrozniane od "nie istnieje".
    queryResult = { data: null, error: null };

    const res = await call(
      createReq({
        url: '/api/owner/restaurants/cudza-restauracja',
        params: { id: 'cudza-restauracja' },
        headers: { authorization: 'Bearer dobry-token' },
      })
    );

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ ok: false, error: 'not_found' });
    expect(eqSpy).toHaveBeenCalledWith('owner_id', 'owner-1');
  });

  it('nieistniejace id -> rowniez 404 (ten sam status co cudza restauracja)', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    queryResult = { data: null, error: null };
    const res = await call(
      createReq({
        url: '/api/owner/restaurants/nie-istnieje',
        params: { id: 'nie-istnieje' },
        headers: { authorization: 'Bearer dobry-token' },
      })
    );
    expect(res.statusCode).toBe(404);
  });

  it('body odpowiedzi nigdy nie zawiera owner_id', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    queryResult = { data: { id: 'r1', name: 'Test' }, error: null };
    const res = await call(
      createReq({
        url: '/api/owner/restaurants/r1',
        params: { id: 'r1' },
        headers: { authorization: 'Bearer dobry-token' },
      })
    );
    expect(res.body.data).not.toHaveProperty('owner_id');
    // select() dla detalu tez nie prosi o owner_id — filtr, nie projekcja.
    expect(selectSpy).toHaveBeenCalledWith(expect.not.stringContaining('owner_id'));
  });
});
