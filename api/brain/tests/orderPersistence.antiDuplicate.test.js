/**
 * T7 - test anty-duplikatowy dla sciezki zapisu zamowienia
 * ===========================================================================
 * Bramka dla etapu 7 z SS9 planu hardeningu. Task analityczny: NIE zmienia
 * kodu produkcyjnego i NIE wlacza persistOrderToDB.
 *
 * Test dokumentuje i zamraza trzy fakty, ktore razem decyduja o tym, ktora
 * sciezke wolno uznac za kanoniczna:
 *
 *  1. persistOrderToDB jest idempotentne TYLKO wtedy, gdy kolumna
 *     orders.idempotency_key istnieje. Gdy jej nie ma, kod swiadomie usuwa
 *     klucz i ponawia insert (OrderPersistence.js:129-144), a wczesniejsze
 *     sprawdzenie duplikatu tylko loguje blad i idzie dalej (linie 67-70).
 *     Efekt: na DZISIEJSZYM schemacie ta sciezka NIE jest idempotentna.
 *
 *  2. Klucz idempotencji jest deterministyczny wzgledem zawartosci koszyka
 *     i niezalezny od kolejnosci pozycji, ale zawiera sessionId - wiec nie
 *     chroni przed duplikatem po zmianie sesji (np. handoff voice -> UI).
 *
 *  3. confirmHandler NIE wola persistOrderToDB. Ten stan jest celowy i ma
 *     pozostac zamrozony do czasu jawnej decyzji uzytkownika (SS13.5).
 * ===========================================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// --- sterowalny mock klienta ---------------------------------------------
let existingOrder = null;
let selectError = null;
let insertCalls = [];
let insertResults = [];

vi.mock('../../_supabase.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: existingOrder, error: selectError }),
        }),
      }),
      insert: (rows) => {
        insertCalls.push(rows[0]);
        const result = insertResults.shift() || { data: { id: `order-${insertCalls.length}` }, error: null };
        return {
          select: () => ({
            single: () => Promise.resolve(result),
          }),
        };
      },
    }),
  },
}));

const { persistOrderToDB } = await import('../services/OrderPersistence.js');

function makeSession(items, total) {
  return {
    cart: { items, total },
    lastRestaurant: { id: 'rest-1', name: 'Restauracja Testowa' },
  };
}

const KEBAB = { id: 'm1', name: 'Kebab', price_pln: 25, qty: 2 };
const FRYTKI = { id: 'm2', name: 'Frytki', price_pln: 10, qty: 1 };

beforeEach(() => {
  existingOrder = null;
  selectError = null;
  insertCalls = [];
  insertResults = [];
});

// ---------------------------------------------------------------------------
// 1. Idempotencja dziala TYLKO gdy kolumna istnieje
// ---------------------------------------------------------------------------

describe('T7 / idempotencja przy sprawnej kolumnie idempotency_key', () => {
  it('drugie wywolanie dla tego samego koszyka NIE wstawia zamowienia', async () => {
    const session = makeSession([KEBAB], 50);

    const first = await persistOrderToDB('sess-1', session);
    expect(first.success).toBe(true);
    expect(insertCalls).toHaveLength(1);

    // Symuluj, ze zamowienie z tym kluczem juz lezy w bazie.
    existingOrder = { id: first.order_id };

    const second = await persistOrderToDB('sess-1', session);
    expect(second.success).toBe(true);
    expect(second.skipped).toBe(true);
    expect(second.order_id).toBe(first.order_id);
    // Kluczowa asercja: zaden drugi insert nie poszedl.
    expect(insertCalls).toHaveLength(1);
  });

  it('zapisuje idempotency_key i session_id na zamowieniu', async () => {
    await persistOrderToDB('sess-1', makeSession([KEBAB], 50));
    expect(insertCalls[0]).toHaveProperty('idempotency_key');
    expect(insertCalls[0].session_id).toBe('sess-1');
    expect(insertCalls[0].idempotency_key).toMatch(/^[0-9a-f]{32}$/);
  });
});

// ---------------------------------------------------------------------------
// 2. REGRESJA KONTRAKTU: brak kolumny = cicha utrata idempotencji
// ---------------------------------------------------------------------------

describe('T7 / brak kolumny idempotency_key (dzisiejszy stan schematu)', () => {
  it('DOWOD: przy braku kolumny powstaje DUPLIKAT mimo identycznego koszyka', async () => {
    const session = makeSession([KEBAB], 50);

    // Tak zachowuje sie Postgres, gdy kolumny nie ma: blad na sprawdzeniu
    // duplikatu ORAZ blad na insercie wspominajacy nazwe kolumny.
    selectError = { message: 'column orders.idempotency_key does not exist' };
    insertResults = [
      { data: null, error: { message: 'column "idempotency_key" of relation "orders" does not exist' } },
      { data: { id: 'order-fallback-1' }, error: null },
      { data: null, error: { message: 'column "idempotency_key" of relation "orders" does not exist' } },
      { data: { id: 'order-fallback-2' }, error: null },
    ];

    const first = await persistOrderToDB('sess-1', session);
    const second = await persistOrderToDB('sess-1', session);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    // Oba przeszly i oba sa NOWE - to jest wlasnie duplikat.
    expect(first.order_id).toBe('order-fallback-1');
    expect(second.order_id).toBe('order-fallback-2');
    expect(second.skipped).toBeUndefined();

    // Cztery proby insertu: po dwie na wywolanie (z kluczem, potem bez).
    expect(insertCalls).toHaveLength(4);
    // Fallbackowe inserty poszly BEZ klucza idempotencji.
    expect(insertCalls[1]).not.toHaveProperty('idempotency_key');
    expect(insertCalls[3]).not.toHaveProperty('idempotency_key');
  });
});

// ---------------------------------------------------------------------------
// 3. Wlasnosci klucza idempotencji
// ---------------------------------------------------------------------------

describe('T7 / wlasnosci klucza idempotencji', () => {
  async function keyFor(sessionId, items, total) {
    insertCalls = [];
    await persistOrderToDB(sessionId, makeSession(items, total));
    return insertCalls[0].idempotency_key;
  }

  it('jest niezalezny od kolejnosci pozycji w koszyku', async () => {
    const a = await keyFor('sess-1', [KEBAB, FRYTKI], 60);
    const b = await keyFor('sess-1', [FRYTKI, KEBAB], 60);
    expect(a).toBe(b);
  });

  it('rozni sie dla innej zawartosci koszyka', async () => {
    const a = await keyFor('sess-1', [KEBAB], 50);
    const b = await keyFor('sess-1', [KEBAB, FRYTKI], 60);
    expect(a).not.toBe(b);
  });

  it('OGRANICZENIE: rozni sie dla innej sesji przy tym samym koszyku', async () => {
    const a = await keyFor('sess-1', [KEBAB], 50);
    const b = await keyFor('sess-2', [KEBAB], 50);
    // To NIE jest blad implementacji, tylko udokumentowany zakres ochrony:
    // klucz chroni przed retry w obrebie sesji, ale nie przed duplikatem
    // powstalym po handoffie voice -> UI, gdzie sesja bywa inna.
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// 4. Zamrozenie stanu: confirmHandler nie wola persistOrderToDB
// ---------------------------------------------------------------------------

describe('T7 / zamrozenie stanu confirmHandler', () => {
  it('confirmHandler NIE wywoluje persistOrderToDB', () => {
    const file = path.resolve(process.cwd(), 'api/brain/domains/food/confirmHandler.js');
    const source = fs.readFileSync(file, 'utf8');

    // Usun komentarze blokowe i liniowe - w pliku sa opisy wylaczonej sciezki.
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(withoutComments).not.toMatch(/persistOrderToDB\s*\(/);
  });

  it('api/orders.js NIE zapisuje idempotency_key - nie moze deduplikowac', () => {
    const file = path.resolve(process.cwd(), 'api/orders.js');
    const source = fs.readFileSync(file, 'utf8');
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    // Zywa scieszka zapisu nie zna klucza idempotencji, wiec dwa identyczne
    // POSTy tworza dwa zamowienia. To jest realne ryzyko duplikatu DZIS,
    // niezaleznie od tego, czy persistOrderToDB kiedykolwiek zostanie wlaczone.
    expect(withoutComments).not.toMatch(/idempotency_key/);
  });
});
