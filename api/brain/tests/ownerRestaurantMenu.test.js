/**
 * ownerRestaurantMenu.test.js
 * ===========================================================================
 * D3 owner-write — GET/POST /api/owner/restaurants/:id/menu,
 * PATCH/DELETE /api/owner/restaurants/:restaurantId/menu/:itemId
 * (api/owner/restaurantMenu.js).
 *
 * Wzorzec mockow identyczny z ownerRestaurants.test.js (spy-based fluent
 * query builder + createReq/createRes/call), rozszerzony o branchowanie
 * `from()` po nazwie tabeli — ten handler dotyka TRZECH tabel:
 * `business_members` (wyprowadzenie zasiegu), `restaurants` (bramka
 * przechodnia) i `menu_items_v2` (wlasciwa operacja) — kazda z wlasnym,
 * niezaleznym wynikiem.
 *
 * ZMIANA MODELU (2026-08-19): wlasnosc lokalu przeszla z osoby
 * (`restaurants.owner_id`) na firme (`restaurants.business_account_id`),
 * a zwiazek osoby z firma zyje w `business_members`.
 *
 * ZDOLNOSC: ten endpoint pyta o `menu.manage`, NIE o `venue.manage` — lustro
 * polityki `menu_business_read` (20260818000400_newbase_rls.sql:181-184).
 * Rozdzial jest celowy: rola moze miec prawo do menu bez prawa do edycji
 * samego lokalu.
 * ===========================================================================
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getUserMock = vi.fn();
const fromSpy = vi.fn();
const eqSpy = vi.fn();
const inSpy = vi.fn();
const selectSpy = vi.fn();
const insertSpy = vi.fn();
const updateSpy = vi.fn();
const deleteSpy = vi.fn();
const orderSpy = vi.fn();

/** Wyprowadzenie zasiegu (.from('business_members')). */
let memberResult = { data: [], error: null };
/** Bramka przechodnia (getScopedRestaurant -> .from('restaurants')...). */
let restaurantResult = { data: null, error: null };
/** Wlasciwa operacja na .from('menu_items_v2'). */
let menuResult = { data: null, error: null };

/** Zdolnosci przepisane 1:1 z 20260818000200_newbase_business.sql. */
const OWNER_CAPS = [
  'orders.read', 'orders.update_status', 'menu.manage',
  'venue.manage', 'members.manage', 'analytics.read', 'billing.read',
];
/** staff = kuchnia/kelner. CELOWO bez menu.manage — nie edytuje karty. */
const STAFF_CAPS = ['orders.read', 'orders.update_status'];
/**
 * Rola hipotetyczna, ktorej dzis nie ma w `business_roles`: prawo do menu BEZ
 * prawa do lokalu. Istnieje w tym pliku po to, by udowodnic, ze bramka menu
 * pyta o `menu.manage`, a nie o `venue.manage` — gdyby pytala o to drugie,
 * ten przypadek dostalby 404. Dodanie takiej roli na produkcji to INSERT,
 * nie migracja schematu, wiec test chroni realna sciezke rozszerzenia.
 */
const MENU_ONLY_CAPS = ['orders.read', 'menu.manage'];

function membership({ accountId = 'acc-1', capabilities = OWNER_CAPS, status = 'active' } = {}) {
  return {
    business_account_id: accountId,
    business_roles: { capabilities },
    business_accounts: { status },
  };
}

function makeQueryBuilder(resultGetter) {
  const qb = {
    eq: (...args) => {
      eqSpy(...args);
      return qb;
    },
    in: (...args) => {
      inSpy(...args);
      return qb;
    },
    order: (...args) => {
      orderSpy(...args);
      return qb;
    },
    select: (...args) => {
      selectSpy(...args);
      return qb;
    },
    maybeSingle: () => Promise.resolve(resultGetter()),
    single: () => Promise.resolve(resultGetter()),
    then: (resolve, reject) => Promise.resolve(resultGetter()).then(resolve, reject),
  };
  return qb;
}

