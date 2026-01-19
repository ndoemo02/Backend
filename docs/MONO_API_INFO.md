# Mono-API Architecture

## Dlaczego Mono-API?

Vercel Trial (darmowy plan) ma **limit 12 serverless functions**. Zamiast tworzyć osobny plik dla każdego endpointu (co szybko wyczerpałoby limit), wszystkie endpointy są obsługiwane przez **jeden plik**: `/api/index.js`.

## Jak to działa?

1. **Routing w `vercel.json`**:
   - `/api/health` → `/api/index/health`
   - `/api/tts` → `/api/index/tts`
   - `/api/restaurants` → `/api/index/restaurants`
   - itd.

2. **Handler w `/api/index.js`**:
   - Analizuje ścieżkę URL (`req.url`)
   - Wywołuje odpowiedni handler (np. `handleHealth`, `handleTts`)
   - Zwraca wynik

## Dostępne Endpointy

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/health` | GET | Health check |
| `/api/tts` | POST | Text-to-Speech |
| `/api/nlu` | POST | Natural Language Understanding |
| `/api/restaurants` | GET | Lista restauracji (z Supabase) |
| `/api/menu` | GET | Menu restauracji (wymaga `restaurant_id`) |
| `/api/orders` | GET/POST | Zamówienia (lista lub utworzenie) |
| `/api/search` | GET | Wyszukiwanie miejsc (Google Places) |
| `/api/places` | GET | Alias dla `/api/search` |

## Przykłady użycia

```bash
# Health check
curl https://your-app.vercel.app/api/health

# Wyszukiwanie restauracji
curl https://your-app.vercel.app/api/restaurants?q=pizza

# Menu restauracji
curl https://your-app.vercel.app/api/menu?restaurant_id=123

# NLU
curl -X POST https://your-app.vercel.app/api/nlu \
  -H "Content-Type: application/json" \
  -d '{"text": "Chcę zamówić pizzę margherita"}'

# Utworzenie zamówienia
curl -X POST https://your-app.vercel.app/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "restaurantId": "123",
    "items": [{"name": "Pizza", "qty": 1, "price": 25}],
    "customerId": "user-123",
    "total": 25
  }'
```

## Zalety

✅ Tylko 1 serverless function (zamiast 8+)  
✅ Łatwe dodawanie nowych endpointów  
✅ Wspólny kod CORS i obsługi błędów  
✅ Mieści się w limicie Vercel Trial  

## Wady

⚠️ Wszystkie endpointy dzielą ten sam cold start  
⚠️ Jeden błąd może wpłynąć na całe API  
⚠️ Trudniejsze rozdzielanie uprawnień per endpoint  

## Migracja na więcej endpointów

Jeśli przejdziesz na Vercel Pro (lub inny plan), możesz łatwo rozdzielić mono-API na osobne pliki:

```bash
# Utwórz osobne pliki
cp api/index.js api/health.js  # i wyodrębnij tylko handleHealth
cp api/index.js api/tts.js     # i wyodrębnij tylko handleTts
# ... itd.

# Usuń rewrites z vercel.json
```
