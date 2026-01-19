# DIALOG POLICY MAP
## Brain V2 — Polityka Dialogowa (Agent 1)

---

## 🎯 CEL DOKUMENTU

Zamienić "tępe komendy" w **dialog sterowany polityką** — bez dotykania FSM ani intentów.

**Zasada nadrzędna:**
> System NIGDY nie wraca automatycznie do `find_nearby` bez pytania użytkownika.

---

## ❌ CZEGO TEN DOKUMENT NIE ZMIENIA

- ❌ NLU (intent detection)
- ❌ Nowych intentów
- ❌ Logiki backendowej (handlery)
- ❌ IntentCapabilityMap rules

## ✅ CO TEN DOKUMENT DEFINIUJE

- ✅ **Mapowanie sytuacji → dialog_key**
- ✅ **Jak system MA rozmawiać** (UX policy)
- ✅ **Surface rendering rules**

---

## 📋 KATALOG SYTUACJI DIALOGOWYCH

### 1️⃣ ICM BLOCK SITUATIONS (Intent Capability Map)

Sytuacje gdzie ICM blokuje intent z powodu brakującego stanu sesji.

| Sytuacja | Trigger | Wymagany Stan | dialog_key | Reakcja UX |
|----------|---------|---------------|------------|------------|
| **Menu bez restauracji** | `menu_request` | `currentRestaurant: null` | `ASK_RESTAURANT_FOR_MENU` | Pokaż listę restauracji, zapytaj którą |
| **Zamówienie bez restauracji** | `create_order` | `currentRestaurant: null` | `ASK_RESTAURANT_FOR_ORDER` | Pokaż listę restauracji, zapytaj którą + zapamiętaj danie |
| **Więcej opcji bez listy** | `show_more_options` | `last_restaurants_list: []` | `ASK_LOCATION` | Zapytaj o miasto |
| **Wybór bez listy** | `select_restaurant` | `last_restaurants_list: []` | `ASK_LOCATION` | Zapytaj o miasto |
| **Potwierdzenie bez zamówienia** | `confirm_order` | `pendingOrder: null` | `ASK_WHAT_TO_ORDER` | Zapytaj co chce zamówić |

---

### 2️⃣ DISAMBIGUATION SITUATIONS (parseOrderItems)

Sytuacje gdzie parser nie może jednoznacznie zidentyfikować pozycji menu.

| Sytuacja | Trigger | Dane dostępne | dialog_key | Reakcja UX |
|----------|---------|---------------|------------|------------|
| **Pozycja nieznana** | `unknownItems.length > 0` | `item_name`, `restaurant` | `ITEM_NOT_FOUND` | "Nie widzę [X] w menu. Pokaż menu?" |
| **Wiele wariantów** | `needsClarification: true` | `options[]` | `CLARIFY_MENU_ITEM` | "Mam kilka opcji dla [X]: 1) Y 2) Z" |
| **Produkt niedostępny** | `unavailable.length > 0` | `item_name`, `reason` | `ITEM_UNAVAILABLE` | "Niestety [X] jest teraz niedostępny" |
| **Brak aliasu w katalogu** | `no_alias_match` | `raw_text` | `ASK_CLARIFICATION_DISH` | "Nie rozpoznaję [X]. Co dokładnie masz na myśli?" |

---

### 3️⃣ HARD BLOCK LEGACY (ICM Flag)

Sytuacje gdzie intent jest zablokowany ze źródła legacy NLU.

| Intent | Flag | dialog_key | Reakcja UX |
|--------|------|------------|------------|
| `create_order` | `HARD_BLOCK_LEGACY: true` | `LEGACY_ORDER_BLOCKED` | Przekieruj do explicit flow |

---

### 4️⃣ CART MUTATION GUARD

Sytuacje gdzie próba mutacji koszyka jest zablokowana.

| Sytuacja | Trigger | dialog_key | Reakcja UX |
|----------|---------|------------|------------|
| **Nielegalna mutacja** | `mutatesCart(intent) && intent !== 'confirm_order'` | `CART_MUTATION_BLOCKED` | Ignoruj cicho, kontynuuj flow |

