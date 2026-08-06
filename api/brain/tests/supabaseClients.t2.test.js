/**
 * T2 - rozdzial klientow Supabase
 * ===========================================================================
 * Bramka dla etapu 2 z SS9 planu hardeningu.
 *
 * Sedno kontraktu: ZADEN z dwoch klientow nie ma fallbacku na klucz tego
 * drugiego. Przed T2 api/_supabase.js schodzil po cichu z service_role na anon,
 * a api/server-vercel.js budowal klienta anon-first i uzywal go rowniez do
 * orders. Dopoki na tabelach nie ma RLS, oba bledy sa NIEWIDOCZNE - dlatego
 * musza byc pilnowane testem, a nie obserwacja runtime.
 * ===========================================================================
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assertPrivateServerConfig, describePrivateServerConfig } from '../../_supabase.js';
import { assertPublicCatalogConfig, describePublicCatalogConfig } from '../../_supabaseCatalog.js';

const MANAGED_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_ROLE',
  'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_KEY',
];

const saved = {};

beforeEach(() => {
  for (const key of MANAGED_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

// ---------------------------------------------------------------------------
// privateServerClient - service_role
// ---------------------------------------------------------------------------

describe('T2 / klient prywatny (service_role)', () => {
  it('rzuca gdy nie ma zadnej konfiguracji', () => {
    expect(() => assertPrivateServerConfig()).toThrow(/Brak wymaganej konfiguracji/);
  });

  it('rzuca gdy brakuje SUPABASE_URL', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    expect(() => assertPrivateServerConfig()).toThrow(/SUPABASE_URL/);
  });

  it('KLUCZOWE: sam klucz anon NIE wystarcza - zero cichego fallbacku', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    process.env.SUPABASE_KEY = 'anon-key-alias';
    expect(() => assertPrivateServerConfig()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('przechodzi z SUPABASE_SERVICE_ROLE_KEY', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    expect(() => assertPrivateServerConfig()).not.toThrow();
  });

  it('przechodzi z alternatywna nazwa SUPABASE_SERVICE_ROLE', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE = 'service-key';
    expect(() => assertPrivateServerConfig()).not.toThrow();
  });

  it('pusty string nie liczy sie jako klucz', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    expect(() => assertPrivateServerConfig()).toThrow();
  });
});

// ---------------------------------------------------------------------------
// publicCatalogClient - anon
// ---------------------------------------------------------------------------

describe('T2 / klient katalogu publicznego (anon)', () => {
  it('rzuca gdy nie ma zadnej konfiguracji', () => {
    expect(() => assertPublicCatalogConfig()).toThrow(/Brak wymaganej konfiguracji/);
  });

  it('KLUCZOWE: sam service_role NIE wystarcza - brak cichej eskalacji uprawnien', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    expect(() => assertPublicCatalogConfig()).toThrow(/SUPABASE_ANON_KEY/);
  });

  it('przechodzi z SUPABASE_ANON_KEY', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    expect(() => assertPublicCatalogConfig()).not.toThrow();
  });

  it('przechodzi z SUPABASE_PUBLISHABLE_KEY', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-key';
    expect(() => assertPublicCatalogConfig()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Diagnostyka nie moze ujawniac sekretow
// ---------------------------------------------------------------------------

describe('T2 / diagnostyka bez sekretow', () => {
  it('describePrivateServerConfig zwraca wylacznie flagi', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sekret-ktorego-nie-wolno-pokazac';

    const cfg = describePrivateServerConfig();
    expect(cfg).toEqual({ url: true, serviceKey: true });
    expect(JSON.stringify(cfg)).not.toContain('sekret-ktorego-nie-wolno-pokazac');
  });

  it('describePublicCatalogConfig zwraca wylacznie flagi', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-sekret';

    const cfg = describePublicCatalogConfig();
    expect(cfg).toEqual({ url: true, catalogKey: true });
    expect(JSON.stringify(cfg)).not.toContain('anon-sekret');
  });

  it('komunikat bledu nie zawiera wartosci klucza', () => {
    process.env.SUPABASE_ANON_KEY = 'wartosc-anon-do-wyciekniecia';
    try {
      assertPrivateServerConfig();
      throw new Error('powinno rzucic');
    } catch (err) {
      expect(err.message).not.toContain('wartosc-anon-do-wyciekniecia');
    }
  });
});
