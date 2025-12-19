# 🚀 Quick Start - Vercel Deployment

## Problem który naprawiliśmy

❌ **Przed:**
- 404 błąd na `/api/health`
- Brak błędów w logach Vercel
- 8 osobnych serverless functions (przekroczenie limitu trial)

✅ **Po:**
- Wszystkie endpointy działają
- Pełne logowanie błędów
- 1 serverless function (mono-API) - mieści się w limicie trial

## Szybkie wdrożenie (3 kroki)

### 1. Deploy na Vercel

```bash
# Opcja A: Vercel CLI
npm i -g vercel
vercel --prod

# Opcja B: GitHub + Vercel Dashboard
# 1. Push do GitHub
# 2. Połącz repo w vercel.com
# 3. Deploy!
```

### 2. Dodaj zmienne środowiskowe w Vercel

W **Vercel Dashboard → Settings → Environment Variables**:

```
SUPABASE_URL=https://xdhlztmjktminrwmzcpl.supabase.co
SUPABASE_ANON_KEY=<twój_klucz>
GOOGLE_MAPS_API_KEY=<twój_klucz>  # opcjonalne, dla /api/search
```

### 3. Przetestuj

```bash
# Health check
curl https://twoja-app.vercel.app/api/health

# Powinieneś zobaczyć:
# {"status":"ok","service":"freeflow-backend","timestamp":"2025-10-01..."}
```

## Dostępne endpointy

```bash
# 1. Health check
GET /api/health

# 2. Lista endpointów
GET /api

# 3. NLU (przetwarzanie tekstu)
POST /api/nlu
Body: {"text": "Chcę zamówić pizzę margherita"}

# 4. Restauracje
GET /api/restaurants?q=pizza

# 5. Menu restauracji
GET /api/menu?restaurant_id=123

# 6. Zamówienia (GET lista, POST utwórz)
GET /api/orders?customer_id=user123
POST /api/orders
Body: {
  "restaurantId": "123",
  "items": [{"name": "Pizza", "qty": 1, "price": 25}],
  "total": 25
}

# 7. Wyszukiwanie miejsc (Google Places)
GET /api/search?query=pizzeria&lat=52.2297&lng=21.0122

# 8. Alias dla search
GET /api/places?q=restauracja

# 9. TTS (placeholder)
POST /api/tts
Body: {"text": "Witaj", "lang": "pl-PL"}
```

## Architektura

**Mono-API** = wszystkie endpointy w 1 pliku (`/api/index.js`)

```
Requesty:
/api/health    ─┐
/api/tts       ─┤
/api/nlu       ─┤
/api/restaurants ─┤──→ vercel.json (rewrites) ──→ /api/index.js (routing)
/api/menu      ─┤
/api/orders    ─┤
/api/search    ─┤
/api/places    ─┘
```

## Sprawdzanie logów

**W Vercel Dashboard:**
1. Deployments → wybierz deployment
2. Functions → kliknij `/api/index`
3. Zobacz logi (console.log, console.error)

**Lub CLI:**
```bash
vercel logs <deployment-url>
```

## Rozwiązywanie problemów

### 404 na endpointach?
✅ Sprawdź `vercel.json` - powinno być:
```json
{
  "rewrites": [
    { "source": "/api/health", "destination": "/api/index/health" }
  ]
}
```

### 500 Internal Server Error?
✅ Sprawdź logi w Vercel Dashboard  
✅ Sprawdź zmienne środowiskowe  
✅ Sprawdź połączenie z Supabase  

### CORS errors?
✅ Headers są skonfigurowane w `vercel.json`  
✅ `setCors()` jest wywoływane w `api/index.js`  

## Development lokalny

```bash
# 1. Zainstaluj zależności
npm install

# 2. Utwórz .env (opcjonalnie)
cp .env.example .env
# edytuj .env z prawdziwymi kluczami

# 3. Uruchom lokalnie
npm start
# API dostępne na http://localhost:3003

# 4. Testy
npm test
```

## Następne kroki

- [ ] Skonfiguruj Supabase RLS policies
- [ ] Dodaj monitoring (Sentry/Vercel Analytics)
- [ ] Skonfiguruj custom domain
- [ ] Dodaj rate limiting
- [ ] Rozważ upgrade do Vercel Pro (jeśli potrzebujesz więcej funkcji)

## Pomocne linki

- 📖 [README.md](./README.md) - Pełna dokumentacja
- 🏗️ [MONO_API_INFO.md](./MONO_API_INFO.md) - Architektura mono-API
- 🚀 [DEPLOYMENT.md](./DEPLOYMENT.md) - Szczegółowy przewodnik deployment
- 📝 [CHANGELOG.md](./CHANGELOG.md) - Historia zmian
