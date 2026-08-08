# Read-only inventory schematu live — §10.0

- **Projekt:** `ezemaacyyvbpjlagchds` („FreeFlow", org `ddgnepyttjrnctskgbvc`, eu-west-3, ACTIVE_HEALTHY, PG 17.6.1.013)
- **Data:** 2026-08-08
- **Zakres:** 8 zapytań z §10.0, wszystkie `READ_ONLY`. Zero DDL, zero DML, **zero zmian stanu**.
- **Anonimizacja:** wyłącznie metadane schematu. Żadne zapytanie nie dotknęło rekordów zamówień,
  danych klientów ani wartości sekretów.

> Ten dokument zamyka wszystkie pozycje `[DO WERYFIKACJI]` z planu hardeningu i **koryguje kilka
> ustaleń oznaczonych tam jako `[POTWIERDZONE]`**. Kod jest source of truth, ale baza jest source
> of truth dla samej siebie — i w kilku miejscach rozjeżdża się z planem.

---

## 0. Wykonane zapytania

| # | Źródło | Wierszy | Wynik |
|---|---|---|---|
| 1 | `information_schema.role_table_grants` (anon/authenticated) | 52 | pełne uprawnienia na wszystkim |
| 2 | `pg_policies` | 30 | polityki istnieją, w większości `USING (true)` |
| 3 | `pg_class.relrowsecurity` | 25 | RLS **włączone** na 9 z 25 tabel |
| 4 | `pg_get_viewdef` | 2 | oba widoki bez `security_invoker` |
| 5 | `pg_proc.proconfig` | 152 | 3 funkcje projektu, **zero SECURITY DEFINER** |
| 6 | `pg_publication_tables` | **0** | publikacja realtime pusta |
| 7 | `information_schema.columns` | 25 | patrz §5 |
| 8 | `pg_constraint` | 4 | patrz §6 |

---

## 1. `PLAN_CORRECTION_REQUIRED` — RLS **jest** częściowo włączone

Plan (§0) twierdzi: „16 tabel `public` bez RLS i z szerokimi grantami **[POTWIERDZONE — audyt]**".
Rzeczywistość: RLS jest **włączone** na 9 tabelach. Żadna nie ma `FORCE ROW LEVEL SECURITY`.

**RLS = ON (9):** `live_perf_logs`, `menu_items`, `menu_items_v2`, `order_items`, `orders`,
`phrases`, `profiles`, `restaurants`, `users`

**RLS = OFF (16):** `amber_alerts`, `amber_intents`, `amber_knowledge`, `brain_logs`,
`brain_sessions`, `conversation_events`, `conversations`, `freefun_events`, `intent_issues`,
`intent_logs`, `menu_items_v2_backup`, `menu_items_v2_backup2`, `menu_items_v2_backup_nlu`,
`system_config`, `system_logs`, `unhandled_logs`

Liczba 16 się zgadza, ale **opis nie**: to nie jest „16 z 25 bez RLS" jako stan jednolity —
to stan mieszany, w którym część tabel wygląda na chronione, a nie jest (patrz §3).

---

## 2. Granty — `anon` ma **pełne** uprawnienia na każdej tabeli

Bez wyjątku. Wszystkie 25 tabel **oraz widok `full_orders_view`** mają dla ról `anon`
**i** `authenticated` komplet:

```
DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
```

To jest istotnie gorsze niż „szerokie granty" z planu. Konkretnie: **`TRUNCATE` i `DELETE`
dla roli anonimowej**. Na 16 tabelach z wyłączonym RLS te uprawnienia nie mają nad sobą
żadnej warstwy — czyli anonimowy klient z kluczem publicznym może dziś skasować zawartość
`brain_sessions`, `system_config`, `conversations`, `intent_logs` i pozostałych.

> Uwaga: nie zweryfikowano tego empirycznie — nie wykonano żadnego zapisu. Wniosek wynika
> z kombinacji grantu i braku RLS, nie z próby.

---

## 3. Polityki RLS — włączone, ale przepuszczają wszystko

30 polityk. Krytyczne przypadki:

### `orders` — 6 polityk, w tym dwie otwierające wszystko

| Polityka | Rola | Operacja | Warunek |
|---|---|---|---|
| `Allow public read on orders` | `anon` | SELECT | **`true`** |
| `Allow public insert for orders` | `public` | INSERT | **`with_check: true`** |
| `Orders: insert from backend` | `public` | INSERT | **`with_check: true`** (duplikat powyższej) |
| `Allow users to see their own orders` | `public` | SELECT | `auth.uid() = user_id` |
| `Orders: business read own restaurants` | `public` | SELECT | `r.business_id = auth.uid()` |
| `Orders: business view own` | `public` | SELECT | identyczna jak wyżej (duplikat) |

Polityki RLS są **permisywne i sumują się przez OR**. Obecność `Allow public read on orders`
z `USING (true)` sprawia, że trzy pozostałe polityki SELECT są bez znaczenia — **anon czyta
wszystkie zamówienia razem z `customer_name`, `customer_phone`, `delivery_address`**.

To potwierdza ryzyko #5 z planu i jednocześnie pokazuje, dlaczego „włączone RLS" bywa gorsze
niż jego brak: panel Supabase pokazuje tabelę jako chronioną.

### Pozostałe otwarte na oścież

- `order_items` — `Allow public read on order_items`, `anon` SELECT `true`
- `users` — `Allow public read on users`, `anon` SELECT `true`
- `phrases` — `anon` SELECT `true`
- `menu_items` — dwie nakładające się polityki publicznego odczytu
- `menu_items_v2` — `Public Read Menu` + `Allow public select`, obie `true` (duplikaty)
- `restaurants` — **cztery** polityki publicznego odczytu, wszystkie `true`
  (`Allow public select`, `Allow read access for all`, `Public Read`, + service_role ALL)

### Poprawnie zawężone

- `profiles` — pełen zestaw oparty o `auth.uid() = id`, DELETE tylko dla admina.
  Uwaga: `Profiles: admin select all` używa `current_setting('jwt.claims.role')`, nie `auth.jwt()`
  — inna konwencja niż reszta, warta weryfikacji przy hardeningu.
- `restaurants` / `menu_items_v2` — polityki właścicielskie na `owner_id = auth.uid()` dla
  INSERT/UPDATE/DELETE są poprawne. Problemem jest wyłącznie nadmiarowy odczyt publiczny.

---

## 4. Widoki i funkcje

### Widoki — oba bez `security_invoker`

`reloptions = null` dla obu, czyli działają z uprawnieniami właściciela i **omijają RLS**
tabel źródłowych. Potwierdza ryzyko #6.

**`amber_tts_daily`** — agregat `avg(tts_ms)` po dniach z `amber_intents`. Niska wrażliwość.

**`full_orders_view`** — łączy `orders` + `restaurants` + `users` + `order_items` + `menu_items`
i wystawia `u.name AS client_name`, czyli **PII**. Dwie dodatkowe obserwacje:

1. Wszystkie złączenia to `JOIN` (inner). Ponieważ `order_items` jest puste, widok **zwraca dziś
   zero wierszy**. Nie zmniejsza to ryzyka — wypełnienie `order_items` (faza post-demo, §13.9)
   natychmiast go otworzy.
2. Widok czyta z **`menu_items`**, czyli tabeli legacy przeznaczonej do zamrożenia w §8/etap 11.
   Zamrożenie `menu_items` bez tknięcia tego widoku go zepsuje. **Tej zależności nie ma w planie.**

### Funkcje — plan zawyża ryzyko

152 wiersze, z czego przytłaczająca większość to funkcje rozszerzeń `pgvector` i `pg_trgm`.

Funkcje należące do projektu: **`ensure_restaurant_exists`, `get_order_stats`,
`update_updated_at_column`** — wszystkie trzy.

**Wszystkie 152 mają `prosecdef = false` (zero SECURITY DEFINER) i `proconfig = null`.**

Ryzyko #7 z planu („Publiczne funkcje z mutable search_path") jest formalnie prawdziwe —
`proconfig` jest puste, więc `search_path` jest mutowalny — ale **istotnie mniej groźne**,
niż sugeruje priorytet P1: mutowalny `search_path` na funkcji `SECURITY INVOKER` nie daje
eskalacji uprawnień. Sekcja §5 planu zakładała istnienie funkcji `SECURITY DEFINER`.
**Nie ma ani jednej.**

---

## 5. Kształt `orders` i `order_items`

### `orders` — 18 kolumn

```
id uuid NOT NULL DEFAULT gen_random_uuid()
restaurant_id uuid NULL            -> FK restaurants(id) ON DELETE SET NULL
user_id uuid NULL
business_id uuid NULL              -> FK profiles(id) ON DELETE SET NULL
total_price numeric NOT NULL
total_cents numeric NULL DEFAULT 0
total_pln numeric NULL
order_value numeric NULL
status text NOT NULL DEFAULT 'pending'
created_at timestamptz NOT NULL DEFAULT now()
confirmed_at timestamptz NULL
items jsonb NULL DEFAULT '[]'
restaurant_name text NULL
dish_name text NULL
customer_name text NULL
customer_phone text NULL
delivery_address text NULL
notes text NULL
```

**Ustalenie 1 — `total_cents` ISTNIEJE.** `api/orders.js:359` ma zakomentowany zapis
`total_cents` z adnotacją „Commented out to prevent column does not exist error". **Ten komentarz
jest nieaktualny.** Kolumna jest, typ `numeric`, default `0`. Etap 6 z §9 jest w tej części
zbędny.

**Ustalenie 2 — `session_id` i `idempotency_key` NIE istnieją.** To **potwierdza** wniosek z T7:
`persistOrderToDB` włączone dziś degradowałoby się po cichu do braku idempotencji
(`OrderPersistence.js:61-70` i `129-144`). Wniosek T7 przechodzi z hipotezy w fakt.

**Ustalenie 3 — trzy kolumny na kwotę.** `total_price`, `total_cents`, `total_pln`, plus
`order_value`. Kod zapisuje tylko `total_price`. Pozostałe to dług, którego plan nie odnotowuje.

**Ustalenie 4 — `confirmed_at` istnieje**, ale patrz §6.

### `order_items` — 7 kolumn

```
id uuid NOT NULL DEFAULT uuid_generate_v4()
order_id uuid NULL
menu_item_id uuid NULL
quantity integer NOT NULL DEFAULT 1
unit_price numeric NOT NULL DEFAULT 0
created_at timestamptz NULL DEFAULT now()
special_instructions jsonb NULL DEFAULT '{}'
```

`special_instructions` jako `jsonb` jest zgodne z pracą z 2026-05-02.
Brak FK na `order_id` i `menu_item_id` (nie ma ich wśród 4 constraintów `orders`;
osobno nie sprawdzano constraintów `order_items` — poza zakresem §10.0).

---

## 6. `orders_status_check` — i wynikający z niego **błąd produkcyjny**

Cztery constrainty na `orders`:

| Nazwa | Definicja |
|---|---|
| `orders_pkey` | `PRIMARY KEY (id)` |
| `orders_restaurant_id_fkey` | `FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE SET NULL` |
| `orders_business_id_fkey` | `FOREIGN KEY (business_id) REFERENCES profiles(id) ON DELETE SET NULL` |
| `orders_status_check` | `CHECK (status = ANY (ARRAY['pending','preparing','completed','delivered','cancelled','accepted']))` |

**`allowed_status_values` (dowód z bazy) — 6 wartości:**
`pending`, `preparing`, `completed`, `delivered`, `cancelled`, `accepted`

### Błąd: `confirmed` nie jest dozwolone, a kod je zapisuje

Wartości `confirmed` **nie ma** w CHECK. Tymczasem zapisują ją trzy miejsca:

| Miejsce | Zapis | Skutek |
|---|---|---|
| `api/orders/finalizeOrder.js:44` | `.update({ status: 'confirmed' })` | **narusza CHECK** |
| `api/brain/services/OrderPersistence.js:107` | `status: 'confirmed'` | narusza CHECK (ścieżka wyłączona) |
| `api/orders.js:350` | whitelist POST zawiera `'confirmed'` | narusza CHECK, gdy klient go poda |

Ścieżka `finalizeOrder` jest **żywa** — woła ją `ClientPanel.tsx` po płatności Stripe.
Oznacza to, że finalizacja zamówienia po płatności kończy się dziś błędem bazy.

Istnienie kolumny `confirmed_at` sugeruje, że status `confirmed` był zamierzony, ale
nigdy nie trafił do CHECK-a.

> **Nie zweryfikowano empirycznie** — nie wykonano żadnego UPDATE. Wniosek wynika z zestawienia
> definicji CHECK z kodem. Weryfikacja wymaga wywołania endpointu, nie zapytania.

### Konsekwencja dla T1

`ALLOWED_STATUS_VALUES` w `api/orders.js` zawierało 7 wartości wyprowadzonych z kodu.
Zgodnie z regułą „po odczycie CHECK-a listę należy zawęzić do przecięcia" — usunięto
`confirmed`. Domena aplikacji = domena bazy = 6 wartości.

`CONTRACT_DECISION_REQUIRED` pozostaje otwarte: to jest domena **wartości**, nie graf
**przejść**. CHECK nie definiuje, który status wolno zmienić na który.

---

## 7. Realtime — publikacja pusta

`pg_publication_tables` dla `supabase_realtime` zwraca **0 wierszy**.

`orders` nie jest publikowane, ale też nic innego nie jest. Decyzja §6 (polling zamiast
Realtime) jest już zgodna ze stanem faktycznym — **nie wymaga żadnej migracji**.
Pozycja `[DO WERYFIKACJI]` zamknięta.

---

## 8. Zestawienie korekt do planu

| Plan mówi | Rzeczywistość | Waga |
|---|---|---|
| „16 tabel bez RLS" `[POTWIERDZONE]` | RLS ON na 9 z 25; stan mieszany, część chroniona pozornie | **korekta** |
| „szerokie granty" | `anon` ma `TRUNCATE`+`DELETE` na **każdej** tabeli | **eskalacja wagi** |
| „Dwa security-definer views" | potwierdzone (brak `security_invoker`) | zgodne |
| „Publiczne funkcje z mutable search_path" P1 | prawda, ale **zero SECURITY DEFINER** → niższa waga | **deeskalacja** |
| `total_cents` nie istnieje (komentarz w kodzie) | **istnieje**, `numeric` default 0 | **korekta** |
| `session_id`, `idempotency_key` brak | potwierdzone | zgodne |
| `orders` nie jest w realtime `[DO WERYFIKACJI]` | potwierdzone — publikacja całkiem pusta | zamknięte |
| — | `full_orders_view` zależy od legacy `menu_items` → §8 etap 11 go zepsuje | **nowe** |
| — | `status='confirmed'` łamie CHECK; `finalizeOrder` jest żywy | **nowe, P0/P1** |
| — | trzy nadmiarowe kolumny kwotowe + duplikaty polityk | nowe, niska waga |

---

## 9. Potwierdzenie wykonania

- Wykonano **8 zapytań**, wszystkie `SELECT`, wszystkie `READ_ONLY`.
- Zapytanie o granty uruchomiono w formie zagregowanej (`string_agg` po `table_name, grantee`)
  i zawężonej do ról `anon`/`authenticated` — to zmiana **prezentacji i zakresu ról**, nie źródła.
  Role `service_role`, `postgres`, `supabase_admin` nie były odpytywane.
- **Zero DDL. Zero DML. Zero zmian stanu.** Nie utworzono, nie zmieniono i nie usunięto
  żadnego obiektu ani rekordu. Nie odczytano żadnych danych zamówień, klientów ani sekretów.
