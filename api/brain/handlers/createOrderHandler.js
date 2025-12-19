import { getSession, updateSession } from "../context.js";
import { findRestaurantByName, getLocationFallback } from "../locationService.js";
import { parseOrderItems, normalize } from "../orderService.js";
import { getMenuItems, sumCartItems } from "../menuService.js";
export async function handleCreateOrder({
  text,
  sessionId,
  prevLocation,
  parsed,
  parsedOrder,
  res,
}) {
  console.log("🧠 create_order handler");
  const normalizedText = normalize(text || "");
  const session = getSession(sessionId) || {};

  if (!hasLocationContext(session)) {
    return respondWithLocationPrompt({ res, session, normalizedText });
  }

  try {
    if (parsedOrder?.any) {
      return await handleParsedOrderFlow({ text, sessionId, parsedOrder });
    }

    return await handleLegacyOrderFlow({
      text,
      sessionId,
      prevLocation,
      parsed,
    });
  } catch (error) {
    console.error("❌ create_order error:", error);
    return {
      reply: "Przepraszam, wystąpił błąd przy przetwarzaniu zamówienia. Spróbuj ponownie.",
    };
  }
}

function hasLocationContext(session) {
  return !!(session?.last_location || session?.lastRestaurant);
}

function isNearbyQuery(normalizedText) {
  if (!normalizedText) return false;
  return /\bgdzie\b/.test(normalizedText) || /w poblizu|w pobli/u.test(normalizedText);
}

function respondWithLocationPrompt({ res, session, normalizedText }) {
  const nearbyIntent = isNearbyQuery(normalizedText);
  const intent = nearbyIntent ? "find_nearby" : "create_order";
  const reply = nearbyIntent
    ? "Brak lokalizacji. Podaj nazwę miasta (np. Piekary) lub powiedz 'w pobliżu'."
    : "Brak lokalizacji. Podaj nazwę miasta lub powiedz 'w pobliżu'.";

  if (res && !res.headersSent) {
    res.status(200).json({
      ok: true,
      intent,
      reply,
      fallback: true,
      context: session,
    });
    return { handled: true };
  }

  return { reply, meta: { fallback: true, intentOverride: intent } };
}

async function handleParsedOrderFlow({ text, sessionId, parsedOrder }) {
  console.log("✅ Using parsedOrder from detectIntent()");

  const firstGroup =
    parsedOrder.groups && parsedOrder.groups.length ? parsedOrder.groups[0] : null;

  let targetRestaurant = null;
  if (firstGroup?.restaurant_name) {
    targetRestaurant = await findRestaurantByName(firstGroup.restaurant_name);
  } else {
    targetRestaurant = getSession(sessionId)?.lastRestaurant || null;
  }

  if (!targetRestaurant) {
    console.warn("⚠️ Restaurant from parsedOrder not found");
    const fallback = await tryFallbackToSessionRestaurant({ text, sessionId });
    if (fallback) return fallback;

    return {
      reply: "Nie mogę znaleźć restauracji dla tego zamówienia. Spróbuj wskazać nazwę lokalu lub wybierz z listy.",
    };
  }

  updateSession(sessionId, { lastRestaurant: targetRestaurant });
  await mergePendingOrderFromParsed({
    sessionId,
    parsedOrder,
    firstGroup,
    restaurant: targetRestaurant,
  });

  if (!firstGroup?.items?.length) {
    const parsedFallback = await tryParseItemsForRestaurant({
      text,
      sessionId,
      restaurant: targetRestaurant,
    });
    if (parsedFallback) return parsedFallback;

    const keywordFallback = await tryKeywordFallback({
      text,
      restaurant: targetRestaurant,
    });

    if (keywordFallback) {
      updateSession(sessionId, {
        expectedContext: "confirm_order",
        pendingOrder: keywordFallback.pendingOrder,
      });
      logPendingOrder(keywordFallback.pendingOrder);
      return { reply: keywordFallback.reply };
    }
  }

  const normalizedItems = normalizeGroupItems(firstGroup?.items || []);
  const total = calcItemsTotal(normalizedItems);
  const itemsList = formatItemsList(normalizedItems);

  const pendingOrder = createPendingOrderPayload(targetRestaurant, normalizedItems, total);
  updateSession(sessionId, {
    expectedContext: "confirm_order",
    pendingOrder,
  });
  logPendingOrder(pendingOrder);

  return {
    reply: `Rozumiem: ${itemsList}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`,
  };
}

