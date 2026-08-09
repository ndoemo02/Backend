# Handoff wykonawczy — poprawki po review T8 i dalsze prace RLS/hardening

- **Data:** 2026-08-08
- **Branch:** `security/rls-demo-hardening`, worktree `C:\Firerfox Portable\Freeflow backend-rls`
  (junction `node_modules` → główne repo; szczegóły operacyjne: `docs/RLS_HARDENING_STATE.md`)
- **Wykonawca:** Sonnet 5. **Recenzent:** Opus (osobna sesja, read-only).
- **Autor handoffu:** Fable 5, na podstawie review T8 wykonanego przez Opusa 2026-08-08
  (werdykt: CHANGES-REQUIRED; ustalenia wcielone niżej — dokument jest samowystarczalny,
  raport review nie istnieje jako osobny plik).
- **Status:** nic z tego dokumentu nie zostało wykonane. Zero SQL na live.

---

## 0. Reguły nadrzędne (obowiązują każdego wykonawcę)

1. **Zero SQL/DDL/DML/RLS/grantów na projekcie live** (`ezemaacyyvbpjlagchds`). Nawet SELECT
   wymaga jawnej zgody użytkownika (zadanie C4).
2. **Zakaz `supabase db push`** — decyzja użytkownika: T10 wykonuje pliki POJEDYNCZO
   (`psql -f <plik>`) z bramką przed każdym (zadanie A3 utrwala to w plikach).
3. **Inventory (`docs/SUPABASE_LIVE_INVENTORY_2026-08-08.md`) ma pierwszeństwo przed planem**
   tam, gdzie go koryguje. Kod jest source of truth dla kodu; baza dla bazy.
4. Kolejność czytania źródeł na zimnym starcie: `docs/RLS_HARDENING_STATE.md` →
   `docs/SUPABASE_FINAL_DEMO_HARDENING_PLAN.md` (plan kanoniczny; §9/§10/§12/§14) →
   inventory → `docs/T7_ORDER_WRITE_PATH_ANALYSIS.md` → `supabase/README.md` → ten dokument.
5. **Zero silent redesign.** Zakazane „przy okazji": routing `findHandler`/`discoveryFilter`,
   deterministyczny rdzeń zamówień, guardy IVL/FSM, fallbacki z CLAUDE.md §8.
6. **`persistOrderToDB` pozostaje wyłączone.** Strażnicy w
   `api/brain/tests/orderPersistence.antiDuplicate.test.js` wolno zmieniać wyłącznie
   świadomie w ramach D5 — i tylko razem z powrotem do decyzji §13.5.
7. Baseline testów brancha: **49/49 PASS** (`ordersAuth.t1`, `supabaseClients.t2`,
   `orderPersistence.antiDuplicate`). Awarie zastane (parytet z `f996b23`): 17 failed
   w `greetingGate`/`liveToolRouter`/`conversationGuards`/`orderHandler.explicitRestaurantLock`
   + 7 plików e2e bez `.env`. Żadne zadanie nie może obniżyć baseline'u.
   Vitest 4: bez `--reporter basic` (nie istnieje).
8. Commity po każdej spójnej paczce, bez pusha bez polecenia. Raport po sesji do
   `docs/RLS_HARDENING_STATE.md` (sekcja commitów + stan zadań).

---

## 1. Decyzje przyjęte przez użytkownika (normatywne, nie podlegają dyskusji wykonawcy)

| # | Decyzja |
|---|---|
| U1 | `restaurants.is_active` MOŻE być widoczne dla anon (wchodzi do grantu kolumnowego). |
| U2 | T10 = wykonanie plik po pliku z bramkami. Globalny `db push` ZABRONIONY. |
| U3 | Panel właściciela pozostaje częścią demo. BEZ pełnego onboardingu firmy — działamy na przygotowanych restauracjach/kontach demo. |
| U4 | Docelowo zapisy właścicielskie przechodzą przez backend z walidacją uprawnienia do restauracji (owner ↔ restaurant), nie przez szeroki bezpośredni zapis Supabase z frontendu. |
| U5 | `amber_tts_daily` domknąć wcześniej (etap 8), o ile nie tworzy to nowej zależności — analiza w A4 potwierdza: nie tworzy. |

## 2. Kontrakt Voice (normatywny)

```
discovery → pozycje → deterministyczny draft koszyka
→ Amber odczytuje RZECZYWISTY stan draftu
→ użytkownik: „to wszystko" → KONIEC sesji Voice
→ ekran koszyka → ręczna weryfikacja → jawne zatwierdzenie
→ checkout/płatność → finalizacja orderu → KDS
```

Zasady twarde:
- **Głosowe potwierdzenie ≠ złożenie zamówienia.** Voice nie uruchamia płatności i nie
  tworzy finalnego orderu.
- Semantyka do rozdzielenia w kodzie/narzędziach:
  **`complete_cart_draft` / `finish_voice_session`** (kończy draft i sesję Voice)
  vs **`place_order` / `finalize_order`** (wyłącznie ścieżka checkout/płatność).
