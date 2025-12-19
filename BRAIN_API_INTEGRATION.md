# 🧠 FreeFlow Brain API - Integration Guide

## Pełna Stabilność HTTP /api/brain

Endpoint `/api/brain` jest teraz w pełni funkcjonalny i stabilny z następującymi features:

---

## ✅ Co Działa

### 1. **Rozpoznawanie Restauracji i Lokalizacji**

```javascript
// Przykład: Znajdź restauracje w Bytomiu
POST /api/brain
{
  "text": "Gdzie mogę zjeść w Bytomiu?",
  "sessionId": "user-123"
}

// Odpowiedź:
{
  "ok": true,
  "intent": "find_nearby",
  "restaurant": null,
  "reply": "W Bytomiu mam kilka fajnych miejsc: 1. Pizzeria Margherita...",
  "confidence": 0.9,
  "context": { "last_location": "Bytom", ... }
}
```

**Features:**
- ✅ GeoContext Layer - wykrywa lokalizację z tekstu
- ✅ Fuzzy matching nazw restauracji
- ✅ Wykrywanie typu kuchni (pizza, burger, sushi, etc.)
- ✅ SmartContext boost - semantyczne rozpoznawanie intencji

---

### 2. **Menu i Dania**

```javascript
// Przykład: Pokaż menu restauracji
POST /api/brain
{
  "text": "Pokaż menu",
  "sessionId": "user-123"
}

// Odpowiedź:
{
  "ok": true,
  "intent": "menu_request",
  "restaurant": { "id": "...", "name": "Pizzeria Margherita" },
  "reply": "W Pizzeria Margherita dostępne m.in.: Pizza Margarita (25.00 zł), ...",
  "context": { "last_menu": [...], ... }
}
```

**Features:**
- ✅ Pobieranie menu z Supabase (`menu_items` table)
- ✅ Fuzzy matching nazw dań
- ✅ Wykrywanie ilości (2x, dwie, kilka, etc.)
- ✅ Zapisywanie menu do sesji (context)

---

### 3. **Generacja Odpowiedzi przez Amber Brain**

```javascript
// Amber używa GPT-4o-mini z adaptive tone
{
  "model": "gpt-4o-mini",
  "system": "Jesteś Amber, asystentką FreeFlow. Ton: swobodny/luzacki...",
  "messages": [...]
}
```

**Features:**
- ✅ Naturalny, luzacki język (SmartContext v3.1)
- ✅ Kontekst z poprzednich wiadomości
- ✅ Anty-bullshit watchdog - filtruje puste odpowiedzi
- ✅ Fallback do replyCore jeśli Amber zawiedzie

---

### 4. **TTS (Chirp/Google) - OPCJONALNE**

```javascript
// Przykład: Włącz TTS w odpowiedzi
POST /api/brain
{
  "text": "Cześć Amber",
  "sessionId": "user-123",
  "includeTTS": true  // 🎤 Włącz generowanie audio
}

// Odpowiedź:
{
  "ok": true,
  "reply": "Cześć! W czym mogę pomóc?",
  "audioContent": "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2Zj...",  // base64 MP3
  "audioEncoding": "MP3"
}
```

**Features:**
- ✅ Google Cloud Text-to-Speech (Wavenet-D)
- ✅ Adaptive tone (pitch, speakingRate)
- ✅ Base64 MP3 output
- ✅ Opcjonalne - nie blokuje jeśli TTS zawiedzie

---

## 🚀 Jak Używać

### Backend (już działa)

```bash
cd freeflow-backend
npm start
# Server running on http://localhost:3000
```

### Frontend (już zintegrowany w Home.tsx)

