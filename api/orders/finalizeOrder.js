/**
 * POST /api/orders/finalize
 *
 * Called after successful Stripe payment.
 * Finalizes the order (status → confirmed) and cleans the backend session
 * so the user can start a fresh order without Ghost Cart.
 */

import { supabase } from "../_supabase.js";
import { applyCORS } from "../_cors.js";
import { closeConversation, generateNewSessionId } from "../brain/session/sessionStore.js";

export default async function finalizeOrder(req, res) {
  applyCORS(res);
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { order_id, session_id } = req.body || {};

    if (!order_id) {
      return res.status(400).json({ ok: false, error: 'Brak order_id' });
    }

    // ── 1. Fetch order from Supabase ──
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, status, notes')
      .eq('id', order_id)
      .maybeSingle();

    if (fetchErr) {
      console.error('[FINALIZE_ORDER] DB fetch error:', fetchErr.message);
      return res.status(500).json({ ok: false, error: 'Błąd pobierania zamówienia' });
    }
    if (!order) {
      return res.status(404).json({ ok: false, error: 'Zamówienie nie znalezione' });
    }

    // ── 2. Update order status to confirmed ──
    // status ORAZ confirmed_at w JEDNYM update. Kolumna confirmed_at jest
    // nullowalna, wiec schemat nie wymusi jej wypelnienia - regula zyje w kodzie
    // (20260818000300_newbase_catalog_orders.sql:141). Sam status zostawialby
    // ja pusta na zawsze, co potwierdzily 140 zamowien w starej bazie.
    const confirmedAt = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from('orders')
      .update({ status: 'confirmed', confirmed_at: confirmedAt })
      .eq('id', order_id);

    if (updateErr) {
      console.error('[FINALIZE_ORDER] DB update error:', updateErr.message);
      return res.status(500).json({ ok: false, error: 'Błąd aktualizacji zamówienia' });
    }

    console.log(`[FINALIZE_ORDER] Order ${order_id} status → confirmed, confirmed_at=${confirmedAt}`);

    // ── 3. Clean backend session ──
    let newSessionId = null;
    if (session_id) {
      try {
        const closureResult = closeConversation(session_id, 'ORDER_CONFIRMED');
        newSessionId = closureResult.newSessionId;
        console.log(`[FINALIZE_ORDER] Session ${session_id.slice(0, 8)}... closed, new=${newSessionId.slice(0, 8)}...`);
      } catch (err) {
        console.warn('[FINALIZE_ORDER] Session cleanup failed:', err.message);
        newSessionId = generateNewSessionId();
      }
    } else {
      newSessionId = generateNewSessionId();
    }

    // ── 4. Return ──
    return res.status(200).json({
      ok: true,
      order_id,
      status: 'confirmed',
      confirmed_at: confirmedAt,
      newSessionId,
    });
  } catch (err) {
    console.error('[FINALIZE_ORDER] Unexpected error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
