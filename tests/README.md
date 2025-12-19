# 🧪 **TESTY FREEFLOW VOICE ORDERING**

## 📋 **Przegląd testów**

Kompleksowy system testów dla FreeFlow Voice Ordering obejmuje:

- **Testy jednostkowe** - funkcje parsowania i logiki
- **Testy integracyjne** - API endpoints
- **Testy end-to-end** - pełny voice flow
- **Testy wydajności** - TTS/STT performance
- **Testy frontend** - React komponenty

## 🚀 **Uruchamianie testów**

### **Backend (Node.js)**

```bash
# Wszystkie testy
npm run test

# Testy jednostkowe
npm run test:unit

# Testy integracyjne
npm run test:integration

# Testy end-to-end
npm run test:e2e

# Testy wydajności
npm run test:performance

# Testy z coverage
npm run test:coverage

# Watch mode (dla development)
npm run test:watch
```

### **Frontend (React)**

```bash
cd classic-ui-app3

# Testy komponentów
npm run test

# Testy z coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## 📁 **Struktura testów**

```
tests/
├── unit/                    # Testy jednostkowe
│   ├── test-intent-detection.js
│   └── test-brain-router.js
├── integration/             # Testy integracyjne
│   └── test-api-endpoints.js
├── e2e/                     # Testy end-to-end
│   └── test-voice-flow.js
├── performance/             # Testy wydajności
│   └── test-tts-stt.js
├── setup.js                 # Konfiguracja testów
└── README.md               # Ta dokumentacja
```

## 🎯 **Rodzaje testów**

### **1. Testy jednostkowe**

Testują pojedyncze funkcje i moduły:

- **Text normalization** - `normalizeTxt()`
- **Fuzzy matching** - `fuzzyIncludes()`
- **Alias application** - `applyAliases()`
- **Size extraction** - `extractSize()`
- **Order parsing** - `parseOrderItems()`
- **Intent boosting** - `boostIntent()`
- **Restaurant parsing** - `parseRestaurantAndDish()`

### **2. Testy integracyjne**

Testują API endpoints z mock'ami:

- **POST /api/brain** - główny endpoint voice processing
- **GET /api/health** - health check
- **POST /api/tts-chirp-hd** - TTS generation
- **GET /api/debug/session** - debug session state
- **POST /api/debug/log** - debug logging

### **3. Testy end-to-end**

Testują pełny voice flow:

- **Nearby restaurant discovery** - "co jest dostępne w pobliżu"
- **Menu requests** - "pokaż menu"
- **Order creation** - "zamów pizzę"
- **Order confirmation** - "tak"
- **Order modification** - "nie, zmień to"
- **Session context** - utrzymywanie stanu między requestami

### **4. Testy wydajności**

Testują performance TTS/STT:

- **Response times** - szybkość generowania audio
- **Audio quality** - rozmiar audio vs długość tekstu
- **Streaming performance** - chunked audio delivery
- **Concurrent load** - wiele jednoczesnych requestów
- **Memory usage** - brak memory leaks

### **5. Testy frontend**

Testują React komponenty:

- **LoadingScreen** - animacja startowa
- **AmberStatus** - status lampa AI
- **TTSSwitcher** - przełącznik TTS engine
- **LiveSessionPopup** - debug popup

## 🔧 **Konfiguracja**

### **Vitest Config**

```javascript
// vitest.config.js
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    coverage: {
      provider: 'v8',
      thresholds: {
        global: {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70
        }
      }
    }
  }
});
```

### **Test Setup**

```javascript
// tests/setup.js
// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://test.supabase.co';

// Global test utilities
global.testUtils = {
  createMockRequest: (body, headers) => ({ ... }),
  createMockResponse: () => ({ ... }),
  createMockSession: (overrides) => ({ ... }),
  measureTime: async (fn) => ({ ... })
};
```

## 📊 **Coverage Requirements**

Minimalne wymagania coverage:

- **Branches**: 70%
- **Functions**: 70%
- **Lines**: 70%
- **Statements**: 70%

## 🐛 **Debugowanie testów**

### **Verbose Output**

```bash
VERBOSE_TESTS=1 npm run test
```

### **Single Test File**

```bash
npm run test tests/unit/test-intent-detection.js
```

### **Watch Mode**

```bash
npm run test:watch
```

## 🚨 **Znane problemy**

### **1. Intent Detection**

- **Problem**: "co jest dostępne w pobliżu" → `intent: "none"`
- **Status**: Częściowo naprawione
- **Test**: `test-brain-router.js` - `boostIntent` patterns

### **2. Character Encoding**

- **Problem**: Polskie znaki w logach
- **Status**: Wymaga naprawy
- **Test**: `test-intent-detection.js` - `normalizeTxt`

### **3. TTS Performance**

- **Problem**: Możliwe problemy z frontend audio playback
- **Status**: Wymaga testowania w przeglądarce
- **Test**: `test-tts-stt.js` - performance tests

## 🔄 **CI/CD Integration**

### **GitHub Actions**

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run test:coverage
```

### **Pre-commit Hooks**

```bash
# .husky/pre-commit
#!/bin/sh
npm run test:unit
```

## 📈 **Metryki jakości**

- **Test Coverage**: >70%
- **Test Execution Time**: <30s dla wszystkich testów
- **TTS Response Time**: <2s dla średnich tekstów
- **API Response Time**: <1s dla voice requests
- **Memory Usage**: <50MB increase po 100 requestach

## 🤝 **Contributing**

### **Dodawanie nowych testów**

1. Utwórz plik testowy w odpowiednim katalogu
2. Użyj opisowych nazw testów
3. Dodaj testy dla edge cases
4. Upewnij się, że coverage się nie zmniejsza
5. Dodaj dokumentację jeśli potrzeba

### **Test Naming Convention**

```javascript
describe('Component/Function Name', () => {
  it('should do something specific', () => {
    // test implementation
  });
  
  it('should handle edge case', () => {
    // test implementation
  });
});
```

## 📞 **Support**

Jeśli masz problemy z testami:

1. Sprawdź logi testów
2. Uruchom testy z `VERBOSE_TESTS=1`
3. Sprawdź coverage report
4. Zgłoś issue z szczegółami

---

**Happy Testing!** 🚀
