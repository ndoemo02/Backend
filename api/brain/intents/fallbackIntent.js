import { normalizeTxt } from "./intentRouterGlue.js";

export function fallbackIntent(text, intent, confidence, session = null) {
  const normalized = normalizeTxt(text || "");
  const ctx = session || {};

  // 1. Jeśli już mamy jakąś sensowną intencję – nie ruszaj
  if (intent && intent !== "none") {
    return intent;
  }

  // 2. Zaakceptowanie propozycji menu, jeśli wcześniej padło pytanie
  if (
    /(^|\s)(tak|ok|dobrze|zgoda|pewnie|jasne|oczywiscie)(\s|$)/i.test(normalized) &&
    ctx.lastRestaurant
  ) {
    return "menu_request";
  }

  // 3. Ogólne gadanie o jedzeniu lub restauracjach → find_nearby
  if (/(restaurac|zje|jedzen|obiad|kolacj|sniadan)/i.test(normalized)) {
    return "find_nearby";
  }

  // 4. Potwierdzanie/odrzucanie zamówienia
  if (ctx?.expectedContext === "confirm_order") {
    if (/(^|\s)nie(\s|$)/i.test(normalized)) {
      return "cancel_order";
    }
  }

  // 5. Bardzo niska pewność → none
  if (confidence != null && confidence < 0.4) {
    return "none";
  }

  return intent || "none";
}
