-- ============================================================================
-- Etap 9 (§9 planu) — deny-all na tabelach wrażliwych (PII)
-- ⛔ NIE WYKONYWAĆ NA LIVE poza T10, za jawną, osobną zgodą użytkownika.
--
-- Źródła: SUPABASE_FINAL_DEMO_HARDENING_PLAN.md §3, §10.3
--         SUPABASE_LIVE_INVENTORY_2026-08-08.md §2, §3 (orders: 6 polityk,
--         w tym `Allow public read on orders` USING (true) — anon czyta PII),
--         §4 (full_orders_view wystawia PII, anon ma na nim pełne granty)
--
-- Korekty względem §10.3 planu (inventory ma pierwszeństwo):
--   1. `businesses`, `table_reservations`, `taxi_drivers` NIE ISTNIEJĄ w live
--      2026-08-08 — pętla pomija nieistniejące z NOTICE (plik pozostaje
--      poprawny, gdyby pojawiły się na innym środowisku).
--   2. Plan robił tylko ENABLE RLS + REVOKE, a na `orders`/`order_items`/
--      `users`/`profiles` istnieje dziś 10+ polityk permisywnych (w tym
--      duplikaty). Ta migracja usuwa WSZYSTKIE polityki na tabelach docelowych.
--      Świadomie usuwa to również "poprawne" polityki self-access na
--      `profiles` (auth.uid() = id) — model docelowy §3 planu to deny-all,
--      jedynym konsumentem `profiles` jest frontendowy AdminPanel, który po T5
--      przechodzi na endpointy backendu (service_role).
--   3. Dodatkowo (nieobecne w §10.3): REVOKE na widoku `full_orders_view`
--      już w tym etapie. Widok jest dziś security-definer i łączy orders+users
--      (PII); zostawienie anonowi SELECT-a na widoku do etapu 12 otwierałoby
--      okno, w którym tabela jest szczelna, a widok nie. Dziś zwraca 0 wierszy
--      (inner join z pustym order_items), ale to własność danych, nie schematu.
--      Etap 12 powtarza ten REVOKE idempotentnie.
--
-- Warunki wejścia: etapy 1 (T1 ✓), 2 (T2 ✓ z zastrzeżeniem decyzji nr 4 —
--   dwaj klienci poza write-setem), 5 (T5 ✗ — NIEWYKONANY, twarda blokada:
--   frontend nadal czyta orders/profiles bezpośrednio), 7 (T7 ✓ analiza).
--   Obowiązuje `integration-blocked-by-T3-T5` ze stanu prac.
-- Warunek wyjścia: testy negatywne §11 zielone; backend nadal tworzy
--   zamówienia przez service_role.
-- Rollback: restore_snapshot.sql z etapu 0; dodatkowo weryfikacja, czy
--   `privateServerClient` faktycznie ma service_role (§12 planu, etap 9).
--
-- Wykonanie wyłącznie pojedynczo za bramką T10 — nigdy przez zbiorczy db push
-- (decyzja użytkownika U2, handoff 2026-08-08).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  t   text;
  pol record;
  tabs text[] := ARRAY[
    'orders','order_items','profiles','users',
    -- wymienione w planie, NIEOBECNE w live 2026-08-08 (pętla pominie z NOTICE)
    'businesses','table_reservations','taxi_drivers'
  ];
BEGIN
  FOREACH t IN ARRAY tabs LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'etap 9: tabela public.% nie istnieje w tej bazie — pomijam', t;
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

-- Domknięcie okna PII przez widok (korekta nr 3 z nagłówka).
DO $$ BEGIN
  IF to_regclass('public.full_orders_view') IS NOT NULL THEN
    REVOKE ALL ON public.full_orders_view FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON public.full_orders_view TO service_role;
  END IF;
END $$;

COMMIT;
