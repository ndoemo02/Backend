# ADR-004: Jawny kontekst dwóch scenariuszy publicznego demo

## Status

Accepted for staged implementation.

## Context

FreeFlow ma zaprezentować dwa niezależne przebiegi:

- lokalnego użytkownika w Piekarach Śląskich;
- turystę w Krakowie.

Obecny backend ma zachowanie zgodne z Piekarami i nie może utracić tej
kompatybilności. Jednocześnie miasto, język i zakres danych nie mogą wynikać z
przypadkowej wypowiedzi modelu ani z samego tekstu odpowiedzi Live.

Projekt jest publicznym demo utrzymywanym przez jedną osobę. Priorytetem jest
mała, odwracalna zmiana bez nowego systemu tenantów i bez uruchamiania
mikrofonu przed wyborem scenariusza.

Checkpoint wejściowy:

- frontend: `0bb9dd6bcab9f784cb8968837e6ead5ed9fd0335`;
- backend: `a7a285e2e5315363ab30e047ad34e2e932ecceb5`;
- istniejąca lokalna zmiana `backend/tests/chaos/REPORT.md` pozostaje poza
  zakresem i nie może zostać nadpisana.

## Options considered

| Opcja | Zalety | Wady |
| --- | --- | --- |
| Miasto wnioskowane przez Gemini z rozmowy | brak nowego stanu UI | niedeterministyczność, możliwość zmiany katalogu przez błędną transkrypcję |
| Osobne buildy Piekary/Kraków | mocna izolacja | podwójny deploy, konfiguracja i regresja |
| Jawny `DemoContext` wybierany przed Live | jeden build, deterministyczny zakres, łatwe testy | wymaga przekazania małego kontraktu frontend–backend |

## Decision

Wybrano jawny, wersjonowalny kontekst:

```ts
type DemoScenarioId = 'piekary-local' | 'krakow-tourist';
type DemoLocale = 'pl' | 'en';
type DemoContextSource = 'default' | 'launch' | 'query' | 'persisted';

interface DemoContext {
  scenarioId: DemoScenarioId;
  preferredLocale: DemoLocale;
  source: DemoContextSource;
}
```

Frontend traktuje `scenarioId` jako nieprzezroczysty identyfikator i nie
decyduje samodzielnie o mieście ani zbiorze danych. Backend jest właścicielem
mapowania:

- `piekary-local` → Piekary Śląskie, odbiorca lokalny, `piekary-v1`;
- `krakow-tourist` → Kraków, turysta, `krakow-v1`.

Brak kontekstu zachowuje dotychczasowy przebieg Piekar. Jawna, nieznana wartość
jest odrzucana zamiast cichego przełączenia na inne miasto.

Oba scenariusze startują po polsku. Angielski jest obsługiwanym językiem
rozmowy, ale automatyczna zmiana języka będzie osobnym kontraktem późniejszego
etapu. Scenariusz turystyczny nie oznacza automatycznie języka angielskiego.

Wybór scenariusza następuje przed uruchomieniem sesji Live i mikrofonu.

## Trade-offs

- Akceptujemy małe lustrzane typy w dwóch repozytoriach zamiast budowy
  współdzielonego pakietu tylko dla dwóch identyfikatorów.
- Na tym etapie kontrakt nie rozstrzyga, czy rekordy lokali są rzeczywiste,
  demonstracyjne czy mieszane. Określa wyłącznie izolację scenariusza.
- Nie implementujemy jeszcze endpointu katalogu scenariuszy, routingu danych,
  promptu, UI wyboru ani trwałego zapisu.

## Consequences

### Positive

- Live nie wybiera miasta na podstawie halucynacji lub błędu STT.
- Obecny przebieg Piekar pozostaje domyślny.
- Kraków można wdrażać i testować niezależnie.
- Język rozmowy nie jest błędnie utożsamiany z lokalizacją.

### Negative

- Do czasu pełnego wpięcia kontekst jest tylko kontraktem i nie zmienia
  działania aplikacji.
- Frontend i backend wymagają testu zgodności przy dodawaniu nowego scenariusza.

### Mitigation

- Każde repo ma testy odrzucania nieznanych scenariuszy.
- Następne etapy muszą przekazywać kontekst przez jawny nagłówek lub pole
  requestu; nie przez prompt użytkownika.

## Revisit triggers

- więcej niż dwa publiczne miasta;
- osobne środowiska danych per partner;
- produkcyjny multi-tenant;
- trzeci obsługiwany język;
- potrzeba zdalnie zarządzanego katalogu scenariuszy.