vi.mock('../../_supabase.js', () => ({
  supabase: {
    auth: { getUser: (...args) => getUserMock(...args) },
    from: vi.fn((table) => {
      fromSpy(table);
      if (table === 'business_members') {
        return {
          select: (...args) => {
            selectSpy(...args);
            return makeQueryBuilder(() => memberResult);
          },
        };
      }
      if (table === 'restaurants') {
        return {
          select: (...args) => {
            selectSpy(...args);
            return makeQueryBuilder(() => restaurantResult);
          },
        };
      }
      return {
        select: (...args) => {
          selectSpy(...args);
          return makeQueryBuilder(() => menuResult);
        },
        insert: (...args) => {
          insertSpy(...args);
          return makeQueryBuilder(() => menuResult);
        },
        update: (...args) => {
          updateSpy(...args);
          return makeQueryBuilder(() => menuResult);
        },
        delete: (...args) => {
          deleteSpy(...args);
          return makeQueryBuilder(() => menuResult);
        },
      };
    }),
  },
}));

const { default: handler } = await import('../../owner/restaurantMenu.js');

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

function createReq({ method = 'GET', url = '/api/owner/restaurants/r1/menu', headers = {}, params = {}, body = {} }) {
  return { method, url, headers, params, body };
}

async function call(req) {
  const res = createRes();
  await handler(req, res);
  return res;
}

const AUTH_OK = { authorization: 'Bearer dobry-token' };

beforeEach(() => {
  getUserMock.mockReset();
  fromSpy.mockClear();
  eqSpy.mockClear();
  inSpy.mockClear();
  selectSpy.mockClear();
  insertSpy.mockClear();
  updateSpy.mockClear();
  deleteSpy.mockClear();
  orderSpy.mockClear();
  // Domyslnie: wywolujacy jest wlascicielem firmy 'acc-1'. Testy ponizej
  // roznicuja wynik na poziomie `restaurantResult`, tak jak przed przepieciem.
  memberResult = { data: [membership()], error: null };
  restaurantResult = { data: null, error: null };
  menuResult = { data: null, error: null };
});

