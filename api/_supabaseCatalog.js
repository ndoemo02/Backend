// api/_supabaseCatalog.js
/**
 * publicCatalogClient - klient katalogu publicznego (klucz anon/publishable).
 * ===========================================================================
 * T2 (etap 2 z SS9 planu hardeningu), realizacja SS4 "dwa jawne klienty".
 *
 * Ten klient obsluguje WYLACZNIE dane, ktore i tak sa publiczne w przegladarce:
 * katalog restauracji i menu. Nie wolno go uzywac do orders, profiles, logow
 * ani configu - od tego jest ./_supabase.js (service_role).
 *
 * Celowo NIE ma fallbacku na klucz service_role. Gdyby go mial, brak klucza
 * anon po cichu podniosl by uprawnienia zapytan katalogowych do service_role,
 * czyli dokladnie odwrotnie niz chce SS4.
 * ===========================================================================
 */
import { createClient } from '@supabase/supabase-js';

/** Kolejnosc wg nazewnictwa spotykanego w repo; wszystkie to klucz publiczny. */
const CATALOG_KEY_VARS = ['SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_KEY'];

function readCatalogKey() {
  for (const name of CATALOG_KEY_VARS) {
    const value = process.env[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/**
 * Rzuca, gdy klient katalogowy nie da sie zbudowac.
 * Wolane przy starcie procesu serwujacego.
 */
export function assertPublicCatalogConfig() {
  const missing = [];
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!readCatalogKey()) missing.push(CATALOG_KEY_VARS.join(' albo '));

  if (missing.length > 0) {
    throw new Error(
      `[Supabase/catalog] Brak wymaganej konfiguracji: ${missing.join(', ')}. ` +
        'Klient katalogu publicznego nie ma fallbacku na service_role - brak ' +
        'klucza anon nie moze po cichu podniesc uprawnien zapytan katalogowych.'
    );
  }
}

/** Diagnostyka bez ujawniania wartosci sekretow. */
export function describePublicCatalogConfig() {
  return {
    url: Boolean(process.env.SUPABASE_URL),
    catalogKey: Boolean(readCatalogKey()),
  };
}

let _client = null;

function getPublicCatalogClient() {
  if (_client) return _client;
  assertPublicCatalogConfig();
  _client = createClient(process.env.SUPABASE_URL, readCatalogKey(), {
    auth: { persistSession: false },
  });
  return _client;
}

export const publicCatalogClient = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getPublicCatalogClient();
      return client[prop];
    },
  }
);
