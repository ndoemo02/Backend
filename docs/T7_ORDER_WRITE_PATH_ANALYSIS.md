# T7 — Analiza kanonicznej ścieżki zapisu zamówienia

- **Zakres:** etap 7 z §9, task T7 z §14 planu `SUPABASE_FINAL_DEMO_HARDENING_PLAN.md`
- **Charakter:** analiza. **Zero zmian w kodzie produkcyjnym.** `persistOrderToDB` pozostaje wyłączone.
- **Deliverable:** ten raport + `api/brain/tests/orderPersistence.antiDuplicate.test.js` (8/8 PASS)
- **Decyzja:** należy do użytkownika (§13.5). Poniżej rekomendacja, nie rozstrzygnięcie.

---

## 1. Dwie ścieżki — stan faktyczny

### Ścieżka A — `api/orders.js` POST, gałąź koszyka (linie 299-380)

**To jedyna ścieżka, która dziś realnie zapisuje zamówienia.** Wołana przez manualny checkout UI
(`CartContext.jsx`) oraz przez frontend po flow głosowym.

Kształt wstawianego rekordu (`orderData`, linie 353-366):

```
user_id, restaurant_id, restaurant_name, items, total_price (PLN float),
status, customer_name, customer_phone, delivery_address, notes, created_at
```

Czego **nie ma**:
- `session_id` — przychodzi w body (linia 386), ale służy wyłącznie do wyczyszczenia koszyka w sesji; **nie trafia na zamówienie**
- `idempotency_key` — nie występuje w tym pliku w ogóle
- `total_cents` — zakomentowane w linii 359 z adnotacją „Commented out to prevent column does not exist error"

**Konsekwencja: ścieżka A nie ma żadnej ochrony przed duplikatem.** Dwa identyczne POST-y tworzą
dwa zamówienia. Nie ma ani klucza idempotencji, ani okna deduplikacji, ani ograniczenia unikalności.

### Ścieżka B — `OrderPersistence.persistOrderToDB`

Zaprojektowana jako „JEDYNA CENTRALNA ŚCIEŻKA ZAPISU" (nagłówek pliku, linie 4-14).
**Wyłączona** w `confirmHandler.js:56-60` — blok oznaczony `PERSIST TO DB - DISABLED`.

Zapisuje pełniejszy kontrakt: `session_id`, `idempotency_key`, `total_cents`, `restaurant_name`,
`status: 'confirmed'`, oraz `items` znormalizowane do `{menu_item_id, name, unit_price_cents, qty,
special_instructions}`.

Klucz idempotencji: `sha256(sessionId + posortowane pozycje).substring(0, 32)` (`generateCartHash`,
linie 23-35).

---

## 2. Ustalenie krytyczne — idempotencja ścieżki B jest warunkowa

`persistOrderToDB` **nie jest idempotentne na dzisiejszym schemacie bazy.** Dwa miejsca degradują
się po cichu, gdy kolumna `orders.idempotency_key` nie istnieje:

**Miejsce 1 — sprawdzenie duplikatu (linie 61-70).** Gdy `SELECT ... .eq('idempotency_key', hash)`
zwróci błąd, kod loguje go i **kontynuuje**, z komentarzem wprost: „Kontynuuj mimo błędu - może
kolumna nie istnieje". Duplikat nie zostaje wykryty.

**Miejsce 2 — fallback insertu (linie 129-144).** Gdy insert zwróci błąd zawierający ciąg
`idempotency_key`, kod wykonuje `delete orderData.idempotency_key` i **ponawia insert bez klucza**.
Zamówienie powstaje.

Plan stwierdza, że kolumny `session_id`, `idempotency_key`, `total_cents` w bazie **nie ma** — ich
dodanie to dopiero etap 6 z §9. Zatem gdyby ścieżkę B włączyć dziś, oba mechanizmy zadziałałyby
naraz i każde ponowienie tworzyłoby duplikat, przy jednoczesnym logu `✅ Order persisted`.

Dowód w teście: `T7 / brak kolumny idempotency_key (dzisiejszy stan schematu)` — dwa wywołania
z identycznym koszykiem dają dwa różne `order_id`, cztery próby insertu, a dwa fallbackowe inserty
idą bez klucza.

