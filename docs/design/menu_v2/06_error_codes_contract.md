# ERROR CODES V1 — KONTRAKT BACKEND ↔ FRONTEND
## Context: Menu Items V2 / BrainV2 Delivery

### 🎯 ZASADA NADRZĘDNA
*   **Backend NIE tłumaczy się użytkownikowi** (nie generuje zdań naturalnych w logice biznesowej).
*   **Backend zwraca kod + fakty** (dane strukturalne).
*   **Dialog Surface renderuje komunikat** (warstwa prezentacji odpowiada za finalne brzmienie).

---

### 🧱 STRUKTURA BŁĘDU (JSON)
Każdy błąd walidacji lub przepływu musi być zwracany w tym formacie:

```json
{
  "error_code": "STRING",        // Klucz błędu dla Frontendu/Surface
  "severity": "USER | SYSTEM",   // USER = błąd do wyświetlenia, SYSTEM = błąd logiki/bezpieczeństwa
  "facts": {                     // Dane potrzebne do wyrenderowania komunikatu
    "item_name": "string?",
    "restaurant": "string?",
    "options": "array?",
    "location_raw": "string?"
  },
  "ui_hint": "STRING"            // Sugestia dla SurfaceRenderer, który klucz szablonu użyć
}
```

---

### 1️⃣ BŁĘDY NLU / DIALOG (LOW RISK)
Dotyczą problemów ze zrozumieniem intencji lub brakiem encji w tekście.

| error_code | Severity | facts | ui_hint | Opis |
| :--- | :--- | :--- | :--- | :--- |
| **INTENT_AMBIGUOUS** | USER | `{}` | `ASK_REPHRASE` | Niskie confidence lub intencja `unknown`. |
| **LOCATION_NOT_RECOGNIZED** | USER | `{ "location_raw": "..." }` | `ASK_LOCATION` | Ekstraktor znalazł frazę, ale nie ma jej w bazie `restaurants`. |

---

### 2️⃣ FSM / ICM (KRYTYCZNE DLA STABILNOŚCI)
Błędy kontroli przepływu (Finite State Machine / Intent Capability Map). Zapewniają, że system nie prosi o dane, których nie może obsłużyć.

| error_code | Severity | facts | ui_hint | Opis |
| :--- | :--- | :--- | :--- | :--- |
| **RESTAURANT_CONTEXT_REQUIRED**| USER | `{ "restaurants": [] }` | `CHOOSE_RESTAURANT` | Wywołano `menu_request` bez wybranej restauracji. |
| **ORDER_CONTEXT_MISSING** | SYSTEM | `{}` | `RESET_FLOW` | Próba `confirm_order` bez aktywnego `pendingOrder`. |

---

### 3️⃣ MENU V2 / DISAMBIGUATION (NAJWAŻNIEJSZE)
Kluczowe dla prawidłowej obsługi składników i modyfikatorów.

| error_code | Severity | facts | ui_hint | Opis |
| :--- | :--- | :--- | :--- | :--- |
| **MENU_ITEM_NOT_FOUND** | USER | `{ "item_name": "...", "restaurant": "..." }` | `SUGGEST_SIMILAR` | Produktu nie ma w karcie danej restauracji. |
| **MENU_ITEM_AMBIGUOUS** | USER | `{ "options": [{ "id", "name" }] }` | `ASK_SELECTION` | Znaleziono wiele wariantów (np. 3 rodzaje naleśników). |
| **MODIFIER_NOT_ALLOWED** | USER | `{ "modifier": "...", "item": "..." }` | `EXPLAIN_LIMITATION` | Próba dodania `extra ser` do czegoś co go nie ma (walidacja `max_extra=0`). |

---

### 4️⃣ SYSTEM / SAFETY
Ostatnia linia obrony przed halucynacjami LLM lub błędami integracji.

| error_code | Severity | facts | ui_hint | Opis |
| :--- | :--- | :--- | :--- | :--- |
| **ORDERING_BLOCKED_BY_GUARD** | SYSTEM | `{}` | `RECOVER_FLOW` | Akcja zablokowana przez Safety Guard (np. próba obejścia FSM). |
| **INTERNAL_VALIDATION_ERROR** | SYSTEM | `{}` | `SILENT_RETRY` | Niezgodność kontraktów między usługami wewnętrznymi. |

---

### 🎨 MAPOWANIE → DIALOG SURFACE (MAPPING)

| ui_hint | Klucz SurfaceRenderer (V2) |
| :--- | :--- |
| **ASK_REPHRASE** | `GENERIC_REPHRASE` |
| **ASK_LOCATION** | `ASK_LOCATION` |
| **CHOOSE_RESTAURANT** | `ASK_RESTAURANT_FOR_MENU` |
| **ASK_SELECTION** | `CLARIFY_MENU_ITEM` |
| **SUGGEST_SIMILAR** | `SUGGEST_SIMILAR_DISHES` |
| **RESET_FLOW** | `RESET_AND_GUIDE` |
| **EXPLAIN_LIMITATION**| `EXPLAIN_UNAVAILABLE_OPTION` |
