/**
 * ownerOrders.test.js
 * ===========================================================================
 * `api/owner/orders.js` — zasieg firmowy dla zamowien (KDS).
 *
 * DLACZEGO TEN ENDPOINT ISTNIEJE: `BusinessPanelNew.tsx` -> `useKDSPolling.ts`
 * -> `lib/kdsApi.ts` wola `GET/PATCH /api/owner/orders[/:id]` od dawna, ale
 * backend nigdy nie dostal odpowiednika — produkcja nie ma nawet katalogu
 * `api/owner/`. KDS odpowiadal 404 i nie widzial zamowien (sesja 14).
 *
 * DLACZEGO TE TESTY SA JEDYNA OCHRONA: polityki RLS nowej bazy stoja na
 * `private.has_capability()`, ktora czyta `auth.uid()`. Backend laczy sie
 * kluczem service_role — RLS omija, `auth.uid()` jest NULL. Polityki nie
 * chronia tego pliku ani troche. Filtr zasiegu w kodzie jest jedynym
 * mechanizmem, wiec testy negatywne sa tu wazniejsze od pozytywnych.
 *
 * ZDOLNOSCI (lustro `business_roles.capabilities`, 20260818000200):
 *   GET   -> `orders.read`
 *   PATCH -> `orders.update_status`
 * CELOWO inne niz `venue.manage` z `restaurants.js`: `staff` i `reception`
 * NIE MAJA wstepu do panelu lokalu, ale MAJA obslugiwac kuchnie (§8).
 *
 * ZASIEG JEST PRZECHODNI. `orders` nie ma kolumny `business_account_id` —
 * ma tylko `restaurant_id`. Przynaleznosc zamowienia do firmy biegnie przez
 * `restaurants.business_account_id`, wiec zasieg musi byc osobnym krokiem
 * PRZED dotknieciem tabeli `orders`.
 * ===========================================================================
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getUserMock = vi.fn();
const fromSpy = vi.fn();
const eqSpy = vi.fn();
const inSpy = vi.fn();
const selectSpy = vi.fn();
const updateSpy = vi.fn();
const limitSpy = vi.fn();

let memberResult = { data: [], error: null };
let restaurantResult = { data: [], error: null };
let orderResult = { data: null, error: null };

/** Zdolnosci przepisane 1:1 z 20260818000200_newbase_business.sql. */
const OWNER_CAPS = [
  'orders.read', 'orders.update_status', 'menu.manage',
  'venue.manage', 'members.manage', 'analytics.read', 'billing.read',
];
/** staff = kuchnia. Bez `venue.manage`, ale Z obiema zdolnosciami zamowien. */
const STAFF_CAPS = ['orders.read', 'orders.update_status'];
/** Rola hipotetyczna: widzi zamowienia, nie moze zmieniac statusu. */
const READONLY_CAPS = ['orders.read'];

function membership({ accountId = 'acc-1', capabilities = OWNER_CAPS, status = 'active' } = {}) {
  return {
    business_account_id: accountId,
    business_roles: { capabilities },
    business_accounts: { status },
  };
}

function makeQueryBuilder(resultGetter) {
  const qb = {
    eq: (...args) => { eqSpy(...args); return qb; },
    in: (...args) => { inSpy(...args); return qb; },
    select: (...args) => { selectSpy(...args); return qb; },
    limit: (...args) => { limitSpy(...args); return Promise.resolve(resultGetter()); },
    // W PostgREST `.order()` jest CHAINABLE — mozna po nim wolac `.limit()`.
    // (Harness `ownerRestaurants.test.js` konczy nim lancuch, bo tamten
    // endpoint nie limituje; tutaj skopiowanie tamtej wersji dawalo
    // "order(...).limit is not a function".)
    order: () => qb,
    maybeSingle: () => Promise.resolve(resultGetter()),
    then: (resolve, reject) => Promise.resolve(resultGetter()).then(resolve, reject),
  };
  return qb;
}

vi.mock('../../_supabase.js', () => ({
  supabase: {
    auth: { getUser: (...args) => getUserMock(...args) },
    from: vi.fn((table) => {
      fromSpy(table);
      const resultGetter =
        table === 'business_members' ? () => memberResult
          : table === 'restaurants' ? () => restaurantResult
            : () => orderResult;
      return {
        select: (...args) => { selectSpy(...args); return makeQueryBuilder(resultGetter); },
        update: (...args) => { updateSpy(...args); return makeQueryBuilder(resultGetter); },
      };
    }),
  },
}));

const { default: handler } = await import('../../owner/orders.js');

function createRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function createReq({ method = 'GET', url = '/api/owner/orders', headers = {}, params = {}, query = {}, body = {} }) {
  return { method, url, headers, params, query, body };
}

async function call(req) {
  const res = createRes();
  await handler(req, res);
  return res;
}

/** Ile razy handler siegnal do tabeli `orders`. */
function orderQueries() {
  return fromSpy.mock.calls.filter(([table]) => table === 'orders').length;
}

function authAs(userId) {
  getUserMock.mockResolvedValue({ data: { user: { id: userId } }, error: null });
}

const BEARER = { authorization: 'Bearer dobry-token' };

beforeEach(() => {
  getUserMock.mockReset();
  fromSpy.mockClear();
  eqSpy.mockClear();
  inSpy.mockClear();
  selectSpy.mockClear();
  updateSpy.mockClear();
  limitSpy.mockClear();
  memberResult = { data: [], error: null };
  restaurantResult = { data: [], error: null };
  orderResult = { data: null, error: null };
});

describe('/api/owner/orders — auth', () => {
  it('brak naglowka Authorization -> 401, zero zapytan do Supabase', async () => {
    const res = await call(createReq({}));
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(getUserMock).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('niepoprawny token -> 401, zero zapytan do orders', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } });
    const res = await call(createReq({ headers: { authorization: 'Bearer zly' } }));
    expect(res.statusCode).toBe(401);
    expect(orderQueries()).toBe(0);
  });

  it('metoda spoza GET/PATCH -> 405', async () => {
    const res = await call(createReq({ method: 'DELETE', headers: BEARER }));
    expect(res.statusCode).toBe(405);
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/owner/orders — zasieg', () => {
  it('brak restaurant_id -> 400 scope_required, zero zapytan do orders', async () => {
    authAs('user-1');
    const res = await call(createReq({ headers: BEARER }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'scope_required' });
    expect(orderQueries()).toBe(0);
  });

  it('brak czlonkostwa -> 404, tabela orders NIE jest pytana', async () => {
    authAs('user-obcy');
    memberResult = { data: [], error: null };
    const res = await call(createReq({ headers: BEARER, query: { restaurant_id: 'rest-1' } }));
    expect(res.statusCode).toBe(404);
    expect(orderQueries()).toBe(0);
  });

  it('lokal nalezy do cudzej firmy -> 404, tabela orders NIE jest pytana', async () => {
    authAs('user-1');
    memberResult = { data: [membership({ accountId: 'acc-1' })], error: null };
    restaurantResult = { data: null, error: null }; // maybeSingle nie znalazl w zasiegu
    const res = await call(createReq({ headers: BEARER, query: { restaurant_id: 'rest-cudzy' } }));
    expect(res.statusCode).toBe(404);
    expect(orderQueries()).toBe(0);
  });

  it('zawieszona firma -> 404 mimo poprawnej zdolnosci', async () => {
    authAs('user-1');
    memberResult = { data: [membership({ status: 'suspended' })], error: null };
    const res = await call(createReq({ headers: BEARER, query: { restaurant_id: 'rest-1' } }));
    expect(res.statusCode).toBe(404);
    expect(orderQueries()).toBe(0);
  });

  it('rola bez orders.read -> 404', async () => {
    authAs('user-1');
    memberResult = { data: [membership({ capabilities: ['venue.manage'] })], error: null };
    const res = await call(createReq({ headers: BEARER, query: { restaurant_id: 'rest-1' } }));
    expect(res.statusCode).toBe(404);
    expect(orderQueries()).toBe(0);
  });

  it('staff (kuchnia) widzi zamowienia swojego lokalu', async () => {
    authAs('user-kuchnia');
    memberResult = { data: [membership({ capabilities: STAFF_CAPS })], error: null };
    restaurantResult = { data: { id: 'rest-1' }, error: null };
    orderResult = { data: [{ id: 'ord-1', status: 'pending' }], error: null };

    const res = await call(createReq({ headers: BEARER, query: { restaurant_id: 'rest-1' } }));

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(res.body.data).toHaveLength(1);
    expect(eqSpy).toHaveBeenCalledWith('restaurant_id', 'rest-1');
  });
});

