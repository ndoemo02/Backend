# Stan prac RLS/hardening — punkt wznowienia

Dokument wskaźnikowy. **Nie jest planem** — plan kanoniczny to
`docs/SUPABASE_FINAL_DEMO_HARDENING_PLAN.md` i tylko on obowiązuje.

Ostatnia aktualizacja: 2026-08-11

---

## Gdzie to jest

- **Worktree:** `C:\Firerfox Portable\Freeflow backend-rls`
- **Branch:** `security/rls-demo-hardening` (baza: `demo/gate1-finalization` @ `f996b23`)
- Wypchnięty na `origin/security/rls-demo-hardening` (2026-08-08, po T8). Nie mergowany.
- Główny worktree `…\Freeflow brain\backend` pozostaje nietknięty.

### Operacyjne: uruchamianie testów

Worktree nie ma własnych zależności. Jest junction do głównego repo:

```
C:\Firerfox Portable\Freeflow backend-rls\node_modules
  -> C:\Firerfox Portable\Freeflow brain\backend\node_modules
```

Gdyby zniknął: `New-Item -ItemType Junction -Path <worktree>\node_modules -Target <backend>\node_modules`.
Usuwać **wyłącznie** przez `cmd /c rmdir <link>` — `Remove-Item -Recurse` potrafi wejść w cel.

Reporter `basic` nie istnieje w vitest 4 — uruchamiać bez `--reporter`.

### Weryfikacja hasha planu

`.gitattributes` ma `* text=auto`, a `core.autocrlf=true`. Świeży checkout daje CRLF,
więc `Get-FileHash` zwróci `9125f685…`, **nie** kanoniczne `4BCDBAC7…`.

Poprawnie:
```
git cat-file blob HEAD:docs/SUPABASE_FINAL_DEMO_HARDENING_PLAN.md | sha256sum
```

---

## Commity na branchu

| SHA | Zakres |
|---|---|
| `92c0c46` | dokument kanoniczny, hash zweryfikowany |
| `1ae5d30` | **T1** — DELETE usunięty, PATCH za bramką + allowlista, GET z filtrem |
| `12df4df` | **T2** — rozdział klientów, zero fallbacków w obie strony |
| `38ef68b` | **T7** — analiza ścieżki zapisu + test anty-duplikatowy |
| `b5541a8` | **inventory §10.0** + zawężenie domeny statusów do bazy |
| `d0f58e8` | **T8** — migracje SQL jako pliki w `supabase/`, zero wykonania |
| `6487cb4` | **Paczka A (A1-A11)** — fixup T8 po review Opusa: P1-1..P1-4, P2-1..P2-4, P2-6, nit-1..3 + decyzje U1/U2/U5 |
| `c59453d` | **D1 cleanup** — F1 nagłówek etapu 8, F4 rozszerzenie zakresu B1 (kolumny poza `.select()`) |
| `d42df6a` | **D2** — `sessionAdapter`: klasyfikacja odmowy uprawnień (42501) do memory-fallback + test 8/8 |
| `34c6132` | **B1** — narrow public catalog read-set |
| `d76adcc` | **B1** — owner-read endpoint (`api/owner/restaurants.js`) + restaurant alias resolver |
| `0c60705` | **B5** — inwentaryzacja zapisów panelu właściciela (docs-only) |
| `d53c71b` | **D3** — owner-scoped write backend (`restaurants.js` PATCH, nowy `restaurantMenu.js`, `_helpers.js`, routing w `server-vercel.js`, 40 nowych testów) |

Frontend (`security/rls-demo-hardening-frontend`, repo `Freeflow-Final`, poza tym worktree):
`f99c19d` — **D3** — `RestaurantManager.jsx` przepięty z bezpośrednich zapisów Supabase
(`restaurants` UPDATE, `menu_items_v2` INSERT/UPDATE/DELETE, menu READ) na `fetch` do
`/api/owner/restaurants/*`.

