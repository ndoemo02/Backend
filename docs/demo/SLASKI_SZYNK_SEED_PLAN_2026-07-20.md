# Śląski Szynk — plan podmiany ukrytego tenanta demo

Data: 2026-07-20  
Projekt Supabase: `ezemaacyyvbpjlagchds`  
Tenant: `4ad6b301-671b-4343-bf91-9bab7cda37b4`

Status: **seed wykonany i zweryfikowany; tenant aktywny wyłącznie do publicznego podglądu demo**

## Cel

Zastąpić fikcyjny, nieaktywny lokal `Kebab u Orła` fikcyjnym lokalem demonstracyjnym `Śląski Szynk`, bez zmiany UUID restauracji i bez dotykania danych pozostałych lokali.

## Zasady bezpieczeństwa

- Restauracja pozostawała `is_active = false` podczas przygotowania danych. Aktywacja do podglądu jest osobnym, odwracalnym krokiem.
- Nie przypisujemy właściciela, profilu biznesowego, Google Place ID, telefonu ani strony WWW.
- Adres jawnie informuje, że jest to lokal demonstracyjny i zamówienia nie są realizowane.
- Stare zamówienie `Kebab u Orła` pozostaje historyczne, ale jego przeterminowany status `pending` zostaje zmieniony na `cancelled`, aby nie trafiło do KDS jako nowe.
- Podmiana menu odbywa się w jednej transakcji.
- Zdjęcia pozostają puste do osobnego audytu/generowania spójnej galerii.
- Rollback nie usuwa przyszłych zamówień testowych. Jeżeli powstaną po seedzie, przed rollbackiem trzeba je świadomie zarchiwizować lub anulować.

## Model menu

- 21 rodzin produktów.
- 31 rekordów `menu_items_v2`, ponieważ rozmiary i smaki są wariantami cenowymi.
- Każdy wariant ma wspólny `base_name`, `item_family` i docelowo wspólne zdjęcie.
- `name` zawiera również nazwę wariantu, dzięki czemu starszy widok nie pokazuje identycznych duplikatów.
- Dane bezpieczeństwa mają strukturę `safety_data.ingredients`, `safety_data.allergens`, `safety_data.dietary` i opcjonalne `warnings`.

## Pliki

- Seed: `SLASKI_SZYNK_SEED_2026-07-20.sql`
- Rollback: `SLASKI_SZYNK_ROLLBACK_2026-07-20.sql`

## Kolejność wdrożenia

1. Uruchomić seed próbnie w transakcji zakończonej `ROLLBACK`.
2. Zweryfikować liczbę rodzin, wariantów, tagów i brak aktywacji restauracji.
3. Uruchomić seed z `COMMIT`.
4. Sprawdzić odczyt restauracji po UUID i pełne menu.
5. Osobno dodać lokal do katalogu rozpoznawania nazw i przeprowadzić testy głos/tekst.
6. Dopiero po przygotowaniu grafik i testach świadomie ustawić `is_active = true` na czas prezentacji.

## Wynik wdrożenia

- Restauracja: `Śląski Szynk`.
- Widoczność: `is_active = false` (0 rekordów w kontroli aktywnego lokalu).
- Menu: 31 rekordów, 21 rodzin produktowych.
- Rodziny z wariantami: 8.
- Rekordy z `safety_data`: 31/31.
- Rekordy z nieprawidłową ceną lub brakującą rodziną/kategorią: 0.
- Zdjęcia: 0/31 — świadomie odłożone do etapu galerii.
- Stare zamówienie oczekujące: zachowane jako historia, status `cancelled`.
- Seed sprawdzony najpierw w transakcji zakończonej `ROLLBACK`.
- Rollback również sprawdzony w transakcji zakończonej `ROLLBACK`; po teście w bazie nadal znajduje się `Śląski Szynk` z 31 rekordami.

## Publiczny podgląd demo — 2026-07-20

- Tenant aktywowano odwracalnym skryptem `SLASKI_SZYNK_PREVIEW_TOGGLE_2026-07-20.sql`.
- Stan po aktywacji: `is_active = true`, 31 pozycji menu, 0 przypisanych zdjęć.
- Punkt GPS: przybliżone `50.387, 18.948`, wyłącznie do wyszukiwania demo; nie reprezentuje realnego adresu restauracji.
- Katalog rozpoznaje nazwę `Śląski Szynk` oraz jej polskie formy fleksyjne; ogólne zapytania o kuchnię śląską nie są przechwytywane jako nazwa lokalu.
- Testy backendu: 45/45 zaliczone (katalog, routing live, pełne menu, rozpoznawanie lokalu i blokada halucynacji napojów).
- Podgląd backendu: `https://backend-kf1wbsmo3-freeflow-build.vercel.app`.
- Podgląd frontendu: `https://freeflow-final-bq6ezjc73-freeflow-build.vercel.app` (artefakt prebuilt; w chwili zapisu Vercel raportował `INITIALIZING`).
- Szybkie ukrycie lokalu: wykonać zakomentowane polecenie `UPDATE ... SET is_active = false` z pliku przełącznika.