- Konsekwencje dla stanu prac:
  - Dzisiejsze wyłączenie `persistOrderToDB` w `confirmHandler.js` jest ZGODNE z kontraktem
    — voice-owy „confirm" nie ma prawa pisać do `orders`.
  - Decyzja §13.5 zostaje przeramowana: finalny order powstaje wyłącznie na ścieżce
    checkout (`POST /api/orders` + `finalizeOrder` po Stripe). Otwarte pozostaje TYLKO,
    czy ścieżka checkoutowa ma pod spodem delegować do `OrderPersistence` (implementacja),
    czy `OrderPersistence` zostaje wycofane — to część D5/C-decyzji, nie tego handoffu.
  - Guardy IVL (FSM escalation: neutral/restaurant_selected → confirm_order = HARD BLOCK)
    NIE mogą zostać osłabione przy zmianie nazewnictwa (D4).

---

## 3. Kategoria A — FIX-SAFE (mechaniczne, Sonnet 5 wykonuje bez dalszych pytań)

Wszystkie zadania A to edycje plików w `supabase/` + README. Jedna paczka, jeden commit
(`fix(security): T8 fixup po review — P1-1..P2-4 + decyzje U1/U2/U5`). Po paczce → D1.

### A1 — Idempotencja bloków UNIQUE w etapie 6  [P1-1]
- **Pliki:** `supabase/migrations/20260808000100_stage06_orders_additive_columns.sql`
  (bloki `uq_orders_idempotency_key` ~:56-58 i `uq_orders_tracking_token` ~:60-62).
- **Cel:** powtórne wykonanie pliku nie może się wywalić. `ADD CONSTRAINT … UNIQUE` przy
  istniejącej nazwie rzuca `duplicate_table` (42P07, kolizja nazwy indeksu), a nie
  `duplicate_object` — obecny handler go nie łapie. Zastąpić oba bloki jawnym strażnikiem:
  `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.orders'::regclass
  AND conname = '…') THEN ALTER TABLE … END IF;` (preferowane — bez subtransakcji), albo
  minimalnie dopisać gałąź `WHEN duplicate_table THEN NULL`.
- **Nie wolno:** ruszać bloku CHECK `chk_orders_session_id_format` (jest poprawny —
  tam faktycznie leci `duplicate_object`), zmieniać nazw constraintów, dotykać statusów.
- **Test akceptacyjny:** przegląd — oba bloki odporne na 42P07; docelowo (T10, staging)
  dwukrotne `psql -f` przechodzi bez błędu.
- **Rollback:** `git revert` commita paczki A.
- **Zależności:** brak.

### A2 — `is_active` w grancie kolumnowym `restaurants`  [P1-2 + U1]
- **Pliki:** `supabase/migrations/20260808000400_stage10_public_catalog_rls.sql`
  (lista `GRANT SELECT (…) ON public.restaurants`).
- **Cel:** dopisać `is_active` do listy grantu. Uprawnienia kolumnowe w PG są sprawdzane
  także dla kolumn w `WHERE` — bez tego każde klienckie `eq('is_active', true)`
  (backend `api/server-vercel.js:788`, frontend `ClientPanel.tsx:140-144`) pada z 42501
  nawet po T5. Zaktualizować komentarz w nagłówku pliku (kontrakt „co widzi anon"
  poszerzony decyzją U1; RLS i tak pokazuje wyłącznie wiersze `is_active = true`).
- **Nie wolno:** dopisywać innych kolumn (owner_id, phone, website, maps_*, opening_hours,
  description pozostają poza grantem); zmieniać polityki ani strony `menu_items_v2`
  (tam `available` już jest w grancie).
- **Test akceptacyjny:** `is_active` obecne w liście GRANT; nagłówek pliku odnotowuje U1.
- **Rollback:** `git revert` paczki A.
- **Zależności:** brak.

### A3 — Protokół wykonania T10: plik po pliku, zakaz `db push`  [P1-4 + U2]
- **Pliki:** `supabase/README.md` (sekcja kolejności) + nagłówki WSZYSTKICH sześciu
  plików w `supabase/migrations/`.
- **Cel:** utrwalić decyzję U2. README dostaje twardą regułę: „Wykonanie wyłącznie
  pojedynczo (`psql -f <plik>` / pojedyncza migracja), po spełnieniu warunków wejścia
  danego etapu i za bramką (zgoda + smoke). `supabase db push` oraz `supabase db reset`
  na live/stagingu z niekompletnym odblokowaniem etapów — ZABRONIONE." Każdy nagłówek
  migracji dostaje jedną linię: „Wykonanie wyłącznie pojedynczo za bramką T10 — nigdy
  przez zbiorczy db push (decyzja użytkownika U2, handoff 2026-08-08)."
- **Nie wolno:** przenosić plików poza `migrations/` (rozważany wariant z review odrzucony
  decyzją U2 — zostaje protokół, nie relokacja); zmieniać kolejności ani nazw plików.
- **Test akceptacyjny:** grep `db push` po `supabase/` pokazuje zakaz w README i 6 nagłówkach.
- **Rollback:** `git revert` paczki A.
- **Zależności:** brak.

