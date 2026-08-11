-- ============================================================================
-- restore_snapshot.sql — ZMATERIALIZOWANY (etap 0, §10.7 planu).
-- Wypełniony na podstawie faktycznego wykonania Q1-Q9 z snapshot_queries.sql
-- na live projekcie ezemaacyyvbpjlagchds (read-only, za jawną zgodą C4).
--
-- Data snapshotu: 2026-08-11
-- Hash: DO OBLICZENIA PO COMMICIE — `git cat-file blob HEAD:supabase/snapshot/restore_snapshot.sql | sha256sum`
--       (nie Get-FileHash — CRLF, patrz docs/RLS_HARDENING_STATE.md). Plik jeszcze
--       nie zacommitowany w momencie zapisu tego nagłówka.
--
-- ⛔ NIE WYKONYWAĆ poza rollbackiem etapów 8-12 (T10), za jawną, osobną zgodą
-- użytkownika. Ten plik jest teraz WYKONYWALNY SKŁADNIOWO (wszystkie sekcje
-- zmaterializowane), ale pozostaje wyłącznie procedurą awaryjną/rollbackową,
-- nie krokiem T10 uruchamianym rutynowo.
--
-- Zasada §12 planu: rollback = odtworzenie DOKŁADNEGO stanu sprzed zmiany,
-- nie generyczne otwarcie dostępu. DISABLE ROW LEVEL SECURITY to wyłącznie
-- ręczna procedura break-glass, nigdy krok tego pliku.
--
-- Źródła zmaterializowanych sekcji (Q1-Q9 wykonane w tej samej sesji,
-- surowe wyniki w scratchpadzie sesji roboczej, nie w repo):
--   Q1 (role_table_grants, 756 wierszy)      -> Sekcja A (granty tabelowe) + Sekcja D (granty widoków)
--   Q2 (column_privileges, 4512 wierszy)     -> zweryfikowane jako W CAŁOŚCI pochodna Q1
--                                                (zero wierszy Q2 poza zbiorem (tabela,grantee,
--                                                privilege_type) z Q1 — rekoncyliacja 1:1,
--                                                patrz raport sesji). Stąd Sekcja A nie zawiera
--                                                osobnych GRANT-ów kolumnowych — byłyby redundantne
--                                                wobec grantów tabelowych, zero utraconej informacji.
--   Q3 (pg_policies, 30 wierszy)             -> Sekcja B (CREATE POLICY)
--   Q4 (RLS state, 25 wierszy)               -> Sekcja C (ENABLE/DISABLE ROW LEVEL SECURITY)
--   Q5 (widoki, 2 wiersze)                   -> Sekcja D (RESET security_invoker)
--   Q6 (funkcje, 3 wiersze)                  -> Sekcja E (RESET search_path + GRANT EXECUTE)
--   Q7 (kolumny restaurants/menu_items_v2)   -> nie zasila restore (to warunek wejścia etapu 10,
--                                                nie stan do odtworzenia — wynik: PASS, 26/26 OK)
--   Q8 (default privileges, 24 wiersze)      -> nie zasila restore (poza zakresem szablonu —
--                                                dotyczy PRZYSZŁYCH obiektów, nie stanu grantów
--                                                na istniejących tabelach/widokach/funkcjach/
--                                                sekwencjach, które ten plik odtwarza)
--   Q9 (granty sekwencji, 2 wiersze)         -> Sekcja F
--
-- Procedura wypełnienia (dla przyszłych re-snapshotów) — bez zmian względem
-- oryginalnego szablonu, patrz git history tego pliku / RESTORE_SNAPSHOT_TEMPLATE.sql.
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