Testy: **96/96 PASS** na bramce D3 (`ownerRestaurants.test.js` 21/21 +
`ownerRestaurantMenu.test.js` 19/19 + baseline/resolver 56/56 —
`ordersAuth.t1`/`supabaseClients.t2`/`orderPersistence.antiDuplicate`/
`restaurantResolver.aliasStep`). Pełny suite: zero nowych regresji (delta failures = 0,
+30 testów, wszystkie D3, wszystkie PASS — jedyna fluktuacja między przebiegami to
`discoveryTaxonomy.test.js`, timing-zależny kontrakt p95, bez związku z `api/owner/*`).
Paczka A i D1 nie dotknęły kodu backendu (wyłącznie `supabase/` + `docs/`); D2 dotknęło
wyłącznie `sessionAdapter.js` + nowy test.

Awarie zastane, potwierdzone parytetem z `f996b23`, **nie regresje**:
- `greetingGate` / `liveToolRouter` / `conversationGuards` / `orderHandler.explicitRestaurantLock` — 17 failed
- `tests/e2e` + `brain_v2_resiliency` — 7 plików nie ładuje się bez `.env` w worktree

---

## Zrobione

- **T1** (§9 etap 1) — ryzyka #1, #2
- **T2** (§9 etap 2) — ryzyka #8, #9
- **T7** (§9 etap 7) — analiza, bez zmian produkcyjnych
- **Inventory §10.0** — wszystkie pozycje `[DO WERYFIKACJI]` zamknięte
- **Paczka A (A1-A11)** — WYKONANE 2026-08-08 (Sonnet 5, ta sesja), commit
  `6487cb4`. Wyłącznie zadania kategorii FIX-SAFE z
  `docs/HANDOFF_EXEC_SONNET5_2026-08-08.md` §3, w podanej kolejności:
  - A1 idempotencja UNIQUE (42P07) w etapie 6
  - A2 `is_active` w grancie kolumnowym `restaurants` (U1)
  - A3 protokół T10 plik-po-pliku, zakaz `db push`/`db reset` (U2) —
    README + nagłówki wszystkich 6 migracji
  - A4 domknięcie `amber_tts_daily` już w etapie 8 (U5)
  - A5 etap 11: `GRANT SELECT … TO service_role` + poprawka komentarza
  - A6 `SET LOCAL lock_timeout = '3s'` w 6/6 migracjach
  - A7 szablon restore: sekcja 0 (zerowanie polityk/grantów migracji przed
    odtworzeniem stanu) + sekcja F (Q9); Q9 przepisane na `pg_class.relacl`
  - A8 szkic `pending_decisions/default_privileges.sql` (nowy plik)
  - A9 `get_order_stats_execute_grant.sql` — kodowa połowa Wariantu 1 już
    istnieje (`server-vercel.js:565`)
  - A10 nota o wersji CLI dla PG17 (config.toml + README)
  - A11 konsolidacja README (warunki wejścia etapów 8/10, tabela U1-U5,
    mapowanie ustaleń review → zadania)

  Zero wykonania SQL na jakiejkolwiek bazie — wyłącznie edycje plików w
  `supabase/`. Baseline 49/49 PASS zweryfikowany po paczce, bez regresji.
  Branch NIE wypchnięty na origin po tym commicie (czeka na explicit
  polecenie użytkownika, jak poprzednio przy `d0f58e8`→push).
- **D2 — `sessionAdapter`: klasyfikacja odmowy RLS do memory-fallback** —
  WYKONANE 2026-08-09, commit `d42df6a`. Nowy `isPermissionDeniedError()`
  (`sessionAdapter.js:69-74`) łapie SQLSTATE `42501` oraz frazy
  `permission denied` / `row-level security policy` i kieruje je tam, gdzie
  dotąd trafiał wyłącznie brak tabeli — do `disableSupabase()` + memory-fallback.
  Wpięte w trzy ścieżki: `loadFromSupabase:144`, `saveToSupabase:196`,
  `touchInSupabase:239`. Bez fixu odmowa uprawnień leciała `throw`, a
  `sessionStore.js:112-121` maskował ją zwrotem świeżej domyślnej sesji —
  cicha utrata stanu na zimnym wywołaniu serverless.
  Zakres nienaruszony zgodnie z handoffem §6: dual-schema probing
  (`modeCandidates`, `continue` na schema-mismatch, memoizacja `supabaseMode`),
  kontrakt sesji, `sessionStore.js`, migracje — bez zmian (potwierdzone `git diff --quiet`).
  Testy: nowy `api/brain/tests/sessionAdapter.permissionDenied.test.js` 8/8
  (load/save/touch × oba warianty schematu `id_data`/`session_payload`
  + przejście do `supabaseMode='memory'`), baseline 49/49 bez regresji.
  **Review Opusa 2026-08-09 (read-only, ta sesja): werdykt D2 CLOSED.**
  Konsekwencja: blokada etapu 8 zdjęta — README i nagłówek migracji etapu 8
  zaktualizowane tym commitem dokumentacyjnym.
