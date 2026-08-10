/**
 * restaurantsResolveEndpoint.test.js
 * ===========================================================================
 * B1 aliases fallback — GET /api/restaurants/resolve (api/restaurants/resolve.js).
 *
 * Testuje kontrakt HTTP: brak/zla nazwa -> 400, brak wyniku -> 404, sukces ->
 * 200 z WYLACZNIE {id,name}. Sam resolver (steps 1-3) jest mockowany — jego
 * logika ma osobny test w restaurantResolver.aliasStep.test.js.
 * ===========================================================================
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const resolveMock = vi.fn();

vi.mock('../services/restaurantResolver.js', () => ({
  resolveRestaurantByName: (...args) => resolveMock(...args),
}));

const { default: handler } = await import('../../restaurants/resolve.js');

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

function createReq({ method = 'GET', query = {} }) {
  return { method, query };
}

async function call(req) {
  const res = createRes();
  await handler(req, res);
  return res;
}

beforeEach(() => {
  resolveMock.mockReset();
});

describe('GET /api/restaurants/resolve — walidacja', () => {
  it('brak parametru name -> 400', async () => {
    const res = await call(createReq({ query: {} }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'name_required' });
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('pusty/whitespace name -> 400', async () => {
    const res = await call(createReq({ query: { name: '   ' } }));
    expect(res.statusCode).toBe(400);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('name dluzszy niz limit -> 400, zero zapytania do resolvera', async () => {
    const res = await call(createReq({ query: { name: 'a'.repeat(101) } }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'name_too_long' });
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('metoda inna niz GET -> 405', async () => {
    const res = await call(createReq({ method: 'POST', query: { name: 'klaps' } }));
    expect(res.statusCode).toBe(405);
    expect(resolveMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/restaurants/resolve — dopasowanie po nazwie (istniejace zachowanie)', () => {
  it('dokladne/czesciowe dopasowanie po name -> 200 {id,name}', async () => {
    resolveMock.mockResolvedValue({ id: 'r1', name: 'Stara Kamienica' });
    const res = await call(createReq({ query: { name: 'kamienica' } }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { id: 'r1', name: 'Stara Kamienica' } });
    expect(resolveMock).toHaveBeenCalledWith('kamienica');
  });

  it('name jest trimowany przed przekazaniem do resolvera', async () => {
    resolveMock.mockResolvedValue({ id: 'r1', name: 'Klaps' });
    await call(createReq({ query: { name: '  klaps  ' } }));
    expect(resolveMock).toHaveBeenCalledWith('klaps');
  });
});

describe('GET /api/restaurants/resolve — dopasowanie po aliasie (nowe)', () => {
  it('alias -> 200 z poprawnym {id,name} kanonicznym', async () => {
    resolveMock.mockResolvedValue({ id: 'r2', name: 'Bar Praha' });
    const res = await call(createReq({ query: { name: 'praga' } }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { id: 'r2', name: 'Bar Praha' } });
  });

  it('brak wyniku (ani name, ani alias) -> 404', async () => {
    resolveMock.mockResolvedValue(null);
    const res = await call(createReq({ query: { name: 'cos-czego-nie-ma' } }));
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ ok: false, error: 'not_found' });
  });
});

describe('GET /api/restaurants/resolve — kontrakt odpowiedzi', () => {
  it('odpowiedz nigdy nie zawiera aliases ani owner_id, nawet gdyby resolver je zwrocil', async () => {
    // Symuluje przyszla regresje resolvera (np. ktos doda pole do zwracanego obiektu) —
    // endpoint musi jawnie rekonstruowac ksztalt, nie przekazywac dalej surowego wyniku.
    resolveMock.mockResolvedValue({
      id: 'r2',
      name: 'Bar Praha',
      aliases: ['praga', 'bar praga'],
      owner_id: 'owner-1',
    });
    const res = await call(createReq({ query: { name: 'praga' } }));
    expect(res.body.data).toEqual({ id: 'r2', name: 'Bar Praha' });
    expect(res.body.data).not.toHaveProperty('aliases');
    expect(res.body.data).not.toHaveProperty('owner_id');
  });

  it('blad resolvera -> 500, nie wyciek szczegolow bledu do klienta', async () => {
    resolveMock.mockRejectedValue(new Error('db down: connection refused at 10.0.0.5'));
    const res = await call(createReq({ query: { name: 'cokolwiek' } }));
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ ok: false, error: 'internal_error' });
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
  });
});
