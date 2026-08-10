# B5 — Inwentaryzacja zapisów panelu właściciela [U3/U4, wejście do D3]

- **Data:** 2026-08-10
- **Status:** VERIFY-FIRST, deliverable-only. Zero edycji kodu, zero migracji, zero SQL.
- **Zadanie źródłowe:** `docs/HANDOFF_EXEC_SONNET5_2026-08-08.md` §B5 (linie 348-361).
- **Zależność:** blokuje D3; wynik konsumuje C5 (zatwierdzenie kontraktu przez użytkownika)
  przed jakąkolwiek implementacją.

---

## 1. Zakres zweryfikowany (repo frontendu)

| Plik | Rola | Zapisy Supabase? |
|---|---|---|
| `frontend/src/pages/Panel/RestaurantManager.jsx` | `DetailsTab.save()` + `MenuTab.addItem/saveEdit/deleteItem` | **TAK — 4 operacje, patrz §2** |
| `frontend/src/hooks/useOwnerRestaurant.ts` | Pobiera listę restauracji przez `GET /api/owner/restaurants` (Bearer JWT, B1) | Brak. Czysty odczyt przez backend. |
| `frontend/src/store/ownerRestaurantStore.ts` | Zustand + `localStorage`, cache listy restauracji i wybranego ID | Brak. Zero importu `supabase`. |
| `frontend/src/lib/businessApi.ts` | Dashboard biznesowy (`fetchBusinessDashboard`) | Brak mutacji — wyłącznie `GET /api/admin/orders` z `x-admin-token`, poza zakresem panelu właściciela (inny mechanizm auth, inny panel: `BusinessPanelNew.tsx`). Plik ma w nagłówku własną deklarację „Read-only… No mutations". |

Wniosek: cała powierzchnia zapisu panelu właściciela to dokładnie **4 operacje w jednym pliku** — `RestaurantManager.jsx`. Handoff wymieniał też `businessApi.ts` jako plik do sprawdzenia; potwierdzone jako poza zakresem (read-only, inny panel).

---

## 2. Tabela operacji zapisu (dziś, bezpośrednio z przeglądarki)

| # | Operacja | Plik:linia | Tabela | Kolumny zapisywane | Warunek własności po stronie klienta | Ochrona dziś (RLS live) |
|---|---|---|---|---|---|---|
| 1 | UPDATE restauracji | `RestaurantManager.jsx:370-375` (`save()`) | `restaurants` | `name, city, address, phone, website, is_active, delivery_available, image_url` + warunkowo `description, min_order_pln, is_open` | `.eq('id', restaurantId).eq('owner_id', userId)` | Policy `owner_id = auth.uid()` na UPDATE |
| 2 | INSERT pozycji menu | `RestaurantManager.jsx:562-570` (`addItem()`) | `menu_items_v2` | `restaurant_id, name, price_pln, description, category, available, image_url` | **Brak.** `restaurant_id` pochodzi z propsa komponentu, zero jawnej weryfikacji w JS | Policy INSERT (join/subquery do `restaurants.owner_id` — `menu_items_v2` nie ma własnej kolumny `owner_id`, patrz §3) |
| 3 | UPDATE pozycji menu | `RestaurantManager.jsx:597-604` (`saveEdit()`) | `menu_items_v2` | `name, price_pln, description, category, available, image_url` | `.eq('id', editItem.id)` — **brak** `restaurant_id`/owner w filtrze klienta | Jak wyżej |
| 4 | DELETE pozycji menu | `RestaurantManager.jsx:615` (`deleteItem()`) | `menu_items_v2` | — | `.eq('id', delItem.id)` — **brak** filtra własności | Jak wyżej |

Operacje 2-4 nie mają żadnej weryfikacji własności po stronie klienta — działają wyłącznie
dlatego, że RLS na żywej bazie to dziś egzekwuje. Filtr `.eq('owner_id', userId)` w operacji 1
jest UX-em (nie próbuje edytować cudzych danych), nie warstwą bezpieczeństwa — usunięcie go
z kodu nic by nie zmieniło dla atakującego, bo prawdziwa bramka jest w bazie.

---

## 3. Co dziś naprawdę chroni te zapisy