---

### 5️⃣ LOCATION SITUATIONS (FindHandler)

Sytuacje związane z brakiem lub nierozpoznaniem lokalizacji.

| Sytuacja | Trigger | dialog_key | Reakcja UX |
|----------|---------|------------|------------|
| **Brak lokalizacji** | `location: null` | `ASK_LOCATION` | "W którym mieście szukamy?" |
| **Lokalizacja nierozpoznana** | `!KNOWN_CITIES.includes(loc)` | `ASK_LOCATION_CLARIFY` | "Nie znam [X]. Czy chodziło o [Y]?" |
| **Pobliże bez GPS** | `/w pobliżu/` + `!body.lat` | `ASK_LOCATION_OR_GPS` | "Podaj miasto lub włącz lokalizację" |

---

### 6️⃣ RESTAURANT SELECTION SITUATIONS (SelectHandler)

| Sytuacja | Trigger | dialog_key | Reakcja UX |
|----------|---------|------------|------------|
| **Wiele restauracji pasuje** | `entities.options.length > 1` | `CHOOSE_RESTAURANT` | "Którą restaurację? 1) X 2) Y" |
| **Fuzzy match** | `isSimilar && currentName !== mentioned` | `CONFIRM_RESTAURANT` | "Czy chodziło Ci o [X]?" |

---

### 7️⃣ ORDER FLOW SITUATIONS (OrderHandler)

| Sytuacja | Trigger | dialog_key | Reakcja UX |
|----------|---------|------------|------------|
| **Zamówienie bez dania** | `!dish && hasOrderVerb` | `ASK_WHAT_TO_ORDER` | "Co dokładnie chciałbyś zamówić?" |
| **Implicit order bez czasownika** | `intent: create_order && !hasOrderVerb` | `CONFIRM_IMPLICIT_ORDER` | "Czy chcesz zamówić [X]?" |
| **Koszyk pusty przy confirm** | `pendingOrder.items.length === 0` | `CART_EMPTY` | "Twój koszyk jest pusty. Co dodać?" |

---

## 🔄 MAPOWANIE: dialog_key → SurfaceRenderer

| dialog_key | Surface Template | Przykładowy output |
|------------|------------------|-------------------|
| `ASK_RESTAURANT_FOR_MENU` | `ASK_RESTAURANT_FOR_MENU` | "Chcesz menu której restauracji? 1. Bar Praha, 2. Hubertus" |
| `ASK_RESTAURANT_FOR_ORDER` | `ASK_RESTAURANT_FOR_ORDER` | "Chcesz zamówić 'kebab' — z której restauracji?" |
| `ASK_LOCATION` | `ASK_LOCATION` | "W którym mieście szukamy?" |
| `ITEM_NOT_FOUND` | `ITEM_NOT_FOUND` | "Nie widzę 'naleśniki ze szpinakiem' w menu. Pokaż menu?" |
| `CLARIFY_MENU_ITEM` | `CLARIFY_ITEMS` | "Mam kilka opcji: 1) Pizza Margherita 2) Pizza Pepperoni" |
| `CHOOSE_RESTAURANT` | `CHOOSE_RESTAURANT` | "Którą restaurację wybierasz? (numer lub nazwa)" |
| `CONFIRM_RESTAURANT` | `CONFIRM_SELECTED_RESTAURANT` | "Czy chodzi o Bar Praha? Powiedz 'tak' żeby kontynuować." |
| `ASK_WHAT_TO_ORDER` | `ASK_CLARIFICATION_DISH` | "Co dokładnie chciałbyś zamówić?" |
| `CART_EMPTY` | `ERROR` (reason: 'no_items') | "Twój koszyk jest pusty. Co dodać?" |

---

## 🛡️ REGUŁY UX (Policy Enforcement)

