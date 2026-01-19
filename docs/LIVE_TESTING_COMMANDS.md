# 🧪 Komendy do Testowania na Żywych Danych

## 🚀 Uruchomienie Backendu

```bash
cd freeflow-backend
npm run dev
```

Backend powinien być dostępny na: `http://localhost:3000`

---

## 📋 BRAIN API - Testowanie Live

### 1. Health Check
```bash
curl http://localhost:3000/api/health
```

**Oczekiwany wynik:**
```json
{
  "ok": true,
  "node": "v20.x.x",
  "service": "FreeFlow Voice Expert",
  "supabase": {
    "ok": true,
    "time": "50.2 ms"
  }
}
```

---

### 2. Znajdź Restauracje w Lokalizacji

```bash
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Gdzie mogę zjeść w Piekarach Śląskich?",
    "sessionId": "test-123"
  }'
```

**Warianty:**
```bash
# Pizza w Bytomiu
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{"text": "Gdzie zjeść pizzę w Bytomiu?", "sessionId": "test-123"}'

# Kebab w Katowicach
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{"text": "Gdzie jest kebab w Katowicach?", "sessionId": "test-123"}'

# Coś azjatyckiego
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{"text": "Chcę coś azjatyckiego w Piekarach", "sessionId": "test-123"}'
```

---

### 3. Menu Restauracji

```bash
# Wybierz restaurację
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Pokaż menu Monte Carlo",
    "sessionId": "test-menu-123"
  }'

# Lub z kontekstem (po wcześniejszym wyborze)
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Pokaż menu",
    "sessionId": "test-menu-123"
  }'
```

---

### 4. Złóż Zamówienie

```bash
# Zamówienie z nazwą restauracji
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Zamów pizzę Margherita w Monte Carlo",
    "sessionId": "test-order-123"
  }'

# Z ilością
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Zamów 2x pizza Margherita",
    "sessionId": "test-order-123"
  }'

# Duża pizza
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Zamów dużą pizzę Margherita",
    "sessionId": "test-order-123"
  }'

# Wiele pozycji
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Zamów pizzę Margherita i pizzę Pepperoni",
    "sessionId": "test-order-123"
  }'
```

---

### 5. Rekomendacje

```bash
# Co polecisz?
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Co polecisz?",
    "sessionId": "test-recommend-123"
  }'

# Najlepsza pizza
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Polecisz dobrą pizzę?",
    "sessionId": "test-recommend-123"
  }'
```

---

### 6. Follow-up (z kontekstem sesji)

```bash
# Krok 1: Wybierz restaurację
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Monte Carlo",
    "sessionId": "flow-test-456"
  }'

# Krok 2: Pokaż menu (kontekst z sesji)
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Pokaż menu",
    "sessionId": "flow-test-456"
  }'

# Krok 3: Zamów (kontekst z sesji)
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Zamów pizzę Margherita",
    "sessionId": "flow-test-456"
  }'

# Krok 4: Potwierdzenie
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Tak",
    "sessionId": "flow-test-456"
  }'
```

---

### 7. Smart Context Tests

```bash
# "Nie" - zmiana restauracji
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Nie, pokaż inne restauracje",
    "sessionId": "context-test-789"
  }'

# Na szybko
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Chcę coś na szybko",
    "sessionId": "context-test-789"
  }'

# Mam ochotę na...
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Mam ochotę na pizzę",
    "sessionId": "context-test-789"
  }'
```

---

### 8. Edge Cases & Typos

```bash
# Literówka w nazwie
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Menu Monte Karlo",
    "sessionId": "edge-test-999"
  }'

# Brak polskich znaków
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Gdzie zjesc w Piekarach Slaskich?",
    "sessionId": "edge-test-999"
  }'

# Bardzo długie zapytanie
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hej, chciałbym zamówić coś do jedzenia, może jakąś pizzę, ale nie jestem pewien którą, może Margherita albo coś innego, co polecasz w restauracji Monte Carlo?",
    "sessionId": "edge-test-999"
  }'
```