-- === SEKCJA A — granty tabelowe (z Q1, role anon/authenticated) ============
-- Zakres: WYŁĄCZNIE anon/authenticated — dokładnie te role, które sekcja 0
-- rewokuje. Granty dla postgres/service_role pominięte świadomie: żadna
-- migracja 8-11 ich nie rewokuje (service_role dostaje GRANT ALL na nowo,
-- postgres nigdy nie jest dotykany), więc nie ma czego odtwarzać — dodanie
-- tych wierszy byłoby no-opem, nie błędem, ale też nie odtwarza żadnego
-- realnego rollbacku (postuluje się scope minimalny, zgodny z §12 planu:
-- rollback = dokładny stan sprzed zmiany W ZAKRESIE TEGO, CO ZMIANA DOTYKA).
-- Zweryfikowane w Q1: WSZYSTKIE wiersze anon/authenticated mają
-- is_grantable = 'NO' (zero WITH GRANT OPTION) — proste GRANT bez klauzuli
-- WITH GRANT OPTION jest więc dokładnym odtworzeniem, nie nadinterpretacją.
-- 25 tabel, po jednym skonsolidowanym GRANT na (tabela, rola) — 50 wierszy
-- Q1 dla tych 25 tabel dawały identyczny zestaw 7 uprawnień na każdej
-- (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER) dla obu ról.
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.amber_alerts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.amber_alerts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.amber_intents TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.amber_intents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.amber_knowledge TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.amber_knowledge TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.brain_logs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.brain_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.brain_sessions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.brain_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.conversation_events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.conversation_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.conversations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.freefun_events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.freefun_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.intent_issues TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.intent_issues TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.intent_logs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.intent_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.live_perf_logs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.live_perf_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.menu_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.menu_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.menu_items_v2 TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.menu_items_v2 TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.menu_items_v2_backup TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.menu_items_v2_backup TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.menu_items_v2_backup2 TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.menu_items_v2_backup2 TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.menu_items_v2_backup_nlu TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.menu_items_v2_backup_nlu TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.order_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.order_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.orders TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.phrases TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.phrases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.restaurants TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.restaurants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.system_config TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.system_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.system_logs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.system_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.unhandled_logs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.unhandled_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.users TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.users TO authenticated;

-- === SEKCJA B — polityki RLS (z Q3, 30 polityk dosłownie) ===================
-- qual/with_check wklejone bez interpretacji z pg_policies.qual/with_check.
-- Bezpieczeństwo wykonania: CREATE POLICY nie ma IF NOT EXISTS w Postgresie —
-- ta sekcja jest bezpieczna do powtórnego uruchomienia WYŁĄCZNIE dlatego, że
-- Sekcja 0 (wyżej, w tej samej transakcji) dropuje wszystkie polityki na
-- tych samych 8 tabelach (menu_items, menu_items_v2, order_items, orders,
-- phrases, profiles, restaurants, users) PRZED tą sekcją — zweryfikowane:
-- wszystkie 8 nazw tabel z Q3 są objęte tablicą `tabs` w Sekcji 0. Plik jako
-- całość jest więc idempotentny; CREATE POLICY osobno — nie jest i nie musi być.
CREATE POLICY "Allow public read on menu_items" ON public.menu_items
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "Allow read access for all" ON public.menu_items
  FOR SELECT TO public
  USING (true);

CREATE POLICY "Allow public select for menu_items_v2" ON public.menu_items_v2
  FOR SELECT TO public
  USING (true);

CREATE POLICY "Allow service role full access for menu_items_v2" ON public.menu_items_v2
  FOR ALL TO service_role
  USING (true);

CREATE POLICY "Owner Delete Menu" ON public.menu_items_v2
  FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1 FROM restaurants r WHERE ((r.id = menu_items_v2.restaurant_id) AND (r.owner_id = auth.uid())))));

CREATE POLICY "Owner Insert Menu" ON public.menu_items_v2
  FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1 FROM restaurants r WHERE ((r.id = menu_items_v2.restaurant_id) AND (r.owner_id = auth.uid())))));

CREATE POLICY "Owner Update Menu" ON public.menu_items_v2
  FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1 FROM restaurants r WHERE ((r.id = menu_items_v2.restaurant_id) AND (r.owner_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1 FROM restaurants r WHERE ((r.id = menu_items_v2.restaurant_id) AND (r.owner_id = auth.uid())))));