### A4 — Domknięcie `amber_tts_daily` w etapie 8  [P2-1 + U5]
- **Pliki:** `supabase/migrations/20260808000200_stage08_runtime_log_config_denyall.sql`
  (nowy blok na końcu, przed COMMIT) + kosmetycznie nagłówek
  `…000600_stage12_views_functions.sql` (adnotacja o idempotentnym powtórzeniu).
- **Cel:** dodać do etapu 8 blok analogiczny do tego z etapu 9 dla `full_orders_view`:
  `DO $$ BEGIN IF to_regclass('public.amber_tts_daily') IS NOT NULL THEN
  REVOKE ALL ON public.amber_tts_daily FROM PUBLIC, anon, authenticated;
  GRANT SELECT ON public.amber_tts_daily TO service_role; END IF; END $$;`
  Uzasadnienie: widok jest dziś security-definer nad `amber_intents`, którą etap 8 zamyka
  — bez tego anon czyta agregaty telemetrii do etapu 12. Warunek U5 („bez nowej
  zależności") spełniony: REVOKE na widoku nie zależy od niczego i nie zmienia definicji
  widoku; `security_invoker` nadal ustawia dopiero etap 12.
- **Nie wolno:** ustawiać `security_invoker` w etapie 8 (to zależy od etapu 9 — kolejność
  z §9 planu bez zmian); dotykać `full_orders_view` (już domknięty w etapie 9).
- **Test akceptacyjny:** etap 8 zawiera guardowany REVOKE na `amber_tts_daily`; etap 12
  pozostaje idempotentnym powtórzeniem.
- **Rollback:** `git revert` paczki A.
- **Zależności:** brak.

### A5 — Etap 11: grant dla service_role + poprawny komentarz  [P2-2]
- **Pliki:** `supabase/migrations/20260808000500_stage11_freeze_menu_items.sql` (:41-45).
- **Cel:** (a) dodać `GRANT SELECT ON public.menu_items TO service_role;` — na środowisku
  odtworzonym wyłącznie z migracji (tryb T10: lokalny stack/staging) service_role może nie
  mieć zastanych grantów, a po etapie 12 `full_orders_view` (security_invoker) JOIN-uje
  `menu_items` i service_role potrzebuje na niej SELECT (BYPASSRLS omija RLS, ale NIE
  zastępuje uprawnień tabelowych); (b) przepisać komentarz tak, by nie mylił obejścia RLS
  z grantami: „REVOKE nie rusza zastanych grantów service_role; jawny GRANT SELECT
  zabezpiecza środowiska odtwarzane z migracji; zamrożenie egzekwuje test kontraktowy
  T4, nie uprawnienia".
- **Nie wolno:** GRANT ALL (zamrożona tabela — SELECT wystarcza i jest spójny z intencją
  freeze); dodawać polityk.
- **Test akceptacyjny:** plik zawiera `GRANT SELECT … TO service_role`; komentarz nie
  zawiera twierdzenia „omija RLS, więc grant zbędny".
- **Rollback:** `git revert` paczki A.
- **Zależności:** brak.

### A6 — `lock_timeout` we wszystkich migracjach  [P2-3]
- **Pliki:** wszystkie 6 plików `supabase/migrations/*.sql`.
- **Cel:** zaraz po `BEGIN;` dodać `SET LOCAL lock_timeout = '3s';`. `DROP POLICY` /
  `ALTER TABLE … ENABLE RLS` / `ADD COLUMN` biorą ACCESS EXCLUSIVE — przy żywym
  backendzie długi zapis blokuje migrację, a za nią kolejkują się wszystkie zapytania
  (przestój zamiast minutowego okna z §9). Fail-fast z powtórzeniem > czekanie.
- **Nie wolno:** dodawać `statement_timeout` (etap 6 przepisuje tabelę `orders` —
  volatile default `tracking_token` — i mógłby zostać ubity w połowie legalnej pracy);
  zmieniać czegokolwiek poza dodaniem jednej linii per plik.
- **Test akceptacyjny:** `grep -l "SET LOCAL lock_timeout" supabase/migrations/*.sql`
  zwraca 6 plików; linia jest bezpośrednio po BEGIN, przed pierwszym DDL.
- **Rollback:** `git revert` paczki A.
- **Zależności:** brak.

### A7 — Szablon restore: sekcja zerująca + sekwencje  [P2-4 + nit-2]
- **Pliki:** `supabase/snapshot/RESTORE_SNAPSHOT_TEMPLATE.sql`,
  `supabase/snapshot/snapshot_queries.sql` (Q9).
- **Cel:** (a) do szablonu dodać SEKCJĘ 0 (przed A): usunięcie polityk utworzonych przez
  migracje (`restaurants_public_read`, `menu_items_v2_public_read` + pętla drop-all po
  tabelach dotkniętych etapami 8-11) oraz `REVOKE ALL … FROM PUBLIC, anon, authenticated`
  na tych tabelach PRZED odtworzeniem grantów z Q1/Q2 — inaczej restore daje stan
  „sprzed + resztki", łamiąc zasadę §12 („dokładny stan"); (b) dodać SEKCJĘ F na wyniki
  Q9 (dziś zbierane dane nie mają miejsca docelowego); (c) Q9 przepisać z
  `information_schema.role_usage_grants` (tylko USAGE, zawężone do ról bieżącego
  użytkownika) na odczyt `pg_class.relacl WHERE relkind = 'S'` w schemacie public.