- **B1 — public catalog read-set + owner-read** — WYKONANE 2026-08-10, commity
  `34c6132` (zawężenie read-setu `restaurants`/`menu_items_v2`) i `d76adcc`
  (`api/owner/restaurants.js` — `GET /api/owner/restaurants[/:id]`, auth przez
  `requireOwner`, service_role, ownership `owner_id = auth.uid()` w jednym
  query + resolver aliasów restauracji). **B1 CLOSED.** Frontend
  (`RestaurantManager.jsx` `DetailsTab`) już czyta przez ten endpoint zamiast
  bezpośredniego `supabase.from('restaurants')` — patrz komentarz
  `RestaurantManager.jsx:283-287`. WRITE (restaurants + menu_items_v2) świadomie
  poza zakresem B1 — zostawione dla B5/D3 (`api/owner/restaurants.js:25-27`).
- **B5 — Inwentaryzacja zapisów panelu właściciela** — WYKONANE 2026-08-10
  (deliverable-only, zero edycji kodu). Raport:
  `docs/B5_OWNER_PANEL_WRITE_INVENTORY.md`. Skrót: 4 operacje zapisu, wszystkie
  w `RestaurantManager.jsx` (UPDATE `restaurants`; INSERT/UPDATE/DELETE
  `menu_items_v2`), dziś chronione WYŁĄCZNIE przez RLS live (polityki
  `owner_id = auth.uid()`, potwierdzone poprawne w inventory §3), które etap 10
  usuwa — stąd D3 jest twardym warunkiem wejścia etapu 10. Dodatkowo odkryty
  gap poza pierwotnym opisem B5: `MenuTab.reload()` czyta `menu_items_v2`
  bezpośrednio z przeglądarki i po etapie 10 przestanie widzieć pozycje
  `available = false` (nie tylko zapis się urwie, też odczyt) — wymaga nowego
  endpointu `GET /api/owner/restaurants/:id/menu` w zakresie D3. Proponowany
  kontrakt 5 endpointów (`PATCH` restauracji, `GET/POST/PATCH/DELETE` menu) w
  raporcie §5, wzorowany na `api/owner/restaurants.js`. **B5 CLOSED**, blokuje
  D3, czeka na C5 (zatwierdzenie kontraktu przez użytkownika) — 3 otwarte
  pytania w raporcie §6.
- **C5 — zatwierdzenie kontraktu endpointów panelu właściciela** — ZATWIERDZONE
  przez użytkownika 2026-08-11. Kontrakt z B5 §5 (5 endpointów) przyjęty bez zmian.
