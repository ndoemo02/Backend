-- ============================================================================
-- restore_snapshot.sql — SZABLON (etap 0, §10.7 planu). NIE jest gotowym skryptem.
-- ⛔ NIE WYKONYWAĆ. Plik staje się wykonywalny dopiero po zmaterializowaniu
-- wyników snapshot_queries.sql w miejsca oznaczonych sekcji.
--
-- Zasada §12 planu: rollback = odtworzenie DOKŁADNEGO stanu sprzed zmiany,
-- nie generyczne otwarcie dostępu. DISABLE ROW LEVEL SECURITY to wyłącznie
-- ręczna procedura break-glass, nigdy krok tego pliku.
--
-- Procedura wypełnienia (przed pierwszym wykonaniem jakiejkolwiek migracji):
--   1. Uruchom snapshot_queries.sql (za jawną zgodą, read-only).
--   2. Q1/Q2  -> sekcja A: po jednym GRANT na wiersz wyniku.
--   3. Q3     -> sekcja B: CREATE POLICY odtwarzające qual/with_check/roles/cmd
--                dosłownie (wyrażenia z pg_policies wklejane bez interpretacji).
--   4. Q4     -> sekcja C: ALTER TABLE ... ENABLE/DISABLE ROW LEVEL SECURITY
--                zgodnie z relrowsecurity per tabela.
--   5. Q5     -> sekcja D: ALTER VIEW ... RESET (security_invoker) tam, gdzie
--                reloptions było NULL; granty widoków wg Q1.
--   6. Q6     -> sekcja E: ALTER FUNCTION ... RESET search_path tam, gdzie
--                proconfig było NULL; ACL funkcji wg proacl.
--   7. Całość opakowana w jedną transakcję.
--
-- Wersjonowanie: wypełniony plik zapisać jako restore_snapshot.sql obok tego
-- szablonu, z datą snapshotu w nagłówku i hashem (git cat-file blob | sha256sum,
-- nie Get-FileHash — CRLF, patrz RLS_HARDENING_STATE.md).
-- ============================================================================

BEGIN;

-- === SEKCJA 0 — zerowanie stanu wprowadzonego migracjami (PRZED sekcją A) ===
-- Bez tej sekcji restore odtwarza zmaterializowany stan z Q1-Q6 NA WIERZCHU
-- polityk i REVOKE-ów, które wprowadziły migracje etapów 8-11 — dając stan
-- "sprzed + resztki migracji", nie "dokładny stan sprzed zmiany" wymagany
-- przez §12 planu (review T8, P2-4). Kolejność: najpierw usunąć wszystko, co
-- migracje dodały (polityki, w tym restaurants_public_read i
-- menu_items_v2_public_read z etapu 10, przez pętlę po tabelach dotkniętych
-- etapami 8-11) — dopiero potem sekcje A-E odtwarzają zmaterializowany stan.
DO $$
DECLARE
  t   text;
  pol record;
  tabs text[] := ARRAY[
    -- etap 8
    'brain_sessions','conversations','conversation_events','amber_intents',
    'brain_logs','intent_issues','intent_logs','live_perf_logs','system_logs',
    'unhandled_logs','freefun_events','system_config','phrases','amber_alerts',
    'amber_knowledge','menu_items_v2_backup','menu_items_v2_backup2',
    'menu_items_v2_backup_nlu','system_events','debug_logs','local_promotions',
    -- etap 9
    'orders','order_items','profiles','users','businesses','table_reservations',
    'taxi_drivers',
    -- etap 10 (polityki restaurants_public_read, menu_items_v2_public_read)
    'restaurants','menu_items_v2',
    -- etap 11
    'menu_items'
  ];
BEGIN
  FOREACH t IN ARRAY tabs LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE;
    END IF;

    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;

-- Widoki dotknięte etapami 8/9/12 (amber_tts_daily, full_orders_view) —
-- REVOKE bez ruszania security_invoker (to odtwarza sekcja D z Q5).
DO $$ BEGIN
  IF to_regclass('public.full_orders_view') IS NOT NULL THEN
    REVOKE ALL ON public.full_orders_view FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regclass('public.amber_tts_daily') IS NOT NULL THEN
    REVOKE ALL ON public.amber_tts_daily FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

-- === SEKCJA A — granty tabelowe i kolumnowe (z Q1/Q2) =======================
-- <TU WKLEIĆ zmaterializowane GRANT-y, np.:>
-- GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   ON public.orders TO anon;
-- ...

-- === SEKCJA B — polityki RLS (z Q3) =========================================
-- <TU WKLEIĆ CREATE POLICY dla wszystkich 30 polityk, dosłownie, np.:>
-- CREATE POLICY "Allow public read on orders" ON public.orders
--   FOR SELECT TO anon USING (true);
-- ...

-- === SEKCJA C — stan RLS per tabela (z Q4) ==================================
-- <TU WKLEIĆ ENABLE/DISABLE ROW LEVEL SECURITY per tabela, np.:>
-- ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.brain_sessions DISABLE ROW LEVEL SECURITY;
-- ...

-- === SEKCJA D — widoki (z Q5 + Q1) ==========================================
-- <TU WKLEIĆ, np.:>
-- ALTER VIEW public.full_orders_view RESET (security_invoker);
-- GRANT ... ON public.full_orders_view TO anon;
-- ...

-- === SEKCJA E — funkcje (z Q6) ==============================================
-- <TU WKLEIĆ, np.:>
-- ALTER FUNCTION public.get_order_stats() RESET search_path;
-- GRANT EXECUTE ON FUNCTION public.get_order_stats() TO anon;
-- ...

-- === SEKCJA F — sekwencje (z Q9) ============================================
-- Dziś bez miejsca docelowego w szablonie (review T8, P2-4) — Q9 zbiera dane,
-- restore ich nie odtwarzał. PK w tym projekcie to uuid, więc spodziewany
-- wynik Q9 jest bliski pustego; sekcja istnieje na wypadek sekwencji spoza
-- kolumn PK (np. liczniki).
-- <TU WKLEIĆ, po jednym GRANT na wiersz wyniku Q9, np.:>
-- GRANT USAGE, SELECT ON SEQUENCE public.<nazwa> TO anon;
-- ...

COMMIT;
