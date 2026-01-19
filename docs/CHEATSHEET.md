# 📋 Cheatsheet - Szybka ściągawka

## 🚀 Deploy (szybkie komendy)

```bash
# Vercel CLI
npm i -g vercel
vercel --prod

# Sprawdź logi
vercel logs [deployment-url]

# Local dev
npm start
```

## 🔧 Endpointy - curl examples

```bash
# Ustaw URL (zmień na swój)
export API="https://your-app.vercel.app"

# 1. Health check
curl $API/api/health

# 2. Lista endpointów
curl $API/api

# 3. NLU
curl -X POST $API/api/nlu \
  -H "Content-Type: application/json" \
  -d '{"text": "Chcę zamówić 2 pizze margherita"}'

# 4. Restauracje
curl $API/api/restaurants
curl $API/api/restaurants?q=pizza

# 5. Menu
curl $API/api/menu?restaurant_id=123

# 6. Zamówienia (GET)
curl $API/api/orders
curl $API/api/orders?customer_id=user-123

# 7. Zamówienia (POST)
curl -X POST $API/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "restaurantId": "123",
    "items": [{"name": "Pizza", "qty": 1, "price": 25}],
    "total": 25
  }'

# 8. Wyszukiwanie
curl "$API/api/search?query=pizzeria&lat=52.2297&lng=21.0122"

# 9. Places (alias)
curl "$API/api/places?q=restauracja"
```

## ⚙️ Zmienne środowiskowe

```env
# Wymagane
SUPABASE_URL=https://xdhlztmjktminrwmzcpl.supabase.co
SUPABASE_ANON_KEY=your_key_here

# Opcjonalne
GOOGLE_MAPS_API_KEY=your_google_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OPENAI_API_KEY=your_openai_key
```

## 📁 Struktura plików

```
freeflow-backend/
├── api/
│   └── index.js              # MONO-API (wszystkie endpointy)
├── vercel.json               # Konfiguracja Vercel
├── package.json              # Dependencies
├── .vercelignore             # Wykluczenie plików
├── .env.example              # Template env vars
└── docs/
    ├── START_HERE.md         # Zacznij tutaj
    ├── QUICK_START.md        # Deploy guide
    ├── FAQ.md                # Q&A
    └── DOCS_INDEX.md         # Spis dokumentów
```

## 🔍 Najważniejsze pliki

| Plik | Opis | Linie |
|------|------|-------|
| `api/index.js` | Mono-API | 449 |
| `vercel.json` | Konfiguracja | 23 |
| `START_HERE.md` | Przewodnik | - |

## 🐛 Troubleshooting

### 404 Error
```bash
# Sprawdź czy vercel.json jest w root
ls -la vercel.json

# Sprawdź czy api/index.js istnieje
ls -la api/index.js

# Re-deploy
vercel --prod
```

### 500 Error
```bash
# Zobacz logi
vercel logs

# Sprawdź env vars w Vercel Dashboard:
# Settings → Environment Variables
```

### CORS Error
```bash
# Test OPTIONS
curl -X OPTIONS $API/api/health -v

# Powinien zwrócić:
# Access-Control-Allow-Origin: *
```

## 📊 Vercel Dashboard - gdzie co znajdziesz

```
Vercel Dashboard
├── Deployments          # Historia deploymentów
│   └── [deployment]
│       └── Functions    # Logi serverless functions
├── Settings
│   ├── Environment Variables    # Zmienne środowiskowe
│   ├── Domains                  # Custom domains
│   └── Git                      # GitHub integration
└── Analytics           # Statystyki (opcjonalnie)
```

## 🧪 Testy

```bash
# Local tests
npm test

# Smoke tests
npm run smoke

# Manual test
curl http://localhost:3003/api/health
```

## 📝 Dodawanie nowego endpointu

### Krok 1: Edytuj `api/index.js`

```javascript
// Dodaj handler
async function handleNewEndpoint(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// Dodaj case w switch
switch (endpoint) {
  // ... existing cases
  case 'new':
    return await handleNewEndpoint(req, res);
}
```

### Krok 2: Edytuj `vercel.json`

```json
{
  "rewrites": [
    // ... existing rewrites
    { "source": "/api/new", "destination": "/api/index/new" }
  ]
}
```

### Krok 3: Deploy

```bash
git add api/index.js vercel.json
git commit -m "Add new endpoint"
git push

# Auto-deploy przez Vercel
```

## 🔐 Supabase Quick Reference

```javascript
// Query example
const { data, error } = await supabase
  .from('table_name')
  .select('*')
  .eq('column', 'value');

// Insert
const { data, error } = await supabase
  .from('table_name')
  .insert([{ column: 'value' }]);

// Update
const { data, error } = await supabase
  .from('table_name')
  .update({ column: 'new_value' })
  .eq('id', '123');
```

## 📚 Linki szybkiego dostępu

| Co | Link |
|----|------|
| Vercel Dashboard | https://vercel.com/dashboard |
| Supabase Dashboard | https://supabase.com/dashboard |
| Google Cloud | https://console.cloud.google.com |
| Vercel Docs | https://vercel.com/docs |
| Supabase Docs | https://supabase.com/docs |

## ⚡ One-liners

```bash
# Sprawdź status deploymentu
vercel inspect [url]

# Preview deployment (branch)
vercel

# Production deployment
vercel --prod

# Alias domain
vercel alias [deployment-url] [domain]

# Env vars
vercel env add SUPABASE_URL
vercel env ls

# Usuń deployment
vercel rm [deployment-id]
```

## 🎯 Gotowe snippety

### JavaScript fetch (frontend)

```javascript
// Health check
const response = await fetch('https://your-app.vercel.app/api/health');
const data = await response.json();
console.log(data);

// NLU
const response = await fetch('https://your-app.vercel.app/api/nlu', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'Chcę zamówić pizzę' })
});
const data = await response.json();
console.log(data.parsed);

// Error handling
try {
  const response = await fetch('https://your-app.vercel.app/api/orders');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  console.log(data.orders);
} catch (error) {
  console.error('Error:', error);
}
```

### Python requests

```python
import requests

# Health check
r = requests.get('https://your-app.vercel.app/api/health')
print(r.json())

# NLU
r = requests.post('https://your-app.vercel.app/api/nlu',
                  json={'text': 'Chcę zamówić pizzę'})
print(r.json()['parsed'])
```

## 🔥 Przydatne aliasy bash

```bash
# Dodaj do ~/.bashrc lub ~/.zshrc

alias vdeploy='vercel --prod'
alias vlogs='vercel logs'
alias venv='vercel env ls'

# API testing
alias api-health='curl https://your-app.vercel.app/api/health'
alias api-list='curl https://your-app.vercel.app/api'

# Local dev
alias dev-start='npm start'
alias dev-test='npm test'
```

## ✅ Pre-deploy checklist (ultra-short)

- [ ] `vercel.json` w root
- [ ] `api/index.js` istnieje
- [ ] Env vars w Vercel
- [ ] `git push` zrobiony
- [ ] Deploy triggered

## 🎉 Post-deploy checklist

- [ ] `/api/health` zwraca 200
- [ ] Logi działają (console.log widoczny)
- [ ] CORS działa (brak błędów w przeglądarce)
- [ ] Wszystkie endpointy testowane

---

**💡 Pro tip:** Zapisz tego linka w zakładkach: https://your-app.vercel.app/api
