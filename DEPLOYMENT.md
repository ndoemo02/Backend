# Deployment Guide - Vercel

## 🚀 Szybkie wdrożenie

### 1. Przygotowanie

```bash
# Zainstaluj Vercel CLI (opcjonalnie)
npm i -g vercel

# Lub użyj Vercel Dashboard: https://vercel.com
```

### 2. Zmienne środowiskowe

W Vercel Dashboard (Settings → Environment Variables) dodaj:

```env
# Supabase (wymagane)
SUPABASE_URL=https://xdhlztmjktminrwmzcpl.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key

# Google Maps (dla /api/search i /api/places)
GOOGLE_MAPS_API_KEY=your_google_maps_api_key

# Opcjonalne
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OPENAI_API_KEY=your_openai_key
```

### 3. Deploy

**Opcja A: Vercel Dashboard**
1. Połącz repozytorium GitHub
2. Wybierz branch (np. `main`)
3. Kliknij "Deploy"

**Opcja B: CLI**
```bash
vercel --prod
```

### 4. Testowanie

Po wdrożeniu, przetestuj endpointy:

```bash
# Podstawowy health check
curl https://twoja-aplikacja.vercel.app/api/health

# Lista wszystkich endpointów
curl https://twoja-aplikacja.vercel.app/api

# Test NLU
curl -X POST https://twoja-aplikacja.vercel.app/api/nlu \
  -H "Content-Type: application/json" \
  -d '{"text": "Chcę zamówić pizzę"}'
```

## 🔧 Architektura Mono-API

### Dlaczego mono-API?

Vercel Trial ma **limit 12 serverless functions**. Zamiast 8 osobnych plików, wszystkie endpointy są w **jednym pliku** (`/api/index.js`).

### Routing

```
/api/health      → /api/index/health
/api/tts         → /api/index/tts
/api/nlu         → /api/index/nlu
/api/restaurants → /api/index/restaurants
/api/menu        → /api/index/menu
/api/orders      → /api/index/orders
/api/search      → /api/index/search
/api/places      → /api/index/places
```

Konfiguracja w `vercel.json`:
```json
{
  "rewrites": [
    { "source": "/api/health", "destination": "/api/index/health" }
    // ...
  ]
}
```

## 📊 Diagnostyka

### Sprawdzanie logów

```bash
# Vercel CLI
vercel logs [deployment-url]

# Lub w Dashboard: Deployments → wybierz deployment → Functions
```

### Typowe problemy

**1. 404 na `/api/health`**
- ✅ Sprawdź `vercel.json` - czy są `rewrites`
- ✅ Sprawdź `api/index.js` - czy jest `export default`

**2. 500 Internal Server Error**
- ✅ Sprawdź logi w Vercel Dashboard
- ✅ Sprawdź zmienne środowiskowe
- ✅ Upewnij się, że Supabase jest dostępna

**3. CORS errors**
- ✅ W `vercel.json` są odpowiednie headery
- ✅ W `api/index.js` funkcja `setCors()` jest wywoływana

**4. Import errors (Cannot find module)**
- ✅ Sprawdź czy `package.json` ma `"type": "module"`
- ✅ Wszystkie importy powinny używać `.js` extension

## 🎯 Production Checklist

- [ ] Zmienne środowiskowe skonfigurowane w Vercel
- [ ] Supabase RLS (Row Level Security) skonfigurowane
- [ ] API rate limiting (opcjonalnie)
- [ ] Monitoring i alerty (np. Sentry)
- [ ] Custom domain (opcjonalnie)
- [ ] SSL certificate (automatyczne w Vercel)

## 📈 Monitoring

### Vercel Analytics
```bash
npm i @vercel/analytics
```

### Dodaj do frontendu:
```js
import { Analytics } from '@vercel/analytics/react';

function App() {
  return (
    <>
      <YourApp />
      <Analytics />
    </>
  );
}
```

## 🔄 Continuous Deployment

Vercel automatycznie wdraża przy każdym push do `main`:
- **Preview deployments**: dla PR/branch
- **Production deployments**: dla `main`

## 📚 Więcej informacji

- [Vercel Docs](https://vercel.com/docs)
- [Vercel Limits](https://vercel.com/docs/limits)
- [Serverless Functions](https://vercel.com/docs/functions)
