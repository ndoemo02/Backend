# Fikcyjne restauracje FreeFlow — projekt danych demo

Data: 2026-07-20  
Projekt Supabase: `ezemaacyyvbpjlagchds`

## Zrozumienie i zakres

- Cztery fikcyjne lokale powstają równolegle do działającego `Śląskiego Szynku`.
- Celem jest sprawdzenie, czy tekst, Voice Live, discovery, menu, koszyk i KDS obsługują nowe tenanty bez wyjątków.
- Menu są kompaktowe: około 12–14 rodzin produktów na lokal, z wariantami tylko tam, gdzie testują realne zachowanie.
- Wszystkie dane są demonstracyjne; zamówienia i płatności nie są realizowane przez prawdziwe restauracje.
- Każda pozycja ma jawne alergeny, dietę i składniki w `safety_data`.
- Grafiki pozostają puste do osobnego, spójnego przebiegu generowania.
- Obecne restauracje i ich historia nie są modyfikowane.

## Tenanty

| Lokal | UUID | Koncept | Główne testy |
|---|---|---|---|
| Silesiana Italiana | `acced74f-ddac-43a0-9f78-016c397f4b8e` | włosko-śląskie fusion | pizza 32/40 cm, makarony, vege, gluten |
| Ruszt i Ogień | `6cce66fb-4d2d-402f-abe5-22e9784d559c` | grill i otwarty ogień | gramatura, ostrość, wysmażenie jako instrukcja |
| Syto po Naszymu | `a2be7ddb-d1dd-49d6-9026-57ecd4c94d60` | domowe obiady | porcje, wariant pierogów, zestaw rodzinny |
| Kebs & Roll | `72c76694-f533-46b8-b831-1965210a0cb4` | nowoczesny street food | M/L/XL, mięso/falafel, sos i ostrość |

Współrzędne są przybliżonymi punktami testowymi w obszarze obsługi. Nie reprezentują prawdziwych adresów.

## Założenia niefunkcjonalne

- Skala: pięć fikcyjnych tenantów i poniżej 120 pozycji menu łącznie.
- Wydajność: pełne menu jednego lokalu ma wracać w pojedynczym odczycie bez paginacji backendowej.
- Bezpieczeństwo: brak właścicieli, profili biznesowych, telefonów, stron WWW i Google Place ID.
- Niezawodność: seed działa w jednej transakcji, waliduje liczby i aktywuje lokale dopiero po poprawnym insercie.
- Utrzymanie: stabilne UUID restauracji, rollback usuwa wyłącznie cztery tenanty i ich menu.
- Prywatność: brak danych użytkowników i prawdziwych danych kontaktowych.

## Decision log

1. Wybrano nowe UUID zamiast nadpisywania prawdziwych lokali — zachowuje historię i ułatwia ukrycie danych realnych.
2. Wybrano kompaktowe menu zamiast pełnych kart — mniejszy koszt audytu, a zachowane są kluczowe przypadki testowe.
3. Warianty są osobnymi rekordami ze wspólnym `base_name` i `item_family` — zgodność ze starszym backendem i przyszłym grupowaniem UI.
4. Napoje istnieją w każdym lokalu — umożliwia test blokady zamawiania posiłku i napoju z różnych restauracji.
5. Brak alkoholu — demo nie wymaga weryfikacji wieku.
6. Brak grafik na etapie seeda — dane najpierw przechodzą test funkcjonalny; galeria otrzyma osobny visual bible.

## Pliki wykonawcze

- `FICTIONAL_DEMO_RESTAURANTS_SEED_2026-07-20.sql`
- `FICTIONAL_DEMO_RESTAURANTS_ROLLBACK_2026-07-20.sql`

## Wynik wdrożenia i testu — 2026-07-20

Seed wykonano transakcyjnie w projekcie Supabase `ezemaacyyvbpjlagchds`. Cztery lokale są aktywne, a `menu_items_v2` zawiera łącznie 74 nowe, dostępne pozycje:

| Lokal | Rekordy menu | Rodziny produktów | Obrazy | Błędy `safety_data` |
|---|---:|---:|---:|---:|
| Silesiana Italiana | 17 | 13 | 0 | 0 |
| Ruszt i Ogień | 17 | 12 | 0 | 0 |
| Syto po Naszymu | 18 | 13 | 0 | 0 |
| Kebs & Roll | 22 | 13 | 0 | 0 |

Weryfikacja lokalnego endpointu Live `show_menu` zwróciła właściwy lokal, stabilny UUID i pełne menu dla wszystkich czterech przypadków. `find_nearby` zwrócił wszystkie cztery miejsca na liście 15 aktywnych lokali. Testy zapytań produktowych potwierdziły mapowania:

- `lasagne` → Silesiana Italiana,
- `ostre skrzydełka` → Ruszt i Ogień,
- `zestaw rodzinny dla czterech` → Syto po Naszymu,
- `rollo falafel` → Kebs & Roll (obok innych pasujących menu).

Obrazy pozostają celowo puste do osobnego, spójnego przebiegu galerii.