- **D3 — Backendowe endpointy zapisu panelu właściciela** — WYKONANE 2026-08-11,
  commity `d53c71b` (backend) + `f99c19d` (frontend, repo `Freeflow-Final`,
  branch `security/rls-demo-hardening-frontend`). Zgodnie z kontraktem C5:
  - `PATCH /api/owner/restaurants/:id` — edycja restauracji, allowlist 11 pól
    z `DetailsTab.save()`, ownership `.eq('id').eq('owner_id')` atomowo w
    samym `update()` (`api/owner/restaurants.js:100-106`).
  - `GET /api/owner/restaurants/:id/menu` — pełne menu właściciela (wliczając
    `available=false`), zastępuje bezpośredni odczyt `MenuTab.reload()`
    zależny od publicznej polityki Stage10.
  - `POST /PATCH /DELETE .../menu(/:itemId)` — CRUD pozycji menu, ownership
    dwuwarstwowe: `getOwnedRestaurant()` (restauracja) +
    `.eq('id',itemId).eq('restaurant_id',restaurantId)` w samym zapisie
    (`api/owner/restaurantMenu.js`). `restaurant_id` nigdy z body.
  - Nowy wspólny helper `api/owner/_helpers.js`: `getOwnedRestaurant` +
    generyczny `buildAllowlistedPatch` (iteruje po schemacie, nie po kluczach
    body — pola spoza allowlisty, w tym `owner_id`/`id`/`restaurant_id`, nigdy
    nie są odczytywane).
  - Frontend `RestaurantManager.jsx` przepięty ze wszystkich 5 bezpośrednich
    wywołań `supabase.from('restaurants'|'menu_items_v2')` na `fetch` do tych
    endpointów; nieużywany import `supabase` usunięty.
  - Testy: 40 nowych (`ownerRestaurants.test.js` +11 PATCH,
    `ownerRestaurantMenu.test.js` nowy, 19), 96/96 na bramce D3, zero regresji
    na pełnym suite.
  **Niezależny review Opusa (read-only, osobna sesja) 2026-08-11: werdykt
  D3 APPROVED — zero P0, zero P1.** 7 ustaleń P2 (nieblokujące, kontrakt/testy)
  przeniesione do backlogu testów-hardeningu poniżej. **D3 CLOSED — owner-panel
  nie jest już blokerem etapu 10.**

## Otwarte

- **T8** — WYKONANE 2026-08-08 (Fable, poprzednia sesja): pliki w `supabase/`
  (README = manifest z kolejnością, warunkami wejścia, ryzykami; 6 migracji
  etapów 6/8/9/10/11/12; snapshot etapu 0; `pending_decisions/` dla spraw
  zablokowanych decyzyjnie). Zero wykonania SQL. Bramka lint NIEuruchomiona
  (brak supabase CLI/psql w środowisku) — przeniesiona na wejście T10.
  Zakommitowane jako `d0f58e8`.
- **Review T8** — WYKONANE 2026-08-08 (Opus, czysta sesja, read-only).
  Werdykt: **CHANGES-REQUIRED** — 4×P1, 7×P2, 3×nit. Raport nie istnieje jako
  osobny plik; wszystkie ustalenia wcielone do handoffu (sekcja 7 = mapowanie)
  i teraz też do `supabase/README.md` (reprodukcja tabeli po paczce A).
- **Fixup po review (paczka A)** — WYKONANE, patrz „Zrobione" powyżej.
- **D1 — re-review paczki A przez Opusa (read-only)** — **APPROVED.** Warunek
  wejścia do T10 spełniony. (Poprzedni wpis w tym dokumencie błędnie twierdził,
  że D1 nadal jest wymagane — stan nieaktualny, skorygowany 2026-08-11.)
