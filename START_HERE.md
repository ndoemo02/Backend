# 🎯 START HERE - Zacznij tutaj!

```
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ✅ FREEFLOW BACKEND - MONO-API                             ║
║   🚀 GOTOWE DO DEPLOYMENT NA VERCEL                          ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

## 🎉 Co zostało naprawione?

### Problemy PRZED:
- ❌ 404 błąd na `/api/health`
- ❌ Brak błędów w logach Vercel
- ❌ Przekroczenie limitu 12 serverless functions (Vercel Trial)

### Rozwiązania PO:
- ✅ Wszystkie 8 endpointów działają
- ✅ Pełne logowanie błędów (console.error)
- ✅ Tylko 1 serverless function (mono-API)

---

## 🚀 Deploy w 3 krokach

### Krok 1: Deploy na Vercel (2 minuty)

**Opcja A - Vercel Dashboard (polecane):**
1. Idź na https://vercel.com
2. Kliknij "Add New Project"
3. Połącz swoje repozytorium GitHub
4. Kliknij "Deploy"

**Opcja B - CLI:**
```bash
npm i -g vercel
vercel --prod
```

### Krok 2: Zmienne środowiskowe (1 minuta)

W **Vercel Dashboard → Settings → Environment Variables** dodaj:

```env
SUPABASE_URL=https://xdhlztmjktminrwmzcpl.supabase.co
SUPABASE_ANON_KEY=eyJhbGci... (twój klucz)
```

Opcjonalnie (dla `/api/search`):
```env
GOOGLE_MAPS_API_KEY=twój_klucz_google
```

### Krok 3: Test (30 sekund)

```bash
curl https://twoja-app.vercel.app/api/health
```

**Powinieneś zobaczyć:**
```json
{
  "status": "ok",
  "service": "freeflow-backend",
  "timestamp": "2025-10-01..."
}
```

✅ **Działa? Gratulacje! 🎉**

---

## 📊 Dostępne endpointy

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/health` | GET | Health check |
| `/api` | GET | Lista wszystkich endpointów |
| `/api/nlu` | POST | Przetwarzanie tekstu |
| `/api/tts` | POST | Text-to-Speech (placeholder) |
| `/api/restaurants` | GET | Lista restauracji |
| `/api/menu` | GET | Menu restauracji |
| `/api/orders` | GET/POST | Zamówienia |
| `/api/search` | GET | Wyszukiwanie miejsc |
| `/api/places` | GET | Alias dla search |

### Przykłady:

```bash
# Lista wszystkich endpointów
curl https://twoja-app.vercel.app/api

# NLU (przetwarzanie tekstu)
curl -X POST https://twoja-app.vercel.app/api/nlu \
  -H "Content-Type: application/json" \
  -d '{"text": "Chcę zamówić 2 pizze margherita"}'

# Restauracje
curl https://twoja-app.vercel.app/api/restaurants?q=pizza
```

---

## 📚 Dokumentacja

### Jeśli to Twój pierwszy raz:
1. **[QUICK_START.md](./QUICK_START.md)** ← Przeczytaj to najpierw! (3 min)
2. **[PRE_DEPLOY_CHECKLIST.md](./PRE_DEPLOY_CHECKLIST.md)** - Checklist (2 min)
3. Deploy! 🚀

### Jeśli masz problem:
1. **[FAQ.md](./FAQ.md)** - Sprawdź FAQ (5 min)
2. **[ROZWIAZANIE.md](./ROZWIAZANIE.md)** - Typowe problemy (3 min)
3. Zobacz logi w Vercel Dashboard

### Jeśli chcesz zrozumieć jak to działa:
1. **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Diagramy (10 min)
2. **[MONO_API_INFO.md](./MONO_API_INFO.md)** - Mono-API explained (5 min)
3. **[api/index.js](./api/index.js)** - Kod źródłowy

### Wszystkie dokumenty:
**[📚 DOCS_INDEX.md](./DOCS_INDEX.md)** - Pełny spis treści (11 plików dokumentacji)

---

## 🏗️ Architektura (uproszczona)