- **Nie wolno:** czynić szablonu „wykonywalnym" — nagłówek ⛔ i placeholdery zostają.
- **Test akceptacyjny:** szablon ma sekcje 0 i F z instrukcją wypełnienia; Q9 czyta relacl.
- **Rollback:** `git revert` paczki A.
- **Zależności:** brak.

### A8 — Szkic `pending_decisions/default_privileges.sql`  [P2-6, część plikowa]
- **Pliki:** nowy `supabase/pending_decisions/default_privileges.sql`.
- **Cel:** utrwalić slot na ryzyko „hardening z datą ważności": jeśli komplet uprawnień
  anon na 25 tabelach pochodzi z `pg_default_acl`, to każdy przyszły `CREATE TABLE`
  odtworzy dziurę (dotknie tabel post-demo: `payments`, znormalizowane `order_items`).
  Plik: nagłówek ⛔ ZABLOKOWANY DANYMI (treść zależy od wyniku Q8 ze snapshotu — C4),
  zakomentowany wzorzec `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES
  FROM anon, authenticated;` z adnotacją, że dokładny `FOR ROLE <grantor>` trzeba wziąć
  z Q8 (defaclrole), oraz opis wariantów (revoke default acl vs świadome pozostawienie
  + checklist przy każdym przyszłym CREATE TABLE).
- **Nie wolno:** wkładać tego do `migrations/`; zgadywać grantora bez Q8.
- **Test akceptacyjny:** plik istnieje, cały SQL zakomentowany, nagłówek wskazuje C4/Q8.
- **Rollback:** usunięcie pliku (`git revert`).
- **Zależności:** wykonanie realne — po C4 (zgoda na snapshot) i decyzji użytkownika.

### A9 — Aktualizacja `pending_decisions/get_order_stats_execute_grant.sql`  [nit-1]
- **Pliki:** `supabase/pending_decisions/get_order_stats_execute_grant.sql`.
- **Cel:** dopisać ustalenie z review: kodowa połowa Wariantu 1 JUŻ ISTNIEJE —
  `api/server-vercel.js:565` woła `privateServerClient.rpc('get_order_stats')`
  z komentarzem do §13.7. Decyzja użytkownika sprowadza się wyłącznie do wykonania
  REVOKE (Wariant 1) albo przebudowy funkcji (Wariant 2). Usunąć nieaktualną prośbę
  o „weryfikację bieżącego przypisania klienta".
- **Nie wolno:** odkomentowywać SQL; podejmować decyzji za użytkownika.
- **Test akceptacyjny:** plik odnotowuje stan kodu z plik:linia; SQL nadal zakomentowany.
- **Rollback:** `git revert` paczki A.
- **Zależności:** brak.

### A10 — Nota o wersji CLI przy bramce lint  [nit-3]
- **Pliki:** `supabase/config.toml` (komentarz), `supabase/README.md` (sekcja bramki lint).
- **Cel:** `major_version = 17` wymaga odpowiednio nowego supabase CLI — dopisać, żeby
  „lint nie startuje" na wejściu T10 nie było diagnozowane jako błąd SQL.
- **Nie wolno:** zmieniać wartości konfiguracyjnych.
- **Test akceptacyjny:** nota obecna w obu miejscach.
- **Rollback:** `git revert` paczki A.
- **Zależności:** brak.

### A11 — Konsolidacja README (warunki wejścia po weryfikacjach review)
- **Pliki:** `supabase/README.md`.
- **Cel:** (a) warunek wejścia etapu 8: zdjąć pozycję „domknięcie klientów spoza
  write-setu T2" do statusu ZWERYFIKOWANE — review potwierdziło, że `server.js:28-39`
  i `api/brain/supabaseClient.js:26-36` używają wyłącznie `SUPABASE_SERVICE_ROLE_KEY`
  z fail-fast; jedyną realną blokadą etapu 8 pozostaje poprawka `sessionAdapter` (D2);
  (b) warunek wejścia etapu 10: dopisać bloker backendowy B1 (`/api/restaurants`
  `select("*")` na kluczu anon — `api/server-vercel.js:781-790`); (c) dodać tabelę
  decyzji U1-U5 + link do tego handoffu; (d) odnotować werdykt review T8 i mapowanie
  ustaleń → zadania (sekcja 7 tego dokumentu).
- **Nie wolno:** zmieniać kolejności etapów; usuwać blokad T4/T5.
- **Test akceptacyjny:** README spójne z tym handoffem; brak sprzeczności z §9/§12 planu.
- **Rollback:** `git revert` paczki A.
- **Zależności:** wykonywane jako ostatnie zadanie paczki A (agreguje A1-A10).

---

## 4. Kategoria B — VERIFY-FIRST (najpierw analiza repo, potem ewentualna mechaniczna zmiana)

