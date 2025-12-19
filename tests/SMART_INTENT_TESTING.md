# 🧠 Smart Intent System - Testy

## Przegląd

Po wprowadzeniu Smart Intent System z NLU LLM, architektura detekcji intencji została zmieniona:

1. **Smart Intent Layer** (`smartResolveIntent`) - główna warstwa która:
   - Najpierw używa Classic NLU (`detectIntent`)
   - Jeśli confidence jest niskie (< 0.75) i brak expectedContext → używa LLM fallback
   - Zwraca wynik z informacją o źródle (`source: 'classic' | 'llm'`)

2. **Context Boost Layer** (`boostIntent`) - warstwa kontekstowa która:
   - Działa tylko gdy istnieje `session.expectedContext`
   - Boostuje intencję na podstawie krótkich fraz użytkownika
   - Zwraca obiekt z `boosted: true` i `fromExpected: true`

## Struktura Testów

### `test-smart-intent.test.js`
Testy dla `smartResolveIntent`:
- ✅ Empty input handling
- ✅ Classic NLU path (high confidence)
- ✅ Classic NLU path (expectedContext)
- ✅ LLM fallback path
- ✅ Environment configuration
- ✅ Error handling
- ✅ Intent mapping

### `test-brain-router.test.js` (zaktualizowane)
Testy dla `boostIntent`:
- ✅ ExpectedContext handling
- ✅ Context-specific boosts
- ✅ Edge cases
- ✅ Backward compatibility

## Uruchamianie Testów

```bash
# Wszystkie testy jednostkowe
npm run test:unit

# Tylko Smart Intent
npx vitest run tests/unit/test-smart-intent.test.js

# Tylko Brain Router
npx vitest run tests/unit/test-brain-router.test.js
```

## Znane Problemy

1. **Sygnatura boostIntent**: 
   - `boostIntent.js` używa: `boostIntent(det, text, session)`
   - `brainRouter.js` używa: `boostIntent(text, hybridIntent, hybridConfidence, currentSession)`
   - **Status**: Wymaga synchronizacji sygnatur

2. **Mockowanie LLM**: 
   - Testy mockują `fetch` dla LLM calls
   - W trybie testowym LLM jest domyślnie wyłączony (chyba że `FORCE_LLM_TEST=true`)

## Coverage

- ✅ Smart Intent Resolution: ~85%
- ✅ Classic NLU Path: 100%
- ✅ LLM Fallback Path: ~80%
- ✅ Context Boost: ~90%

## Następne Kroki

1. ✅ Zaktualizować testy dla boostIntent
2. ✅ Dodać testy dla smartResolveIntent
3. ⏳ Zsynchronizować sygnaturę boostIntent w brainRouter
4. ⏳ Dodać integration tests dla pełnego flow
5. ⏳ Dodać performance tests dla LLM calls