async function handleLegacyOrderFlow({ text, sessionId, prevLocation, parsed }) {
  let targetRestaurant = null;
  if (parsed?.restaurant) {
    targetRestaurant = await findRestaurantByName(parsed.restaurant);
    if (targetRestaurant) {
      updateSession(sessionId, { lastRestaurant: targetRestaurant });
      console.log(`✅ Restaurant set from text: ${targetRestaurant.name}`);
    }
  }

  const current = targetRestaurant || getSession(sessionId)?.lastRestaurant;
  if (!current) {
    console.warn("⚠️ No restaurant in context for create_order");
    const fallback = await getLocationFallback(
      sessionId,
      prevLocation,
      `Najpierw wybierz restaurację w {location}:\n{list}\n\nZ której chcesz zamówić?`,
    );
    if (fallback) {
      return { reply: fallback };
    }
    return { reply: "Najpierw wybierz restaurację, zanim złożysz zamówienie." };
  }

  const parsedItems = await parseOrderItems(text, current.id);
  if (!parsedItems.length) {
    const suggestion = await buildSuggestionReply({ text, restaurant: current });
    return { reply: suggestion };
  }

  const total = calcItemsTotal(parsedItems);
  const pendingOrder = createPendingOrderPayload(current, parsedItems, total);
  updateSession(sessionId, {
    expectedContext: "confirm_order",
    pendingOrder,
  });
  logPendingOrder(pendingOrder);

  return {
    reply: `Rozumiem: ${formatItemsList(parsedItems)}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`,
  };
}

async function tryFallbackToSessionRestaurant({ text, sessionId }) {
  const s2 = getSession(sessionId) || {};
  if (!s2.lastRestaurant) return null;

  const fallbackItems = await parseOrderItems(text, s2.lastRestaurant.id);
  if (!fallbackItems.length) return null;

  const total = calcItemsTotal(fallbackItems);
  const pendingOrder = createPendingOrderPayload(s2.lastRestaurant, fallbackItems, total);

  updateSession(sessionId, {
    expectedContext: "confirm_order",
    pendingOrder,
  });
  logPendingOrder(pendingOrder);

  return {
    reply: `Rozumiem: ${formatItemsList(fallbackItems)}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`,
  };
}

async function tryParseItemsForRestaurant({ text, sessionId, restaurant }) {
  const fallbackItems = await parseOrderItems(text, restaurant.id);
  if (!fallbackItems.length) return null;

  const total = calcItemsTotal(fallbackItems);
  const pendingOrder = createPendingOrderPayload(restaurant, fallbackItems, total);

  updateSession(sessionId, {
    expectedContext: "confirm_order",
    pendingOrder,
  });
  logPendingOrder(pendingOrder);

  return {
    reply: `Rozumiem: ${formatItemsList(fallbackItems)}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`,
  };
}

async function tryKeywordFallback({ text, restaurant }) {
  const keyword =
    normalize(text).replace(/pizza\s*/g, "").split(" ").find((w) => w.length >= 4) || "";
  if (!keyword) return null;

  const menuForSearch = await getMenuItems(restaurant.id, { includeUnavailable: true });
  const matched = (menuForSearch || []).filter((m) => normalize(m.name).includes(keyword));
  if (!matched.length) return null;

  const fallbackItems = matched.slice(0, 1).map((m) => ({
    id: m.id,
    name: m.name,
    price: Number(m.price_pln) || 0,
    quantity: 1,
  }));

  const total = calcItemsTotal(fallbackItems);
  return {
    reply: `Rozumiem: ${formatItemsList(fallbackItems)}. Razem ${total.toFixed(2)} zł. Dodać do koszyka?`,
    pendingOrder: createPendingOrderPayload(restaurant, fallbackItems, total),
  };
}

async function mergePendingOrderFromParsed({ sessionId, parsedOrder, firstGroup, restaurant }) {
  try {
    const session = getSession(sessionId) || {};
    const poItems = parsedOrder?.items || firstGroup?.items || [];
    if (!poItems?.length) return;

    const incoming = poItems.map((it) => ({
      id: it.id,
      name: it.name || it.item_name,
      price_pln: Number(it.price_pln ?? it.price ?? 0),
      qty: Number(it.qty || it.quantity || 1),
    }));

    const restName = restaurant?.name || session.lastRestaurant?.name;
    const restId = restaurant?.id || session.lastRestaurant?.id;

    if (
      session.pendingOrder &&
      Array.isArray(session.pendingOrder.items) &&
      session.pendingOrder.restaurant_id === restId
    ) {
      const merged = [...session.pendingOrder.items];
      for (const inc of incoming) {
        const idx = merged.findIndex(
          (m) =>
            (m.id && inc.id && m.id === inc.id) ||
            (m.name && inc.name && m.name.toLowerCase() === (inc.name || "").toLowerCase()),
        );
        if (idx >= 0) {
          merged[idx].qty = Number(merged[idx].qty || 1) + Number(inc.qty || 1);
        } else {
          merged.push(inc);
        }
      }
      session.pendingOrder.items = merged;
      session.pendingOrder.total = Number(sumCartItems(merged)).toFixed(2);
    } else {
      session.pendingOrder = {
        items: incoming,
        restaurant: restName,
        restaurant_id: restId,
        total: Number(parsedOrder?.totalPrice ?? sumCartItems(poItems)).toFixed(2),
      };
    }

    session.expectedContext = "confirm_order";
    console.log("🧠 Saved/merged pending order to session:", session.pendingOrder);
    updateSession(sessionId, session);
  } catch (error) {
    console.warn("⚠️ create_order: failed to store pendingOrder", error);
  }
}

