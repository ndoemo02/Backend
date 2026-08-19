/**
 * ownerRestaurants.test.js
 * ===========================================================================
 * B1 owner-read + D3 owner-write (api/owner/restaurants.js), po przepieciu na
 * model wlasnosci NOWEJ bazy (2026-08-19).
 *
 * ZMIANA MODELU: wlasnosc nie jest juz cecha OSOBY (`restaurants.owner_id ->
 * auth.users.id`). W nowej bazie lokal nalezy do FIRMY
 * (`restaurants.business_account_id -> business_accounts.id`), a osoba jest
 * zwiazana z firma przez `business_members (user_id, business_account_id,
 * role_key)`. Kolumny `owner_id` NIE MA.
 *
 * DLACZEGO TE TESTY SA JEDYNA OCHRONA: polityki RLS nowej bazy stoja na
 * `private.has_capability()`, ktora czyta `auth.uid()`. Backend laczy sie
 * kluczem service_role — RLS omija, `auth.uid()` jest NULL. Polityki nie
 * chronia tych endpointow ani troche. Filtr zasiegu w kodzie backendu jest
 * jedynym mechanizmem, wiec testy negatywne sa tu wazniejsze od pozytywnych.
 *
 * Zdolnosc wymagana przez ten endpoint to `venue.manage` — lustro polityk
 * `restaurants_business_read` i `restaurants_business_update`
 * (20260818000400_newbase_rls.sql:165-172).
 *
 * Harness rozszerzony wzgledem poprzedniej wersji: handler dotyka DWOCH tabel
 * (`business_members` — wyprowadzenie zasiegu, `restaurants` — wlasciwa
 * operacja), kazda z wlasnym wynikiem, plus szpieg na `.in()`.
 * ===========================================================================
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getUserMock = vi.fn();
const fromSpy = vi.fn();
const eqSpy = vi.fn();
const inSpy = vi.fn();
const selectSpy = vi.fn();
const updateSpy = vi.fn();

/** Wynik zapytania o czlonkostwa (.from('business_members')). */
let memberResult = { data: [], error: null };
/** Wynik wlasciwej operacji (.from('restaurants')). */
let restaurantResult = { data: null, error: null };

/**
 * Zdolnosci przepisane 1:1 z 20260818000200_newbase_business.sql — jesli tam
 * sie zmienia, ten plik ma zaczac klamac glosno, a nie po cichu.
 */
const OWNER_CAPS = [
  'orders.read', 'orders.update_status', 'menu.manage',
  'venue.manage', 'members.manage', 'analytics.read', 'billing.read',
];
const MANAGER_CAPS = [
  'orders.read', 'orders.update_status', 'menu.manage', 'venue.manage', 'analytics.read',
];
/** staff = kuchnia/kelner. CELOWO bez venue.manage — nie ma wstepu do panelu lokalu. */
const STAFF_CAPS = ['orders.read', 'orders.update_status'];

/** Jeden wiersz `business_members` w ksztalcie, jaki zwraca PostgREST z osadzeniem. */
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
    select: (...args) => {
      selectSpy(...args);
      return qb;
    },
    order: () => Promise.resolve(resultGetter()),
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
      const resultGetter = table === 'business_members'
        ? () => memberResult
        : () => restaurantResult;
      return {
        select: (...args) => {
          selectSpy(...args);
          return makeQueryBuilder(resultGetter);
        },
        update: (...args) => {
          updateSpy(...args);
          return makeQueryBuilder(resultGetter);
        },
      };
    }),
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

function createReq({ method = 'GET', url = '/api/owner/restaurants', headers = {}, params = {}, body = {} }) {
  return { method, url, headers, params, body };
}

async function call(req) {
  const res = createRes();
  await handler(req, res);
  return res;
}

/** Ile razy handler siegnal do tabeli `restaurants`. */
function restaurantQueries() {
  return fromSpy.mock.calls.filter(([table]) => table === 'restaurants').length;
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
  memberResult = { data: [], error: null };
  restaurantResult = { data: null, error: null };
});

