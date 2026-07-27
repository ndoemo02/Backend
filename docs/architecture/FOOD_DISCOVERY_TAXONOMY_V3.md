# FreeFlow Food Discovery Taxonomy V3

Status: **kontrakt wdrożeniowy dla publicznego demo**  
Źródło historyczne: `taxonomy freeflow.pdf` (dokument projektowy poza repozytorium)  
Aktualne źródło wykonawcze: `api/brain/discovery/queryUnderstanding.ts`

## 1. Cel

Taksonomia ma zamieniać krótkie polecenia tekstowe i głosowe na deterministyczne
filtry wyszukiwania. Model językowy nie jest źródłem prawdy o lokalach, menu,
cenach, alergenach ani dostępności.

Docelowy przepływ:

```text
użytkownik
  -> Gemini wybiera narzędzie i przekazuje pełną wypowiedź
  -> parser deterministyczny rozpoznaje filtry
  -> baza danych weryfikuje lokale i pozycje menu
  -> backend zwraca ustrukturyzowany wynik oraz status filtrów
  -> interfejs pokazuje wynik
  -> Gemini opisuje wyłącznie zweryfikowane dane
```

Podział odpowiedzialności:

- **Gemini**: język, doprecyzowanie niejednoznaczności, naturalna narracja i wybór
  narzędzia.
- **Parser**: szybkie i powtarzalne mapowanie tekstu na zamknięte identyfikatory.
- **Baza danych**: jedyne źródło prawdy o lokalu, pozycji, cenie, wariancie,
  dostępności i oznaczeniach bezpieczeństwa żywności.
- **Frontend**: czytelnie rozróżnia to, co rozpoznano w pytaniu, od tego, co
  potwierdzono w wynikach.

## 2. Kanoniczny kontrakt zapytania

Obecny kontrakt pozostaje kompatybilny:

```ts
interface ParsedDiscoveryQuery {
  topGroups: TopGroupID[];
  categories: CategoryID[];
  tags: CoreTag[];
  vibes: VibeID[];
  dietarys: DietaryID[];
  open_now: boolean;
  confidence: 'empty' | 'partial' | 'deterministic';
  rawText: string;
}
```

Rozszerzenie V3, wdrażane etapami:

```ts
type PriceBand = 'budget' | 'mid' | 'premium';
type DiscoverySort = 'distance' | 'price' | 'rating';
type Proximity = 'near';

interface ParsedDiscoveryQueryV3 extends ParsedDiscoveryQuery {
  priceBand: PriceBand | null;
  sort: DiscoverySort | null;
  proximity: Proximity | null;
  unresolved: string[];
  source: 'text' | 'live';
}
```

Znaczenie pól:

- `priceBand` opisuje intencję cenową, nie konkretną cenę.
- `sort` wybiera kolejność dopiero po pobraniu zweryfikowanych wartości.
- `proximity: near` wymaga współrzędnych użytkownika i lokalu. Samo słowo
  „blisko” nie jest dowodem odległości.
- `unresolved` przechowuje fragmenty wymagające doprecyzowania.
- `source` służy diagnostyce; nie zmienia semantyki parsera.

## 3. Reguły filtrowania

1. Parser pracuje na pełnej wypowiedzi użytkownika. Argument pomocniczy
   `cuisine` nie może zastępować `rawText`.
2. Identyfikatory rozpoznane przez model muszą zostać zwalidowane względem
   zamkniętych enumów parsera.
3. Wymagania dietetyczne i alergiczne są twardymi filtrami.
4. Brak metadanych nie oznacza dopasowania. Dla kryteriów bezpieczeństwa
   `unknown != match`.
5. `open_now` jest prawdziwe wyłącznie po weryfikacji godzin otwarcia. Do tego
   czasu może być oznaczone jako nierozstrzygnięte, ale nie deklarowane jako
   potwierdzone.
6. Odległość, cena i ocena są obliczane lub odczytywane z danych, nigdy
   dopowiadane przez Gemini.
7. Wyszukiwanie pozycji pomiędzy lokalami musi używać metadanych pozycji
   (`item_tags`, `dietary_flags`, `spicy`, cena, dostępność), a nie tylko
   taksonomii restauracji.

## 4. Kontrakt informacji zwrotnej

Filtr przechodzi przez jawne stany:

```ts
type FilterResolution = 'recognized' | 'verified' | 'no_match' | 'unknown';

interface DiscoveryFilterFeedback {
  id: string;
  dimension: string;
  label: string;
  state: FilterResolution;
  resolvedValue?: string;
}
```

Przykłady:

- `Blisko` po parsowaniu: `recognized`.
- po obliczeniu: `verified`, `resolvedValue: "0,8 km"`.
- `Bez glutenu` bez oznaczeń pozycji: `unknown`, a nie `verified`.
- brak pozycji spełniających filtr: `no_match`.

Frontend może pokazać maksymalnie kilka najważniejszych oznaczeń, ale backend
zwraca pełną listę rozstrzygnięć. Chipsy menu i chipsy zapytania pozostają
osobnymi komponentami i kontraktami.

## 5. Fallback modelu

Model jest używany tylko wtedy, gdy parser zwraca `empty`, `partial` z istotnym
`unresolved` albo użytkownik wyraźnie prosi o poradę opisową.

Fallback:

1. otrzymuje dozwolone wartości enumów;
2. zwraca wyłącznie propozycję ustrukturyzowanego filtra;
3. wynik przechodzi walidację schematu;
4. baza wykonuje właściwe wyszukanie;
5. model nie tworzy nazw dań ani lokali.

RAG, embeddingi, graf wiedzy i dodatkowy mały model nie są potrzebne do
zamknięcia obecnego demo. Mogą później wspierać opisy regionalne i porównania,
ale nie zastępują filtrów transakcyjnych.

## 6. Powiązanie z zamawianiem

Taksonomia odpowiada za znalezienie kandydatów. Mutacja koszyka jest osobnym,
deterministycznym kontraktem:

```text
prepare draft -> validate current menu/price/availability
-> one explicit confirmation -> atomic commit
```

Pytania informacyjne nie mogą wykonywać mutacji. Częściowe dodanie zamówienia
przy brakującej pozycji jest niedozwolone. Dostępność stolika nie jest objęta
demo, dopóki nie istnieje autorytatywne źródło danych.

## 7. Ślad diagnostyczny

Docelowo backend zapisuje zdarzenia decyzyjne append-only z identyfikatorami
`trace_id`, `session_id` i `turn_id`, typem zdarzenia, aktorem, wersją taksonomii
oraz bezpiecznym payloadem. Nie zapisujemy pełnego audio, sekretów ani danych,
które nie są potrzebne do odtworzenia decyzji.

To nie jest pełny event sourcing. Stan biznesowy pozostaje w istniejących
tabelach, a dziennik służy audytowi i regresji.

## 8. Etapy wdrożenia

1. Zamrożenie kontraktu i testów regresji.
2. `priceBand`, `sort`, `proximity` oraz zachowanie pełnego `rawText`.
3. Weryfikacja filtrów na poziomie `menu_items_v2`.
4. Odpowiedź `recognized -> verified/no_match/unknown`.
5. Jeden frontendowy store i kompaktowe oznaczenia przy Voice Docku.
6. Atomowy `pendingOrder` i ustrukturyzowany fokus pozycji menu.
7. Pełny smoke test tekst/Live i osobna bramka bezpieczeństwa publicznego demo.

Po każdym etapie uruchamiane są testy taksonomii i istniejące testy zgodności
adapterów. Etapy nie wymagają przebudowy wizualnej Voice Docka.

## 9. Poza zakresem demo

- klikalny system filtrów zastępujący rozmowę;
- przebudowa całego UI;
- RAG/embeddingi/graf wiedzy jako warstwa transakcyjna;
- automatyczne uczenie parsera z rozmów;
- deklarowanie dostępności stolików;
- pełny katalog Krakowa i okolic;
- produkcyjne przechowywanie historii rozmów i audio.

## 10. Punkty powrotu

Utworzone przed pracą:

- frontend: `safety/pre-taxonomy-2026-07-27`
  (`9627d54c0fc7c8ef4a543d7bda0edf49789a4cc0`);
- backend: `safety/pre-taxonomy-2026-07-27`
  (`d866402231ac7ec982f817d475f9eb5f20cdf71f`);
- snapshot niezatwierdzonego backendu:
  `safety/pre-taxonomy-worktree-2026-07-27`
  (`0ef603cb2f54fae49b111a994cce1845119fecaf`).

Powrót wykonujemy selektywnie przez `git restore --source=<ref> -- <ścieżka>`
albo odtworzenie osobnej gałęzi z refa. Nie używamy `git reset --hard`.
