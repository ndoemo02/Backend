/**
 * api/_auth.js
 * ===========================================================================
 * Warstwa autoryzacji dla endpointow operujacych na danych wrazliwych.
 *
 * Kontrakt jest celowo IDENTYCZNY z tym, ktory dziala juz w
 * api/admin/adminRouter.js:31-37 (requireAdminToken):
 *   - naglowek `x-admin-token`
 *   - porownanie z process.env.ADMIN_TOKEN
 *   - fail-closed: brak ADMIN_TOKEN w srodowisku => kazde zadanie odrzucone
 *
 * Rozszerzenie wzgledem adminRouter: porownanie stalo-czasowe na skrotach
 * SHA-256, zeby ani wartosc, ani dlugosc tokenu nie wyciekala kanalem czasowym.
 *
 * UWAGA (znany dlug, poza zakresem T1): sam ADMIN_TOKEN jest dzis
 * kompilowany do bundla frontendu jako VITE_ADMIN_TOKEN. Dopoki T3 tego nie
 * usunie i nie zrotuje sekretu, ta warstwa podnosi poprzeczke, ale nie jest
 * szczelna wobec kogos, kto przeczytal bundle produkcyjny.
 * Patrz: plan hardeningu SS13.1, ryzyko #3.
 * ===========================================================================
 */

import { createHash, timingSafeEqual } from 'node:crypto';

function digest(value) {
  return createHash('sha256').update(String(value), 'utf8').digest();
}

/**
 * Porownanie stalo-czasowe. Oba wejscia sa najpierw skracane do 32 bajtow,
 * wiec porownywane bufory zawsze maja te sama dlugosc i timingSafeEqual
 * nie rzuca, a rozna dlugosc tokenu nie jest rozpoznawalna po czasie.
 */
function safeEquals(a, b) {
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Rozstrzyga autoryzacje i rozroznia dwa przypadki:
 *   401 - zadanie w ogole nie przedstawilo tokenu (brak uwierzytelnienia)
 *   403 - token byl, ale jest niewlasciwy albo serwer nie ma go z czym porownac
 *
 * Rozroznienie jest celowe: 401 mowi klientowi "dolacz poswiadczenie",
 * 403 mowi "poswiadczenie odrzucone" i nie zacheca do ponowienia.
 *
 * @param {{ headers?: Record<string, unknown> }} req
 * @returns {{ ok: true } | { ok: false, status: 401 | 403, error: string }}
 */
export function authenticateAdmin(req) {
  const provided = req?.headers?.['x-admin-token'];

  if (typeof provided !== 'string' || provided.length === 0) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }

  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    // fail-closed: token podano, ale serwer nie ma wzorca. Nigdy nie przepuszczaj.
    return { ok: false, status: 403, error: 'forbidden' };
  }

  if (!safeEquals(provided, expected)) {
    return { ok: false, status: 403, error: 'forbidden' };
  }

  return { ok: true };
}

/**
 * Czy zadanie niesie wazny token admina.
 * Nie modyfikuje odpowiedzi - sluzy do rozgalezien typu
 * "admin widzi wszystko, reszta musi podac zakres".
 *
 * @param {{ headers?: Record<string, unknown> }} req
 * @returns {boolean}
 */
export function isAdminRequest(req) {
  return authenticateAdmin(req).ok;
}

/**
 * Twarda bramka. Gdy brak autoryzacji - odpowiada 401 albo 403 i zwraca false.
 * Wzorzec wywolania w handlerze bez lancucha middleware:
 *
 *   if (!requireAdmin(req, res)) return;
 *
 * @returns {boolean} true gdy zadanie moze isc dalej
 */
export function requireAdmin(req, res) {
  const verdict = authenticateAdmin(req);
  if (verdict.ok) return true;
  res.status(verdict.status).json({ ok: false, error: verdict.error });
  return false;
}
