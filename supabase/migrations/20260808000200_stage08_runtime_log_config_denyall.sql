-- ============================================================================
-- Etap 8 (§9 planu) — deny-all na klastrze runtime / log / config (§7 Etap A)
-- ⛔ NIE WYKONYWAĆ NA LIVE poza T10, za jawną, osobną zgodą użytkownika.
--
-- Źródła: SUPABASE_FINAL_DEMO_HARDENING_PLAN.md §7 Etap A, §10.2
--         SUPABASE_LIVE_INVENTORY_2026-08-08.md §1 (realna lista tabel),
--         §2 (anon ma DELETE+TRUNCATE na wszystkim), §3 (polityki `true`)
--
-- Korekty względem §10.2 planu (inventory ma pierwszeństwo):
--   1. Lista tabel dopasowana do LIVE. Plan wymieniał `system_events`,
--      `debug_logs`, `local_promotions` — te tabele NIE ISTNIEJĄ w live
--      (pętla poniżej pomija nieistniejące z NOTICE, więc plik działa też na
--      środowisku, gdzie się pojawią). Live zawiera za to nieujęte w planie:
--      `amber_knowledge`, `intent_logs`, `unhandled_logs` oraz trzy backupy
--      `menu_items_v2_backup*` — wszystkie dołączone (wewnętrzne artefakty,
--      zero konsumentów przeglądarkowych).
--   2. Plan robił tylko ENABLE RLS + REVOKE. Inventory §3 pokazuje, że część
--      tabel MA już permisywne polityki `USING (true)` (`phrases` anon SELECT,
--      `live_perf_logs` RLS ON). Zostawienie ich to pozorna ochrona — ta
--      migracja DODATKOWO usuwa wszystkie istniejące polityki na tabelach
--      klastra (deny-all = RLS ON + zero permissive policies + zero grantów).
--
-- Warunki wejścia:
--   - etap 0 (snapshot/restore wygenerowany);
--   - dla `brain_sessions`: poprawka sessionAdapter z §7 planu (klasyfikacja
--     RLS-denial do ścieżki memory-fallback) — NIEWYKONANA na dziś;
--   - domknięcie write-setu T2 (PLAN_CORRECTION_REQUIRED, decyzja nr 4 stanu):
--     klienci `server.js:28-39` i `api/brain/supabaseClient.js` muszą mieć
--     potwierdzone service_role, inaczej REVOKE odetnie zapisy logów/sesji.
-- Warunek wyjścia: backend nadal loguje i czyta sesje (service_role omija RLS).
-- Rollback: restore_snapshot.sql z etapu 0 (dokładny stan, nie generyczny
--           DISABLE RLS) — §12 planu, etap 8.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  t   text;
  pol record;
  tabs text[] := ARRAY[
    -- runtime
    'brain_sessions',
    -- logi / telemetria
    'conversations','conversation_events','amber_intents','brain_logs',
    'intent_issues','intent_logs','live_perf_logs','system_logs',
    'unhandled_logs','freefun_events',
    -- config / wiedza
    'system_config','phrases','amber_alerts','amber_knowledge',
    -- backupy wewnętrzne (nieujęte w planie, obecne w live)
    'menu_items_v2_backup','menu_items_v2_backup2','menu_items_v2_backup_nlu',
    -- wymienione w planie, NIEOBECNE w live 2026-08-08 (pętla pominie z NOTICE)
    'system_events','debug_logs','local_promotions'
  ];
BEGIN
  FOREACH t IN ARRAY tabs LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'etap 8: tabela public.% nie istnieje w tej bazie — pomijam', t;
      CONTINUE;
    END IF;

    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

COMMIT;
