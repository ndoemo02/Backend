/**
 * restaurantResolver.aliasStep.test.js
 * ===========================================================================
 * B1 aliases fallback — krok 3 (dopasowanie po `aliases`) w
 * `resolveRestaurantByName()`. Kroki 1 (entity cache) i 2 (dopasowanie po
 * `name`) sa istniejacym zachowaniem sprzed tej sesji — testy nizej pokazuja,
 * ze zostaly nienaruszone.
 * ===========================================================================
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

let nameResult = { data: [], error: null };
let aliasResult = { data: [], error: null };
const ilikeSpy = vi.fn();

function makeQueryBuilder() {
  let lastColumn = null;
  const qb = {
    eq: () => qb,
    ilike: (column, pattern) => {
      lastColumn = column;
      ilikeSpy(column, pattern);
      return qb;
    },
    limit: () => {
      if (lastColumn === 'name') return Promise.resolve(nameResult);
      if (lastColumn === 'aliases') return Promise.resolve(aliasResult);
      return Promise.resolve({ data: [], error: null });
    },
  };
  return qb;
}

vi.mock('../../_supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => makeQueryBuilder()),
    })),
  },
}));

const { resolveRestaurantByName } = await import('../services/restaurantResolver.js');

beforeEach(() => {
  nameResult = { data: [], error: null };
  aliasResult = { data: [], error: null };
  ilikeSpy.mockClear();
});

describe('resolveRestaurantByName — krok 1 (entity cache)', () => {
  it('trafienie w cache nie odpytuje bazy w ogole', async () => {
    const cache = [{ id: 'cache-1', name: 'Klaps Burgers' }];
    const result = await resolveRestaurantByName('klaps', cache);
    expect(result).toEqual({ id: 'cache-1', name: 'Klaps Burgers' });
    expect(ilikeSpy).not.toHaveBeenCalled();
  });
});

describe('resolveRestaurantByName — krok 2 (name, istniejace zachowanie)', () => {
  it('dopasowanie po name dziala jak dotychczas i nie sięga do kroku alias', async () => {
    nameResult = { data: [{ id: 'r1', name: 'Stara Kamienica' }], error: null };
    const result = await resolveRestaurantByName('kamienica');
    expect(result).toEqual({ id: 'r1', name: 'Stara Kamienica' });
    expect(ilikeSpy).toHaveBeenCalledWith('name', '%kamienica%');
    expect(ilikeSpy).not.toHaveBeenCalledWith('aliases', expect.anything());
  });

  it('kilka trafien po name -> wybiera najkrotsza nazwe', async () => {
    nameResult = {
      data: [
        { id: 'long', name: 'Restauracja Stara Kamienica Premium' },
        { id: 'short', name: 'Kamienica' },
      ],
      error: null,
    };
    const result = await resolveRestaurantByName('kamienica');
    expect(result).toEqual({ id: 'short', name: 'Kamienica' });
  });
});

describe('resolveRestaurantByName — krok 3 (aliases, nowy)', () => {
  it('name puste, alias trafia -> zwraca {id, name} restauracji', async () => {
    nameResult = { data: [], error: null };
    aliasResult = { data: [{ id: 'r2', name: 'Bar Praha' }], error: null };
    const result = await resolveRestaurantByName('praga');
    expect(result).toEqual({ id: 'r2', name: 'Bar Praha' });
    expect(ilikeSpy).toHaveBeenCalledWith('name', '%praga%');
    expect(ilikeSpy).toHaveBeenCalledWith('aliases', '%praga%');
  });

  it('wynik kroku alias nigdy nie zawiera pola aliases', async () => {
    nameResult = { data: [], error: null };
    aliasResult = { data: [{ id: 'r2', name: 'Bar Praha' }], error: null };
    const result = await resolveRestaurantByName('praga');
    expect(Object.keys(result).sort()).toEqual(['id', 'name']);
  });

  it('name i alias oba puste -> null (404 na warstwie endpointu)', async () => {
    const result = await resolveRestaurantByName('cos-czego-nie-ma');
    expect(result).toBeNull();
  });

  it('blad DB w kroku alias nie wywala funkcji — zwraca null', async () => {
    const { supabase } = await import('../../_supabase.js');
    const rejectingQb = {
      eq: () => rejectingQb,
      ilike: () => rejectingQb,
      limit: () => Promise.reject(new Error('db down')),
    };
    supabase.from
      .mockImplementationOnce(() => ({ select: () => makeQueryBuilder() })) // krok 2: name, puste (default)
      .mockImplementationOnce(() => ({ select: () => rejectingQb }));       // krok 3: aliases, blad DB
    const result = await resolveRestaurantByName('cokolwiek');
    expect(result).toBeNull();
  });
});