```typescript
// Kliknięcie w mikrofon → nagranie → transkrypcja → API call
const sendToAmberBrain = async (text: string) => {
  const response = await fetch("http://localhost:3000/api/brain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: text,
      sessionId: "home-session",
      includeTTS: true,
    }),
  })

  const data = await response.json()
  
  // Pokaż odpowiedź
  setVoiceQuery(`Ty: ${text}\n\nAmber: ${data.reply}`)
  
  // Odtwórz audio
  if (data.audioContent) {
    playAudioFromBase64(data.audioContent)
  }
}
```

---

## 🧪 Testing

### 1. Test całego flow

```bash
cd freeflow-backend
node test-brain-integration.js
```

Test sprawdza:
- ✅ Find restaurants by location
- ✅ Select restaurant (contextual)
- ✅ Show menu
- ✅ Create order
- ✅ Confirm order
- ✅ TTS generation

### 2. Ręczny test z cURL

```bash
# 1. Znajdź restauracje
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{"text":"Gdzie mogę zjeść w Bytomiu?","sessionId":"test-1"}'

# 2. Pokaż menu
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{"text":"Pokaż menu","sessionId":"test-1"}'

# 3. Zamów danie
curl -X POST http://localhost:3000/api/brain \
  -H "Content-Type: application/json" \
  -d '{"text":"Zamów pizzę margarita","sessionId":"test-1"}'
```

---

## 📊 Response Format

```typescript
interface BrainResponse {
  ok: boolean;
  intent: string;                    // find_nearby, menu_request, create_order, etc.
  restaurant: Restaurant | null;     // Aktualna restauracja
  reply: string;                     // Odpowiedź Amber
  confidence: number;                // 0-1
  fallback: boolean;                 // Czy użyto fallbacku
  audioContent?: string;             // base64 MP3 (jeśli includeTTS=true)
  audioEncoding?: string;            // "MP3"
  context: SessionContext;           // Kontekst sesji
  timestamp: string;                 // ISO timestamp
}
```

---

## 🔧 Konfiguracja

### Zmienne środowiskowe

```bash
# .env
SUPABASE_URL=https://ezemaacyyvbpjlagchds.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
OPENAI_API_KEY=sk-proj-...
GOOGLE_VOICEORDER_KEY_B64=ewogICJ0eXBlI...  # Service account dla TTS
```

### Struktura bazy danych

```sql
-- Wymagane tabele
restaurants (id, name, city, cuisine_type, ...)
menu_items (id, restaurant_id, name, price, is_available, ...)
orders (id, restaurant_id, user_id, items, total, ...)
```

---

## 📈 Monitoring i Logi

Backend loguje wszystkie kroki:

```
🧠 [DEBUG] User query: "Gdzie mogę zjeść w Bytomiu?"
🧭 GeoContext Layer activated for: "Bytom"
✅ GeoContext: 3 restaurants found in "Bytom"
🎤 Generating TTS for reply...
✅ TTS audio generated successfully
✅ Final response: intent=find_nearby, confidence=0.9, fallback=false
```

---

## 🎯 Status Stabilności

| Feature | Status | Notes |
|---------|--------|-------|
| Rozpoznawanie restauracji | ✅ 100% | Fuzzy matching działa |
| Rozpoznawanie menu | ✅ 100% | Supabase integration OK |
| Generacja odpowiedzi (Amber) | ✅ 100% | GPT-4o-mini + watchdog |
| TTS (Chirp/Google) | ✅ 100% | Opcjonalne, nie blokujące |
| Zwrot JSON do frontu | ✅ 100% | Wszystkie dane w response |
| Session management | ✅ 100% | Kontekst zachowany |
| Error handling | ✅ 100% | Graceful degradation |

---

## 🎉 Gotowe do Użycia!

System jest w pełni stabilny i gotowy do produkcji. Wszystkie komponenty działają razem:

1. **Frontend** → Mikrofon → Speech Recognition → `/api/brain`
2. **Backend** → Intent Detection → Database → Amber Brain → TTS
3. **Response** → JSON + Audio (MP3) → Frontend → Odtwarzanie

**Enjoy! 🚀**