```
┌─────────────────┐
│  User Request   │
│  /api/health    │
└────────┬────────┘
         │
         ↓
┌─────────────────────────────┐
│    vercel.json (rewrite)    │
│  /api/health → /api/index/  │
│                    health    │
└────────┬────────────────────┘
         │
         ↓
┌─────────────────────────────┐
│     /api/index.js           │
│  (MONO-API - 1 function)    │
│                             │
│  switch(endpoint) {         │
│    case 'health':           │
│      handleHealth()         │
│    case 'tts':              │
│      handleTts()            │
│    // ... 8 endpointów      │
│  }                          │
└────────┬────────────────────┘
         │
         ↓
┌─────────────────┐
│   Response      │
│ {status: "ok"}  │
└─────────────────┘
```

---

## ⚡ Szybki przegląd

### Struktura projektu:
```
freeflow-backend/
├── api/
│   └── index.js          # 🎯 MONO-API (wszystkie endpointy)
├── vercel.json           # ⚙️  Konfiguracja (rewrites + CORS)
├── package.json          # 📦 Dependencies
├── .vercelignore         # 🚫 Wykluczenie testów
└── docs/                 # 📚 11 plików dokumentacji
    ├── START_HERE.md     # ← Jesteś tutaj
    ├── QUICK_START.md    # 🚀 Deploy w 3 krokach
    ├── FAQ.md            # ❓ Pytania i odpowiedzi
    └── ...               # Zobacz DOCS_INDEX.md
```

### Kluczowe pliki:
- **`api/index.js`** - mono-API (449 linii, 8 endpointów)
- **`vercel.json`** - routing i CORS
- **`QUICK_START.md`** - przewodnik deployment

---

## 🔍 Rozwiązywanie problemów

### 404 na `/api/health`?
1. Sprawdź czy `vercel.json` jest w root projektu
2. Sprawdź logi: Vercel Dashboard → Functions
3. Zobacz [FAQ.md#404](./FAQ.md)

### 500 Internal Error?
1. Sprawdź zmienne środowiskowe w Vercel
2. Zobacz logi: Deployments → Functions → `/api/index`
3. Sprawdź connection do Supabase

### CORS errors?
1. Powinno działać automatycznie
2. Test: `curl -X OPTIONS https://your-app.vercel.app/api/health -v`
3. Zobacz [FAQ.md#cors](./FAQ.md)

---

## ✅ Checklist przed deployem

- [ ] Przeczytałem [QUICK_START.md](./QUICK_START.md)
- [ ] Mam konto Vercel
- [ ] Mam zmienne środowiskowe (SUPABASE_URL, SUPABASE_ANON_KEY)
- [ ] Kod jest w repozytorium GitHub
- [ ] Sprawdziłem [PRE_DEPLOY_CHECKLIST.md](./PRE_DEPLOY_CHECKLIST.md)

**Wszystko gotowe? Deploy! 🚀**

---

## 🎯 Co dalej?

### Zaraz po deployu:
1. ✅ Przetestuj wszystkie endpointy
2. ✅ Sprawdź logi w Vercel Dashboard
3. ✅ Skonfiguruj monitoring (opcjonalnie)

### W przyszłości:
- 🔐 Dodaj authentication (Supabase Auth)
- 📊 Dodaj analytics (Vercel Analytics)
- 🚦 Dodaj rate limiting
- 🔄 Rozważ upgrade do Vercel Pro (więcej functions)

---

## 📖 Najważniejsze linki

### Deploy:
- [Vercel Dashboard](https://vercel.com/dashboard)
- [QUICK_START.md](./QUICK_START.md)
- [PRE_DEPLOY_CHECKLIST.md](./PRE_DEPLOY_CHECKLIST.md)

### Dokumentacja:
- [DOCS_INDEX.md](./DOCS_INDEX.md) - Spis wszystkich dokumentów
- [README.md](./README.md) - Główna dokumentacja
- [FAQ.md](./FAQ.md) - Pytania i odpowiedzi

### Konfiguracja:
- [Supabase Dashboard](https://supabase.com/dashboard)
- [Google Cloud Console](https://console.cloud.google.com)

---

## 💡 Protip

**Zapisz tego linka:**
https://twoja-app.vercel.app/api

Pokaże Ci listę wszystkich dostępnych endpointów + przykłady użycia.

---

```
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🎉 GOTOWE!                                             ║
║                                                           ║
║   Następny krok:                                         ║
║   📖 Przeczytaj QUICK_START.md                           ║
║   🚀 Deploy na Vercel                                    ║
║   ✅ Przetestuj endpointy                                ║
║                                                           ║
║   Powodzenia! 🚀                                         ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
```

---

**Ostatnia aktualizacja:** 2025-10-01  
**Status:** ✅ READY TO DEPLOY