CREATE POLICY "Public Read Menu" ON public.menu_items_v2
  FOR SELECT TO public
  USING (true);

CREATE POLICY "Allow public read on order_items" ON public.order_items
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "Allow public insert for orders" ON public.orders
  FOR INSERT TO public
  WITH CHECK (true);

CREATE POLICY "Allow public read on orders" ON public.orders
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "Allow users to see their own orders" ON public.orders
  FOR SELECT TO public
  USING ((auth.uid() = user_id));

CREATE POLICY "Orders: admin full access" ON public.orders
  FOR ALL TO public
  USING ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = orders.business_id) AND (p.role = 'admin'::text)))))
  WITH CHECK ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = orders.business_id) AND (p.role = 'admin'::text)))));

CREATE POLICY "Orders: business read own restaurants" ON public.orders
  FOR SELECT TO public
  USING ((EXISTS ( SELECT 1 FROM restaurants r WHERE ((r.id = orders.restaurant_id) AND (r.business_id = auth.uid())))));

CREATE POLICY "Orders: business view own" ON public.orders
  FOR SELECT TO public
  USING ((EXISTS ( SELECT 1 FROM restaurants r WHERE ((r.id = orders.restaurant_id) AND (r.business_id = auth.uid())))));

CREATE POLICY "Orders: insert from backend" ON public.orders
  FOR INSERT TO public
  WITH CHECK (true);

CREATE POLICY "Allow public read on phrases" ON public.phrases
  FOR SELECT TO anon
  USING (true);

CREATE POLICY "Profiles: admin select all" ON public.profiles
  FOR SELECT TO public
  USING ((current_setting('jwt.claims.role'::text, true) = 'admin'::text));

CREATE POLICY "Profiles: delete admin-only" ON public.profiles
  FOR DELETE TO public
  USING (((auth.role() = 'authenticated'::text) AND (current_setting('jwt.claims.role'::text, true) = 'admin'::text)));

CREATE POLICY "Profiles: insert own" ON public.profiles
  FOR INSERT TO public
  WITH CHECK ((auth.uid() = id));

CREATE POLICY "Profiles: select own" ON public.profiles
  FOR SELECT TO public
  USING ((auth.uid() = id));

CREATE POLICY "Profiles: update own" ON public.profiles
  FOR UPDATE TO public
  USING ((auth.uid() = id))
  WITH CHECK ((auth.uid() = id));

CREATE POLICY "Allow public select for restaurants" ON public.restaurants
  FOR SELECT TO public
  USING (true);

CREATE POLICY "Allow read access for all" ON public.restaurants
  FOR SELECT TO public
  USING (true);

CREATE POLICY "Allow service role full access for restaurants" ON public.restaurants
  FOR ALL TO service_role
  USING (true);

CREATE POLICY "Owner Delete Restaurant" ON public.restaurants
  FOR DELETE TO authenticated
  USING ((auth.uid() = owner_id));

CREATE POLICY "Owner Insert Restaurant" ON public.restaurants
  FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = owner_id));

CREATE POLICY "Owner Update Restaurant" ON public.restaurants
  FOR UPDATE TO authenticated
  USING ((auth.uid() = owner_id))
  WITH CHECK ((auth.uid() = owner_id));

CREATE POLICY "Public Read" ON public.restaurants
  FOR SELECT TO public
  USING (true);

CREATE POLICY "Allow public read on users" ON public.users
  FOR SELECT TO anon
  USING (true);

