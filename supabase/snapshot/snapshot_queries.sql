-- ============================================================================
-- Etap 0 (§9 planu) — zapytania snapshotu przed pierwszą zmianą
-- READ-ONLY. Mimo to: ⛔ NIE URUCHAMIAĆ NA LIVE bez jawnej zgody — nawet SELECT
-- na live wymaga zgody zgodnie z regułami sesji (§10.0 planu).
--
-- Cel: zmaterializować DOKŁADNY stan grantów / polityk / widoków / funkcji
-- sprzed pierwszej migracji, jako dane wejściowe do restore_snapshot.sql
-- (RESTORE_SNAPSHOT_TEMPLATE.sql w tym katalogu). Zasada §12 planu:
-- rollback = odtworzenie stanu sprzed zmiany, nie generyczne otwarcie dostępu.
--
-- Inventory z 2026-08-08 pokrywa część tych danych, ale NIE wystarcza jako
-- snapshot: (a) granty odpytano tylko dla anon/authenticated, (b) nie zebrano
-- kolumn restaurants/menu_items_v2, (c) nie zebrano default privileges,
-- (d) nie zebrano ACL funkcji. Stąd komplet poniżej.
-- ============================================================================

-- Q1. Pełne granty tabelowe — WSZYSTKIE role (restore musi znać też service_role
--     i ewentualne role niestandardowe).
SELECT table_schema, table_name, grantee, privilege_type, is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
ORDER BY table_name, grantee, privilege_type;

-- Q2. Granty kolumnowe (jeśli istnieją — restore po etapie 10 ich wymaga).
SELECT table_name, column_name, grantee, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public'
ORDER BY table_name, column_name, grantee;

-- Q3. Wszystkie polityki RLS z pełnymi wyrażeniami (30 wg inventory).
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Q4. Stan RLS per tabela.
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
ORDER BY relname;

-- Q5. Definicje widoków + reloptions (security_invoker) + właściciel.
SELECT c.relname, pg_get_viewdef(c.oid) AS definition, c.reloptions,
       pg_get_userbyid(c.relowner) AS owner
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v';

-- Q6. Funkcje projektu: sygnatura, security definer, proconfig, ACL.
SELECT p.oid::regprocedure AS signature, p.prosecdef, p.proconfig, p.proacl
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('ensure_restaurant_exists','get_order_stats','update_updated_at_column');

-- Q7. Kolumny restaurants / menu_items_v2 — warunek wejścia etapu 10
--     (weryfikacja, że każda kolumna z list GRANT istnieje w live).
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('restaurants','menu_items_v2')
ORDER BY table_name, ordinal_position;

-- Q8. Default privileges — czy nowe obiekty dostają automatycznie granty dla
--     anon/authenticated (wyjaśnia, skąd wziął się komplet uprawnień z §2
--     inventory, i czy REVOKE nie zostanie „odtworzony" przy kolejnym CREATE).
SELECT pg_get_userbyid(d.defaclrole) AS grantor, n.nspname, d.defaclobjtype, d.defaclacl
FROM pg_default_acl d
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace;

-- Q9. Granty na sekwencjach (restore kompletny; dziś PK to uuid, więc
--     spodziewany wynik bliski pustego). information_schema.role_usage_grants
--     zwraca wyłącznie uprawnienie USAGE i tylko dla ról bieżącego użytkownika
--     (zawężenie roli, nie schematu) — niekompletne jako źródło restore
--     (review T8, nit-2). Czytamy ACL wprost z pg_class: pełny zestaw
--     uprawnień (USAGE, SELECT, UPDATE), bez zawężenia do ról wołającego.
SELECT c.relname AS sequence_name, c.relacl
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'S'
ORDER BY c.relname;
