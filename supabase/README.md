# T8 — migracje SQL jako pliki (bez wykonania)

- **Task:** T8 z §14 planu `docs/SUPABASE_FINAL_DEMO_HARDENING_PLAN.md`
- **Data:** 2026-08-08
- **Status: ŻADEN plik z tego katalogu nie został wykonany na żadnej bazie.**
  Wykonanie należy wyłącznie do T10, za jawną, osobną zgodą użytkownika.
- Źródła treści: plan kanoniczny §9/§10 + `docs/SUPABASE_LIVE_INVENTORY_2026-08-08.md`
  (inventory ma pierwszeństwo tam, gdzie koryguje plan) + wyniki T1/T2/T7.
- **Review T8:** wykonany 2026-08-08 (Opus, czysta sesja, read-only). Werdykt:
  **CHANGES-REQUIRED** — 4×P1, 7×P2, 3×nit. Ustalenia wcielone do fixupu
  poniżej i do `docs/HANDOFF_EXEC_SONNET5_2026-08-08.md` §7 (mapowanie
  ustalenie → zadanie); raport nie istnieje jako osobny plik. Handoff
  wykonawczy tej paczki: `docs/HANDOFF_EXEC_SONNET5_2026-08-08.md`.

## Decyzje użytkownika (U1-U5)

Normatywne, przyjęte przed fixupem po review T8 — pełny kontekst w
`docs/HANDOFF_EXEC_SONNET5_2026-08-08.md` §1.

| # | Decyzja |
|---|---|
| U1 | `restaurants.is_active` MOŻE być widoczne dla anon (wchodzi do grantu kolumnowego etapu 10). |
| U2 | T10 = wykonanie plik po pliku z bramkami. Globalny `db push` ZABRONIONY. |
| U3 | Panel właściciela pozostaje częścią demo. BEZ pełnego onboardingu firmy — działamy na przygotowanych restauracjach/kontach demo. |
| U4 | Docelowo zapisy właścicielskie przechodzą przez backend z walidacją uprawnienia do restauracji (owner ↔ restaurant), nie przez szeroki bezpośredni zapis Supabase z frontendu. |
| U5 | `amber_tts_daily` domknąć wcześniej (etap 8), o ile nie tworzy to nowej zależności — potwierdzone: nie tworzy. |

## Układ katalogu

| Ścieżka | Rola |
|---|---|
| `config.toml` | minimalna konfiguracja Supabase CLI (bez linku do live) |
| `migrations/*.sql` | migracje wolne od otwartych decyzji, w kolejności wykonania |
| `snapshot/snapshot_queries.sql` | etap 0 — zapytania read-only do zdjęcia stanu przed pierwszą zmianą |
| `snapshot/RESTORE_SNAPSHOT_TEMPLATE.sql` | szablon rollbacku; wykonywalny dopiero po zmaterializowaniu wyników snapshotu |
| `pending_decisions/*.sql` | szkice zablokowane decyzyjnie — CELOWO poza `migrations/`, żeby `supabase db push` nie rozstrzygnął ich przypadkiem |

## Kolejność wykonania (przyszłe T10) i warunki wejścia

| # | Plik | Etap §9 | Warunki wejścia | Stan warunków na 2026-08-08 |
|---|---|---|---|---|
| 0 | `snapshot/snapshot_queries.sql` → wypełnienie `restore_snapshot.sql` | 0 | jawna zgoda na SELECT-y na live | częściowo pokryte inventory; snapshot pełny NIEWYKONANY |
| 1 | `20260808000100_stage06_orders_additive_columns.sql` | 6 | etap 0 | gotowe po etapie 0 |
| 2 | `20260808000200_stage08_runtime_log_config_denyall.sql` | 8 | etap 0; poprawka `sessionAdapter` — klasyfikacja odmowy RLS (42501) do memory-fallback (§7 planu, zadanie D2) | **ZWERYFIKOWANE (review T8): klienci spoza write-setu T2 (`server.js:28-39`, `api/brain/supabaseClient.js:26-36`) używają wyłącznie `SUPABASE_SERVICE_ROLE_KEY`, fail-fast — zdjęte jako blokada.** Jedyną realną blokadą pozostaje `sessionAdapter` (D2) — NIEWYKONANA |
| 3 | `20260808000300_stage09_sensitive_denyall.sql` | 9 | etapy 1 ✓, 2 ✓ (z zastrzeżeniem j.w.), 5 ✗ (T5), 7 ✓; audyt zapisów `profiles` z frontendu (zadanie B2) | **T5 niewykonane — twarda blokada**; B2 NIEWYKONANE |
| 4 | `20260808000400_stage10_public_catalog_rls.sql` | 10 | etap 5 ✗ (T5) + weryfikacja kolumn (snapshot Q7) + zawężenie `/api/restaurants` `select("*")` na kliencie anon (zadanie B1, `api/server-vercel.js:781-790`, review T8 P1-3) + **audyt kolumn poza `.select()`** — `.eq()`/`.ilike()`/`.order()`/`.in()` w backendzie i we frontendowych zapytaniach anon (zadanie B1 rozszerzone, re-review D1 F4; znany przypadek: `frontend/src/state/CartContext.jsx:283` filtruje po `aliases`, kolumnie NIEOBECNEJ w grancie etapu 10) + kontrakt endpointów panelu właściciela (zadanie D3, po B5/C5, U3/U4) | **T5 niewykonane — twarda blokada**; B1 (w tym rozszerzenie audytu) i D3 NIEWYKONANE — dodatkowe blokady |
| 5 | `20260808000500_stage11_freeze_menu_items.sql` | 11 | etap 4 ✗ (T4, test kontraktowy) | **T4 niewykonane — twarda blokada** |
| 6 | `20260808000600_stage12_views_functions.sql` | 12 | etap 9 wykonany; definicje z §10.0 ✓ (inventory) | za etapem 9 |

