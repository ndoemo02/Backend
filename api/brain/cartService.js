import crypto from "node:crypto";
import { sumCartItems } from "./menuService.js";

/**
 * Upewnia się, że obiekt sesji ma strukturę koszyka.
 * Mutuje przekazany obiekt (zgodnie z dotychczasowym zachowaniem brainRoutera).
 */
export function ensureSessionCart(session = {}) {
  if (!session.cart) session.cart = { items: [], total: 0 };
  if (!Array.isArray(session.cart.items)) session.cart.items = [];
  if (typeof session.cart.total !== "number") session.cart.total = 0;
}

/**
 * Przenosi pendingOrder do koszyka i czyści kontekst konfirmacji.
 */
export function commitPendingOrder(session) {
  if (!session?.pendingOrder?.items?.length) {
    const fallbackCart = session?.cart || { items: [], total: 0 };
    return { committed: false, cart: fallbackCart };
  }

  ensureSessionCart(session);

  const toAdd = session.pendingOrder.items.map((item) => ({
    id: item.id || crypto.randomUUID?.() || String(Date.now()),
    name: item.name || item.item_name || "pozycja",
    price_pln: Number(item.price_pln ?? item.price ?? 0),
    qty: Number(item.qty || item.quantity || 1),
    restaurant_id: session.pendingOrder.restaurant_id,
    restaurant_name: session.pendingOrder.restaurant,
  }));

  session.cart.items.push(...toAdd);
  session.cart.total = Number(sumCartItems(session.cart.items).toFixed(2));
  session.lastOrder = { ...session.pendingOrder };
  delete session.pendingOrder;

  if (session.expectedContext === "confirm_order") {
    delete session.expectedContext;
  }

  return { committed: true, cart: session.cart };
}