describe('GET /api/owner/restaurants — auth', () => {
  it('brak naglowka Authorization -> 401, zero zapytan do Supabase', async () => {
    const res = await call(createReq({}));
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(getUserMock).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
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
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('metoda inna niz GET -> 405, zero auth check', async () => {
    const res = await call(createReq({ method: 'POST' }));
    expect(res.statusCode).toBe(405);
    expect(getUserMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/owner/restaurants — zasieg wyprowadzony z czlonkostwa', () => {
  it('czlonek z venue.manage -> lista filtrowana po zbiorze firm, nie po osobie', async () => {
    authAs('user-1');
    memberResult = { data: [membership({ accountId: 'acc-1' })], error: null };
    restaurantResult = { data: [{ id: 'r1', name: 'Test', city: 'Piekary' }], error: null };

    const res = await call(createReq({ headers: BEARER }));

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, data: [{ id: 'r1', name: 'Test', city: 'Piekary' }] });
    // Zasieg pytany o tozsamosc z JWT, nigdy z requestu.
    expect(eqSpy).toHaveBeenCalledWith('user_id', 'user-1');
    // Filtr na restaurants jest ZBIOREM firm, nie skalarem osoby.
    expect(inSpy).toHaveBeenCalledWith('business_account_id', ['acc-1']);
    expect(selectSpy).toHaveBeenCalledWith('id,name,city');
  });

  it('czlonkostwo w DWOCH firmach -> zbior obu id, nie tylko pierwsze', async () => {
    authAs('user-1');
    memberResult = {
      data: [membership({ accountId: 'acc-1' }), membership({ accountId: 'acc-2', capabilities: MANAGER_CAPS })],
      error: null,
    };
    restaurantResult = { data: [{ id: 'r1' }, { id: 'r9' }], error: null };

    const res = await call(createReq({ headers: BEARER }));

    expect(res.statusCode).toBe(200);
    expect(inSpy).toHaveBeenCalledWith('business_account_id', ['acc-1', 'acc-2']);
  });

  it('ZERO czlonkostwa -> 200 z pusta lista i ZERO zapytan do restaurants', async () => {
    authAs('obcy-user');
    memberResult = { data: [], error: null };

    const res = await call(createReq({ headers: BEARER }));

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, data: [] });
    // Kluczowe: tabela restaurants nie zostaje nawet dotknieta — brak zasiegu
    // jest rozstrzygniety zanim powstanie jakikolwiek filtr.
    expect(restaurantQueries()).toBe(0);
    expect(inSpy).not.toHaveBeenCalled();
  });

  it('rola staff (bez venue.manage) -> pusta lista, ZERO zapytan do restaurants', async () => {
    authAs('kucharz-1');
    memberResult = { data: [membership({ capabilities: STAFF_CAPS })], error: null };

    const res = await call(createReq({ headers: BEARER }));

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, data: [] });
    expect(restaurantQueries()).toBe(0);
  });

  it('firma zawieszona (status suspended) -> pusta lista mimo waznego czlonkostwa', async () => {
    // Lustro `b.status = 'active'` z private.has_capability
    // (20260818000400_newbase_rls.sql:66). Bez tego zawieszona firma dalej
    // pracuje przez backend, choc przez RLS bylaby odcieta.
    authAs('user-1');
    memberResult = { data: [membership({ status: 'suspended' })], error: null };

    const res = await call(createReq({ headers: BEARER }));

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, data: [] });
    expect(restaurantQueries()).toBe(0);
  });

  it('czlonkostwo jest, ale firma nie ma lokali -> 200 z pusta tablica, nie blad', async () => {
    authAs('user-1');
    memberResult = { data: [membership()], error: null };
    restaurantResult = { data: [], error: null };

    const res = await call(createReq({ headers: BEARER }));

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, data: [] });
    expect(restaurantQueries()).toBe(1);
  });
});