### B1 — `/api/restaurants`: zawężenie `select("*")` na kliencie anon  [P1-3]
- **Pliki (analiza):** `api/server-vercel.js:781-790` + wszyscy konsumenci odpowiedzi
  `/api/restaurants` (frontend: grep po fetch/axios na ten endpoint; backend: brak).
  **DODATKOWO (re-review D1, F4):** zakres analizy B1 obejmuje TEŻ bezpośrednie
  zapytania klienta anon z frontendu (nie tylko `/api/restaurants` przez backend) —
  `frontend/src/pages/ClientPanel/ClientPanel.tsx:141-144`,
  `frontend/src/pages/Panel/CustomerPanel.jsx:96-99`,
  `frontend/src/state/CartContext.jsx:262-283` i analogiczne miejsca po
  `grep -rn "\.from('restaurants')\|\.from('menu_items_v2')" frontend/src`.
  **Pliki (zmiana):** `api/server-vercel.js` (tylko lista kolumn w `.select()`);
  ewentualne zmiany frontendu — osobna decyzja, patrz niżej.
- **Cel:** endpoint działa po T2 na `publicCatalogClient` (klucz anon) i po etapie 10
  jego `select("*")` padnie na kolumnach spoza grantu. Analiza: które pola odpowiedzi
  są realnie konsumowane. Jeśli mieszczą się w kontrakcie live-safe
  (`id,name,address,city,cuisine_type,lat,lng,delivery_available,price_level,
  taxonomy_groups,taxonomy_cats,taxonomy_tags` + `is_active` po U1) — zawęzić `.select()`
  do tej listy (zmiana mechaniczna). Jeśli konsument potrzebuje pola SPOZA kontraktu
  (np. phone/maps_rating) — STOP, eskalacja do C (decyzja o poszerzeniu grantu vs
  przepięcie endpointu na `privateServerClient`, co zmienia model §4 planu).
  **Rozszerzenie zakresu (re-review D1, F4):** kolumnowy grant PostgreSQL jest
  sprawdzany nie tylko dla kolumn w liście `.select()`, ale dla KAŻDEJ kolumny
  użytej po stronie serwera w zapytaniu — `.eq()`, `.ilike()`, `.order()`, `.in()`
  i analogiczne operatory (ten sam mechanizm, który uzasadnił A2/`is_active` w
  WHERE). Audyt B1 musi więc objąć te operatory, nie tylko listy SELECT, i to
  zarówno w `api/server-vercel.js` jak i w bezpośrednich zapytaniach frontendu
  wskazanych wyżej. **Znany przykład:** `frontend/src/state/CartContext.jsx:283`
  — `.ilike('aliases', …)` na `restaurants`; kolumna `aliases` NIE występuje
  wcale w liście `GRANT SELECT (…)` etapu 10
  (`supabase/migrations/20260808000400_stage10_public_catalog_rls.sql:71-75`) —
  po etapie 10 to zapytanie padnie z 42501. Czy `aliases` dopisać do grantu, czy
  przepiąć to wyszukiwanie na backend (service_role) — NIEROZSTRZYGNIĘTE tutaj;
  decyzja należy do C, analogicznie do pozostałych rozszerzeń grantu w §13 planu.
- **Nie wolno:** zmieniać przypisania klienta bez decyzji; ruszać innych endpointów;
  zmieniać kształtu odpowiedzi ponad usunięcie pól (usunięcie pól = zmiana kontraktu
  API — musi być wykazane, że nikt ich nie czyta); rozstrzygać los `aliases` (i
  innych podobnych trafień audytu) bez decyzji C.
- **Test akceptacyjny:** raport konsumentów pól (SELECT + WHERE/ORDER/filter) —
  backend i frontend; po zmianie `node --check` +
  `npx vitest run api/brain/tests/supabaseClients.t2.test.js` zielone; smoke
  `/api/restaurants` zwraca dane z jawną listą kolumn.
- **Rollback:** `git revert` commita B1.
- **Zależności:** blokuje etap 10 w T10. Niezależne od paczki A.

### B2 — Audyt zapisów `profiles` z frontendu  [P2-7]
- **Pliki (analiza, repo FRONTENDU):** `C:\Firerfox Portable\Freeflow brain\frontend` —
  grep `.from('profiles')` / `.from("profiles")` z klasyfikacją read/write per plik:linia;
  dodatkowo ścieżki rejestracji (`supabase.auth.signUp` i następstwa).
- **Cel:** etap 9 kasuje polityki self-access (`auth.uid() = id`) na `profiles`.
  Backend nie używa `profiles` (zweryfikowane), ale istnienie polityk INSERT/UPDATE
  sugeruje, że frontend mógł tworzyć/aktualizować profil przy rejestracji kluczem
  authenticated. Deliverable: raport. Jeśli zapisy istnieją i są na ścieżce demo →
  eskalacja: rozszerzenie write-setu T5 (przepięcie na backend) albo decyzja C.
  Jeśli nie istnieją / martwe — odnotować w README jako warunek wejścia etapu 9: ZAMKNIĘTE.
- **Nie wolno:** edytować frontendu w ramach tego zadania (to write-set T5, osobny PR).
- **Test akceptacyjny:** raport z pełną listą wystąpień i klasyfikacją; wpis w README.
- **Rollback:** n/d (analiza).
- **Zależności:** blokuje etap 9 w T10.