---

## 🛒 ORDERS API - Testowanie Live

### 1. Pobierz Listę Zamówień

```bash
# Wszystkie zamówienia
curl http://localhost:3000/api/orders

# Z filtrem statusu
curl "http://localhost:3000/api/orders?status=pending"
```

---

### 2. Utwórz Zamówienie

```bash
# Podstawowe zamówienie
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "restaurant_id": "YOUR_RESTAURANT_ID",
    "items": [
      {
        "name": "Pizza Margherita",
        "quantity": 1,
        "price": 25.00
      }
    ],
    "sessionId": "order-test-123"
  }'

# Zamówienie wielopozycyjne
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "restaurant_id": "YOUR_RESTAURANT_ID",
    "items": [
      {
        "name": "Pizza Margherita",
        "quantity": 2,
        "price": 25.00
      },
      {
        "name": "Cola 0.5L",
        "quantity": 2,
        "price": 8.00
      }
    ],
    "sessionId": "order-test-123"
  }'
```

---

### 3. Zamówienie z Tekstem (NLP)

```bash
# Zamówienie tekstowe
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Chcę zamówić pizzę Margherita",
    "restaurant_name": "Monte Carlo",
    "user_email": "test@example.com"
  }'

# Z literówką w nazwie restauracji
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Zamów pizzę",
    "restaurant_name": "Monte Karlo",
    "user_email": "test@example.com"
  }'
```

---

## 🏪 RESTAURANTS API

### 1. Wszystkie Restauracje

```bash
curl http://localhost:3000/api/restaurants
```

---

### 2. Restauracje w Pobliżu

```bash
# Piekary Śląskie (50.3859, 18.9461)
curl "http://localhost:3000/api/restaurants/nearby?lat=50.3859&lng=18.9461&radius=5"

# Katowice centrum (50.2649, 19.0238)
curl "http://localhost:3000/api/restaurants/nearby?lat=50.2649&lng=19.0238&radius=3"

# Bytom (50.3484, 18.9156)
curl "http://localhost:3000/api/restaurants/nearby?lat=50.3484&lng=18.9156&radius=5"
```

---

### 3. Menu Restauracji

```bash
# Pobierz ID restauracji najpierw
RESTAURANT_ID=$(curl -s http://localhost:3000/api/restaurants | jq -r '.data[0].id')

# Pobierz menu
curl "http://localhost:3000/api/menu/$RESTAURANT_ID"
```

---

## 📊 BRAIN STATS

```bash
# Statystyki sesji
curl "http://localhost:3000/api/brain/stats?sessionId=test-123"

# Wszystkie statystyki
curl http://localhost:3000/api/brain/stats
```

---

## 🔧 Pomocnicze Skrypty

### PowerShell (Windows)

```powershell
# Test Brain API
$body = @{
    text = "Gdzie zjeść w Piekarach?"
    sessionId = "ps-test-" + (Get-Date -Format "HHmmss")
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/brain" -Method POST -Body $body -ContentType "application/json"

# Test z pretty print
$response = Invoke-RestMethod -Uri "http://localhost:3000/api/brain" -Method POST -Body $body -ContentType "application/json"
$response | ConvertTo-Json -Depth 10
```

---

### Bash (Linux/Mac)

```bash
#!/bin/bash
# test-brain.sh

BASE_URL="http://localhost:3000"
SESSION_ID="bash-test-$(date +%s)"

# Test 1: Find nearby
echo "🔍 Test 1: Find nearby restaurants"
curl -s -X POST "$BASE_URL/api/brain" \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"Gdzie zjeść w Piekarach?\", \"sessionId\": \"$SESSION_ID\"}" \
  | jq .

# Test 2: Show menu
echo -e "\n🍕 Test 2: Show menu"
curl -s -X POST "$BASE_URL/api/brain" \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"Pokaż menu Monte Carlo\", \"sessionId\": \"$SESSION_ID\"}" \
  | jq .

# Test 3: Create order
echo -e "\n🛒 Test 3: Create order"
curl -s -X POST "$BASE_URL/api/brain" \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"Zamów pizzę Margherita\", \"sessionId\": \"$SESSION_ID\"}" \
  | jq .
```