Nad wszystkim obowiązuje `integration-blocked-by-T3-T5` z `docs/RLS_HARDENING_STATE.md`
oraz warunek deployowy: rotacja `ADMIN_TOKEN`, usunięcie `VITE_ADMIN_TOKEN` z frontendu.

### Protokół wykonania T10 (decyzja użytkownika U2)

Wykonanie wyłącznie **pojedynczo** (`psql -f <plik>` / pojedyncza migracja przez
`supabase migration up` na jeden plik), po spełnieniu warunków wejścia danego
etapu z tabeli powyżej i **za bramką** (jawna zgoda użytkownika + smoke test po
pliku, przed przejściem do kolejnego). `supabase db push` oraz `supabase db reset`
na live/stagingu z niekompletnym odblokowaniem etapów są **ZABRONIONE** — oba
wykonują cały katalog `migrations/` naraz i omijają bramkowanie per etap opisane
w tej tabeli. Każdy plik w `migrations/` niesie tę samą regułę w nagłówku.

## Najważniejsze odstępstwa od §10 planu (uzasadnione inventory)

1. **Etap 6:** bez zmiany CHECK-a statusów (decyzja otwarta nr 1, warianty w
   `pending_decisions/`); `total_cents` jako `numeric` (istnieje w live), nie `integer`.
2. **Etapy 8–11:** przed REVOKE usuwane są WSZYSTKIE istniejące polityki na tabelach
   docelowych — live ma ~30 polityk, w większości permisywnych `USING (true)` z duplikatami,
   których plan nie przewidywał. Deny-all bez ich usunięcia byłby pozorny po ewentualnym
   przyszłym GRANT.
3. **Listy tabel dopasowane do live:** dodane `amber_knowledge`, `intent_logs`,
   `unhandled_logs`, `menu_items_v2_backup{,2,_nlu}`; tabele z planu nieistniejące w live
   (`system_events`, `debug_logs`, `local_promotions`, `businesses`, `table_reservations`,
   `taxi_drivers`) są w pętlach z guardem `to_regclass` (NOTICE + pominięcie).
4. **Etap 9 dodatkowo odbiera granty na `full_orders_view`** (widok PII, anon ma dziś na nim
   pełne uprawnienia) — nie czeka to do etapu 12.
5. **Etap 12:** tylko 3 realne funkcje projektu (`get_business_stats` i
   `match_learning_embeddings` z planu NIE istnieją w live); ALTER przez pętlę po `pg_proc`
   (sygnatury nie były inwentaryzowane); `get_order_stats` bez REVOKE (decyzja §13.7).

## Ryzyka

- **Etap 9 usuwa też „poprawne" polityki self-access na `profiles`** — zgodnie z modelem
  deny-all §3 planu; wymaga wcześniejszego T5 (AdminPanel na endpointy backendu).
- **Etap 10 zmienia semantykę zapisu katalogu:** bezpośredni zapis właścicielski z przeglądarki
  (`RestaurantManager.jsx`) przestaje działać — z założenia; T5 musi to wyprzedzić.
- **Kolumny katalogu niezweryfikowane w live** (inventory §10.0 nie obejmował
  `restaurants`/`menu_items_v2`) — nieistniejąca kolumna w `GRANT SELECT (…)` wywali całą
  transakcję etapu 10 (fail-closed, bez stanu częściowego); stąd warunek Q7 przed T10.
- **`full_orders_view` czyta legacy `menu_items`** — zamrożenie (etap 11) tego nie psuje,
  ale przyszły `DROP menu_items` tak; zależność flagowana w plikach 11 i 12.