### B3 — Inwentaryzacja formatów `session_id`  [P2-5]
- **Pliki (analiza):** `api/brain/session/sessionStore.js` (`generateNewSessionId` :207-213),
  `api/brain/session/sessionAdapter.js`, `api/voice/live/GeminiLiveGateway.js`
  (skąd pochodzi sessionId sesji live), `api/brain/core/*` (`ensureSessionId` i wejścia
  z body), frontend `useBrainSession.ts:195`, `useConversationStore.ts:106`.
- **Cel:** CHECK `^sess_[a-z0-9_]+$` z etapu 6 stanie się twardym ograniczeniem ścieżki
  zapisu w T9 (`OrderPersistence.js:88` pisze `session_id` wprost z sesji). Ustalić
  WSZYSTKIE realne kształty identyfikatorów sesji (generator, id dostarczane z zewnątrz
  przez live/WS, wielkość liter, myślniki/UUID). Deliverable: raport + rekomendacja:
  (i) wszystkie kształty pasują → CHECK zostaje bez zmian; (ii) istnieją kształty
  niezgodne → rekomendacja dla T9 (normalizacja przed insertem, zapis NULL zamiast
  łamania CHECK) i/lub zmiana constraintu na `NOT VALID` w etapie 6 (mechaniczna
  poprawka pliku migracji — wykonać dopiero po zatwierdzeniu rekomendacji w D1/review).
- **Nie wolno:** zmieniać generatora sesji ani `OrderPersistence` (strażnicy T7).
- **Test akceptacyjny:** raport wymienia każde źródło sessionId z plik:linia i werdyktem
  zgodności z regexem.
- **Rollback:** n/d (analiza); ewentualna zmiana migracji — `git revert`.
- **Zależności:** wynik konsumowany przez D5 (T9) i przez D1 (re-review).

### B4 — Mapa powierzchni Voice pod rozdział semantyczny  [kontrakt Voice]
- **Pliki (analiza):** `api/voice/live/ToolRouter.js`, `api/voice/live/IntentVerification*`
  (IVL v2 + FSM `ALLOWED_TOOLS_BY_ORDER_MODE`), `api/brain/domains/food/confirmHandler.js`,
  schematy narzędzi (`ToolSchemas` / liveToolDeclarations po stronie frontendu:
  `useGeminiLiveSession.ts`), SYSTEM_INSTRUCTION (frontend), `api/orders.js` (ścieżka A),
  `api/orders/finalizeOrder.js`.
- **Cel:** deliverable-only: mapa „kto dziś rozumie `confirm_order` i jako co" —
  pełna lista miejsc (tool declaration → ToolRouter mapping → IVL/FSM guard →
  confirmHandler → frontend store/UI), plus propozycja planu zmiany nazw/semantyki:
  `complete_cart_draft`/`finish_voice_session` (Voice, kończy draft) oddzielone od
  `place_order`/`finalize_order` (checkout). Zidentyfikować każde miejsce, gdzie
  zmiana nazwy narzędzia dotyka guardów (FSM hard block, rapid-fire, confidence)
  i testów (`liveToolRouter`, `live_safety_regression_matrix`, IVL 36 testów).
- **Nie wolno:** ZERO zmian w kodzie — implementacja to D4. Zakaz osłabiania guardów
  nawet w propozycji (hard block neutral→confirm musi mieć odpowiednik po zmianie nazw).
- **Test akceptacyjny:** raport-mapa z plik:linia + plan przejścia (stare nazwy →
  nowe, strategia kompatybilności: alias przejściowy czy twarda zmiana) + lista testów
  do aktualizacji.
- **Rollback:** n/d.
- **Zależności:** wejście do D4. Niezależne od migracji SQL.

### B5 — Inwentaryzacja zapisów panelu właściciela  [U3/U4, wejście do D3]
- **Pliki (analiza, repo FRONTENDU):** `frontend/src/pages/Panel/RestaurantManager.jsx`
  (zapisy `restaurants` :365-369, `menu_items_v2` :522-538 i okolice), `useOwnerRestaurant.ts`,
  `businessApi.ts` — pełna lista operacji zapisu wykonywanych dziś bezpośrednio
  z przeglądarki (tabela: operacja → tabela → kolumny → warunek własności).
- **Cel:** U3/U4 mówią „panel zostaje, zapisy przez backend z walidacją uprawnienia".
  Deliverable: kontrakt minimalnego zestawu endpointów backendu dla demo
  (np. update pozycji menu, dostępność, ceny — cokolwiek panel realnie robi),
  z jawnym pominięciem onboardingu firmy (U3). To definiuje write-set D3.
- **Nie wolno:** edytować kodu; projektować pełnego CRUD ponad to, czego panel używa.
- **Test akceptacyjny:** tabela operacji + proponowany kontrakt endpointów
  (ścieżka, metoda, walidacja `owner_id` ↔ `restaurant_id`, klient service_role).
- **Rollback:** n/d.
- **Zależności:** blokuje D3; wynik wpływa na warunki wejścia etapu 10 (README).

---

## 5. Kategoria C — OWNER-DECISION (żadnych zmian bez decyzji użytkownika)

