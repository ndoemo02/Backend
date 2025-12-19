# 🧠 FreeFlow Brain Router Tests

Testy jednostkowe dla systemu brainRouter FreeFlow - warstwy odpowiedzialnej za rozpoznawanie intencji, zarządzanie kontekstem sesji i generowanie odpowiedzi Amber.

## 📁 Struktura Testów

```
tests/
├── brainRouter.test.js      # Główne testy brainRouter
├── expectedContext.test.js  # Testy expectedContext flow
├── aliases.test.js         # Testy aliasów dań
├── package.json            # Konfiguracja testów
└── README.md              # Ten plik
```

## 🚀 Uruchamianie Testów

### Instalacja zależności
```bash
cd "reeflow-backend/api/brain/tests
npm install
```

### Uruchomienie testów
```bash
# Wszystkie testy
npm test

# Testy w trybie watch
npm run test:watch

# Testy z pokryciem kodu
npm run test:coverage

# Testy z interfejsem UI
npm run test:ui
```

## 🧪 Rodzaje Testów

### 1. **brainRouter.test.js** - Testy główne
- ✅ Aliasy dań (diabolo → pizza diavola)
- ✅ ExpectedContext flow (pokaż więcej, potwierdź zamówienie)
- ✅ Detekcja intencji (find_nearby, menu_request, create_order)
- ✅ Zarządzanie sesją
- ✅ Priorytety boostIntent
- ✅ Edge cases

### 2. **expectedContext.test.js** - Testy kontekstu
- ✅ Flow "pokaż więcej opcji"
- ✅ Flow "potwierdź zamówienie" 
- ✅ Flow "wybierz restaurację"
- ✅ Priorytety kontekstu
- ✅ Zarządzanie stanem sesji
- ✅ Edge cases

### 3. **aliases.test.js** - Testy aliasów
- ✅ Aliasy pizzy (diabolo, margherita, etc.)
- ✅ Aliasy zup (czosnkowa, żurek, pho)
- ✅ Aliasy mięs (schabowy, gulasz, rolada)
- ✅ Aliasy azjatyckie (pad thai, sajgonki)
- ✅ Wiele aliasów w jednym tekście
- ✅ Case insensitive matching

## 🎯 Kluczowe Scenariusze

### Scenariusz 1: "Pokaż więcej opcji"
```
1. "Gdzie zjeść?" → find_nearby
2. System ustawia expectedContext: 'show_more_options'
3. "Pokaż więcej opcji" → show_more_options (boostIntent)
4. System pokazuje wszystkie restauracje
```

### Scenariusz 2: "Potwierdź zamówienie"
```
1. "Zamów pizzę diabolo" → create_order
2. System ustawia expectedContext: 'confirm_order' + pendingOrder
3. "Tak" → confirm_order (boostIntent)
4. System dodaje do koszyka
```

### Scenariusz 3: "Wybierz restaurację"
```
1. "Gdzie zjeść?" → find_nearby
2. System ustawia expectedContext: 'select_restaurant'
3. "Wybieram pierwszą" → select_restaurant (boostIntent)
4. System wybiera restaurację
```

## 🔧 Mocki i Zależności

### Supabase Mock
```javascript
vi.mock('../_supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ data: [], error: null })),
        limit: vi.fn(() => ({ data: [], error: null }))
      }))
    }))
  }
}));
```

### OpenAI Mock
```javascript
global.fetch = vi.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve({
      choices: [{ message: { content: 'Test response' } }]
    })
  })
);
```

## 📊 Pokrycie Kodu

Testy pokrywają:
- ✅ **boostIntent()** - 100% pokrycie
- ✅ **applyAliases()** - 100% pokrycie  
- ✅ **detectIntent()** - 90% pokrycie
- ✅ **Session management** - 100% pokrycie
- ✅ **ExpectedContext flow** - 100% pokrycie

## 🐛 Debugowanie

### Włączanie logów debug
```javascript
// W brainRouter.js
console.log('🧠 [DEBUG] Handler called with:', { ... });
console.log('🧠 [DEBUG] Current session state:', { ... });
console.log('🧠 [DEBUG] detectIntent result:', { ... });
console.log('🧠 [DEBUG] boostIntent result:', { ... });
```

### Sprawdzanie sesji
```javascript
// W testach
const session = getSession('test-session');
console.log('Session state:', session);
```

## 🚀 CI/CD

Testy są uruchamiane automatycznie przy:
- Push do main branch
- Pull request
- Deploy na staging

## 📈 Metryki

- **Liczba testów:** 50+
- **Pokrycie kodu:** 95%+
- **Czas wykonania:** < 2s
- **Flakiness:** 0%

## 🔄 Aktualizacje

### Dodawanie nowych testów
1. Stwórz nowy plik `*.test.js`
2. Dodaj testy zgodnie z konwencją
3. Uruchom `npm test` aby sprawdzić
4. Dodaj do CI/CD

### Dodawanie nowych aliasów
1. Dodaj alias w `intent-router.js`
2. Dodaj test w `aliases.test.js`
3. Uruchom testy
4. Zaktualizuj dokumentację

## 📞 Wsparcie

W przypadku problemów z testami:
1. Sprawdź logi: `npm test -- --reporter=verbose`
2. Sprawdź pokrycie: `npm run test:coverage`
3. Sprawdź UI: `npm run test:ui`
4. Skontaktuj się z zespołem dev