- Kategorie B (verify-first: B1-B5), C (owner-decision: C1-C5) oraz D3-D5
  z handoffu — **B1, B5, C5 i D3 CLOSED** (patrz „Zrobione" powyżej).
  **B2-B4, C1-C4, D4-D5 NIETKNIĘTE.** D2 nie jest już otwarte — wykonane
  2026-08-09 (`d42df6a`).
- **Owner-panel nie jest już blokerem etapu 10.** D3 zamknęło jedyną aktywną
  zależność panelu właściciela od bezpośredniego zapisu/odczytu Supabase w
  przeglądarce — potwierdzone grepem: zero `.update/.insert/.delete` na
  `restaurants`/`menu_items_v2` w aktywnym UI (`RestaurantManager.jsx`).
  Pozostałe bezpośrednie `.from('restaurants')` w aktywnym froncie
  (`ClientPanel.tsx`, `CustomerPanel.jsx`, `CartContext.jsx`) to wyłącznie
  `.select()` z jawną, wąską listą kolumn — przy okazji review D3 potwierdzone,
  że przynajmniej te trzy miejsca NIE używają `select('*')` (stan w planie
  §14 może być nieaktualny w tym punkcie — bez pełnego audytu T5 nie
  rozstrzygam czy T5 jest w całości zamknięte, czy tylko częściowo).
- **AKTUALNY HANDOFF WYKONAWCZY: `docs/HANDOFF_EXEC_SONNET5_2026-08-08.md`.**
  Zawiera: decyzje użytkownika U1-U5, kontrakt Voice (głosowe potwierdzenie ≠
  złożenie zamówienia; rozdział `complete_cart_draft`/`finish_voice_session` od
  `place_order`/`finalize_order`), zadania A (fix-safe, WYKONANE tą sesją) /
  B (verify-first) / C (owner-decision) / D (opus-review-required) z plikami,
  testami akceptacyjnymi, rollbackiem i bramkami per etap T10.
- T3, T5, T6, T9, T10 — nietknięte.

---

## Backlog test-hardening

Nieblokujące, wychwycone przez review D2 2026-08-09 (ustalenia F2/F3 raportu).
Nie są warunkiem wejścia żadnego etapu — do zrobienia przy najbliższym dotknięciu
`api/brain/tests/sessionAdapter.permissionDenied.test.js`.

1. **Dwa przypadki „message-only" bez `code: '42501'`.** Obie fixtury testu
   (`PERMISSION_DENIED`, `RLS_POLICY_DENIED`, linie `:41-49`) niosą `code`, więc
   `error?.code === '42501'` (`sessionAdapter.js:70`) zwraca `true` zanim dojdzie do
   dopasowania frazowego z `:73` — gałąź tekstowa jest we wszystkich 8 testach
   nieosiągalna. To właśnie ona jest siatką bezpieczeństwa dla odmów bez SQLSTATE
   (błędy opakowane przez warstwę pośrednią). Dodać `{ message: 'permission denied
   for table brain_sessions' }` i `{ message: 'new row violates row-level security
   policy …' }` bez pola `code`.
2. **Jeden test negatywny.** Nic dziś nie blokuje przyszłego rozluźnienia predykatu
   (np. do `msg.includes('denied')`), które zaczęłoby po cichu maskować błędy spoza
   klasy permission/RLS. Dodać asercję, że błąd typu connection failure
   (`{ code: '08006', message: 'connection failure' }`) nadal propaguje —
   `await expect(adapter.loadSession('x')).rejects`.

Nieblokujące, wychwycone przez niezależny review Opusa D3 2026-08-11 (werdykt D3 APPROVED,
zero P0/P1). Nie są warunkiem wejścia etapu 10 — do zrobienia przy najbliższym dotknięciu
`api/owner/*`.

3. **Silent field drop + 200 „Zapisano" przy częściowo niepoprawnym payloadzie.**
   `buildAllowlistedPatch` (`api/owner/_helpers.js:59-95`) traktuje wartość niepoprawną
   identycznie jak nieobecną — bezpieczne (fail-closed, zero półzapisu), ale mylące dla
   właściciela (np. ujemne `min_order_pln` ciche pomijane, frontend nie waliduje znaku
   przed wysyłką — `RestaurantManager.jsx:367`).
4. **401 dla POST/PATCH/DELETE menu przetestowany tylko pośrednio.** Testy 401 w
   `ownerRestaurantMenu.test.js` istnieją wyłącznie w bloku `GET`. Guard (`requireOwner`
   przed rozgałęzieniem metod, `restaurantMenu.js:96`) jest bezpieczny, ale brak testu
   wprost blokującego regresję, gdyby ktoś przeniósł go do gałęzi per-metoda.
5. **`eqSpy` współdzielony między dwoma query builderami w testach menu.** Asercje
   `eq('id',...)`/`eq('restaurant_id',...)` w `ownerRestaurantMenu.test.js` nie dowodzą,
   że oba filtry są w JEDNYM łańcuchu zapytania (są — `restaurantMenu.js:146-152`), tylko
   że obie wartości gdzieś padły. Doprecyzować mock, jeśli kod kiedyś rozdzieli te query.
6. **Malformed UUID w `:id`/`:itemId` → 500 zamiast 404.** Nie-UUID powoduje błąd
   PostgREST (22P02) łapany przez ogólny `catch` → 500 `internal_error`. Zero wycieku,
   ale zaśmieca logi; do rozważenia dedykowana walidacja formatu przed query.
7. **TOCTOU w ścieżce menu (marginalne).** `getOwnedRestaurant` i właściwy zapis to dwa
   osobne zapytania; okno wyścigu wymagałoby przepisania właściciela restauracji w trakcie
   pojedynczego requestu — demo nie ma transferu własności (U3), ryzyko teoretyczne.
8. **Rozjazd allowlisty zapisu i projekcji odczytu restauracji (odziedziczone po B1).**
   `description`/`min_order_pln`/`is_open` są zapisywalne przez D3, ale nie ma ich w
   `DETAIL_FIELDS` (`restaurants.js:40-41`) — właściciel nie zobaczy zapisanej wartości
   po odświeżeniu. Pre-existing z B1 (`d76adcc`), D3 tylko dokłada ścieżkę zapisu.
9. **Brak górnego limitu długości stringów w `buildAllowlistedPatch`.** Walidowany jest
   tylko `minLength`. Górna granica pochodzi wyłącznie z limitu ciała `express.json()`
   (100kb) i typów kolumn DB — bez DoS-u, ale bardzo długie wartości przechodzą do bazy.

---

## Blokady wdrożeniowe

**`integration-blocked-by-T3-T5`** — T1 i T2 są celowo niezdatne do wdrożenia samodzielnie.
Bramka na PATCH łamie KDS (`startOrder`, `markOrderReady`, `completeOrder`) i claim płatności
w `ClientPanel` — żaden z nich nie wysyła `x-admin-token`.

Przed jakimkolwiek deployem wymagane: rotacja `ADMIN_TOKEN`, usunięcie `VITE_ADMIN_TOKEN`
z frontendu, brak tokenu w `dist` i source mapach.

---

## Decyzje czekające na użytkownika

1. **`status = 'confirmed'` łamie CHECK.** `finalizeOrder.js:44` (ścieżka żywa, po Stripe)
   zapisuje wartość, której baza nie dopuszcza. Rozszerzyć CHECK czy zmienić kod na `accepted`?
   Należy do T9. Szczegóły: `SUPABASE_LIVE_INVENTORY_2026-08-08.md` §6.
2. **`CONTRACT_DECISION_REQUIRED`** — graf dozwolonych *przejść* statusu. CHECK definiuje
   tylko domenę *wartości*. Walidator przejść świadomie niezaimplementowany.
3. **§13.5** — która ścieżka zapisu jest kanoniczna. Rekomendacja w
   `T7_ORDER_WRITE_PATH_ANALYSIS.md` §4, decyzja nie podjęta.
4. **`PLAN_CORRECTION_REQUIRED` — write-set §14/T2 niepełny.** Klientów Supabase są cztery,
   nie dwa. Poza zakresem zostały `server.js:28-39` i `api/brain/supabaseClient.js`
   (sprzężone przez `globalThis.supabase`).
5. **Ryzyko duplikatu na ścieżce A** — `api/orders.js` POST nie ma idempotencji.
   Podwójny klik duplikuje zamówienie dziś. Należy do T9.
6. **`full_orders_view` zależy od legacy `menu_items`** — etap 11 z §9 (zamrożenie)
   zepsuje ten widok. Zależności nie ma w planie.

---

## Czego nie robiono

Zero merge, zero rotacji kluczy, zero zapisu do Supabase, zero DDL i DML.
Jedyne wykonane SQL to osiem `SELECT`-ów z §10.0 za jawną zgodą, udokumentowane w inventory.

Push: wyłącznie na gałąź `origin/security/rls-demo-hardening`, za każdym razem na
jawne polecenie użytkownika. Gałąź nie jest mergowana do `main` ani do
`demo/gate1-finalization`.