describe('GET /api/owner/restaurants/:id — pojedynczy lokal', () => {
  it('lokal wlasnej firmy -> 200, ownership i operacja w jednym query', async () => {
    authAs('user-1');
    memberResult = { data: [membership()], error: null };
    restaurantResult = { data: { id: 'r1', name: 'Test', city: 'Piekary' }, error: null };

    const res = await call(
      createReq({ url: '/api/owner/restaurants/r1', params: { id: 'r1' }, headers: BEARER })
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, data: { id: 'r1', name: 'Test' } });
    expect(eqSpy).toHaveBeenCalledWith('id', 'r1');
    expect(inSpy).toHaveBeenCalledWith('business_account_id', ['acc-1']);
  });

  it('lokal CUDZEJ firmy -> 404, nie 200 z cudzymi danymi i nie 403', async () => {
    authAs('user-1');
    memberResult = { data: [membership({ accountId: 'acc-moja' })], error: null };
    // { id = X, business_account_id in ('acc-moja') } trafia zero wierszy,
    // bo X nalezy do innej firmy — nieodrozniane od "nie istnieje".
    restaurantResult = { data: null, error: null };

    const res = await call(
      createReq({ url: '/api/owner/restaurants/cudzy', params: { id: 'cudzy' }, headers: BEARER })
    );

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ ok: false, error: 'not_found' });
    expect(inSpy).toHaveBeenCalledWith('business_account_id', ['acc-moja']);
  });

  it('user BEZ czlonkostwa -> 404 i ZERO zapytan do restaurants', async () => {
    authAs('obcy-user');
    memberResult = { data: [], error: null };

    const res = await call(
      createReq({ url: '/api/owner/restaurants/r1', params: { id: 'r1' }, headers: BEARER })
    );

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ ok: false, error: 'not_found' });
    expect(restaurantQueries()).toBe(0);
  });

  it('rola staff -> 404 i ZERO zapytan do restaurants', async () => {
    authAs('kucharz-1');
    memberResult = { data: [membership({ capabilities: STAFF_CAPS })], error: null };

    const res = await call(
      createReq({ url: '/api/owner/restaurants/r1', params: { id: 'r1' }, headers: BEARER })
    );

    expect(res.statusCode).toBe(404);
    expect(restaurantQueries()).toBe(0);
  });

  it('nieistniejace id -> rowniez 404 (ten sam status co cudzy lokal)', async () => {
    authAs('user-1');
    memberResult = { data: [membership()], error: null };
    restaurantResult = { data: null, error: null };

    const res = await call(
      createReq({ url: '/api/owner/restaurants/nie-ma', params: { id: 'nie-ma' }, headers: BEARER })
    );

    expect(res.statusCode).toBe(404);
  });

  it('zaden select nie prosi o owner_id ani business_account_id — to filtr, nie projekcja', async () => {
    authAs('user-1');
    memberResult = { data: [membership()], error: null };
    restaurantResult = { data: { id: 'r1', name: 'Test' }, error: null };

    const res = await call(
      createReq({ url: '/api/owner/restaurants/r1', params: { id: 'r1' }, headers: BEARER })
    );

    expect(res.body.data).not.toHaveProperty('owner_id');
    expect(res.body.data).not.toHaveProperty('business_account_id');
    const restaurantSelects = selectSpy.mock.calls
      .map(([fields]) => fields)
      .filter((fields) => typeof fields === 'string' && fields.includes('name'));
    expect(restaurantSelects.length).toBeGreaterThan(0);
    for (const fields of restaurantSelects) {
      expect(fields).not.toContain('owner_id');
      expect(fields).not.toContain('business_account_id');
    }
  });
});