describe('GET /api/owner/restaurants/:id/menu', () => {
  it('brak naglowka Authorization -> 401, zero zapytan', async () => {
    const res = await call(createReq({ params: { id: 'r1' } }));
    expect(res.statusCode).toBe(401);
    expect(getUserMock).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('niepoprawny token -> 401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } });
    const res = await call(createReq({ params: { id: 'r1' }, headers: { authorization: 'Bearer zly' } }));
    expect(res.statusCode).toBe(401);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('wlasna restauracja -> 200, zwraca WSZYSTKIE pozycje wlacznie z available=false', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    restaurantResult = { data: { id: 'r1' }, error: null };
    menuResult = {
      data: [
        { id: 'm1', name: 'Pizza', price_pln: 20, available: true },
        { id: 'm2', name: 'Kalzone', price_pln: 22, available: false },
      ],
      error: null,
    };

    const res = await call(createReq({ params: { id: 'r1' }, headers: AUTH_OK }));

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.find((i) => i.id === 'm2').available).toBe(false);
    // Zasieg wyprowadzony z czlonkostwa po JWT userId, nie z requestu...
    expect(fromSpy).toHaveBeenCalledWith('business_members');
    expect(eqSpy).toHaveBeenCalledWith('user_id', 'owner-1');
    // ...i uzyty jako ZBIOR firm w bramce na tabeli restaurants.
    expect(fromSpy).toHaveBeenCalledWith('restaurants');
    expect(inSpy).toHaveBeenCalledWith('business_account_id', ['acc-1']);
    // menu filtrowane po restaurant_id z URL, bez filtra po available
    expect(fromSpy).toHaveBeenCalledWith('menu_items_v2');
    expect(eqSpy).toHaveBeenCalledWith('restaurant_id', 'r1');
  });

  it('cudza restauracja -> 404, zero zapytan do menu_items_v2', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    restaurantResult = { data: null, error: null };

    const res = await call(createReq({ params: { id: 'cudza' }, headers: AUTH_OK }));

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ ok: false, error: 'not_found' });
    expect(fromSpy).not.toHaveBeenCalledWith('menu_items_v2');
  });

  it('metoda spoza GET/POST/PATCH/DELETE -> 405', async () => {
    const res = await call(createReq({ method: 'PUT', params: { id: 'r1' } }));
    expect(res.statusCode).toBe(405);
    expect(getUserMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/owner/restaurants/:id/menu', () => {
  it('wlasna restauracja -> 201, insert z restaurant_id z URL', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    restaurantResult = { data: { id: 'r1' }, error: null };
    menuResult = { data: { id: 'm-new', name: 'Nowa pozycja', price_pln: 15 }, error: null };

    const res = await call(
      createReq({
        method: 'POST',
        params: { id: 'r1' },
        headers: AUTH_OK,
        body: { name: 'Nowa pozycja', price_pln: 15, available: true },
      })
    );

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ ok: true, data: { id: 'm-new' } });
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Nowa pozycja', price_pln: 15, restaurant_id: 'r1' })
    );
  });

  it('cudza restauracja -> 404, zero insert()', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    restaurantResult = { data: null, error: null };

    const res = await call(
      createReq({
        method: 'POST',
        params: { id: 'cudza' },
        headers: AUTH_OK,
        body: { name: 'X', price_pln: 10 },
      })
    );

    expect(res.statusCode).toBe(404);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('restaurant_id z body jest ignorowany — insert zawsze do :id z URL, nigdy do cudzego lokalu', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    restaurantResult = { data: { id: 'r1' }, error: null };
    menuResult = { data: { id: 'm-new' }, error: null };

    await call(
      createReq({
        method: 'POST',
        params: { id: 'r1' },
        headers: AUTH_OK,
        body: { name: 'X', price_pln: 10, restaurant_id: 'restauracja-napastnika' },
      })
    );

    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ restaurant_id: 'r1' }));
    expect(insertSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ restaurant_id: 'restauracja-napastnika' })
    );
  });

  it('brak name -> 400 invalid_payload, zero insert()', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    restaurantResult = { data: { id: 'r1' }, error: null };

    const res = await call(
      createReq({ method: 'POST', params: { id: 'r1' }, headers: AUTH_OK, body: { price_pln: 10 } })
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'invalid_payload' });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('ujemna cena -> 400 invalid_payload, zero insert()', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    restaurantResult = { data: { id: 'r1' }, error: null };

    const res = await call(
      createReq({
        method: 'POST',
        params: { id: 'r1' },
        headers: AUTH_OK,
        body: { name: 'X', price_pln: -5 },
      })
    );

    expect(res.statusCode).toBe(400);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('brak description/category/image_url -> default null, brak available -> default true', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    restaurantResult = { data: { id: 'r1' }, error: null };
    menuResult = { data: { id: 'm-new' }, error: null };

    await call(
      createReq({
        method: 'POST',
        params: { id: 'r1' },
        headers: AUTH_OK,
        body: { name: 'X', price_pln: 10 },
      })
    );

    expect(insertSpy).toHaveBeenCalledWith({
      name: 'X',
      price_pln: 10,
      description: null,
      category: null,
      available: true,
      image_url: null,
      restaurant_id: 'r1',
    });
  });
});