### C1 — `status='confirmed'` vs CHECK 6 wartości  [decyzja zastana nr 1, T9]
Warianty w `supabase/pending_decisions/orders_status_check_confirmed.sql`.
Nowy kontekst z kontraktu Voice: `finalize_order` (po płatności) jest jedynym prawomocnym
przejściem do stanu „potwierdzone" — decyzja sprowadza się do: (A) rozszerzyć CHECK
o `confirmed` (i przywrócić je do `ALLOWED_STATUS_VALUES`), albo (B) `finalizeOrder.js:44`
pisze `accepted` (zero DDL). Bez decyzji ścieżka po Stripe pozostaje ZŁAMANA na live.

### C2 — EXECUTE na `get_order_stats`  [§13.7]
Kodowa połowa Wariantu 1 już zrobiona (`server-vercel.js:565` → privateServerClient).
Decyzja: wykonać REVOKE (Wariant 1, plik pending_decisions) czy przebudować funkcję
jako świadomie publiczny agregat (Wariant 2 — osobny projekt).

### C3 — Graf przejść statusów  [CONTRACT_DECISION_REQUIRED]
CHECK definiuje domenę wartości; walidator przejść w `PATCH /api/orders/:id` świadomie
nie istnieje. Kontrakt Voice zawęża problem (finalizacja tylko po płatności; KDS:
pending→preparing→completed/delivered; cancelled), ale graf musi zatwierdzić użytkownik.

### C4 — Zgoda na read-only snapshot live  [etap 0]
`supabase/snapshot/snapshot_queries.sql` (Q1-Q9): wymagane przed pierwszym wykonaniem
jakiejkolwiek migracji (restore_snapshot) ORAZ dla Q7 (kolumny katalogu — warunek
etapu 10) i Q8 (default privileges — treść A8). Bez tej zgody T10 nie startuje.

### C5 — Zatwierdzenie kontraktu endpointów panelu właściciela
Po B5: użytkownik zatwierdza minimalny zestaw operacji demo (U3/U4) przed implementacją D3.

---

## 6. Kategoria D — OPUS-REVIEW-REQUIRED (Sonnet wykonuje, Opus recenzuje przed scaleniem/T10)

### D1 — Re-review paczki A (+ ewentualnych zmian z B1/B3)
- **Zakres:** ponowny read-only review `supabase/` po commicie paczki A — czy P1-1…P2-4
  są domknięte, czy nie wprowadzono regresji względem planu/inventory. Werdykt APPROVE
  wymagany PRZED jakimkolwiek T10.
- **Test akceptacyjny:** raport review z werdyktem; brak nowych P1.
- **Zależności:** po paczce A.

### D2 — `sessionAdapter`: klasyfikacja odmowy RLS do memory-fallback  [§7 planu, blokada etapu 8]
- **Pliki:** `api/brain/session/sessionAdapter.js` (`:141` rzuca przy nieznanym błędzie;
  `isMissingTableError` / `isSchemaMismatchError` nie łapią `permission denied` /
  `42501` / PGRST-owych odmów).
- **Cel:** odmowa uprawnień ma degradować do memory-fallback (jak brak tabeli), nie
  ubijać trwałości sesji wyjątkiem. Minimalny fix + test jednostkowy symulujący błąd
  42501 na obu wariantach schematu.
- **Nie wolno:** ruszać dual-schema probing ponad klasyfikację błędu; zmieniać kontraktu
  sesji.
- **Test akceptacyjny:** nowy test zielony; baseline 49/49 bez regresji.
- **Rollback:** `git revert`.
- **Zależności:** blokuje etap 8 w T10. Review Opusa: tak (dotyka trwałości sesji
  produkcyjnej).

### D3 — Backendowe endpointy zapisu panelu właściciela  [U3/U4]
- **Pliki:** nowe handlery w `api/` (kontrakt z B5/C5), frontend `RestaurantManager.jsx`
  przepięty z bezpośrednich zapisów Supabase na endpointy; klient: `privateServerClient`;
  walidacja: `restaurants.owner_id` ↔ tożsamość wołającego (JWT Supabase), zakres tylko
  operacje z zatwierdzonego kontraktu.
- **Nie wolno:** budować onboardingu firm (U3); dotykać read-path katalogu; przyjmować
  `owner_id` z body żądania (twarda reguła §4 planu: endpoint rewaliduje).
- **Test akceptacyjny:** testy autoryzacji (cudza restauracja → 403; brak JWT → 401;
  legalny właściciel → 200), smoke panelu na koncie demo; baseline bez regresji.
- **Rollback:** `git revert`; polityki właścicielskie w bazie i tak znikają dopiero
  w etapie 10, więc do czasu T10 stary frontend działa.
- **Zależności:** B5 → C5 → D3. Blokuje etap 10 (razem z T5/B1). Review Opusa: tak
  (nowa powierzchnia autoryzacji).

### D4 — Rozdział semantyczny Voice: `complete_cart_draft` vs `place_order`  [kontrakt Voice]
- **Pliki:** wg mapy z B4 (ToolRouter, IVL/FSM, confirmHandler, ToolSchemas,
  liveToolDeclarations, SYSTEM_INSTRUCTION, store frontendu, testy live).
