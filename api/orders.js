import { supabase } from "./_supabase.js";
import { applyCORS } from "./_cors.js";
import { normalizeTxt, levenshtein } from "./brain/helpers.js";

// 🛒 Nowy endpoint dla create_order
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
    console.error("❌ Order error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ✅ Funkcje normalize i levenshtein zaimportowane z helpers.js (deduplikacja)

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
  let best = null;
  let bestScore = Infinity;
  let exactMatch = null;

  console.log(`🔍 Szukam "${query}" (znormalizowane: "${normQuery}") w ${list.length} pozycjach`);

  for (const el of list) {
    const name = normalizeTxt(safeString(el[field]));
    
    // Sprawdź dokładne dopasowanie (includes)
    if (name.includes(normQuery)) {
      console.log(`✅ Dokładne dopasowanie: "${el[field]}" zawiera "${query}"`);
      exactMatch = el;
      break; // Priorytet dla dokładnych dopasowań
    }
    
    // Sprawdź podobieństwo Levenshtein
    const dist = levenshtein(name, normQuery);
    console.log(`📊 "${el[field]}" → odległość: ${dist}`);
    
    if (dist < bestScore) {
      bestScore = dist;
      best = el;
    }
  }

  // Zwróć dokładne dopasowanie jeśli istnieje, w przeciwnym razie najlepsze podobieństwo
  const result = exactMatch || (bestScore <= 2 ? best : null);
  
  if (result) {
    console.log(`🎯 WYBRANE: "${result[field]}" (typ: ${exactMatch ? 'dokładne' : 'podobieństwo'})`);
  } else {
    console.log(`❌ BRAK DOPASOWANIA: najlepsza odległość: ${bestScore}`);
  }
  
  return result;
}

// 🛒 Funkcja do tworzenia zamówienia (dla intent-router)
export async function createOrder(restaurantId, userId = "guest") {
  try {
    console.log(`🛒 Tworzę zamówienie dla restauracji ${restaurantId}, użytkownik: ${userId}`);
    
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
      console.error("❌ Błąd tworzenia zamówienia:", error);
      throw error;
    }
    
    console.log("✅ Zamówienie utworzone:", order?.id);
    return order;
    
  } catch (err) {
    console.error("🔥 Błąd createOrder:", err);
    return null;
  }
}

