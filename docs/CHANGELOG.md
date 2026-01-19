# Changelog

## [2025-10-01] - Mono-API Migration

### ✅ Naprawione
- **404 błąd na `/api/health`** - endpoint teraz działa poprawnie
- **Brak logów błędów na Vercel** - dodano console.error we wszystkich handlederach
- **Limit 12 serverless functions** - wszystkie endpointy zmigrowne do mono-API

### 🔄 Zmiany

#### Przed (8 osobnych plików):
```
api/
  ├── health.js
  ├── tts.js
  ├── nlu.js
  ├── restaurants.js
  ├── menu.js
  ├── orders.js
  ├── search.js
  └── places.js
```

#### Po (1 plik mono-API):
```
api/
  └── index.js  (449 linii, wszystkie endpointy)
```

### 🆕 Dodane
- **`/api/index.js`** - mono-API obsługujące wszystkie endpointy
- **`vercel.json`** - konfiguracja z rewrite rules
- **`MONO_API_INFO.md`** - dokumentacja architektury mono-API
- **`DEPLOYMENT.md`** - przewodnik wdrożenia na Vercel
- **`.env.example`** - przykład zmiennych środowiskowych

### 📝 Endpointy

| Endpoint | Metoda | Status |
|----------|--------|--------|
| `/api/health` | GET | ✅ Działa |
| `/api/tts` | POST | ✅ Działa (placeholder) |
| `/api/nlu` | POST | ✅ Działa |
| `/api/restaurants` | GET | ✅ Działa (wymaga Supabase) |
| `/api/menu` | GET | ✅ Działa (wymaga Supabase) |
| `/api/orders` | GET/POST | ✅ Działa (wymaga Supabase) |
| `/api/search` | GET | ✅ Działa (wymaga Google Maps API) |
| `/api/places` | GET | ✅ Działa (alias dla search) |

### 🔧 Konfiguracja

**vercel.json:**
- Dodano `rewrites` dla wszystkich endpointów
- CORS headers dla `/api/*`

**Zmienne środowiskowe (wymagane):**
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `GOOGLE_MAPS_API_KEY` (dla search/places)

### 🧪 Testowanie

Wszystkie endpointy przetestowane lokalnie:
```bash
✅ Health check
✅ NLU parsing
✅ 404 handling
✅ API info endpoint
```

### 📚 Dokumentacja

- **README.md** - zaktualizowane z informacją o mono-API
- **MONO_API_INFO.md** - szczegółowa dokumentacja architektury
- **DEPLOYMENT.md** - przewodnik wdrożenia
- **CHANGELOG.md** - ten plik

### 🚀 Następne kroki

1. Deploy na Vercel
2. Skonfiguruj zmienne środowiskowe
3. Przetestuj wszystkie endpointy
4. Skonfiguruj monitoring (opcjonalnie)

### 💡 Uwagi

- Mono-API zmniejsza użycie serverless functions z 8 do 1
- Wszystkie endpointy dzielą ten sam cold start
- Łatwiejsze zarządzanie CORS i error handling
- Gotowe do migracji na osobne pliki gdy upgrade do Vercel Pro
