# SESSION LIFECYCLE — FRONTEND INTEGRATION GUIDE
## Context: Conversation Isolation (One session_id = One conversation)

---

## 🎯 ZASADA KLUCZOWA

**Po każdej odpowiedzi z backendu frontend MUSI sprawdzić:**

```typescript
if (response.conversationClosed === true) {
  // Natychmiast przełącz na nowy session_id
  setSessionId(response.newSessionId);
  resetLocalDialogState();
}
```

---

## 📦 STRUKTURA ODPOWIEDZI (Backend → Frontend)

Gdy konwersacja jest zamykana, backend zwraca:

```json
{
  "conversationClosed": true,
  "newSessionId": "sess_1737284025123_abc123",
  "closedReason": "CART_ITEM_ADDED | ORDER_CONFIRMED",
  "reply": "Dodano do koszyka. Coś jeszcze?",
  ...
}
```

### Pola lifecycle:
| Pole | Typ | Opis |
|------|-----|------|
| `conversationClosed` | `boolean` | Czy konwersacja została zamknięta |
| `newSessionId` | `string` | ID do użycia przy następnym request |
| `closedReason` | `enum` | Powód zamknięcia: `CART_ITEM_ADDED` lub `ORDER_CONFIRMED` |

---

## ✅ REFERENCYJNY KOD (WKLEJALNY)

### React Hook: useBrainSession.ts

```typescript
import { useState, useCallback } from 'react';

export function useBrainSession(initialSessionId?: string) {
  const [sessionId, setSessionId] = useState<string>(
    initialSessionId || generateLocalSessionId()
  );
  
  const handleBrainResponse = useCallback((response: BrainResponse) => {
    // ═══════════════════════════════════════════════════════════════
    // CONVERSATION BOUNDARY CHECK
    // ═══════════════════════════════════════════════════════════════
    if (response.conversationClosed === true) {
      console.info(
        '[SessionLifecycle] Conversation closed:',
        response.closedReason
      );
      
      // MUST: Switch to new session ID immediately
      setSessionId(response.newSessionId);
      
      // Reset UI-only state (not cart, not backend)
      resetLocalDialogState();
    }
    
    return response;
  }, []);
  
  return { sessionId, handleBrainResponse };
}

function generateLocalSessionId(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  return `sess_${ts}_${rand}`;
}

function resetLocalDialogState(): void {
  // ❌ NIE resetuje koszyka
  // ❌ NIE resetuje backendu
  // ✅ Resetuje tylko UI
  //    - wyczyść input text
  //    - zatrzymaj voice recording
  //    - wyczyść pending hints
}
```

### Fetch wrapper: sendToBrain.ts

```typescript
async function sendToBrain(sessionId: string, text: string): Promise<BrainResponse> {
  const response = await fetch('/api/brain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, text })
  });
  
  const data = await response.json();
  
  // Log lifecycle events for debugging
  if (data.conversationClosed) {
    console.log(`[Brain] Session ${sessionId} closed. Next: ${data.newSessionId}`);
  }
  
  return data;
}
```

---

## 🧪 CHECKLISTA REGRESYJNA

### 1️⃣ CART_ITEM_ADDED
```
User: "Poproszę kebaba"
→ Backend returns: conversationClosed=true, closedReason="CART_ITEM_ADDED"
→ Frontend saves newSessionId
→ Następna wypowiedź → nowa rozmowa w Admin Panelu
```

### 2️⃣ ORDER_CONFIRMED
```
User: "Potwierdzam"
→ Backend returns: conversationClosed=true, closedReason="ORDER_CONFIRMED"
→ Frontend saves newSessionId
→ Kolejna wypowiedź → nowy timeline w adminie
```

### 3️⃣ BACKEND FAILSAFE
```
Frontend ignoruje newSessionId i wysyła stary ID:
→ Pipeline automatycznie generuje nową sesję
→ Brak crasha
→ Brak FSM leakage
```

### 4️⃣ ADMIN PANEL
```
Każdy session_id:
✓ ma początek (created)
✓ ma koniec (closedAt)
✓ ma reason (closedReason)
```

---

## ⚠️ WAŻNE UWAGI

### Co resetLocalDialogState() MUSI robić:
- ✅ Wyczyścić pole tekstowe input
- ✅ Zatrzymać nagrywanie głosu (jeśli aktywne)
- ✅ Wyczyścić pending UI hints (suggestions, panels)
- ✅ Ustawić focus na input (ready for next conversation)

### Co resetLocalDialogState() NIE MOŻE robić:
- ❌ Czyścić koszyk (cart) — to jest persystentne
- ❌ Wywoływać API backendu — backend już zresetował sesję
- ❌ Zmieniać restauracji w UI — użytkownik może robić multi-restaurant order

---

## 🔄 DIAGRAM PRZEPŁYWU

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                 │
└─────────────────────────────────────────────────────────────────┘
         │
         │ sendToBrain(sessionId, "Poproszę kebaba")
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                        BACKEND                                  │
│  ┌───────────────┐    ┌──────────────┐    ┌─────────────────┐  │
│  │ getOrCreate   │ →  │ NLU + Handler│ →  │ closeConversation│  │
│  │ ActiveSession │    │              │    │ (returns newId) │  │
│  └───────────────┘    └──────────────┘    └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │
         │ Response: { conversationClosed: true, newSessionId: "..." }
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ if (response.conversationClosed) {                        │  │
│  │   setSessionId(response.newSessionId) // ← KRYTYCZNE     │  │
│  │   resetLocalDialogState()                                 │  │
│  │ }                                                         │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │
         │ Następny input → używa newSessionId
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ADMIN PANEL                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Timeline 1: sess_123...                                     ││
│  │   └─ [10:30] "Poproszę kebaba"                             ││
│  │   └─ [10:30] → CART_ITEM_ADDED ■ CLOSED                    ││
│  │                                                             ││
│  │ Timeline 2: sess_456... (NEW)                               ││
│  │   └─ [10:31] "A jeszcze colę"                              ││
│  │   └─ ...                                                    ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## 📋 TypeScript Interface

```typescript
interface BrainResponse {
  ok: boolean;
  session_id: string;
  reply: string;
  intent: string;
  
  // Session Lifecycle (NEW)
  conversationClosed?: boolean;
  newSessionId?: string;
  closedReason?: 'CART_ITEM_ADDED' | 'ORDER_CONFIRMED';
  
  // Standard fields
  restaurants?: Restaurant[];
  menuItems?: MenuItem[];
  actions?: Action[];
  meta?: ResponseMeta;
}
```
