# ✅ Pre-Deploy Checklist

## Przed deploymentem na Vercel

### 1. Pliki wymagane

- [x] `/api/index.js` - mono-API (449 linii)
- [x] `vercel.json` - konfiguracja rewrites i CORS
- [x] `package.json` - dependencies
- [x] `.vercelignore` - wykluczenie testów

### 2. Konfiguracja

- [x] `vercel.json` ma `rewrites` dla wszystkich endpointów
- [x] `vercel.json` ma `headers` dla CORS
- [x] `package.json` ma `"type": "module"`
- [x] `api/index.js` exportuje `default function handler`

### 3. Zmienne środowiskowe (MUSISZ DODAĆ W VERCEL)

**Wymagane:**
- [ ] `SUPABASE_URL` - URL Supabase (lub użyj hardcoded)
- [ ] `SUPABASE_ANON_KEY` - Klucz Supabase

**Opcjonalne:**
- [ ] `GOOGLE_MAPS_API_KEY` - dla `/api/search` i `/api/places`
- [ ] `OPENAI_API_KEY` - dla przyszłych funkcji AI

### 4. Testowanie lokalne (opcjonalne)

```bash
# Zainstaluj dependencies
npm install

# Uruchom lokalnie
npm start

# Testuj
curl http://localhost:3003/api/health
```

### 5. Git & Deploy

```bash
# Stage wszystkie zmiany
git add .

# Commit
git commit -m "Migrate to mono-API for Vercel Trial"

# Push
git push origin main

# Vercel automatycznie wykryje i zrobi deploy
```

### 6. Po deployu - Weryfikacja

**A. Sprawdź czy wszystkie endpointy działają:**

```bash
# Zamień YOUR_APP na swoją nazwę
export APP="https://your-app.vercel.app"

# 1. Health check
curl $APP/api/health

# 2. Lista endpointów
curl $APP/api

# 3. NLU test
curl -X POST $APP/api/nlu \
  -H "Content-Type: application/json" \
  -d '{"text": "Chcę zamówić pizzę"}'

# 4. Restaurants (wymaga Supabase)
curl $APP/api/restaurants
```

**B. Sprawdź logi:**
1. Vercel Dashboard → Deployments
2. Wybierz najnowszy deployment
3. Functions → `/api/index`
4. Zobacz czy są błędy

**C. Sprawdź CORS:**
```bash
curl -X OPTIONS $APP/api/health -v | grep -i access-control
```

Powinieneś zobaczyć:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS
```

### 7. Troubleshooting

**404 na endpointach?**
- [ ] Sprawdź czy `vercel.json` jest w root projektu
- [ ] Sprawdź czy zrobiłeś re-deploy po dodaniu plików
- [ ] Zobacz deployment logs w Vercel Dashboard

**500 Internal Server Error?**
- [ ] Sprawdź logi w Vercel Dashboard (Functions → `/api/index`)
- [ ] Sprawdź czy zmienne środowiskowe są ustawione
- [ ] Sprawdź connection string do Supabase

**CORS errors?**
- [ ] Sprawdź headers w `vercel.json`
- [ ] Sprawdź czy `setCors()` jest wywołane w `api/index.js`
- [ ] Test z `curl -X OPTIONS`

**Import errors?**
- [ ] Sprawdź czy `package.json` ma `"type": "module"`
- [ ] Sprawdź czy wszystkie importy mają `.js` extension
- [ ] Sprawdź czy dependencies są w `package.json`

---

## 🚀 Quick Deploy (3 kroki)

### Krok 1: Vercel Dashboard
1. Idź na https://vercel.com
2. Kliknij "Add New Project"
3. Połącz GitHub repo
4. Kliknij "Deploy"

### Krok 2: Environment Variables
1. Project Settings → Environment Variables
2. Dodaj `SUPABASE_URL` i `SUPABASE_ANON_KEY`
3. Kliknij "Save"

### Krok 3: Test
```bash
curl https://your-app.vercel.app/api/health
```

✅ Jeśli widzisz `{"status":"ok",...}` - **DZIAŁA!**

---

## 📊 Monitoring po deployu

### Vercel Dashboard
- **Deployments**: Historia deploymentów
- **Functions**: Logi i metryki
- **Analytics**: Ruch i performance (opcjonalnie)

### Supabase Dashboard
- **API**: Requests do Supabase
- **Database**: Zapytania SQL
- **Logs**: Błędy i warnings

### Testy integracyjne
```bash
# Uruchom smoke tests (lokalne)
npm run smoke
```

---

## ✅ Final Checklist

Przed uznaniem za kompletne, sprawdź:

- [ ] `/api/health` zwraca 200 OK
- [ ] `/api` zwraca listę endpointów
- [ ] Logi działają (widzisz `console.log` w Vercel)
- [ ] CORS działa (brak błędów w przeglądarce)
- [ ] Zmienne środowiskowe są ustawione
- [ ] Dokumentacja jest aktualna (README.md)

**Wszystko gotowe? Deploy! 🚀**