export default async function handler(req, res) {
  if (applyCORS(req, res)) return; // 👈 ważne: obsługuje preflight

  // GET - pobierz zamówienia
  if (req.method === 'GET') {
    try {
      const { user_email, user_id, restaurant_id } = req.query;
      console.log('📋 Pobieram zamówienia dla:', { user_email, user_id, restaurant_id });

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
      
      // Filtruj według parametrów
      if (restaurant_id) {
        query = query.eq('restaurant_id', restaurant_id);
      } else if (user_id) {
        query = query.eq('user_id', user_id);
      } else if (user_email) {
        // Dla kompatybilności - jeśli nie ma user_id, pobierz wszystkie zamówienia
        console.log('⚠️ user_email nie jest obsługiwane, pobieram wszystkie zamówienia');
      }

      const { data: orders, error } = await query;
      
      if (error) {
        console.error('❌ Błąd pobierania zamówień:', error);
        return res.status(500).json({ error: error.message });
      }

      console.log(`✅ Znaleziono ${orders?.length || 0} zamówień`);
      return res.json({ orders: orders || [] });

    } catch (err) {
      console.error('🔥 Błąd GET orders:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // POST - utwórz zamówienie
  if (req.method === 'POST') {
    try {
    // 🔥 Check if this is a cart order (from frontend)
    if (req.body.restaurant_id && req.body.items && Array.isArray(req.body.items)) {
      console.log('🛒 Cart order detected:', req.body);
      
      const { restaurant_id, items, user_id, restaurant_name, customer_name, customer_phone, delivery_address, notes, total_price } = req.body;
      
      if (!restaurant_id || !items?.length) {
        return res.status(400).json({ error: "Incomplete cart order data" });
      }
      
      const orderData = {
        user_id: user_id || null,
        restaurant_id: restaurant_id,
        restaurant_name: restaurant_name || 'Unknown Restaurant',
        items: items,
        total_price: total_price || items.reduce((sum, item) => sum + (item.unit_price_cents * item.qty), 0),
        status: "pending",
        customer_name: customer_name || null,
        customer_phone: customer_phone || null,
        delivery_address: delivery_address || null,
        notes: notes || null,
        created_at: new Date().toISOString(),
      };
      
      console.log('📝 Cart order data:', orderData);
      
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .insert([orderData])
        .select()
        .single();
      
      if (orderErr) {
        console.error('❌ Cart order error:', orderErr);
        return res.status(500).json({ error: orderErr.message });
      }
      
      console.log('✅ Cart order created:', order.id);
      return res.json({ 
        ok: true, 
        id: order.id, 
        order: order,
        message: 'Order created successfully' 
      });
    }
    
    // 🔥 Legacy order creation (voice commands)
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
    
    console.log("🟡 INPUT:", { message, restaurant_name, user_email });

    // Get user_id from Supabase Auth if available
    let user_id = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (user && !error) {
          user_id = user.id;
          console.log("✅ User authenticated:", user.email, "ID:", user_id);
        }
      } catch (authError) {
        console.log("⚠️ Auth error:", authError.message);
      }
    }

    // Pobierz restauracje
    console.log("🏪 Pobieram listę restauracji...");
    const { data: restaurants, error: restErr } = await supabase.from("restaurants").select("*");
    if (restErr) throw restErr;
    console.log(`📋 Znaleziono ${restaurants?.length || 0} restauracji`);

    const restMatch = findBestMatch(restaurants, restaurant_name, "name");
    if (!restMatch) {
      console.warn("❌ Nie znaleziono restauracji:", restaurant_name);
      return res.json({ reply: `Nie mogę znaleźć restauracji "${restaurant_name}".` });
    }

    console.log("✅ Restauracja dopasowana:", restMatch.name, "(ID:", restMatch.id, ")");

    // Pobierz menu restauracji
    console.log("🍽️ Pobieram menu dla restauracji:", restMatch.id);
    const { data: menu, error: menuErr } = await supabase
      .from("menu_items")
      .select("*")
      .eq("restaurant_id", restMatch.id);

    if (menuErr || !menu?.length) {
      console.warn("❌ Brak menu dla:", restMatch.name, "Błąd:", menuErr);
      return res.json({ reply: `Nie znalazłem menu dla "${restMatch.name}".` });
    }

    console.log(`📋 Znaleziono ${menu.length} pozycji w menu:`);
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
      console.log(`🔢 Parsowanie ilości: "${message}" → ${quantity}x "${cleaned}"`);
    } else {
      console.log(`🔢 Brak ilości w komendzie, domyślnie: 1x "${cleaned}"`);
    }

    // Szukaj pozycji
    console.log("🔍 Szukam pozycji w menu...");
    const item = findBestMatch(menu, cleaned);
    if (!item) {
      console.warn("❌ Brak pozycji:", cleaned);
      return res.json({ reply: `Nie znalazłem "${cleaned}" w menu. Spróbuj powiedzieć np. "pizza" lub "burger".` });
    }

    console.log("✅ Pozycja dopasowana:", item.name, "-", item.price, "zł");

    // Dodaj zamówienie
    console.log("💾 Tworzę zamówienie w bazie danych...");
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
    
    console.log("📝 Dane zamówienia:", orderData);
    
    const { data: order, error: orderErr } = await supabase.from("orders").insert([orderData]).select();

    if (orderErr) {
      console.error("❌ Błąd tworzenia zamówienia:", orderErr);
      throw orderErr;
    }

    console.log("✅ Zamówienie utworzone:", order[0]?.id);

    const response = {
      reply: `Zamówiłem ${quantity}x ${item.name} w ${restMatch.name} za ${item.price * quantity} zł.`,
      order_id: order[0]?.id,
    };
    
      console.log("📤 Odpowiedź:", response);
      return res.json(response);

    } catch (err) {
      console.error("🔥 Błąd POST orders:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE - usuń wszystkie zamówienia (dla testów)
  if (req.method === 'DELETE') {
    try {
      console.log('🗑️ Usuwam wszystkie zamówienia...');
      
      const { error } = await supabase.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      
      if (error) {
        console.error('❌ Błąd usuwania zamówień:', error);
        return res.status(500).json({ error: error.message });
      }

      console.log('✅ Wszystkie zamówienia usunięte');
      return res.json({ message: 'All orders deleted successfully' });

    } catch (err) {
      console.error('🔥 Błąd DELETE orders:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // PATCH - update order status
  if (req.method === 'PATCH') {
    try {
      const orderId = req.url.split('/').pop();
      const { status } = req.body;

      if (!orderId || !status) {
        return res.status(400).json({ error: 'Missing order ID or status' });
      }

      console.log(`📝 Updating order ${orderId} to status: ${status}`);

      const { data, error } = await supabase
        .from('orders')
        .update({ status })
        .eq('id', orderId)
        .select()
        .single();

      if (error) {
        console.error('❌ Error updating order:', error);
        return res.status(500).json({ error: error.message });
      }

      console.log('✅ Order updated successfully:', data);
      return res.json({ ok: true, order: data });
    } catch (err) {
      console.error('🔥 Błąd PATCH orders:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // Method not allowed
  return res.status(405).json({ error: 'Method not allowed' });
}