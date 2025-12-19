# FreeFlow Backend

```
╔═══════════════════════════════════════════════════════════════╗
║  🚀 MONO-API FOR VERCEL TRIAL                                ║
║  ✅ 8 Endpointów w 1 Serverless Function                     ║
╚═══════════════════════════════════════════════════════════════╝
```

Backend dla aplikacji FreeFlow - serwer obsługujący transkrypcję audio i integrację z AI.

## 🚀 Quick Start

**Problem rozwiązany:**
- ✅ Naprawiono 404 błąd na `/api/health`
- ✅ Dodano pełne logowanie błędów dla Vercel
- ✅ Zmigowano do mono-API (1 serverless function zamiast 8)

**Deploy w 3 krokach:**
1. Deploy na Vercel (połącz GitHub repo)
2. Dodaj zmienne środowiskowe (`SUPABASE_URL`, `SUPABASE_ANON_KEY`)
3. Testuj: `curl https://your-app.vercel.app/api/health`

📖 **[Pełny przewodnik → QUICK_START.md](./QUICK_START.md)**  
📚 **[Wszystkie dokumenty → DOCS_INDEX.md](./DOCS_INDEX.md)**  
⚡ **[Ściągawka → CHEATSHEET.md](./CHEATSHEET.md)**

## Technologie
- Node.js
- Express/Vercel Functions
- Supabase
- OpenAI API

## Instalacja

1. Sklonuj repozytorium:
```bash
git clone https://github.com/ndoemo02/freeflow-backend.git
cd freeflow-backend
```

2. Zainstaluj zależności:
```bash
npm install
```

3. Skonfiguruj zmienne środowiskowe:
Utwórz plik `.env` i dodaj:
```
OPENAI_API_KEY=your_openai_key
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_key
```

4. Uruchom serwer:
```bash
npm start
```

## API Endpoints

### Mono-API (Vercel Trial - limit 12 endpointów)
Wszystkie endpointy są obsługiwane przez `/api/index.js`:

- `/api/health` - sprawdzenie stanu serwera
- `/api/tts` - synteza mowy (Text-to-Speech)
- `/api/nlu` - przetwarzanie języka naturalnego
- `/api/restaurants` - wyszukiwanie restauracji
- `/api/menu` - menu restauracji
- `/api/orders` - zarządzanie zamówieniami (GET/POST)
- `/api/search` - wyszukiwanie miejsc (Google Places)
- `/api/places` - alias dla `/api/search`

## Struktura
- `/api/index.js` - **mono-API** - wszystkie endpointy w jednym pliku
- `/lib` - biblioteki pomocnicze (legacy handlers)
- `/public` - pliki statyczne
- `server.js` - lokalny serwer Express (development)
- `asr.js` - automatyczne rozpoznawanie mowy

## Wdrożenie
Aplikacja jest skonfigurowana do wdrożenia na Vercel.

📖 **Dokumentacja deploymentu:**
- 🚀 [QUICK_START.md](./QUICK_START.md) - Szybki start (3 kroki)
- ✅ [PRE_DEPLOY_CHECKLIST.md](./PRE_DEPLOY_CHECKLIST.md) - Checklist przed deployem
- 📋 [DEPLOYMENT.md](./DEPLOYMENT.md) - Pełny przewodnik deployment
- 🏗️ [ARCHITECTURE.md](./ARCHITECTURE.md) - Architektura i diagramy
- 💡 [MONO_API_INFO.md](./MONO_API_INFO.md) - Wyjaśnienie mono-API
- ✅ [ROZWIAZANIE.md](./ROZWIAZANIE.md) - Co zostało naprawione
- 📝 [CHANGELOG.md](./CHANGELOG.md) - Historia zmian

## Licencja
MIT
