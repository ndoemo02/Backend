/**
 * T1 - autoryzacja endpointow /api/orders
 * ===========================================================================
 * Bramka dla etapu 1 z SS9 planu hardeningu (docs/SUPABASE_FINAL_DEMO_HARDENING_PLAN.md).
 *
 * Zakres:
 *   - DELETE /api/orders nie istnieje (kasowal CALA tabele bez autoryzacji)
 *   - PATCH /api/orders/:id wymaga tokenu admina
 *   - PATCH ma allowliste pol; user_id jest trwale poza nia
 *   - payload z polem spoza allowlisty nie moze zostac zastosowany czesciowo
 *   - GET /api/orders wymaga zakresu albo tokenu (wczesniej zwracal cala tabele z PII)
 * ===========================================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const updateSpy = vi.fn();

vi.mock('../../_supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: (payload) => {
        updateSpy(payload);
        return {
          eq: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: 'ord-1', ...payload }, error: null }),
            }),
          }),
        };
      },
      select: () => {
        const qb = Promise.resolve({ data: [], error: null });
        qb.order = () => qb;
        qb.eq = () => qb;
        return qb;
      },
    })),
  },
}));

const { default: handler } = await import('../../orders.js');

const VALID_TOKEN = 'token-testowy-t1';

function createRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    ended: false,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

function createReq({ method, url = '/api/orders/ord-1', headers = {}, body, query = {} }) {
  return { method, url, headers, body, query };
}

async function call(req) {
  const res = createRes();
  await handler(req, res);
  return res;
}

beforeEach(() => {
  updateSpy.mockClear();
  process.env.ADMIN_TOKEN = VALID_TOKEN;
});

// ---------------------------------------------------------------------------
// DELETE - endpoint ma nie istniec
// ---------------------------------------------------------------------------

describe('T1 / DELETE /api/orders', () => {
  it('nie jest obslugiwany - zwraca 405', async () => {
    const res = await call(createReq({ method: 'DELETE', url: '/api/orders' }));
    expect(res.statusCode).toBe(405);
  });

  it('nie kasuje niczego nawet z poprawnym tokenem admina', async () => {
    const res = await call(
      createReq({
        method: 'DELETE',
        url: '/api/orders',
        headers: { 'x-admin-token': VALID_TOKEN },
      })
    );
    expect(res.statusCode).toBe(405);
  });

  it('nie jest juz ogloszany w Access-Control-Allow-Methods', async () => {
    const res = await call(createReq({ method: 'OPTIONS', url: '/api/orders' }));
    expect(res.headers['Access-Control-Allow-Methods']).not.toMatch(/DELETE/);
  });
});

// ---------------------------------------------------------------------------
// PATCH - autoryzacja
// ---------------------------------------------------------------------------

describe('T1 / PATCH autoryzacja', () => {
  it('brak tokenu -> 401 i zero zapisu', async () => {
    const res = await call(createReq({ method: 'PATCH', body: { status: 'preparing' } }));
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('bledny token -> 403 i zero zapisu', async () => {
    const res = await call(
      createReq({
        method: 'PATCH',
        headers: { 'x-admin-token': 'nie-ten-token' },
        body: { status: 'preparing' },
      })
    );
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ ok: false, error: 'forbidden' });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('fail-closed: brak ADMIN_TOKEN na serwerze -> 403 mimo podanego tokenu', async () => {
    delete process.env.ADMIN_TOKEN;
    const res = await call(
      createReq({
        method: 'PATCH',
        headers: { 'x-admin-token': 'cokolwiek' },
        body: { status: 'preparing' },
      })
    );
    expect(res.statusCode).toBe(403);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PATCH - allowlista pol
// ---------------------------------------------------------------------------

describe('T1 / PATCH allowlista pol', () => {
  const auth = { 'x-admin-token': VALID_TOKEN };

  it('poprawny token + dozwolone pole -> sukces', async () => {
    const res = await call(
      createReq({ method: 'PATCH', headers: auth, body: { status: 'preparing' } })
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(updateSpy).toHaveBeenCalledWith({ status: 'preparing' });
  });

  it('notes rowniez przechodzi', async () => {
    const res = await call(
      createReq({ method: 'PATCH', headers: auth, body: { notes: 'bez cebuli' } })
    );
    expect(res.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith({ notes: 'bez cebuli' });
  });

  it('poprawny token + user_id -> 400, pole nie jest zapisywalne', async () => {
    const res = await call(
      createReq({
        method: 'PATCH',
        headers: auth,
        body: { user_id: 'ktos-inny' },
      })
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'field_not_allowed' });
    expect(res.body.fields).toContain('user_id');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('payload z dodatkowym polem NIE jest stosowany czesciowo', async () => {
    const res = await call(
      createReq({
        method: 'PATCH',
        headers: auth,
        body: { status: 'preparing', user_id: 'ktos-inny' },
      })
    );
    expect(res.statusCode).toBe(400);
    // Kluczowa asercja: dozwolone pole 'status' rowniez nie zostalo zapisane.
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('nieznane pole rowniez odrzuca cale zadanie', async () => {
    const res = await call(
      createReq({
        method: 'PATCH',
        headers: auth,
        body: { status: 'preparing', total_price: 0 },
      })
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.fields).toContain('total_price');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('pusty payload -> 400', async () => {
    const res = await call(createReq({ method: 'PATCH', headers: auth, body: {} }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'empty_payload' });
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PATCH - domena wartosci statusu
// ---------------------------------------------------------------------------

describe('T1 / PATCH domena statusu', () => {
  const auth = { 'x-admin-token': VALID_TOKEN };

  // Dokladnie szesc wartosci z constraintu orders_status_check odczytanego
  // z bazy 2026-08-08 (docs/SUPABASE_LIVE_INVENTORY_2026-08-08.md).
  it.each(['pending', 'preparing', 'completed', 'delivered', 'cancelled', 'accepted'])(
    'przyjmuje status %s',
    async (status) => {
      const res = await call(createReq({ method: 'PATCH', headers: auth, body: { status } }));
      expect(res.statusCode).toBe(200);
    }
  );

  it('odrzuca confirmed - baza go NIE dopuszcza mimo uzycia w finalizeOrder.js', async () => {
    const res = await call(createReq({ method: 'PATCH', headers: auth, body: { status: 'confirmed' } }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'status_not_allowed' });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('odrzuca status spoza domeny', async () => {
    const res = await call(
      createReq({ method: 'PATCH', headers: auth, body: { status: 'wlasnie-wymyslony' } })
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'status_not_allowed' });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('odrzuca pusty status', async () => {
    const res = await call(createReq({ method: 'PATCH', headers: auth, body: { status: '   ' } }));
    expect(res.statusCode).toBe(400);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('odrzuca PATCH bez identyfikatora zamowienia', async () => {
    const res = await call(
      createReq({ method: 'PATCH', url: '/api/orders', headers: auth, body: { status: 'preparing' } })
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'missing_order_id' });
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET - filtr autoryzacyjny
// ---------------------------------------------------------------------------

describe('T1 / GET filtr autoryzacyjny', () => {
  it('bez zakresu i bez tokenu -> 400 zamiast zrzutu calej tabeli', async () => {
    const res = await call(createReq({ method: 'GET', url: '/api/orders', query: {} }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'scope_required' });
  });

  it('samo user_email nie otwiera juz pelnej listy', async () => {
    const res = await call(
      createReq({ method: 'GET', url: '/api/orders', query: { user_email: 'kto@example.com' } })
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'scope_required' });
  });

  it('z restaurant_id -> przechodzi', async () => {
    const res = await call(
      createReq({ method: 'GET', url: '/api/orders', query: { restaurant_id: 'rest-1' } })
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('orders');
  });

  it('z user_id -> przechodzi', async () => {
    const res = await call(
      createReq({ method: 'GET', url: '/api/orders', query: { user_id: 'user-1' } })
    );
    expect(res.statusCode).toBe(200);
  });

  it('token admina pozwala na pelna liste bez zakresu', async () => {
    const res = await call(
      createReq({
        method: 'GET',
        url: '/api/orders',
        headers: { 'x-admin-token': VALID_TOKEN },
        query: {},
      })
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('orders');
  });

  it('bledny token bez zakresu nie otwiera pelnej listy', async () => {
    const res = await call(
      createReq({
        method: 'GET',
        url: '/api/orders',
        headers: { 'x-admin-token': 'zly' },
        query: {},
      })
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'scope_required' });
  });
});