`docs/SUPABASE_LIVE_INVENTORY_2026-08-08.md:104-105`:
> `restaurants` / `menu_items_v2` — polityki właścicielskie na `owner_id = auth.uid()` dla
> INSERT/UPDATE/DELETE są poprawne. Problemem jest wyłącznie nadmiarowy odczyt publiczny.

`menu_items_v2` **nie ma kolumny `owner_id`** (potwierdzone listą GRANT w
`supabase/migrations/20260808000400_stage10_public_catalog_rls.sql:106-109`: `id,
restaurant_id, name, description, price_pln, category, available, image_url, section_order,
item_family, item_tags, dietary_flags`). Polityka INSERT/UPDATE/DELETE musi więc rozstrzygać
własność przez `restaurant_id → restaurants.owner_id` (join/`EXISTS`), nie przez kolumnę na
samej tabeli. Nie zweryfikowano treści polityki bezpośrednio (`pg_policies`/psql) — zero SQL na
live bez jawnej zgody (reguła nadrzędna §0.1 handoffu). To założenie wynika z braku kolumny
`owner_id` w schemacie, nie z odczytu definicji polityki — do ewentualnego potwierdzenia
jednym `SELECT` z `snapshot_queries.sql` przed T10, za osobną zgodą.

**Migracja etapu 10** (`supabase/migrations/20260808000400_stage10_public_catalog_rls.sql:14-20`,
jeszcze NIE wykonana na live) usuwa te polityki właścicielskie i robi `REVOKE ALL ... FROM
PUBLIC, anon, authenticated` na obu tabelach. Komentarz w pliku wprost:
> Świadoma zmiana semantyki: usunięcie polityk właścicielskich (...) oznacza, że bezpośredni
> zapis z przeglądarki (dziś `RestaurantManager.jsx:365-369`) przestaje działać. To jest model
> docelowy §1/§3 planu (zapisy wyłącznie backend, service_role, walidacja `owner_id` na
> endpointzie).

Innymi słowy: **wszystkie 4 operacje z tabeli §2 dziś działają; po wykonaniu etapu 10 wszystkie
4 zaczną zwracać błąd uprawnień (42501).** D3 jest dlatego twardym warunkiem wejścia etapu 10
(graf zależności handoffu: `10→T5+B1+D3`).

---

## 4. Gap odkryty w tej analizie: READ też się urwie, nie tylko WRITE

