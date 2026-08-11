/**
 * ownerRestaurantMenu.test.js
 * ===========================================================================
 * D3 owner-write — GET/POST /api/owner/restaurants/:id/menu,
 * PATCH/DELETE /api/owner/restaurants/:restaurantId/menu/:itemId
 * (api/owner/restaurantMenu.js).
 *
 * Wzorzec mockow identyczny z ownerRestaurants.test.js (spy-based fluent
 * query builder + createReq/createRes/call), rozszerzony o branchowanie
 * `from()` po nazwie tabeli — ten handler dotyka DWOCH tabel: `restaurants`
 * (ownership pre-check, getOwnedRestaurant) i `menu_items_v2` (wlasciwa
 * operacja) — kazda z wlasnym, niezaleznym `queryResult`.
 * ===========================================================================
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getUserMock = vi.fn();
const fromSpy = vi.fn();
const eqSpy = vi.fn();
const selectSpy = vi.fn();
const insertSpy = vi.fn();
const updateSpy = vi.fn();
const deleteSpy = vi.fn();
const orderSpy = vi.fn();

/** Ownership pre-check (getOwnedRestaurant -> .from('restaurants')...). */
let restaurantResult = { data: null, error: null };
/** Wlasciwa operacja na .from('menu_items_v2'). */
let menuResult = { data: null, error: null };

function makeQueryBuilder(resultGetter) {
  const qb = {
    eq: (...args) => {
      eqSpy(...args);
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
  selectSpy.mockClear();
  insertSpy.mockClear();
  updateSpy.mockClear();
  deleteSpy.mockClear();
  orderSpy.mockClear();
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
    // ownership sprawdzany na tabeli restaurants, filtrowany po JWT userId, nie z requestu
    expect(fromSpy).toHaveBeenCalledWith('restaurants');
    expect(eqSpy).toHaveBeenCalledWith('owner_id', 'owner-1');
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
