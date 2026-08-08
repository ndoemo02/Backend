-- ============================================================================
-- Etap 12 (§9 planu) — widoki (security_invoker) + funkcje (search_path)
-- ⛔ NIE WYKONYWAĆ NA LIVE poza T10, za jawną, osobną zgodą użytkownika.
--
-- Źródła: SUPABASE_FINAL_DEMO_HARDENING_PLAN.md §5, §10.6
--         SUPABASE_LIVE_INVENTORY_2026-08-08.md §4
--
-- Korekty względem §10.6 planu (inventory ma pierwszeństwo):
--   1. Funkcje projektu w live to DOKŁADNIE trzy: ensure_restaurant_exists,
--      get_order_stats, update_updated_at_column. Wymieniana w planie
--      `get_business_stats` NIE ISTNIEJE w live (kod api/admin/business-stats.js:17
--      woła nieistniejące RPC — zastany błąd, poza zakresem T8, tylko flagowany).
--      `match_learning_embeddings` również nie istnieje. Pozostałe 149 wierszy
--      pg_proc to funkcje rozszerzeń pgvector/pg_trgm — nieruszane.
--   2. Zero SECURITY DEFINER wśród funkcji (deeskalacja ryzyka #7) — mutowalny
--      search_path na SECURITY INVOKER nie daje eskalacji uprawnień; poprawka
--      poniżej jest higieniczna, nie krytyczna.
--   3. REVOKE EXECUTE na get_order_stats ŚWIADOMIE POMINIĘTE — to decyzja
--      §13.7 planu (endpoint /api/order-stats woła ją dziś klientem anon-first;
--      warianty w supabase/pending_decisions/get_order_stats_execute_grant.sql).
--      Tu zmienia się wyłącznie search_path (decision-free).
--   4. Sygnatury funkcji nie były inwentaryzowane — ALTER wykonywany jest przez
--      pętlę po pg_proc z pg_get_function_identity_arguments (oid::regprocedure),
--      więc plik nie zgaduje sygnatur.
--
-- Uwaga do full_orders_view: po security_invoker=true anon/authenticated
-- i tak dostaną odmowę na tabelach bazowych (etap 9), a service_role omija RLS.
-- Widok nadal czyta legacy menu_items — zależność opisana w pliku etapu 11.
--
-- Uwaga do amber_tts_daily: REVOKE/GRANT poniżej jest od 2026-08-08 POWTÓRZENIEM
-- bloku już wykonanego w etapie 8 (fixup po review T8, P2-1/U5) — etap 8 zamyka
-- okno telemetrii wcześniej, bo amber_tts_daily jest security-definer nad
-- amber_intents, którą etap 8 właśnie zamyka. Tu dochodzi wyłącznie
-- security_invoker (zależny od etapu 9, patrz wyżej) — REVOKE/GRANT jest
-- idempotentny i celowo pozostawiony dla porządku (spójność z full_orders_view).
--
-- Warunki wejścia: etap 9 wykonany (inaczej security_invoker na widoku PII
--   opiera się o niezamknięte tabele); odczyt definicji z §10.0 — WYKONANY
--   (inventory §4).
-- Warunek wyjścia: testy negatywne na widoki zielone; /api/order-stats zachowuje
--   się zgodnie z decyzją §13.7.
-- Rollback: restore_snapshot.sql dla konkretnego widoku/funkcji (§12, etap 12).
--
-- Wykonanie wyłącznie pojedynczo za bramką T10 — nigdy przez zbiorczy db push
-- (decyzja użytkownika U2, handoff 2026-08-08).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ------------------------------------------------------------------- widoki
DO $$ BEGIN
  IF to_regclass('public.full_orders_view') IS NOT NULL THEN
    ALTER VIEW public.full_orders_view SET (security_invoker = true);
    REVOKE ALL ON public.full_orders_view FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON public.full_orders_view TO service_role;
  END IF;

  IF to_regclass('public.amber_tts_daily') IS NOT NULL THEN
    ALTER VIEW public.amber_tts_daily SET (security_invoker = true);
    REVOKE ALL ON public.amber_tts_daily FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON public.amber_tts_daily TO service_role;
  END IF;
END $$;

-- ------------------------------------------------------------------ funkcje
-- search_path dla wszystkich trzech funkcji projektu (decision-free).
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('ensure_restaurant_exists','get_order_stats','update_updated_at_column')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public', fn.sig);
  END LOOP;
END $$;

-- REVOKE EXECUTE tylko tam, gdzie nie ma otwartej decyzji:
--   - ensure_restaurant_exists: zero wywołań w kodzie runtime — brak legalnego
--     konsumenta przeglądarkowego;
--   - update_updated_at_column: funkcja triggerowa — odebranie EXECUTE ról
--     klienckich NIE psuje odpalania triggerów (uprawnienie sprawdzane przy
--     CREATE TRIGGER, nie przy DML).
-- get_order_stats: patrz korekta nr 3 w nagłówku — NIE ruszana.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('ensure_restaurant_exists','update_updated_at_column')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END $$;

COMMIT;