### Reguła 1: NIE RESETUJ BEZ PYTANIA
```
IF icm_block AND hasRestaurantsList THEN
  → ASK_RESTAURANT_FOR_*
ELSE IF icm_block AND !hasRestaurantsList THEN
  → ASK_LOCATION
NEVER
  → silently fallback to find_nearby
```

### Reguła 2: ZAPAMIĘTAJ KONTEKST
```
IF user_intent_blocked THEN
  session.dialog_focus = "CHOOSING_RESTAURANT_FOR_*"
  session.pendingDish = extracted_dish (if any)
  session.expectedContext = "select_restaurant"
```

### Reguła 3: DANIE MA PRIORYTET
```
IF user_mentions_dish AND no_restaurant THEN
  → preserve dish in session.pendingDish
  → ask for restaurant first
  → after selection, auto-continue order flow
```

### Reguła 4: JEDNA ODPOWIEDŹ = JEDEN CEL
```
NEVER combine:
  - location question + restaurant list
  - menu display + order confirmation
  
ALWAYS:
  - one clear question
  - one expected response type
```

### Reguła 5: BŁĄD = HELPFUL RECOVERY
```
IF error_condition THEN
  → explain what went wrong (1 sentence)
  → suggest concrete action ("powiedz X" or "pokaż menu")
  → preserve user's original intent if possible
```

---

## 📊 DIALOG FOCUS STATES

| dialog_focus | Znaczenie | Expected Next Intent |
|--------------|-----------|---------------------|
| `CHOOSING_RESTAURANT_FOR_MENU` | User wants menu, picking restaurant | `select_restaurant` |
| `CHOOSING_RESTAURANT_FOR_ORDER` | User wants to order, picking restaurant | `select_restaurant` |
| `CLARIFYING_DISH` | Disambiguation in progress | `select_dish_variant` |
| `AWAITING_LOCATION` | Need city/address | text with location |
| `CONFIRMING_ORDER` | Order ready, awaiting "tak" | `confirm_order` |

---

## 🔗 POWIĄZANIA Z ISTNIEJĄCYM KODEM

### Pipeline.js (linie 186-262)
Obecnie implementuje SOFT DIALOG BRIDGE dla:
- `menu_request` + `hasRestaurantsList` → `ASK_RESTAURANT_FOR_MENU`
- `create_order` + `hasRestaurantsList` → `ASK_RESTAURANT_FOR_ORDER`

**Status:** ✅ Zgodne z polityką

### SurfaceRenderer.js
Obecnie obsługuje klucze:
- `ASK_LOCATION`
- `CHOOSE_RESTAURANT`
- `ASK_RESTAURANT_FOR_MENU`
- `ASK_RESTAURANT_FOR_ORDER`
- `CLARIFY_ITEMS`
- `ITEM_NOT_FOUND`
- `CONFIRM_ADD`
- `ERROR`

**Status:** ✅ Zgodne z polityką

### IntentCapabilityMap.js
Definiuje `fallbackIntent` dla każdego intentu.

**Status:** ⚠️ Policy Override — system powinien preferować dialog przed fallbackiem

---

## 📝 BRAKUJĄCE POWIERZCHNIE (TODO)

| dialog_key | Status | Priorytet |
|------------|--------|-----------|
| `ITEM_UNAVAILABLE` | ❌ Brak | P2 |
| `ASK_LOCATION_CLARIFY` | ❌ Brak | P3 |
| `ASK_LOCATION_OR_GPS` | ❌ Brak | P3 |
| `CONFIRM_IMPLICIT_ORDER` | ❌ Brak | P2 |
| `LEGACY_ORDER_BLOCKED` | ❌ Brak | P3 |

---

## 🎯 METRYKI SUKCESU

1. **Zero silent fallbacks** — każdy ICM block produkuje odpowiedź dialogową
2. **Context preservation** — `pendingDish` nigdy nie jest gubione
3. **Single turn clarity** — użytkownik wie dokładnie czego system oczekuje
4. **Recovery path** — każdy błąd ma sugestię naprawy

---

*Dokument wygenerowany: 2026-01-19*
*Agent: Dialog Policy Architect*
*Wersja: 1.0*
