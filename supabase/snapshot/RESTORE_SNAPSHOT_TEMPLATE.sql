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

COMMIT;