describe('PATCH /api/owner/restaurants/:restaurantId/menu/:itemId', () => {
  it('wlasny item -> 200, update filtrowany po id ORAZ restaurant_id', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    restaurantResult = { data: { id: 'r1' }, error: null };
    menuResult = { data: { id: 'm1', name: 'Zaktualizowane' }, error: null };

    const res = await call(
      createReq({
        method: 'PATCH',
        url: '/api/owner/restaurants/r1/menu/m1',
        params: { restaurantId: 'r1', itemId: 'm1' },
        headers: AUTH_OK,
        body: { name: 'Zaktualizowane' },
      })
    );

    expect(res.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith({ name: 'Zaktualizowane' });
    expect(eqSpy).toHaveBeenCalledWith('id', 'm1');
    expect(eqSpy).toHaveBeenCalledWith('restaurant_id', 'r1');
  });

  it('item z innej restauracji (cudzy restaurantId w URL) -> 404 juz na etapie ownership restauracji', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    restaurantResult = { data: null, error: null }; // :restaurantId nie nalezy do ownera

    const res = await call(
      createReq({
        method: 'PATCH',
        params: { restaurantId: 'cudza-restauracja', itemId: 'm1' },
        headers: AUTH_OK,
        body: { name: 'Przejecie' },
      })
    );

    expect(res.statusCode).toBe(404);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('item istnieje, ale nalezy do innej restauracji niz :restaurantId w URL (IDOR) -> 404, zero danych', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    restaurantResult = { data: { id: 'r1' }, error: null }; // r1 nalezy do ownera
    // item m1 realnie nalezy do innej restauracji -> update .eq('id','m1').eq('restaurant_id','r1') trafia 0 wierszy
    menuResult = { data: null, error: null };

    const res = await call(
      createReq({
        method: 'PATCH',
        params: { restaurantId: 'r1', itemId: 'm1' },
        headers: AUTH_OK,
        body: { name: 'X' },
      })
    );

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('id/restaurant_id w body sa ignorowane (allowlist ich nie zna)', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    restaurantResult = { data: { id: 'r1' }, error: null };
    menuResult = { data: { id: 'm1' }, error: null };

    await call(
      createReq({
        method: 'PATCH',
        params: { restaurantId: 'r1', itemId: 'm1' },
        headers: AUTH_OK,
        body: { name: 'X', id: 'inny-item', restaurant_id: 'inna-restauracja' },
      })
    );

    expect(updateSpy).toHaveBeenCalledWith({ name: 'X' });
    expect(eqSpy).toHaveBeenCalledWith('restaurant_id', 'r1');
  });

  it('brak itemId w URL -> 400 missing_item_id', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    const res = await call(
      createReq({ method: 'PATCH', params: { restaurantId: 'r1' }, headers: AUTH_OK, body: { name: 'X' } })
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'missing_item_id' });
  });
});

describe('DELETE /api/owner/restaurants/:restaurantId/menu/:itemId', () => {
  it('wlasny item -> 200, delete filtrowany po id ORAZ restaurant_id', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    restaurantResult = { data: { id: 'r1' }, error: null };
    menuResult = { data: { id: 'm1' }, error: null };

    const res = await call(
      createReq({
        method: 'DELETE',
        params: { restaurantId: 'r1', itemId: 'm1' },
        headers: AUTH_OK,
      })
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, data: { id: 'm1' } });
    expect(deleteSpy).toHaveBeenCalled();
    expect(eqSpy).toHaveBeenCalledWith('id', 'm1');
    expect(eqSpy).toHaveBeenCalledWith('restaurant_id', 'r1');
  });

  it('cudzy item (restauracja nie nalezy do ownera) -> 404, zero delete()', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    restaurantResult = { data: null, error: null };

    const res = await call(
      createReq({ method: 'DELETE', params: { restaurantId: 'cudza', itemId: 'm1' }, headers: AUTH_OK })
    );

    expect(res.statusCode).toBe(404);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('item istnieje ale w innej restauracji niz :restaurantId (IDOR) -> 404', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    restaurantResult = { data: { id: 'r1' }, error: null };
    menuResult = { data: null, error: null };

    const res = await call(
      createReq({ method: 'DELETE', params: { restaurantId: 'r1', itemId: 'cudzy-item' }, headers: AUTH_OK })
    );

    expect(res.statusCode).toBe(404);
  });
});

