// api/_supabase.js
/**
 * privateServerClient - klient service_role.
 * ===========================================================================
 * T2 (etap 2 z SS9 planu hardeningu).
 *
 * CO SIE ZMIENILO: ten modul mial wczesniej cichy fallback
 *   SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE || SUPABASE_ANON_KEY
 * Brak klucza service_role nie byl bledem - klient po prostu schodzil na klucz
 * anon i dzialal dalej. Dopoki na tabelach nie ma RLS, taki klient widzi to samo
 * co service_role, wiec awaria byla niewidoczna. Po wlaczeniu RLS (etapy 8-10)
 * ten sam fallback zamienilby sie w ciche, czesciowe braki danych w produkcji.
 *
 * TERAZ: zadnego fallbacku na anon. Brak konfiguracji = twardy blad.
 * Do katalogu publicznego sluzy osobny klient: ./_supabaseCatalog.js
 * ===========================================================================
 */
import { createClient } from '@supabase/supabase-js';

/** Oba nazewnictwa oznaczaja ten sam klucz service_role i wystepuja w repo. */
const SERVICE_KEY_VARS = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE'];

function readServiceKey() {
  for (const name of SERVICE_KEY_VARS) {
    const value = process.env[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/**
 * Rzuca, gdy klient service_role nie da sie zbudowac.
 * Wolane przy starcie procesu serwujacego (api/server-vercel.js), zeby brak
 * konfiguracji byl widoczny od razu, a nie dopiero przy pierwszym zapytaniu.
 */
export function assertPrivateServerConfig() {
  const missing = [];
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!readServiceKey()) missing.push(SERVICE_KEY_VARS.join(' albo '));

  if (missing.length > 0) {
    throw new Error(
      `[Supabase/private] Brak wymaganej konfiguracji: ${missing.join(', ')}. ` +
        'Klient service_role nie ma fallbacku na klucz anon - proces nie moze ' +
        'obslugiwac danych wrazliwych bez tych zmiennych.'
    );
  }
}

/** Diagnostyka bez ujawniania wartosci sekretow. */
export function describePrivateServerConfig() {
  return {
    url: Boolean(process.env.SUPABASE_URL),
    serviceKey: Boolean(readServiceKey()),
  };
}

let _client = null;

function getPrivateServerClient() {
  if (_client) return _client;
  assertPrivateServerConfig();
  _client = createClient(process.env.SUPABASE_URL, readServiceKey(), {
    auth: { persistSession: false },
  });
  return _client;
}

/**
 * Lazy proxy - zachowany, bo 57 modulow importuje `supabase` z tego pliku,
 * a czesc z nich jest ladowana w kontekstach bez pelnego env (testy).
 * Roznica wobec stanu sprzed T2: brak klienta rzuca opisowym bledem zamiast
 * po cichu tworzyc klienta na kluczu anon.
 */
export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getPrivateServerClient();
      return client[prop];
    },
  }
);

/** Jawna nazwa zgodna z SS4 planu. Ten sam obiekt co `supabase`. */
export const privateServerClient = supabase;