Uruchomienie:
```bash
chmod +x test-brain.sh
./test-brain.sh
```

---

## 🧪 Pełny Flow Test

```bash
# 1. Health check
echo "=== Health Check ==="
curl -s http://localhost:3000/api/health | jq .

# 2. Find restaurants
echo -e "\n=== Find Restaurants ==="
RESPONSE=$(curl -s -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{"text": "Gdzie zjeść w Piekarach?", "sessionId": "flow-complete-001"}')
echo $RESPONSE | jq .

# 3. Select restaurant
echo -e "\n=== Select Restaurant ==="
curl -s -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{"text": "Monte Carlo", "sessionId": "flow-complete-001"}' | jq .

# 4. Show menu
echo -e "\n=== Show Menu ==="
curl -s -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{"text": "Pokaż menu", "sessionId": "flow-complete-001"}' | jq .

# 5. Create order
echo -e "\n=== Create Order ==="
curl -s -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{"text": "Zamów pizzę Margherita", "sessionId": "flow-complete-001"}' | jq .

# 6. Check stats
echo -e "\n=== Check Stats ==="
curl -s "http://localhost:3000/api/brain/stats?sessionId=flow-complete-001" | jq .
```

---

## 📝 Zapisywanie Wyników

```bash
# Zapisz do pliku
curl -s http://localhost:3000/api/health > health-check.json

# Zapisz z timestampem
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
curl -s -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{"text": "Test", "sessionId": "log-test"}' > "test_$TIMESTAMP.json"

# Zapisz tylko odpowiedź Amber
curl -s -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{"text": "Gdzie zjeść?", "sessionId": "test"}' | jq -r '.reply'
```

---

## 🎯 Quick Test Suite

```bash
# Szybki test wszystkich endpointów
echo "🧪 Quick Test Suite"
echo "=================="

echo -n "Health: "
curl -s http://localhost:3000/api/health | jq -r '.ok'

echo -n "Restaurants: "
curl -s http://localhost:3000/api/restaurants | jq -r '.ok // "ok"'

echo -n "Brain API: "
curl -s -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{"text": "test", "sessionId": "quick"}' | jq -r '.ok'

echo -n "Orders: "
curl -s http://localhost:3000/api/orders | jq -r 'if type == "array" then "ok" else .ok end'

echo "=================="
echo "✅ All endpoints responding"
```

---

## 💡 Tips

### 1. Użyj `jq` do formatowania JSON
```bash
# Instalacja (Ubuntu/Debian)
sudo apt-get install jq

# Instalacja (Mac)
brew install jq

# Windows (Chocolatey)
choco install jq
```

### 2. Watch mode (auto-refresh)
```bash
watch -n 5 'curl -s http://localhost:3000/api/health | jq .'
```

### 3. Performance test
```bash
time curl -s -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{"text": "Test", "sessionId": "perf"}'
```

### 4. Concurrent requests
```bash
for i in {1..10}; do
  curl -s -X POST http://localhost:3000/api/brain \
    -H "Content-Type: application/json" \
    -d "{\"text\": \"Test $i\", \"sessionId\": \"concurrent-$i\"}" &
done
wait
```

---

**Pro Tip:** Zapisz często używane komendy jako aliasy w `.bashrc` lub `.zshrc`:

```bash
alias freeflow-health='curl -s http://localhost:3000/api/health | jq .'
alias freeflow-test='curl -s -X POST http://localhost:3000/api/brain -H "Content-Type: application/json" -d'
```

---

**Dokumentacja:** [BRAIN_API_TESTS.md](./BRAIN_API_TESTS.md)  
**Testy Automatyczne:** `npm run test:brain` lub `npm run test:orders`