describe('Zasieg firmowy — zdolnosc menu.manage', () => {
  it('user BEZ zadnego czlonkostwa -> 404 i ZERO zapytan do restaurants oraz menu_items_v2', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'obcy-user' } }, error: null });
    memberResult = { data: [], error: null };
    restaurantResult = { data: { id: 'r1' }, error: null };
    menuResult = { data: [{ id: 'm1' }], error: null };

    const res = await call(createReq({ params: { id: 'r1' }, headers: AUTH_OK }));

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ ok: false, error: 'not_found' });
    expect(fromSpy).not.toHaveBeenCalledWith('restaurants');
    expect(fromSpy).not.toHaveBeenCalledWith('menu_items_v2');
  });

  it('rola staff (bez menu.manage) -> 404 na GET, ZERO dotkniecia menu_items_v2', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'kucharz-1' } }, error: null });
    memberResult = { data: [membership({ capabilities: STAFF_CAPS })], error: null };
    // Lokal ISTNIEJE — 404 ma przyjsc z braku zdolnosci, nie z braku wiersza.
    restaurantResult = { data: { id: 'r1' }, error: null };
    menuResult = { data: [{ id: 'm1' }], error: null };

    const res = await call(createReq({ params: { id: 'r1' }, headers: AUTH_OK }));

    expect(res.statusCode).toBe(404);
    expect(fromSpy).not.toHaveBeenCalledWith('menu_items_v2');
  });

  it('rola staff -> 404 na POST, ZERO insert()', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'kucharz-1' } }, error: null });
    memberResult = { data: [membership({ capabilities: STAFF_CAPS })], error: null };
    // Lokal ISTNIEJE — 404 ma przyjsc z braku zdolnosci, nie z braku wiersza.
    restaurantResult = { data: { id: 'r1' }, error: null };
    menuResult = { data: [{ id: 'm1' }], error: null };

    const res = await call(
      createReq({
        method: 'POST',
        params: { id: 'r1' },
        headers: AUTH_OK,
        body: { name: 'X', price_pln: 10 },
      })
    );

    expect(res.statusCode).toBe(404);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rola staff -> 404 na PATCH, ZERO update()', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'kucharz-1' } }, error: null });
    memberResult = { data: [membership({ capabilities: STAFF_CAPS })], error: null };
    // Lokal ISTNIEJE — 404 ma przyjsc z braku zdolnosci, nie z braku wiersza.
    restaurantResult = { data: { id: 'r1' }, error: null };
    menuResult = { data: [{ id: 'm1' }], error: null };

    const res = await call(
      createReq({
        method: 'PATCH',
        params: { restaurantId: 'r1', itemId: 'm1' },
        headers: AUTH_OK,
        body: { name: 'X' },
      })
    );

    expect(res.statusCode).toBe(404);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('rola staff -> 404 na DELETE, ZERO delete()', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'kucharz-1' } }, error: null });
    memberResult = { data: [membership({ capabilities: STAFF_CAPS })], error: null };
    // Lokal ISTNIEJE — 404 ma przyjsc z braku zdolnosci, nie z braku wiersza.
    restaurantResult = { data: { id: 'r1' }, error: null };
    menuResult = { data: [{ id: 'm1' }], error: null };

    const res = await call(
      createReq({ method: 'DELETE', params: { restaurantId: 'r1', itemId: 'm1' }, headers: AUTH_OK })
    );

    expect(res.statusCode).toBe(404);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('firma zawieszona -> 404 mimo waznego czlonkostwa z komplet zdolnosci', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    memberResult = { data: [membership({ status: 'suspended' })], error: null };
    restaurantResult = { data: { id: 'r1' }, error: null };
    menuResult = { data: [{ id: 'm1' }], error: null };

    const res = await call(createReq({ params: { id: 'r1' }, headers: AUTH_OK }));

    expect(res.statusCode).toBe(404);
    expect(fromSpy).not.toHaveBeenCalledWith('menu_items_v2');
  });

  it('rola z menu.manage ale BEZ venue.manage -> przechodzi bramke (dowod, ze pytamy o wlasciwa zdolnosc)', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'menuowy-1' } }, error: null });
    memberResult = { data: [membership({ capabilities: MENU_ONLY_CAPS })], error: null };
    restaurantResult = { data: { id: 'r1' }, error: null };
    menuResult = { data: [{ id: 'm1', name: 'Pizza' }], error: null };

    const res = await call(createReq({ params: { id: 'r1' }, headers: AUTH_OK }));

    expect(res.statusCode).toBe(200);
    expect(fromSpy).toHaveBeenCalledWith('menu_items_v2');
  });

  it('czlonkostwo w dwoch firmach -> bramka dostaje zbior obu id', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null });
    memberResult = {
      data: [membership({ accountId: 'acc-1' }), membership({ accountId: 'acc-2' })],
      error: null,
    };
    restaurantResult = { data: { id: 'r1' }, error: null };
    menuResult = { data: [], error: null };

    await call(createReq({ params: { id: 'r1' }, headers: AUTH_OK }));

    expect(inSpy).toHaveBeenCalledWith('business_account_id', ['acc-1', 'acc-2']);
  });
});
