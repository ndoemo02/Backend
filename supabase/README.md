# T8 — migracje SQL jako pliki (bez wykonania)

- **Task:** T8 z §14 planu `docs/SUPABASE_FINAL_DEMO_HARDENING_PLAN.md`
- **Data:** 2026-08-08
- **Status: ŻADEN plik z tego katalogu nie został wykonany na żadnej bazie.**
  Wykonanie należy wyłącznie do T10, za jawną, osobną zgodą użytkownika.
- Źródła treści: plan kanoniczny §9/§10 + `docs/SUPABASE_LIVE_INVENTORY_2026-08-08.md`
  (inventory ma pierwszeństwo tam, gdzie koryguje plan) + wyniki T1/T2/T7.

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
| 2 | `20260808000200_stage08_runtime_log_config_denyall.sql` | 8 | etap 0; poprawka `sessionAdapter` (§7 planu); domknięcie klientów spoza write-setu T2 (`server.js:28-39`, `api/brain/supabaseClient.js`) | poprawki NIEWYKONANE — blokada |
| 3 | `20260808000300_stage09_sensitive_denyall.sql` | 9 | etapy 1 ✓, 2 ✓ (z zastrzeżeniem j.w.), 5 ✗ (T5), 7 ✓ | **T5 niewykonane — twarda blokada** |
| 4 | `20260808000400_stage10_public_catalog_rls.sql` | 10 | etap 5 ✗ (T5) + weryfikacja kolumn (snapshot Q7) | **T5 niewykonane — twarda blokada** |
| 5 | `20260808000500_stage11_freeze_menu_items.sql` | 11 | etap 4 ✗ (T4, test kontraktowy) | **T4 niewykonane — twarda blokada** |
| 6 | `20260808000600_stage12_views_functions.sql` | 12 | etap 9 wykonany; definicje z §10.0 ✓ (inventory) | za etapem 9 |

Nad wszystkim obowiązuje `integration-blocked-by-T3-T5` z `docs/RLS_HARDENING_STATE.md`
oraz warunek deployowy: rotacja `ADMIN_TOKEN`, usunięcie `VITE_ADMIN_TOKEN` z frontendu.

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

## Rollback

Per etap — tabela w §12 planu. Skrót: etapy RLS/grant (8–12) wyłącznie przez
`restore_snapshot.sql` (dokładny stan sprzed zmiany); etap 6 się nie cofa (kolumny
addytywne zostają); `DISABLE ROW LEVEL SECURITY` tylko jako ręczny break-glass.

## Bramka T8 (lint) — stan

`supabase db lint` NIE zostało uruchomione: w środowisku nie ma `supabase` CLI ani `psql`,
a lint wymaga lokalnego stacka (Docker) lub stagingu. Weryfikacja składni pozostaje
warunkiem wejścia T10 (pierwszy krok: `supabase start` + `supabase db lint` lokalnie,
zero kontaktu z live).