describe('PATCH /api/owner/orders/:id — ksztalt zadania', () => {
  it('brak id -> 400, zero zapytan', async () => {
    authAs('user-1');
    const res = await call(createReq({ method: 'PATCH', headers: BEARER, body: { status: 'preparing' } }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'missing_id' });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('brak status w body -> 400, zero zapytan', async () => {
    authAs('user-1');
    const res = await call(createReq({ method: 'PATCH', headers: BEARER, params: { id: 'ord-1' }, body: {} }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'invalid_status' });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('status spoza allowlisty -> 400 PRZED dotknieciem bazy', async () => {
    authAs('user-1');
    const res = await call(createReq({
      method: 'PATCH', headers: BEARER, params: { id: 'ord-1' }, body: { status: 'zmyslony' },
    }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'invalid_status' });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('status systemowy (confirmed) jest odrzucany — kuchnia nie zamazuje sladu platnosci', async () => {
    authAs('user-1');
    const res = await call(createReq({
      method: 'PATCH', headers: BEARER, params: { id: 'ord-1' }, body: { status: 'confirmed' },
    }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'invalid_status' });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it.each(['accepted', 'preparing', 'completed', 'delivered', 'cancelled'])(
    'status %s jest dozwolony (mapa KDS)',
    async (status) => {
      authAs('user-1');
      memberResult = { data: [membership({ capabilities: STAFF_CAPS })], error: null };
      restaurantResult = { data: [{ id: 'rest-1' }], error: null };
      orderResult = { data: { id: 'ord-1', status }, error: null };

      const res = await call(createReq({
        method: 'PATCH', headers: BEARER, params: { id: 'ord-1' }, body: { status },
      }));

      expect(res.statusCode).toBe(200);
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status }));
    },
  );
});

describe('PATCH /api/owner/orders/:id — zasieg', () => {
  it('rola bez orders.update_status -> 404, tabela orders NIE jest pytana', async () => {
    authAs('user-1');
    memberResult = { data: [membership({ capabilities: READONLY_CAPS })], error: null };
    const res = await call(createReq({
      method: 'PATCH', headers: BEARER, params: { id: 'ord-1' }, body: { status: 'preparing' },
    }));
    expect(res.statusCode).toBe(404);
    expect(orderQueries()).toBe(0);
  });

  it('brak czlonkostwa -> 404, tabela orders NIE jest pytana', async () => {
    authAs('user-obcy');
    memberResult = { data: [], error: null };
    const res = await call(createReq({
      method: 'PATCH', headers: BEARER, params: { id: 'ord-1' }, body: { status: 'preparing' },
    }));
    expect(res.statusCode).toBe(404);
    expect(orderQueries()).toBe(0);
  });

  it('cudze zamowienie -> 404 (zero zaktualizowanych wierszy)', async () => {
    authAs('user-1');
    memberResult = { data: [membership({ capabilities: STAFF_CAPS })], error: null };
    restaurantResult = { data: [{ id: 'rest-1' }], error: null };
    orderResult = { data: null, error: null };

    const res = await call(createReq({
      method: 'PATCH', headers: BEARER, params: { id: 'ord-cudze' }, body: { status: 'preparing' },
    }));
    expect(res.statusCode).toBe(404);
  });

  it('restaurant_id z BODY nie rozszerza zasiegu — filtr idzie z czlonkostwa', async () => {
    authAs('user-1');
    memberResult = { data: [membership({ capabilities: STAFF_CAPS })], error: null };
    restaurantResult = { data: [{ id: 'rest-moj' }], error: null };
    orderResult = { data: { id: 'ord-1', status: 'preparing' }, error: null };

    await call(createReq({
      method: 'PATCH',
      headers: BEARER,
      params: { id: 'ord-1' },
      body: { status: 'preparing', restaurant_id: 'rest-CUDZY' },
    }));

    // Filtr zamowien musi stac na liscie z zasiegu, nigdy na wartosci z body.
    expect(inSpy).toHaveBeenCalledWith('restaurant_id', ['rest-moj']);
    const podaneListy = inSpy.mock.calls.map(([, values]) => values).flat();
    expect(podaneListy).not.toContain('rest-CUDZY');
  });

  it('body nie moze przemycic innych kolumn niz status', async () => {
    authAs('user-1');
    memberResult = { data: [membership({ capabilities: STAFF_CAPS })], error: null };
    restaurantResult = { data: [{ id: 'rest-1' }], error: null };
    orderResult = { data: { id: 'ord-1', status: 'preparing' }, error: null };

    await call(createReq({
      method: 'PATCH',
      headers: BEARER,
      params: { id: 'ord-1' },
      body: { status: 'preparing', total_price: 1, user_id: 'ktos-inny', confirmed_at: null },
    }));

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const patch = updateSpy.mock.calls[0][0];
    expect(Object.keys(patch).sort()).toEqual(['status', 'updated_at']);
  });
});