> **LIVE_SCHEMA_VERIFICATION_REQUIRED** — brak kolumn jest ustaleniem z planu (§0, §2), nie
> z odczytu `information_schema`. Konektor Supabase w tej sesji nie miał dostępu do projektu
> `ezemaacyyvbpjlagchds`, więc nie dało się tego potwierdzić bezpośrednio.

---

## 3. Scenariusze duplikatu

| # | Scenariusz | Status dziś | Chroni? |
|---|---|---|---|
| 1 | Podwójny klik / retry sieciowy na manualnym checkoucie | **realny** | nie — ścieżka A nie ma idempotencji |
| 2 | Voice `confirm_order` + manualny checkout w UI | nieaktywny (B wyłączone) | nie — gdyby B włączyć, A nie zna klucza i nie skoliduje |
| 3 | Retry w obrębie jednej sesji przy włączonym B i **istniejącej** kolumnie | — | tak |
| 4 | Ten sam koszyk po handoffie voice → UI ze **zmienioną** sesją | — | **nie** — `sessionId` wchodzi do hasha |

Scenariusz 1 jest jedynym aktywnym ryzykiem produkcyjnym i **nie zależy od tego, czy ścieżka B
kiedykolwiek zostanie włączona**.

Scenariusz 4 to udokumentowane ograniczenie zakresu, nie błąd: klucz chroni przed retry w obrębie
sesji, ale nie przed duplikatem powstałym przy zmianie sesji.

---

## 4. Rekomendacja

**Kanoniczna docelowo: ścieżka B (`OrderPersistence.persistOrderToDB`).** Ma pełny kontrakt danych,
jedno miejsce zapisu i realną idempotencję. Ścieżka A powinna docelowo delegować do niej albo zostać
wycofana.

**Ale nie wolno jej włączyć przed spełnieniem trzech warunków:**

1. **Etap 6 z §9** — kolumny `session_id`, `idempotency_key`, `total_cents` istnieją w `orders`.
2. **`UNIQUE` na `idempotency_key`** — sam `SELECT` przed `INSERT` to wyścig typu check-then-act.
   Dwa równoległe żądania mogą oba nie znaleźć duplikatu i oba wstawić. Bez ograniczenia w bazie
   idempotencja jest najlepszym staraniem, nie gwarancją.
3. **Usunięcie obu cichych fallbacków** (linie 61-70 i 129-144). Zapis, który po cichu rezygnuje
   z idempotencji, jest gorszy niż zapis, który głośno pada — bo wygląda na poprawny w logach.

**Niezależnie od powyższego i przed demo:** scenariusz 1 dotyczy ścieżki A, która jest żywa.
Zamknięcie go wymaga klucza idempotencji na ścieżce A albo ograniczenia unikalności w bazie.
To wykracza poza write-set T7 (task analityczny) i należy do T9.

**Czego rekomendacja nie przesądza:** czy ścieżka A ma zniknąć, czy stać się cienkim adapterem nad B.
To zależy od decyzji §13.5 i od tego, czy manualny checkout ma zachować własny kontrakt HTTP.

---

## 5. Co zamraża test

`api/brain/tests/orderPersistence.antiDuplicate.test.js` — 8 testów:

- idempotencja działa, gdy kolumna istnieje (brak drugiego insertu)
- `idempotency_key` i `session_id` trafiają na rekord
- **dowód degradacji** przy braku kolumny → duplikat
- klucz niezależny od kolejności pozycji w koszyku
- klucz różny dla innej zawartości koszyka
- klucz różny dla innej sesji (udokumentowane ograniczenie)
- **`confirmHandler` nie woła `persistOrderToDB`** — blokada przed cichym włączeniem
- **`api/orders.js` nie zna `idempotency_key`** — blokada przed założeniem, że ścieżka A dedupikuje

Dwa ostatnie to strażnicy kontraktu: każda przyszła zmiana, która włączy ścieżkę B lub doda klucz
do ścieżki A, **musi** świadomie zmienić ten test — i tym samym wrócić do decyzji §13.5.