async function buildSuggestionReply({ text, restaurant }) {
  const lowerText = normalize(text);
  const isPizzaRequest = /(pizza|pizze|pizz[ay])/i.test(lowerText);

  if (isPizzaRequest) {
    const pizzaSuggestion = await suggestPizzaList(restaurant);
    if (pizzaSuggestion) {
      return pizzaSuggestion;
    }
  }

  return await generalMenuFallback(restaurant);
}

async function suggestPizzaList(restaurant) {
  const bannedKeywords = [
    "sos",
    "dodatk",
    "extra",
    "napoj",
    "napój",
    "napoje",
    "sklad",
    "skład",
    "fryt",
    "ser",
    "szynk",
    "bekon",
    "boczek",
    "cebula",
    "pomidor",
    "czosnek",
    "pieczark",
  ];
  const pizzaNameHints =
    /(margher|margar|capric|diavol|hawaj|hawai|funghi|prosciut|salami|pepperoni|quattro|formaggi|stagioni|parma|parme|tonno|napolet|napolit|bianca|bufala|wiejsk|vege|wegetar|vegetar|carbonar|calzone|monte|romana|neapol|neapolita)/i;

  let menu = await getMenuItems(restaurant.id, { includeUnavailable: false });
  if (!menu?.length) return null;

  const pizzas = menu
    .filter((m) => {
      const name = (m.name || "").toLowerCase();
      const category = (m.category || "").toLowerCase();
      if (name.length <= 3) return false;
      if (bannedKeywords.some((k) => name.includes(k))) return false;
      if (category.includes("pizz") || category.includes("pizzeria")) return true;
      return name.includes("pizza") || pizzaNameHints.test(name);
    })
    .slice(0, 6);

  if (!pizzas.length) return null;
  const list = pizzas.map((m) => m.name).join(", ");
  return `Jasne, jaką pizzę z ${restaurant.name} wybierasz? Mam np.: ${list}.`;
}

async function generalMenuFallback(restaurant) {
  const banned = [
    "sos",
    "dodatk",
    "extra",
    "napoj",
    "napój",
    "napoje",
    "sklad",
    "skład",
    "ser",
    "szynk",
    "bekon",
    "boczek",
    "cebula",
    "pomidor",
    "czosnek",
    "pieczark",
  ];

  const menu = await getMenuItems(restaurant.id, { includeUnavailable: false });
  const filtered = (menu || [])
    .filter((m) => {
      const n = (m.name || "").toLowerCase();
      if (n.length <= 3) return false;
      return !banned.some((k) => n.includes(k));
    })
    .slice(0, 6);

  if (filtered.length) {
    return `Nie rozpoznałam konkretnego dania. W ${restaurant.name} masz np.: ${filtered
      .map((m) => m.name)
      .join(", ")}. Co wybierasz?`;
  }

  return `Nie rozpoznałam dania. Sprawdź menu ${restaurant.name} i spróbuj ponownie.`;
}

function normalizeGroupItems(items = []) {
  return items.map((item) => ({
    id: item.menuItemId ?? item.id,
    name: item.name,
    price: Number(item.price ?? item.price_pln ?? 0),
    quantity: Number(item.quantity ?? item.qty ?? 1),
  }));
}

function calcItemsTotal(items = []) {
  return items.reduce(
    (sum, item) =>
      sum + Number(item.price ?? item.price_pln ?? 0) * Number(item.quantity ?? item.qty ?? 1),
    0,
  );
}

function formatItemsList(items = []) {
  return items
    .map((item) => {
      const qty = Number(item.quantity ?? item.qty ?? 1);
      const price = Number(item.price ?? item.price_pln ?? 0) * qty;
      return `${qty}x ${item.name} (${price.toFixed(2)} zł)`;
    })
    .join(", ");
}

function createPendingOrderPayload(restaurant, items, total) {
  const details = restaurant
    ? { id: restaurant.id, name: restaurant.name, city: restaurant.city }
    : null;
  return {
    restaurant: details?.name || null,
    restaurant_id: details?.id || null,
    restaurant_details: details,
    items,
    total: Number(total),
  };
}

function logPendingOrder(pendingOrder) {
  if (!pendingOrder?.items?.length) return;
  console.log("✅ Pending order saved to session:");
  console.log("   - expectedContext: confirm_order");
  console.log("   - pendingOrder items count:", pendingOrder.items.length);
  console.log(
    "   - pendingOrder items:",
    pendingOrder.items
      .map((i) => `${Number(i.quantity ?? i.qty ?? 1)}x ${i.name}`)
      .join(", "),
  );
  console.log("   - total:", Number(pendingOrder.total).toFixed(2), "zł");
  if (pendingOrder.restaurant_details) {
    console.log("   - restaurant:", pendingOrder.restaurant_details.name);
  }
}