-- === SEKCJA C — stan RLS per tabela (z Q4, 25 tabel) =========================
-- relforcerowsecurity = false na WSZYSTKICH 25 tabelach w Q4 — zero
-- FORCE ROW LEVEL SECURITY do odtworzenia, żadna instrukcja NO FORCE
-- nie jest potrzebna (to już domyślny stan Postgresa).
ALTER TABLE public.amber_alerts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.amber_intents DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.amber_knowledge DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.freefun_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.intent_issues DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.intent_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_perf_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items_v2_backup DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items_v2_backup2 DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items_v2_backup_nlu DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phrases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.unhandled_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- === SEKCJA D — widoki (z Q5 + Q1) ==========================================
-- reloptions = NULL dla obu widoków w Q5 (brak jawnego security_invoker) ->
-- RESET przywraca brak jawnego override (stan domyślny), zgodnie z procedurą
-- szablonu. Granty z Q1, ten sam zakres ról co Sekcja A (anon/authenticated,
-- is_grantable=NO wszędzie w Q1 dla tych ról).
ALTER VIEW public.full_orders_view RESET (security_invoker);
ALTER VIEW public.amber_tts_daily RESET (security_invoker);

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.amber_tts_daily TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.amber_tts_daily TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.full_orders_view TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.full_orders_view TO authenticated;

-- === SEKCJA E — funkcje (z Q6, 3 funkcje) ===================================
-- proconfig = NULL dla wszystkich 3 -> RESET search_path (brak jawnego
-- override w snapshocie).
--
-- PUBLIC EXECUTE JEST CZĘŚCIĄ SNAPSHOTU I MUSI BYĆ ODTWORZONE.
-- proacl wszystkich 3 funkcji w snapshocie:
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,
--    service_role=X/postgres}
-- Wiodące `=X` (pusty grantee) to EXECUTE dla PUBLIC — domyślny stan Postgresa
-- dla funkcji, obecny w live. Etap 12
-- (20260808000600_stage12_views_functions.sql:98) wykonuje
-- `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` na
-- `ensure_restaurant_exists` i `update_updated_at_column` — bez GRANT-u do
-- PUBLIC rollback zostawiłby ACL tych funkcji TRWALE WĘŻSZE niż stan sprzed
-- migracji, wbrew §12 planu (rollback = DOKŁADNY stan sprzed zmiany).
--
-- `get_order_stats` CELOWO bez GRANT-u do PUBLIC — to NIE jest przeoczenie:
-- etap 12 jej nie rewokuje (korekta nr 3 w nagłówku tamtego pliku; decyzja
-- §13.7 pozostaje otwarta), więc jej PUBLIC EXECUTE przechodzi przez całą
-- planowaną sekwencję nietknięty i nie ma czego odtwarzać. Gdyby kiedykolwiek
-- wykonano WARIANT 1 z pending_decisions/get_order_stats_execute_grant.sql
-- (`REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`), TEN plik wymaga
-- wtedy dopisania trzeciego `GRANT ... TO PUBLIC`. Restore odtwarza zakres
-- FAKTYCZNIE WYKONYWANY, nie przyszłe decyzje.
--
-- postgres/service_role poza zakresem — uzasadnienie jak w Sekcji A (żadna
-- migracja ich nie rewokuje; zweryfikowane na danych Q1/Q6).
ALTER FUNCTION public.ensure_restaurant_exists() RESET search_path;
GRANT EXECUTE ON FUNCTION public.ensure_restaurant_exists() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_restaurant_exists() TO anon;
GRANT EXECUTE ON FUNCTION public.ensure_restaurant_exists() TO authenticated;
ALTER FUNCTION public.get_order_stats() RESET search_path;
GRANT EXECUTE ON FUNCTION public.get_order_stats() TO anon;
GRANT EXECUTE ON FUNCTION public.get_order_stats() TO authenticated;
ALTER FUNCTION public.update_updated_at_column() RESET search_path;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO anon;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO authenticated;

-- === SEKCJA F — sekwencje (z Q9, 2 sekwencje) ===============================
-- relacl pokazuje `rwU` (SELECT, UPDATE, USAGE) dla anon/authenticated na
-- obu sekwencjach. PK projektu to uuid — zgodnie z przewidywaniem szablonu
-- wynik Q9 jest bliski pustego (tylko 2 sekwencje spoza kolumn PK).
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.conversation_events_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.conversation_events_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.live_perf_logs_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.live_perf_logs_id_seq TO authenticated;

COMMIT;