describe('PATCH /api/owner/restaurants/:id — auth', () => {
  it('brak naglowka Authorization -> 401, zero update()', async () => {
    const res = await call(
      createReq({ method: 'PATCH', params: { id: 'r1' }, body: { name: 'Nowa nazwa' } })
    );
    expect(res.statusCode).toBe(401);
    expect(getUserMock).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('niepoprawny/wygasly token -> 401, zero update()', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } });
    const res = await call(
      createReq({
        method: 'PATCH',
        params: { id: 'r1' },
        headers: { authorization: 'Bearer zly-token' },
        body: { name: 'Nowa nazwa' },
      })
    );
    expect(res.statusCode).toBe(401);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/owner/restaurants/:id — edycja', () => {
  it('lokal wlasnej firmy -> 200, patch tylko z wyslanych pol, zasieg w tym samym query', async () => {
    authAs('user-1');
    memberResult = { data: [membership()], error: null };
    restaurantResult = { data: { id: 'r1', name: 'Nowa nazwa', city: 'Piekary' }, error: null };

    const res = await call(
      createReq({
        method: 'PATCH',
        url: '/api/owner/restaurants/r1',
        params: { id: 'r1' },
        headers: BEARER,
        body: { name: 'Nowa nazwa', is_active: true, delivery_available: false },
      })
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, data: { id: 'r1', name: 'Nowa nazwa' } });
    expect(updateSpy).toHaveBeenCalledWith({
      name: 'Nowa nazwa',
      is_active: true,
      delivery_available: false,
    });
    expect(eqSpy).toHaveBeenCalledWith('id', 'r1');
    expect(inSpy).toHaveBeenCalledWith('business_account_id', ['acc-1']);
  });

  it('lokal CUDZEJ firmy -> 404, nie 200 i nie 403', async () => {
    authAs('user-1');
    memberResult = { data: [membership({ accountId: 'acc-moja' })], error: null };
    restaurantResult = { data: null, error: null };

    const res = await call(
      createReq({
        method: 'PATCH',
        url: '/api/owner/restaurants/cudzy',
        params: { id: 'cudzy' },
        headers: BEARER,
        body: { name: 'Przejecie' },
      })
    );

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ ok: false, error: 'not_found' });
    expect(inSpy).toHaveBeenCalledWith('business_account_id', ['acc-moja']);
  });

  it('user BEZ czlonkostwa -> 404 i ZERO update()', async () => {
    authAs('obcy-user');
    memberResult = { data: [], error: null };

    const res = await call(
      createReq({
        method: 'PATCH',
        params: { id: 'r1' },
        headers: BEARER,
        body: { name: 'Przejecie' },
      })
    );

    expect(res.statusCode).toBe(404);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(restaurantQueries()).toBe(0);
  });

  it('rola staff -> 404 i ZERO update() (kuchnia nie edytuje lokalu)', async () => {
    authAs('kucharz-1');
    memberResult = { data: [membership({ capabilities: STAFF_CAPS })], error: null };

    const res = await call(
      createReq({
        method: 'PATCH',
        params: { id: 'r1' },
        headers: BEARER,
        body: { name: 'Zmiana' },
      })
    );

    expect(res.statusCode).toBe(404);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('firma zawieszona -> 404 i ZERO update()', async () => {
    authAs('user-1');
    memberResult = { data: [membership({ status: 'suspended' })], error: null };

    const res = await call(
      createReq({
        method: 'PATCH',
        params: { id: 'r1' },
        headers: BEARER,
        body: { name: 'Zmiana' },
      })
    );

    expect(res.statusCode).toBe(404);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('business_account_id w body NIE trafia do update() i nie zmienia zasiegu', async () => {
    authAs('user-1');
    memberResult = { data: [membership({ accountId: 'acc-moja' })], error: null };
    restaurantResult = { data: { id: 'r1', name: 'Test' }, error: null };

    const res = await call(
      createReq({
        method: 'PATCH',
        params: { id: 'r1' },
        headers: BEARER,
        body: { name: 'Test', business_account_id: 'acc-napastnika', owner_id: 'napastnik-999' },
      })
    );

    expect(res.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith({ name: 'Test' });
    // Zasieg nadal z czlonkostwa, nie z body.
    expect(inSpy).toHaveBeenCalledWith('business_account_id', ['acc-moja']);
  });

  it('id w body nie trafia do update() (nie da sie przeniesc rekordu)', async () => {
    authAs('user-1');
    memberResult = { data: [membership()], error: null };
    restaurantResult = { data: { id: 'r1', name: 'Test' }, error: null };

    await call(
      createReq({
        method: 'PATCH',
        params: { id: 'r1' },
        headers: BEARER,
        body: { name: 'Test', id: 'inne-id' },
      })
    );

    expect(updateSpy).toHaveBeenCalledWith({ name: 'Test' });
  });

  it('nieznane pole w body nie trafia do update() (np. created_at, is_admin)', async () => {
    authAs('user-1');
    memberResult = { data: [membership()], error: null };
    restaurantResult = { data: { id: 'r1', name: 'Test' }, error: null };

    await call(
      createReq({
        method: 'PATCH',
        params: { id: 'r1' },
        headers: BEARER,
        body: { name: 'Test', created_at: '2020-01-01', is_admin: true, cuisine_type: 'sushi' },
      })
    );

    expect(updateSpy).toHaveBeenCalledWith({ name: 'Test' });
  });

  it('body poza allowlista -> 400 empty_patch, zero update() i zero zapytan o zasieg', async () => {
    authAs('user-1');
    memberResult = { data: [membership()], error: null };

    const res = await call(
      createReq({
        method: 'PATCH',
        params: { id: 'r1' },
        headers: BEARER,
        body: { business_account_id: 'x', created_at: '2020-01-01' },
      })
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'empty_patch' });
    expect(updateSpy).not.toHaveBeenCalled();
    // Walidacja ksztaltu przed dotknieciem bazy — kolejnosc zachowana z wersji sprzed przepiecia.
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('null w polu nullable (np. city) -> jawne wyczyszczenie, nie odrzucane', async () => {
    authAs('user-1');
    memberResult = { data: [membership()], error: null };
    restaurantResult = { data: { id: 'r1' }, error: null };

    await call(
      createReq({ method: 'PATCH', params: { id: 'r1' }, headers: BEARER, body: { city: null } })
    );

    expect(updateSpy).toHaveBeenCalledWith({ city: null });
  });

  it('zle typy (is_active jako string) -> pole pomijane, nie 500', async () => {
    authAs('user-1');
    memberResult = { data: [membership()], error: null };
    restaurantResult = { data: { id: 'r1', name: 'Test' }, error: null };

    const res = await call(
      createReq({
        method: 'PATCH',
        params: { id: 'r1' },
        headers: BEARER,
        body: { name: 'Test', is_active: 'yes' },
      })
    );

    expect(res.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith({ name: 'Test' });
  });

  it('metoda inna niz GET/PATCH -> 405', async () => {
    const res = await call(createReq({ method: 'DELETE', params: { id: 'r1' } }));
    expect(res.statusCode).toBe(405);
    expect(getUserMock).not.toHaveBeenCalled();
  });
});