- **Cel:** implementacja kontraktu z §2: voice-owy confirm kończy draft i sesję Voice
  (bez zapisu do `orders`, bez płatności); `place_order`/`finalize_order` istnieją
  wyłącznie na ścieżce checkout. Guardy IVL/FSM przeniesione 1:1 na nowe nazwy
  (hard block, rapid-fire, coherence) — żaden nie może zniknąć ani zelżeć.
- **Nie wolno:** włączać `persistOrderToDB` (strażnicy T7); zmieniać ścieżki A
  w `api/orders.js` ponad nazewnictwo; osłabiać `live_safety_regression_matrix`.
- **Test akceptacyjny:** komplet testów live (50 + 36 IVL + liveToolRouter) zielony po
  aktualizacji nazw; nowy test: po `complete_cart_draft` w `orders` nie powstaje wiersz.
- **Rollback:** `git revert` (zmiana czysto kodowa).
- **Zależności:** B4 (mapa) → D4. Review Opusa: tak (rdzeń live pipeline).

### D5 — T9: kontrakt orders na ścieżce checkout  [T7 + kontrakt Voice + C1]
- **Pliki:** `api/orders.js` (idempotencja ścieżki A — klucz idempotencji lub
  ograniczenie unikalności; `session_id` na rekordzie z normalizacją wg B3;
  odkomentowanie `total_cents`), `api/orders/finalizeOrder.js` (status wg C1),
  nowy `api/orders/track.js` (`GET /api/orders/track/:tracking_token` — kontrakt §2
  planu: tylko `{status, eta, restaurant_name}`, bez PII, bez listowania), świadoma
  aktualizacja strażników w `orderPersistence.antiDuplicate.test.js`.
- **Cel:** zamknięcie jedynego aktywnego ryzyka duplikatu (podwójny klik na ścieżce A —
  scenariusz 1 z T7) + kontrakt trackingu. Rola `OrderPersistence` (delegacja vs
  wycofanie) — rozstrzygana tutaj, zgodnie z przeramowaniem §13.5 przez kontrakt Voice.
- **Nie wolno:** startować przed C1 i etapem 6 (kolumny muszą istnieć na środowisku
  testowym); łamać kontraktu „no real PII" (§2 planu).
- **Test akceptacyjny:** bramka T9 z §14 planu: e2e z jednym orderem, powtórzony
  confirm/klik idempotentny, tracking bez PII; baseline bez regresji.
- **Rollback:** `git revert`; kolumny etapu 6 zostają (addytywne).
- **Zależności:** T7 ✓ (zielony), C1, B3, etap 6 na środowisku testowym. Review Opusa: tak.

---

## 7. Mapowanie ustaleń review Opusa → zadania

| Ustalenie | Waga | Zadanie |
|---|---|---|
| P1-1 UNIQUE nie-idempotentne (42P07) | P1 | A1 |
| P1-2 `is_active` poza grantem | P1 | A2 (+U1) |
| P1-3 `/api/restaurants` select("*") na anon | P1 | B1 (+ README: A11) |
| P1-4 `db push` omija bramkowanie | P1 | A3 (+U2) |
| P2-1 okno `amber_tts_daily` | P2 | A4 (+U5) |
| P2-2 etap 11: BYPASSRLS ≠ granty | P2 | A5 |
| P2-3 brak lock_timeout | P2 | A6 |
| P2-4 restore addytywny, bez sekcji zerującej | P2 | A7 |
| P2-5 CHECK session_id vs ścieżka T9 | P2 | B3 → D5 |
| P2-6 default privileges bez slotu | P2 | A8 + C4 |
| P2-7 polityki `profiles` bez audytu frontendu | P2 | B2 |
| nit-1 get_order_stats — kod już przepięty | nit | A9 |
| nit-2 Q9 role_usage_grants | nit | A7 |
| nit-3 wersja CLI dla PG17 | nit | A10 |
| (pozytywne) klienci spoza T2 = service_role | — | A11 (zdjęcie blokady etapu 8) |

## 8. Kolejność wykonania i bramki

```
Paczka A (A1→A10, A11 na końcu) ── commit ──> D1 (re-review Opus, wymagany APPROVE)
B1, B2, B3, B4, B5 — równoległe, niezależne od A (commity per zadanie po analizie)
C1–C5 — decyzje użytkownika (C4 odblokowuje etap 0/Q7/Q8; C1 odblokowuje D5; C5 odblokowuje D3)
D2 — po A (niezależne od B), przed etapem 8 w T10
D3 — po B5 + C5
D4 — po B4
D5 — po C1 + B3 + etapie 6 na środowisku testowym
T10 (wykonanie migracji, plik po pliku, poza tym handoffem):
  wymaga D1=APPROVE, C4, oraz per etap: 8→D2; 9→B2+T5; 10→T5+B1+D3; 11→T4.
```

**Definition of done tego handoffu:** paczka A zakommitowana i zrecenzowana (D1=APPROVE),
raporty B1-B5 istnieją, decyzje C przedstawione użytkownikowi z kompletem danych,
`docs/RLS_HARDENING_STATE.md` zaktualizowany. Nic nie zostało wykonane na live.
