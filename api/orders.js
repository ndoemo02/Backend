/**
 * api/orders.js
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * @DEPRECATED dla Voice/Brain V2 flow
 * 
 * Zamówienia głosowe są teraz zapisywane w:
 *   api/brain/domains/food/confirmHandler.js â†’ persistOrderToDB()
 * 
 * Ten plik pozostaje TYLKO dla:
 *   - Manual UI checkout (CartContext.jsx)
 *   - Legacy voice commands (starszy flow)
 *   - GET/PATCH operacje na zamówieniach
 * 
 * NIE używaj tych endpointów dla nowych integracji Voice.
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 */

import { supabase } from "./_supabase.js";
import { applyCORS } from "./_cors.js";
import { normalizeTxt, levenshtein } from "./brain/helpers.js";
import { isAdminRequest, requireAdmin } from "./_auth.js";

/**
 * @DEPRECATED - Używaj ConfirmOrderHandler dla Voice flow
 */
export async function createOrderEndpoint(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    let { restaurant_id, items, sessionId } = req.body;

    // Bezpieczny fallback dla items (string vs array)
    if (typeof items === "string") {
      try {
        items = JSON.parse(items);
      } catch {
        items = [];
      }
    }

    if (!restaurant_id || !items?.length)
      return res.status(400).json({ ok: false, error: "Incomplete order data" });

    // Calculate total from items
    const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    const { data, error } = await supabase
      .from("orders")
      .insert([
        {
          restaurant_id: restaurant_id,
          user_id: null, // Guest order
          items: items,
          total_price: total,
          status: "pending",
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ ok: true, id: data.id, items: data.items || [] });
  } catch (err) {
    console.error("âťŚ Order error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// âś… Funkcje normalize i levenshtein zaimportowane z helpers.js (deduplikacja)

function findBestMatch(list, query, field = "name") {
  const safeString = (v) => {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    if (typeof v === "object") {
      // Preferuj .name jeśli istnieje (np. restauracja)
      if (v.name) return String(v.name);
      try { return JSON.stringify(v); } catch { return String(v); }
    }
    return String(v);
  };

  const normQuery = normalizeTxt(safeString(query));
  if (!normQuery) {
    console.log("❌ Puste zapytanie — findBestMatch odrzucone");
    return null;
  }
  let best = null;
  let bestScore = Infinity;
  let exactMatch = null;

  console.log(`đź”Ť Szukam "${query}" (znormalizowane: "${normQuery}") w ${list.length} pozycjach`);

  for (const el of list) {
    const name = normalizeTxt(safeString(el[field]));

    // Sprawdź dokładne dopasowanie (includes)
    if (name.includes(normQuery)) {
      console.log(`âś… Dokładne dopasowanie: "${el[field]}" zawiera "${query}"`);
      exactMatch = el;
      break; // Priorytet dla dokładnych dopasowań
    }

    // Sprawdź podobieństwo Levenshtein
    const dist = levenshtein(name, normQuery);
    console.log(`đź“Š "${el[field]}" â†’ odległość: ${dist}`);

    if (dist < bestScore) {
      bestScore = dist;
      best = el;
    }
  }

  // Zwróć dokładne dopasowanie jeśli istnieje, w przeciwnym razie najlepsze podobieństwo
  const result = exactMatch || (bestScore <= 2 ? best : null);

  if (result) {
    console.log(`đźŽŻ WYBRANE: "${result[field]}" (typ: ${exactMatch ? 'dokładne' : 'podobieństwo'})`);
  } else {
    console.log(`âťŚ BRAK DOPASOWANIA: najlepsza odległość: ${bestScore}`);
  }

  return result;
}

/**
 * @DEPRECATED dla Voice/Brain V2 - używaj ConfirmOrderHandler â†’ persistOrderToDB()
 * Pozostawione dla legacy intent-router
 */
export async function createOrder(restaurantId, userId = "guest") {
  try {
    console.log(`đź›’ Tworzę zamówienie dla restauracji ${restaurantId}, użytkownik: ${userId}`);

    const orderData = {
      user_id: userId === "guest" ? null : userId,
      restaurant_id: restaurantId,
      status: "pending",
      created_at: new Date().toISOString(),
    };

    const { data: order, error } = await supabase
      .from("orders")
      .insert([orderData])
      .select()
      .single();

    if (error) {
      console.error("âťŚ Błąd tworzenia zamówienia:", error);
      throw error;
    }

    console.log("âś… Zamówienie utworzone:", order?.id);
    return order;

  } catch (err) {
    console.error("đź”Ą Błąd createOrder:", err);
    return null;
  }
}

// ===========================================================================
// T1 - kontrakt PATCH /api/orders/:id
// ===========================================================================

/**
 * Pola, ktore ogolny PATCH wolno zapisac.
 *
 * user_id jest CELOWO poza lista i nie moze do niej wrocic: pozwalalo
 * przepiac dowolne zamowienie na dowolnego uzytkownika bez jakiegokolwiek
 * dowodu wlasnosci. Powiazanie zamowienia z kontem po platnosci wymaga
 * osobnego, serwerowego kontraktu claim/finalize (dowod sesji albo tracking
 * token) - zaleznosc T5/T6, nie tego endpointu.
 */
const PATCH_ALLOWED_FIELDS = new Set(['status', 'notes']);

/**
 * allowed_status_values - domena wyprowadzona z KODU, nie z bazy.
 *
 * LIVE_SCHEMA_VERIFICATION_REQUIRED: definicja CHECK `orders_status_check`
 * nie zostala odczytana - konektor Supabase nie ma dostepu do projektu
 * ezemaacyyvbpjlagchds. Ta lista moze byc SZERSZA niz to, co dopuszcza baza;
 * wtedy wartosc przejdzie walidacje aplikacji i zostanie odrzucona dopiero
 * przez Postgresa. Po odczycie CHECK-a liste nalezy ZAWEZIC do przeciecia.
 *
 * Zrodla - kazda wartosc ma dowod w kodzie, zadna nie jest wymyslona:
 *   pending    orders.js POST insert + createOrder(), ai/tools/order.js:126
 *   confirmed  orders/finalizeOrder.js:44, OrderPersistence.js:107
 *   cancelled  whitelist POST w orders.js
 *   preparing  KDS startOrder()      -> frontend/src/lib/kdsApi.ts:355
 *   completed  KDS markOrderReady()  -> kdsApi.ts:378 (pierwsza proba)
 *   accepted   KDS markOrderReady()  -> kdsApi.ts:378 (fallback po orders_status_check)
 *   delivered  KDS completeOrder()   -> kdsApi.ts:428
 *
 * Swiadomie NIEobecne: 'new' i 'ready' zyja wylacznie w UI KDS
 * (kdsApi.ts:306 mapuje pending->new przy renderze) i nigdy nie sa zapisywane.
 *
 * CONTRACT_DECISION_REQUIRED: to jest domena WARTOSCI, nie graf PRZEJSC.
 * Walidator dozwolonych przejsc (ktory status wolno zmienic na ktory)
 * swiadomie nie jest tu zaimplementowany - wymaga osobnej decyzji kontraktowej.
 */
const ALLOWED_STATUS_VALUES = new Set([
  'pending',
  'confirmed',
  'cancelled',
  'preparing',
  'completed',
  'accepted',
  'delivered',
]);

/**
 * Wyciaga id zamowienia z zadania. Preferuje req.params.id (Express routuje
 * /api/orders/:id), a gdy go brak - ostatni segment sciezki z odcietym query
 * stringiem. Zwraca null dla /api/orders bez identyfikatora, zeby PATCH nie
 * celowal w zamowienie o id doslownie rownym "orders".
 */
function extractOrderId(req) {
  const fromParams = req?.params?.id;
  if (typeof fromParams === 'string' && fromParams.trim()) return fromParams.trim();

  const rawUrl = typeof req?.url === 'string' ? req.url : '';
  const path = rawUrl.split('?')[0].replace(/\/+$/, '');
  const last = path.split('/').pop() || '';
  if (!last || last === 'orders') return null;
  return last;
}

export default async function handler(req, res) {
  // Manual CORS check specifically for this endpoint to ensure Vercel doesn't block it
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  // T1: DELETE i PUT nie sa juz obslugiwane przez ten handler - nie ogloszaj ich.
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, X-Admin-Token'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // GET - pobierz zamówienia
  if (req.method === 'GET') {
    try {
      const { user_id, restaurant_id } = req.query;
      const admin = isAdminRequest(req);

      // T1 / filtr autoryzacyjny (etap 1 z SS9 planu hardeningu).
      // Przed zmiana: brak parametrow ALBO samo user_email (ktore i tak bylo
      // jawnie ignorowane) zwracalo CALA tabele orders razem z PII
      // kazdemu anonimowemu klientowi. Teraz pelna lista wymaga tokenu admina,
      // a kazdy inny odczyt musi podac zakres.
      if (!admin && !restaurant_id && !user_id) {
        return res.status(400).json({
          ok: false,
          error: 'scope_required',
          detail: 'Podaj restaurant_id albo user_id. Pelna lista wymaga naglowka x-admin-token.'
        });
      }

      let query = supabase
        .from('orders')
        .select(`
          *,
          restaurants:restaurant_id (
            name,
            address
          )
        `)
        .order('created_at', { ascending: false });

      if (restaurant_id) {
        query = query.eq('restaurant_id', restaurant_id);
      } else if (user_id) {
        query = query.eq('user_id', user_id);
      }

      const { data: orders, error } = await query;

      if (error) {
        console.error('âťŚ Błąd pobierania zamówień:', error);
        return res.status(500).json({ error: error.message });
      }

      return res.json({ orders: orders || [] });

    } catch (err) {
      console.error('đź”Ą Błąd GET orders:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // POST - utwórz zamówienie
  if (req.method === 'POST') {
    try {
      // đź”Ą Check if this is a cart order (from frontend)
      if (req.body.restaurant_id && req.body.items && Array.isArray(req.body.items)) {
        console.log('đź›’ Cart order detected:', req.body);

        const { restaurant_id, items, user_id, restaurant_name, customer_name, customer_phone, delivery_address, notes } = req.body;

        let { total_price, total_cents } = req.body;

        if (!restaurant_id || !items?.length) {
          return res.status(400).json({ error: "Incomplete cart order data" });
        }

        // Validate UUID format for restaurant_id
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(restaurant_id)) {
          console.error('âťŚ Invalid restaurant_id format:', restaurant_id);
          return res.status(400).json({
            error: `Nieprawidłowy identyfikator restauracji. Proszę odświeżyć stronę i spróbować ponownie.`,
            code: 'INVALID_RESTAURANT_ID',
            received: restaurant_id
          });
        }

        // --- Currency Normalization Strategy ---
        // 1. If explicit total_cents is provided (New Frontend), use it as ground truth.
        // 2. If valid total_price (PLN) is provided, derive cents from it.
        // 3. Fallback: calculate from items.

        let finalCents = 0;
        let finalPLN = 0;

        if (total_cents !== undefined && total_cents !== null && !isNaN(Number(total_cents))) {
          finalCents = Number(total_cents);
          finalPLN = finalCents / 100;
        } else if (total_price !== undefined && total_price !== null && !isNaN(Number(total_price))) {
          // Heuristic: If total_price seems huge (legacy cents), treat as cents.
          // Note: Frontend update fixed this to send explicit floats for PLN.
          // But to be safe for mixed versions:
          // If we assume new frontend sends floats like 50.00, treat as PLN
          finalPLN = Number(total_price);
          finalCents = Math.round(finalPLN * 100);
        } else {
          // Calculate from items
          finalCents = items.reduce((sum, item) => sum + ((item.unit_price_cents || 0) * (item.qty || item.quantity || 1)), 0);
          finalPLN = finalCents / 100;
        }

        const requestedStatus = String(req.body?.status || '').trim().toLowerCase();
        const allowedStatuses = new Set(['pending', 'cancelled', 'confirmed']);
        const safeStatus = allowedStatuses.has(requestedStatus) ? requestedStatus : 'pending';

        const orderData = {
          user_id: user_id || null,
          restaurant_id: restaurant_id,
          restaurant_name: restaurant_name || 'Unknown Restaurant',
          items: items,
          total_price: finalPLN,   // PLN (float)
          // total_cents: finalCents, // Cents (integer) - Commented out to prevent "column does not exist" error
          status: safeStatus,
          customer_name: customer_name || null,
          customer_phone: customer_phone || null,
          delivery_address: delivery_address || null,
          notes: notes || null,
          created_at: new Date().toISOString(),
        };

        console.log('đź“ť Cart order data:', orderData);

        const { data: order, error: orderErr } = await supabase
          .from('orders')
          .insert([orderData])
          .select()
          .single();

        if (orderErr) {
          console.error('âťŚ Cart order error:', orderErr);
          return res.status(500).json({ error: orderErr.message });
        }

        console.log('✅ Cart order created:', order.id);

        // Clear session cart after successful order placement (Voice Live flow)
        try {
          const { getSession, updateSession } = await import('./brain/session/sessionStore.js');
          const sessionId = req.body.session_id || req.headers['x-amber-session-id'] || null;
          if (sessionId) {
            const snap = getSession(sessionId);
            if (snap && snap.cart) {
              updateSession(sessionId, {
                cart: { items: [], total: 0 },
                lastOrderId: order.id,
                orderMode: 'completed',
                expectedContext: null,
                pendingOrder: null,
                currentRestaurant: null,
                lastRestaurant: null,
              });
              console.log('🧹 Session cart cleared after order:', order.id);
            }
          }
        } catch (clearErr) {
          console.error('⚠️ Failed to clear session cart:', clearErr.message);
        }

        return res.json({
          ok: true,
          id: order.id,
          order: order,
          message: 'Order created successfully'
        });
      }

      // đź”Ą Legacy order creation (voice commands)
      let { message, restaurant_name, user_email } = req.body;

      // Bezpieczny fallback dla undefined values
      const safeString = (v) => {
        if (v == null) return "";
        if (typeof v === "string") return v;
        if (typeof v === "number") return String(v);
        if (typeof v === "object") {
          if (v.name) return String(v.name);
          try { return JSON.stringify(v); } catch { return String(v); }
        }
        return String(v);
      };

      message = safeString(message);
      restaurant_name = safeString(restaurant_name);
      user_email = user_email || "";

      console.log("đźźˇ INPUT:", { message, restaurant_name, user_email });
      // Guard: reject empty requests — prevents ghost orders from empty POST bodies
      if (!message.trim() && !restaurant_name.trim()) {
        console.warn("❌ Odrzucono puste zapytanie legacy — brak message i restaurant_name");
        return res.status(400).json({ ok: false, error: "Puste zapytanie — podaj nazwę dania lub restauracji." });
      }

      // Get user_id from Supabase Auth if available
      let user_id = null;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.substring(7);
          const { data: { user }, error } = await supabase.auth.getUser(token);
          if (user && !error) {
            user_id = user.id;
            console.log("âś… User authenticated:", user.email, "ID:", user_id);
          }
        } catch (authError) {
          console.log("âš ď¸Ź Auth error:", authError.message);
        }
      }

      // Pobierz restauracje
      console.log("đźŹŞ Pobieram listę restauracji...");
      const { data: restaurants, error: restErr } = await supabase.from("restaurants").select("*");
      if (restErr) throw restErr;
      console.log(`đź“‹ Znaleziono ${restaurants?.length || 0} restauracji`);

      const restMatch = findBestMatch(restaurants, restaurant_name, "name");
      if (!restMatch) {
        console.warn("âťŚ Nie znaleziono restauracji:", restaurant_name);
        return res.json({ reply: `Nie mogę znaleźć restauracji "${restaurant_name}".` });
      }

      console.log("âś… Restauracja dopasowana:", restMatch.name, "(ID:", restMatch.id, ")");

      // Pobierz menu restauracji
      console.log("đźŤ˝ď¸Ź Pobieram menu dla restauracji:", restMatch.id);
      const { data: menu, error: menuErr } = await supabase
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", restMatch.id);

      if (menuErr || !menu?.length) {
        console.warn("âťŚ Brak menu dla:", restMatch.name, "Błąd:", menuErr);
        return res.json({ reply: `Nie znalazłem menu dla "${restMatch.name}".` });
      }

      console.log(`đź“‹ Znaleziono ${menu.length} pozycji w menu:`);
      menu.forEach((item, i) => {
        console.log(`  ${i + 1}. "${item.name}" - ${item.price} zł`);
      });

      // Parsuj ilość
      let quantity = 1;
      let cleaned = message;
      const match = message.match(/(\d+)\s*x\s*(.+)/i);
      if (match) {
        quantity = parseInt(match[1]);
        cleaned = match[2];
        console.log(`đź”˘ Parsowanie ilości: "${message}" â†’ ${quantity}x "${cleaned}"`);
      } else {
        console.log(`đź”˘ Brak ilości w komendzie, domyślnie: 1x "${cleaned}"`);
      }

      // Szukaj pozycji
      console.log("đź”Ť Szukam pozycji w menu...");
      const item = findBestMatch(menu, cleaned);
      if (!item) {
        console.warn("âťŚ Brak pozycji:", cleaned);
        return res.json({ reply: `Nie znalazłem "${cleaned}" w menu. Spróbuj powiedzieć np. "pizza" lub "burger".` });
      }

      console.log("âś… Pozycja dopasowana:", item.name, "-", item.price, "zł");

      // Dodaj zamówienie
      console.log("đź’ľ Tworzę zamówienie w bazie danych...");
      const orderData = {
        user_id: user_id || null,
        restaurant_id: restMatch.id,
        restaurant_name: restMatch.name,
        dish_name: item.name,
        total_price: item.price * quantity,
        items: [{
          name: item.name,
          price: item.price,
          quantity: quantity
        }],
        status: "pending",
      };

      console.log("đź“ť Dane zamówienia:", orderData);

      const { data: order, error: orderErr } = await supabase.from("orders").insert([orderData]).select();

      if (orderErr) {
        console.error("âťŚ Błąd tworzenia zamówienia:", orderErr);
        throw orderErr;
      }

      console.log("âś… Zamówienie utworzone:", order[0]?.id);

      const response = {
        reply: `Zamówiłem ${quantity}x ${item.name} w ${restMatch.name} za ${item.price * quantity} zł.`,
        order_id: order[0]?.id,
      };

      console.log("đź“¤ Odpowiedź:", response);
      return res.json(response);

    } catch (err) {
      console.error("đź”Ą Błąd POST orders:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // PATCH - update order status
  if (req.method === 'PATCH') {
    // T1 (etap 1 z SS9): PATCH mutuje CUDZE zamowienia, wiec wymaga autoryzacji.
    // Przed zmiana dowolny anonimowy klient zmienial status, notatki i wlasciciela
    // dowolnego zamowienia, znajac wylacznie jego id.
    if (!requireAdmin(req, res)) return;

    try {
      const orderId = extractOrderId(req);
      if (!orderId) {
        return res.status(400).json({ ok: false, error: 'missing_order_id' });
      }

      const body =
        req.body && typeof req.body === 'object' && !Array.isArray(req.body)
          ? req.body
          : {};
      const providedKeys = Object.keys(body);

      if (providedKeys.length === 0) {
        return res.status(400).json({
          ok: false,
          error: 'empty_payload',
          allowed: [...PATCH_ALLOWED_FIELDS],
        });
      }

      // Allowlista pol. Cokolwiek spoza niej odrzuca CALE zadanie - payload
      // z dodatkowym polem nie moze zostac zastosowany czesciowo.
      const rejectedFields = providedKeys.filter((k) => !PATCH_ALLOWED_FIELDS.has(k));
      if (rejectedFields.length > 0) {
        return res.status(400).json({
          ok: false,
          error: 'field_not_allowed',
          fields: rejectedFields,
          allowed: [...PATCH_ALLOWED_FIELDS],
          detail: 'Zadanie odrzucone w calosci - zadne pole nie zostalo zapisane.',
        });
      }

      const updatePayload = {};

      if ('status' in body) {
        const status = typeof body.status === 'string' ? body.status.trim() : '';
        if (!status) {
          return res.status(400).json({ ok: false, error: 'invalid_status' });
        }
        if (!ALLOWED_STATUS_VALUES.has(status)) {
          return res.status(400).json({
            ok: false,
            error: 'status_not_allowed',
            allowed: [...ALLOWED_STATUS_VALUES],
          });
        }
        updatePayload.status = status;
      }

      if ('notes' in body) {
        if (typeof body.notes !== 'string') {
          return res.status(400).json({ ok: false, error: 'invalid_notes' });
        }
        updatePayload.notes = body.notes;
      }

      // Loguj wylacznie nazwy pol. Wartosci (notes) moga zawierac dane klienta.
      console.log('[ORDERS_PATCH]', { orderId, fields: Object.keys(updatePayload) });

      const { data, error } = await supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', orderId)
        .select()
        .single();

      if (error) {
        console.error('[ORDERS_PATCH] blad aktualizacji:', error.message);
        return res.status(500).json({ error: error.message });
      }

      return res.json({ ok: true, order: data });
    } catch (err) {
      console.error('[ORDERS_PATCH] wyjatek:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // Method not allowed
  return res.status(405).json({ error: 'Method not allowed' });
}


