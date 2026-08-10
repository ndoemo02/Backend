-- ============================================================================
-- Etap 10 (§9 planu) — katalog publiczny: restaurants + menu_items_v2
-- ⛔ NIE WYKONYWAĆ NA LIVE poza T10, za jawną, osobną zgodą użytkownika.
--
-- Źródła: SUPABASE_FINAL_DEMO_HARDENING_PLAN.md §3 (tabela kolumn), §10.4
--         SUPABASE_LIVE_INVENTORY_2026-08-08.md §3 (restaurants: 4 duplikaty
--         polityk publicznego odczytu; menu_items_v2: 2 duplikaty; polityki
--         właścicielskie owner_id = auth.uid() na INSERT/UPDATE/DELETE)
--
-- Korekty względem §10.4 planu (inventory ma pierwszeństwo):
--   1. Plan dropował tylko własną politykę po nazwie. Live ma po kilka
--      nakładających się polityk publicznego odczytu (duplikaty) — ta migracja
--      usuwa WSZYSTKIE istniejące polityki na obu tabelach i odtwarza wyłącznie
--      kanoniczny publiczny odczyt.
--   2. Świadoma zmiana semantyki: usunięcie polityk właścicielskich
--      (owner_id = auth.uid()) + REVOKE zapisu oznacza, że bezpośredni zapis
--      z przeglądarki (dziś RestaurantManager.jsx:365-369) przestaje działać.
--      To jest model docelowy §1/§3 planu (zapisy wyłącznie backend,
--      service_role, walidacja owner_id na endpointzie) — i dokładnie dlatego
--      etap 5 (T5) jest twardym warunkiem wejścia.
--
-- Warunki wejścia:
--   - etap 5 / T5 (✗ na dziś): jawne `.select()` zamiast `select('*')`
--     ORAZ przepięcie zapisów RestaurantManager na backend. Bez tego ten plik
--     objawi się jako "puste menu"/martwy panel właściciela, nie jako błąd
--     uprawnień.
--   - Jednorazowa weryfikacja przed T10: kolumny z list GRANT poniżej istnieją
--     w live (inventory §10.0 nie obejmował kolumn restaurants/menu_items_v2;
--     zapytanie w supabase/snapshot/snapshot_queries.sql §Q7). Nieistniejąca
--     kolumna = błąd całej transakcji (fail-closed, bez częściowego stanu).
-- Warunek wyjścia: testy pozytywne §11 zielone; karty menu renderują wszystkie
--   potrzebne pola; anon NIE czyta owner_id (test negatywny §11).
-- Rollback: restore_snapshot.sql; jeśli przyczyną regresji jest brakująca
--   kolumna w grancie — DOPISAĆ kolumnę, nie wyłączać RLS (§12 planu, etap 10).
--
-- Wykonanie wyłącznie pojedynczo za bramką T10 — nigdy przez zbiorczy db push
-- (decyzja użytkownika U2, handoff 2026-08-08).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ---------------------------------------------------------------- restaurants
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'restaurants'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.restaurants', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restaurants FROM PUBLIC, anon, authenticated;

-- Column-level grant: kontrakt live-safe (CLAUDE.md §7 + §3 planu), poszerzony
-- decyzją użytkownika U1 (handoff 2026-08-08): is_active MOŻE być widoczne dla
-- anon. Bez niego klienckie `.eq('is_active', true)` (backend
-- api/server-vercel.js:788, frontend ClientPanel.tsx:140-144) pada z 42501 —
-- uprawnienia kolumnowe w PG są sprawdzane też dla kolumn użytych w WHERE, nie
-- tylko w SELECT-liście. RLS i tak zwraca wyłącznie wiersze is_active = true
-- (patrz USING poniżej) — grant kolumnowy tylko odblokowuje filtr po stronie
-- klienta, nie zmienia zbioru widocznych wierszy.
-- Poszerzony decyzją użytkownika po audycie B1 (2026-08-10): image_url
-- zatwierdzone jako PUBLIC (karta restauracji w ClientPanel.tsx renderuje ją
-- bez logowania, klientem anon).
-- Celowo BEZ: owner_id, aliases, created_at, description, phone, website,
-- maps_rating, maps_ratings_total, photo_gallery, opening_hours — wzbogacenie
-- karty i dane właścicielskie czyta backend (repository.js, service_role),
-- nie przeglądarka. Rozszerzenie tej listy to decyzja §13 planu (T5/T10),
-- nie korekta ad hoc (patrz audyt B1: owner_id/aliases wymagają osobnego
-- backend-scoped path, nie grantu anon).
GRANT SELECT (
  id, name, address, city, cuisine_type, lat, lng,
  delivery_available, price_level, is_active,
  taxonomy_groups, taxonomy_cats, taxonomy_tags, image_url
) ON public.restaurants TO anon, authenticated;

CREATE POLICY restaurants_public_read ON public.restaurants
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

GRANT ALL ON public.restaurants TO service_role;

-- -------------------------------------------------------------- menu_items_v2
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'menu_items_v2'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.menu_items_v2', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.menu_items_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_items_v2 FROM PUBLIC, anon, authenticated;

-- description i image_url są tu celowo WLICZONE (karty menu ich używają —
-- RestaurantManager.jsx:522-538, findHandler.js:508); wykluczenie description
-- w CLAUDE.md §7 dotyczy read-path `restaurants`, nie menu.
GRANT SELECT (
  id, restaurant_id, name, description, price_pln, category, available,
  image_url, section_order, item_family, item_tags, dietary_flags
) ON public.menu_items_v2 TO anon, authenticated;

CREATE POLICY menu_items_v2_public_read ON public.menu_items_v2
  FOR SELECT TO anon, authenticated
  USING (available = true);

GRANT ALL ON public.menu_items_v2 TO service_role;

COMMIT;
