-- ============================================================================
-- Etap 6 (§9 planu) — kolumny addytywne na public.orders
-- ⛔ NIE WYKONYWAĆ NA LIVE poza T10, za jawną, osobną zgodą użytkownika.
--
-- Źródła: SUPABASE_FINAL_DEMO_HARDENING_PLAN.md §2, §10.1
--         SUPABASE_LIVE_INVENTORY_2026-08-08.md §5 (kształt orders — 18 kolumn)
--
-- Korekty względem §10.1 planu (inventory ma pierwszeństwo):
--   1. `total_cents` JUŻ ISTNIEJE w live jako `numeric DEFAULT 0` — komentarz
--      w api/orders.js ("column does not exist") jest nieaktualny. Klauzula
--      poniżej używa typu `numeric` (zgodnego z live), nie `integer` z planu,
--      żeby świeże środowisko (staging/local) nie rozjechało się typem z live.
--   2. Zmiana CHECK-a statusów została CAŁKOWICIE USUNIĘTA z tej migracji.
--      Live CHECK `orders_status_check` dopuszcza 6 wartości (bez 'confirmed',
--      bez 'ready'); kod po T1 używa dokładnie tych 6. Rozstrzygnięcie
--      'confirmed' (rozszerzyć CHECK vs zmienić finalizeOrder.js na 'accepted')
--      to decyzja użytkownika nr 1 (T9) — wariantowy szkic leży w
--      supabase/pending_decisions/orders_status_check_confirmed.sql.
--      Ta migracja NIE dotyka statusów.
--
-- Warunki wejścia: etap 0 (snapshot + restore_snapshot.sql wygenerowany).
-- Warunek wyjścia: dzisiejszy insert z api/orders.js przechodzi bez zmian
--                  (wszystkie kolumny addytywne, nullable lub z defaultem).
-- Rollback: kolumny addytywne ZOSTAJĄ nawet przy rollbacku innych etapów
--           (§12 planu, etap 6 — "problem leży gdzie indziej, nie cofać").
--
-- Uwaga wykonawcza: ADD COLUMN tracking_token z defaultem volatile
-- (gen_random_uuid()) wymusza przepisanie tabeli i nadaje ISTNIEJĄCYM wierszom
-- unikalne wartości — to zamierzone (UNIQUE niżej tego wymaga). Skala demo,
-- okno transakcyjne minutowe.
--
-- Wykonanie wyłącznie pojedynczo za bramką T10 — nigdy przez zbiorczy db push
-- (decyzja użytkownika U2, handoff 2026-08-08).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS total_cents numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tracking_token uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT true;

-- Format session_id dopasowany do realnie generowanego przez frontend:
-- `sess_${Date.now()}_${random36}` (frontend/src/store/useConversationStore.ts). NULL dozwolony —
-- istniejące wiersze i ścieżka A (api/orders.js) nie zapisują session_id
-- do czasu T9.
DO $$ BEGIN
  ALTER TABLE public.orders
    ADD CONSTRAINT chk_orders_session_id_format
    CHECK (session_id IS NULL OR (length(session_id) <= 128 AND session_id ~ '^sess_[a-z0-9_]+$'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- UNIQUE na idempotency_key — warunek nr 2 z rekomendacji T7 (§4):
-- bez ograniczenia w bazie idempotencja ścieżki B to check-then-act z wyścigiem.
-- NULL-e nie kolidują (standardowe zachowanie UNIQUE), więc ścieżka A,
-- która klucza nie zapisuje, nie jest blokowana.
--
-- Strażnik IF NOT EXISTS na pg_constraint (nie EXCEPTION WHEN duplicate_object):
-- ADD CONSTRAINT … UNIQUE przy już istniejącej nazwie rzuca duplicate_table
-- (42P07, kolizja nazwy wspierającego indeksu), nie duplicate_object — powtórne
-- wykonanie pliku wywaliłoby się na starym handlerze (review T8, P1-1).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'uq_orders_idempotency_key'
  ) THEN
    ALTER TABLE public.orders ADD CONSTRAINT uq_orders_idempotency_key UNIQUE (idempotency_key);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'uq_orders_tracking_token'
  ) THEN
    ALTER TABLE public.orders ADD CONSTRAINT uq_orders_tracking_token UNIQUE (tracking_token);
  END IF;
END $$;

COMMIT;