- **Default privileges nieznane** (snapshot Q8) — jeśli istnieją, nowe tabele znów dostaną
  szerokie granty mimo REVOKE na istniejących; do rozstrzygnięcia po snapshot.
- **Kod woła nieistniejące RPC `get_business_stats`** (`api/admin/business-stats.js:17`) —
  błąd zastany, poza zakresem T8, tylko flagowany.
- **Kolumnowy grant etapu 10 sprawdzany też w WHERE/ORDER, nie tylko w SELECT** —
  ta sama mechanika co `is_active`/A2, ale audyt B1 pierwotnie obejmował tylko
  listy `.select()`. Znany przypadek: `frontend/src/state/CartContext.jsx:283`
  (`.ilike('aliases', …)` na `restaurants`) — `aliases` nie jest w ogóle w liście
  grantu etapu 10, więc to zapytanie padnie z 42501 po etapie 10. Pełny audyt
  (backend + frontend, wszystkie operatory) jest częścią rozszerzonego B1
  (re-review D1, ustalenie F4) — patrz `docs/HANDOFF_EXEC_SONNET5_2026-08-08.md` §4 B1.
  Los `aliases` (grant vs przepięcie na backend) NIEROZSTRZYGNIĘTY.

## Mapowanie ustaleń review T8 → zadania

Pełny kontekst i treść zadań: `docs/HANDOFF_EXEC_SONNET5_2026-08-08.md` (§3-§6
kategorie A/B/C/D, §7 ta tabela w oryginale). Kolumna „Zadanie" odsyła do
oznaczeń z tego handoffu, nie do plików w tym repo.

| Ustalenie | Waga | Zadanie |
|---|---|---|
| P1-1 UNIQUE nie-idempotentne (42P07) | P1 | A1 — wykonane w tej paczce |
| P1-2 `is_active` poza grantem | P1 | A2 (+U1) — wykonane w tej paczce |
| P1-3 `/api/restaurants` select("*") na anon | P1 | B1 — analiza/zmiana poza tą paczką |
| P1-4 `db push` omija bramkowanie | P1 | A3 (+U2) — wykonane w tej paczce |
| P2-1 okno `amber_tts_daily` | P2 | A4 (+U5) — wykonane w tej paczce |
| P2-2 etap 11: BYPASSRLS ≠ granty | P2 | A5 — wykonane w tej paczce |
| P2-3 brak lock_timeout | P2 | A6 — wykonane w tej paczce |
| P2-4 restore addytywny, bez sekcji zerującej | P2 | A7 — wykonane w tej paczce |
| P2-5 CHECK session_id vs ścieżka T9 | P2 | B3 → D5 — poza tą paczką |
| P2-6 default privileges bez slotu | P2 | A8 (szkic pliku, wykonane) + C4 (decyzja, poza tą paczką) |
| P2-7 polityki `profiles` bez audytu frontendu | P2 | B2 — poza tą paczką |
| nit-1 get_order_stats — kod już przepięty | nit | A9 — wykonane w tej paczce |
| nit-2 Q9 role_usage_grants | nit | A7 — wykonane w tej paczce |
| nit-3 wersja CLI dla PG17 | nit | A10 — wykonane w tej paczce |
| (pozytywne) klienci spoza T2 = service_role | — | A11 (zdjęcie blokady etapu 8) — wykonane w tej paczce |

Zadania B/C/D pozostają otwarte po tej paczce — wymagane przed D1 (re-review
Opusa) tylko w zakresie „czy paczka A domyka P1-1/P1-2/P1-4/P2-1..4/nit-1..3
bez regresji"; B/C/D mają własne bramki (§8 handoffu).

## Rollback

Per etap — tabela w §12 planu. Skrót: etapy RLS/grant (8–12) wyłącznie przez
`restore_snapshot.sql` (dokładny stan sprzed zmiany); etap 6 się nie cofa (kolumny
addytywne zostają); `DISABLE ROW LEVEL SECURITY` tylko jako ręczny break-glass.

## Bramka T8 (lint) — stan

`supabase db lint` NIE zostało uruchomione: w środowisku nie ma `supabase` CLI ani `psql`,
a lint wymaga lokalnego stacka (Docker) lub stagingu. Weryfikacja składni pozostaje
warunkiem wejścia T10 (pierwszy krok: `supabase start` + `supabase db lint` lokalnie,
zero kontaktu z live).

**Wersja CLI (review T8, nit-3):** `config.toml` deklaruje `major_version = 17`
(zgodne z PG 17.6 na live). Wymaga odpowiednio nowego Supabase CLI — starsze
wersje nie rozpoznają PG17 jako celu lokalnego stacka. Jeśli `supabase start` /
`supabase db lint` nie startuje na wejściu T10, sprawdzić `supabase --version`
PRZED diagnozowaniem tego jako błąd w plikach SQL.
