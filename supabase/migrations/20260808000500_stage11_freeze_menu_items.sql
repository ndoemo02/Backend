-- ============================================================================
-- Etap 11 (§9 planu) — zamrożenie legacy public.menu_items
-- ⛔ NIE WYKONYWAĆ NA LIVE poza T10, za jawną, osobną zgodą użytkownika.
--
-- Źródła: SUPABASE_FINAL_DEMO_HARDENING_PLAN.md §8 krok 4, §10.5
--         SUPABASE_LIVE_INVENTORY_2026-08-08.md §3 (dwie nakładające się
--         polityki publicznego odczytu), §4 (zależność full_orders_view)
--
-- Korekta względem §10.5 planu: dodatkowo usuwane są istniejące polityki
-- publicznego odczytu (plan zakładał, że ich nie ma).
--
-- ZALEŻNOŚĆ NIEOBECNA W PLANIE (inventory §4, decyzja czekająca nr 6):
-- `full_orders_view` czyta z `menu_items` (JOIN). Samo RLS+REVOKE poniżej NIE
-- psuje widoku, dopóki widok działa jako security-definer (uprawnienia
-- właściciela), a po etapie 12 (security_invoker) jedynym konsumentem widoku
-- jest service_role, który omija RLS — więc też działa. Realnie pęka dopiero
-- przyszły `DROP TABLE menu_items` (post-demo): wymaga wcześniejszej przebudowy
-- lub usunięcia widoku. Ten plik świadomie NIE rozwiązuje tego — flaguje.
--
-- Warunki wejścia: etap 4 / T4 (✗ na dziś) — kod przepięty na menu_items_v2,
--   test kontraktowy menuItemsLegacy.contract.test.js zielony. TWARDA BLOKADA.
-- Warunek wyjścia: test kontraktowy nadal zielony po REVOKE.
-- Rollback: restore_snapshot.sql dla tej tabeli + pilna naprawa kodu, jeśli
--   coś jednak odpytuje menu_items (§12 planu, etap 11). Tabela pozostaje
--   fizycznie nietknięta — to jest rollback sam w sobie.
--
-- Wykonanie wyłącznie pojedynczo za bramką T10 — nigdy przez zbiorczy db push
-- (decyzja użytkownika U2, handoff 2026-08-08).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'menu_items'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.menu_items', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_items FROM PUBLIC, anon, authenticated;
-- REVOKE nie rusza zastanych grantów service_role; jawny GRANT SELECT
-- zabezpiecza środowiska odtwarzane z migracji; zamrożenie egzekwuje test
-- kontraktowy T4, nie uprawnienia (review T8, P2-2: BYPASSRLS omija RLS, ale
-- NIE zastępuje uprawnień tabelowych — na środowisku odtworzonym wyłącznie
-- z migracji, bez zastanych grantów, `full_orders_view` po etapie 12
-- (security_invoker) JOIN-uje menu_items i service_role potrzebuje na niej
-- SELECT).
GRANT SELECT ON public.menu_items TO service_role;

COMMIT;
