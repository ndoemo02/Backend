/**
 * P4-A - kontrakt finalizacji zamowienia
 * ===========================================================================
 * Zadanie #4 z WORK_PACKAGES.md. Bramka dla P0 opisanego w CLAUDE.md §10:
 * ze 140 zamowien w starej bazie ZERO mialo wypelnione confirmed_at, mimo ze
 * kolumna istniala od poczatku. finalizeOrder.js ustawial wylacznie status.
 *
 * Nowa baza (20260818000300_newbase_catalog_orders.sql:141) formuluje regule
 * wprost: "status ORAZ confirmed_at w jednym UPDATE". Ten plik jest jej
 * egzekucja w kodzie - schemat nie wymusi wypelnienia kolumny nullowalnej.
 *
 * 'confirmed' i 'accepted' to DWA ROZNE zdarzenia: confirmed = klient zaplacil,
 * accepted = restauracja przyjela. Test pilnuje, ze finalizacja platnosci
 * zapisuje to pierwsze.
 * ===========================================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const updateSpy = vi.fn();

vi.mock('../../_supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { id: 'ord-1', status: 'pending', notes: null }, error: null }),
        }),
      }),
      update: (payload) => {
        updateSpy(payload);
        return { eq: () => Promise.resolve({ data: null, error: null }) };
      },
    })),
  },
}));

vi.mock('../../_cors.js', () => ({ applyCORS: () => {} }));

vi.mock('../session/sessionStore.js', () => ({
  closeConversation: () => ({ newSessionId: 'sess_nowa_sesja_testowa' }),
  generateNewSessionId: () => 'sess_nowa_sesja_testowa',
}));

const { default: finalizeOrder } = await import('../../orders/finalizeOrder.js');

function createRes() {
  return {
    statusCode: 200,
    body: undefined,
    setHeader() {
      return this;
    },
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

async function callFinalize(body) {
  const res = createRes();
  await finalizeOrder({ method: 'POST', headers: {}, body }, res);
  return res;
}

beforeEach(() => {
  updateSpy.mockClear();
});

describe('P4-A / finalizeOrder wypelnia confirmed_at', () => {
  it('zapisuje status ORAZ confirmed_at w JEDNYM update', async () => {
    const res = await callFinalize({ order_id: 'ord-1', session_id: 'sess_abc' });

    expect(res.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const payload = updateSpy.mock.calls[0][0];
    expect(payload.status).toBe('confirmed');
    expect(payload.confirmed_at).toBeTruthy();
  });

  it('confirmed_at jest znacznikiem czasu, nie napisem-zaslepka', async () => {
    const przed = Date.now();
    await callFinalize({ order_id: 'ord-1' });
    const po = Date.now();

    const { confirmed_at: confirmedAt } = updateSpy.mock.calls[0][0];
    const parsed = Date.parse(confirmedAt);

    expect(Number.isNaN(parsed)).toBe(false);
    expect(parsed).toBeGreaterThanOrEqual(przed - 1000);
    expect(parsed).toBeLessThanOrEqual(po + 1000);
  });

  it('nie dotyka bazy, gdy brakuje order_id', async () => {
    const res = await callFinalize({});

    expect(res.statusCode).toBe(400);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