`MenuTab.reload()` (`RestaurantManager.jsx:527-545`) czyta `menu_items_v2` **bezpośrednio
klientem Supabase** (nie przez backend), filtrowane tylko po `restaurant_id`. Dziś to pokazuje
WSZYSTKIE pozycje (`available = true` i `false`), bo obecne polityki SELECT na `menu_items_v2`
są bezwarunkowe (`Public Read Menu` / `Allow public select`, oba `true` — to jest właśnie
„nadmiarowy odczyt publiczny" naprawiany w etapie 10).

Migracja etapu 10 zawęża SELECT do `USING (available = true)`
(`20260808000400_stage10_public_catalog_rls.sql:111-113`). Od tego momentu **właściciel
przestanie widzieć własne WYŁĄCZONE pozycje menu na swoim panelu** — czysty regres odczytu,
niezależny od zapisu.

B1 (`api/owner/restaurants.js`) objęło wyłącznie odczyt szczegółów restauracji
(`GET /api/owner/restaurants/:id`), świadomie z pominięciem menu — nagłówek pliku
(`restaurants.js:25-27`) wprost zostawia to B5/D3. Ten gap nie był nazwany w oryginalnym opisie
B5 (który mówi o zapisach), ale wpływa na te same warunki wejścia etapu 10 i ten sam plik —
zgłaszam go tu, decyzja o zakresie należy do C5 (pytanie 1 w §6).

---

## 5. Proponowany kontrakt endpointów (D3) — do zatwierdzenia w C5

Wzorzec identyczny z B1 (`api/owner/restaurants.js`, już na branchu):
`requireOwner(req, res)` (Bearer Supabase JWT → `auth.getUser` → `userId`, `api/_auth.js:150`)
+ klient `supabase`/`privateServerClient` z `api/_supabase.js` (service_role — jedyny klient
z `GRANT ALL` po etapie 10). Ownership zawsze jako **warunek w tym samym zapytaniu**
(`.eq('owner_id', auth.userId)` w jednym query), nie osobny odczyt + sprawdzenie w JS —
tak jak `restaurants.js:71-76`. 404 (nie 403) dla cudzych zasobów, żeby różnica statusu nie
ujawniała istnienia cudzego ID — tak jak `restaurants.js:79-81`.

| # | Endpoint | Metoda | Body / walidacja | Uwagi |
|---|---|---|---|---|
| D3.1 | `/api/owner/restaurants/:id` | `PATCH` | Allowlist pól z `save()`: `name, city, address, phone, website, is_active, delivery_available, image_url, description, min_order_pln, is_open`. `.update(patch).eq('id', id).eq('owner_id', auth.userId)`. 0 zaktualizowanych wierszy → 404. | Zero pól poza tą listą — brak pełnego CRUD ponad realne użycie (zakaz z B5). Zero zmiany `owner_id`/onboardingu nowej restauracji (U3). |
| D3.2 | `/api/owner/restaurants/:id/menu` | `GET` | Zwraca WSZYSTKIE pozycje (`available` true i false) danej restauracji, tylko gdy `owner_id` restauracji zgadza się z JWT. | **Nowy, poza pierwotnym opisem B5** — patrz gap §4. Bez tego `MenuTab.reload()` przestaje działać po T10 razem z zapisem. |
| D3.3 | `/api/owner/restaurants/:id/menu` | `POST` | Pola z `addItem()`: `name, price_pln, description, category, available, image_url`. `restaurant_id` **nigdy z body** — bierze się z URL param, dopiero po weryfikacji że `:id` należy do ownera. | |
| D3.4 | `/api/owner/restaurants/:id/menu/:itemId` | `PATCH` | Pola z `saveEdit()`. Dwuwarstwowa walidacja: `:id` należy do ownera + `.eq('id', itemId).eq('restaurant_id', id)` przy update (bo `menu_items_v2` nie ma własnej kolumny `owner_id`, §3). | |
| D3.5 | `/api/owner/restaurants/:id/menu/:itemId` | `DELETE` | Walidacja jak D3.4. | |

Frontend: `RestaurantManager.jsx` przepięty z bezpośrednich wywołań `supabase.from(...)` na
`fetch(getApiUrl(...), { headers: { Authorization: Bearer <token> } })` — analogicznie do
migracji odczytu w `DetailsTab` (już zrobionej w B1, `RestaurantManager.jsx:298-346`).

---

## 6. Otwarte pytania dla C5 (decyzja użytkownika, przed D3)

1. Czy zakres D3 obejmuje też **D3.2 (GET menu dla właściciela)** — gap odkryty w §4 — czy to
   osobne mikro-zadanie wykonywane przed/razem z T10, poza pierwotnym D3?
2. Pola warunkowe `description`, `min_order_pln`, `is_open` w `DetailsTab` istnieją w kodzie
   pod flagą „dopiero po migracji kolumn" (`RestaurantManager.jsx:294-297`). Czy D3.1 ma je
   obsłużyć teraz (na wypadek gdy kolumny już istnieją na live — niezweryfikowane w tej
   analizie, wymaga jednego `SELECT` za zgodą) czy dopiero po potwierdzeniu migracji?
3. Format błędu przy 0 zaktualizowanych/usuniętych wierszy w D3.3-D3.5 (nie istnieje vs nie
   twoje) — 404 dla obu, spójnie z wzorcem B1, czy inaczej?

---

## 7. Czego NIE zrobiono w tej analizie (zgodnie z „Nie wolno" w B5)

- Zero edycji `RestaurantManager.jsx` — nadal pisze bezpośrednio do Supabase, zero regresji.
- Zero nowych plików w `api/owner/`.
- Zero migracji SQL, zero zmian w `supabase/migrations/`.
- Zero SQL wykonanego na live (założenie o strukturze polityki `menu_items_v2` w §3 wynika
  z braku kolumny w schemacie, nie z odczytu `pg_policies`).
- Nie zaprojektowano pełnego CRUD ponad to, czego panel realnie używa (brak np. bulk-operacji,
  brak endpointu do zmiany `section_order` mimo że kolumna istnieje w SELECT panelu).
