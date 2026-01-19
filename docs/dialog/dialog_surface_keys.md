# DIALOG SURFACE KEYS CATALOG
## Brain V2 — Katalog Powierzchni Dialogowych (Agent 2)

---

## 🎯 CEL DOKUMENTU

Definicja wszystkich `dialog_key`, ich parametrów (`facts`) oraz szablonów odpowiedzi.
To jest **Contract** pomiędzy backend logic (Pipeline/Handlers) a prezentacją (Renderer).

---

## 📋 LISTA KLUCZY (SURFACE KEYS)

### 1️⃣ DISCOVERY & LOCATION

#### `ASK_LOCATION`
**Sytuacja:** System potrzebuje lokalizacji, aby znaleźć restauracje.
**Facts:**
- `dishNames` (optional): `['pizza']` — jeśli user szukał konkretnego dania.
**Template:**
- *Z daniem:* "Dobra, szukam {dish} — tylko powiedz mi miasto, żebym znalazła restauracje."
- *Bez dania:* "Dobra — tylko powiedz mi miasto, żebym znalazła restauracje."

#### `ASK_LOCATION_CLARIFY` (NEW)
**Sytuacja:** User podał lokalizację, której nie rozpoznajemy.
**Facts:**
- `location`: `Wyszków`
**Template:**
- "Nie znam {location}. Czy to na pewno poprawna nazwa miasta?"

---

### 2️⃣ ICM BLOCK / DIALOG BRIDGES

#### `ASK_RESTAURANT_FOR_MENU`
**Sytuacja:** User chce menu, ale nie wybrał restauracji. Mamy listę kandydatów.
**Facts:**
- `restaurants`: `[{name: 'Bar Praha'}, {name: 'Hubertus'}]`
**Template:**
- "Chcesz menu której restauracji? 1. Bar Praha, 2. Hubertus"

#### `ASK_RESTAURANT_FOR_ORDER`
**Sytuacja:** User chce zamówić, ale nie wybrał restauracji.
**Facts:**
- `restaurants`: `[{name: 'Bar Praha'}, ...]`
- `dishNames` (optional): `['kebab']`
**Template:**
- *Z daniem:* "Chcesz zamówić '{dish}' — z której restauracji? 1. Bar Praha..."
- *Bez dania:* "Chcesz zamówić, ale nie mam jeszcze restauracji. Powiedz gdzie szukać."

#### `LEGACY_ORDER_BLOCKED` (NEW)
**Sytuacja:** Legacy intent `create_order` zablokowany (zabezpieczenie).
**Facts:** (brak)
**Template:**
- "Aby złożyć zamówienie, najpierw znajdźmy restaurację. Na co masz ochotę?"

---

### 3️⃣ SELECTION & DISAMBIGUATION

#### `CHOOSE_RESTAURANT`
**Sytuacja:** Wiele restauracji pasuje do zapytania.
**Facts:**
- `city`: `Warszawie`
- `restaurantCount`: `5`
**Template:**
- "Mam {count} miejsc w {city}. Którą restaurację wybierasz? (Możesz powiedzieć numer albo nazwę.)"

#### `CONFIRM_SELECTED_RESTAURANT`
**Sytuacja:** Fuzzy match restauracji, wymagane potwierdzenie.
**Facts:**
- `restaurantName`: `Bar Mleczny`
- `nextAction`: `zobaczyć menu` (optional)
**Template:**
- "Czy chodzi o {restaurantName}? Powiedz 'tak' żeby {nextAction}."

#### `ITEM_NOT_FOUND`
**Sytuacja:** Pozycja nieznaleziona w menu.
**Facts:**
- `unknownItems`: `[{name: 'sushi'}]`
- `restaurantName`: `Bar Praha`
**Template:**
- "Nie widzę '{unknown}' w {restaurantName}. Podaj pełną nazwę z karty albo powiedz: 'pokaż menu'."

#### `ITEM_UNAVAILABLE` (NEW)
**Sytuacja:** Pozycja jest w menu, ale oznaczona jako niedostępna.
**Facts:**
- `itemName`: `Zupa dnia`
- `reason`: `wyprzedane` (optional)
**Template:**
- "Niestety '{itemName}' jest teraz niedostępne."

#### `CLARIFY_ITEMS` / `CLARIFY_MENU_ITEM`
**Sytuacja:** Niejednoznaczność (np. Pizza ma warianty 30cm i 40cm).
**Facts:**
- `clarify`: `[{base: 'Pizza', options: [...]}]`
**Template:**
- "Mam kilka opcji dla '{base}': 1) 30cm, 2) 40cm. Którą wybierasz?"

#### `ASK_CLARIFICATION_DISH`
**Sytuacja:** User podał nazwę, ale parser ma wątpliwości (generic logic).
**Facts:**
- `dishNames`: `['burger']`
- `options`: `[{name: 'Cheeseburger'}, {name: 'Vege Burger'}]`
**Template:**
- "Mam kilka opcji dla '{dish}': 1) Cheeseburger... Który?"

#### `ASK_WHAT_TO_ORDER` (NEW)
**Sytuacja:** User chce "zamówić", ale nie powiedział co.
**Facts:** (brak)
**Template:**
- "Co dokładnie chciałbyś zamówić?"

---

### 4️⃣ ORDER FLOW

#### `CONFIRM_ADD`
**Sytuacja:** Potwierdzenie dodania do koszyka (przed finalizacją).
**Facts:**
- `dishNames`: `['Kebab duży']`
- `priceTotal`: `25`
**Template:**
- "Dodać do koszyka: {dishNames} za {priceTotal} zł? Powiedz: 'tak' albo 'nie'."

#### `CART_EMPTY` (NEW)
**Sytuacja:** Próba potwierdzenia zamówienia przy pustym koszyku.
**Facts:** (brak)
**Template:**
- "Twój koszyk jest pusty. Co dodać?"

#### `CONFIRM_IMPLICIT_ORDER` (NEW)
**Sytuacja:** Intent `create_order` bez jawnego czasownika zamówienia (implicytne).
**Facts:**
- `itemName`: `Cola`
**Template:**
- "Czy chcesz zamówić {itemName}?"

---

### 5️⃣ ERROR HANDLING

#### `ERROR`
**Sytuacja:** Generic fallback.
**Facts:**
- `reason`: `timeout` | `no_menu`
**Template:**
- "Przepraszam, coś poszło nie tak." / "Nie mam menu tej restauracji."

#### `CART_MUTATION_BLOCKED` (NEW)
**Sytuacja:** Próba zmiany koszyka w nielegalnym momencie.
**Template:**
- "Dokończmy najpierw obecny krok zamówienia."

---

*Dokument wygenerowany: 2026-01-19*
*Agent: Dialog Surface Renderer*
