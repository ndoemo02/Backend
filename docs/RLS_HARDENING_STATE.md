# Stan prac RLS/hardening — punkt wznowienia

Dokument wskaźnikowy. **Nie jest planem** — plan kanoniczny to
`docs/SUPABASE_FINAL_DEMO_HARDENING_PLAN.md` i tylko on obowiązuje.

Ostatnia aktualizacja: 2026-08-08

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

Testy: **49/49 PASS** (`ordersAuth.t1`, `supabaseClients.t2`, `orderPersistence.antiDuplicate`) —
niezmienione po paczce A (wyłącznie pliki w `supabase/` + `docs/`, zero kodu backendu dotknięte).

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
- **NASTĘPNY KROK WYMAGANY: D1 — re-review paczki A przez Opusa** (read-only),
  zgodnie z `docs/HANDOFF_EXEC_SONNET5_2026-08-08.md` §6 (D1) i §8 (bramki).
  Werdykt APPROVE jest warunkiem wejścia do jakiegokolwiek T10. D1 NIE zostało
  wykonane w tej sesji — kategoria OPUS-REVIEW-REQUIRED, poza zakresem FIX-SAFE.
- Kategorie B (verify-first: B1-B5), C (owner-decision: C1-C5) i pozostałe
  zadania D (D2-D5) z handoffu — NIETKNIĘTE w tej sesji, zgodnie z zakresem
  (wyłącznie FIX-SAFE).
- **AKTUALNY HANDOFF WYKONAWCZY: `docs/HANDOFF_EXEC_SONNET5_2026-08-08.md`.**
  Zawiera: decyzje użytkownika U1-U5, kontrakt Voice (głosowe potwierdzenie ≠
  złożenie zamówienia; rozdział `complete_cart_draft`/`finish_voice_session` od
  `place_order`/`finalize_order`), zadania A (fix-safe, WYKONANE tą sesją) /
  B (verify-first) / C (owner-decision) / D (opus-review-required) z plikami,
  testami akceptacyjnymi, rollbackiem i bramkami per etap T10.
- T3, T5, T6, T9, T10 — nietknięte.

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

Zero merge, zero push, zero rotacji kluczy, zero zapisu do Supabase, zero DDL i DML.
Jedyne wykonane SQL to osiem `SELECT`-ów z §10.0 za jawną zgodą, udokumentowane w inventory.
