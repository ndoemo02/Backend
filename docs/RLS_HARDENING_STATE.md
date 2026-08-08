# Stan prac RLS/hardening — punkt wznowienia

Dokument wskaźnikowy. **Nie jest planem** — plan kanoniczny to
`docs/SUPABASE_FINAL_DEMO_HARDENING_PLAN.md` i tylko on obowiązuje.

Ostatnia aktualizacja: 2026-08-08

---

## Gdzie to jest

- **Worktree:** `C:\Firerfox Portable\Freeflow backend-rls`
- **Branch:** `security/rls-demo-hardening` (baza: `demo/gate1-finalization` @ `f996b23`)
- **Nie pchnięty.** Brak upstreamu. Nie mergowany.
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

Testy: **49/49 PASS** (`ordersAuth.t1`, `supabaseClients.t2`, `orderPersistence.antiDuplicate`).

Awarie zastane, potwierdzone parytetem z `f996b23`, **nie regresje**:
- `greetingGate` / `liveToolRouter` / `conversationGuards` / `orderHandler.explicitRestaurantLock` — 17 failed
- `tests/e2e` + `brain_v2_resiliency` — 7 plików nie ładuje się bez `.env` w worktree

---

## Zrobione

- **T1** (§9 etap 1) — ryzyka #1, #2
- **T2** (§9 etap 2) — ryzyka #8, #9
- **T7** (§9 etap 7) — analiza, bez zmian produkcyjnych
- **Inventory §10.0** — wszystkie pozycje `[DO WERYFIKACJI]` zamknięte

## Otwarte

- **T8** — migracje jako pliki, odblokowane. Wejście dla Fable: treść T8 z §14,
  wyniki T1/T2/T7, `docs/SUPABASE_LIVE_INVENTORY_2026-08-08.md`. Nic więcej.
  Fable nie projektuje całości od zera i nie tworzy konkurencyjnego planu.
- **Review T8** — osobna sesja Opus, read-only, bez edycji.
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
