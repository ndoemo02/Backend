# Response Architecture - System Overview

## Architektura warstwowa (po implementacji ResponseController)

```
┌─────────────────────────────────────────────────────────────┐
│                        USER REQUEST                          │
│                     "Szukam pizzy w Piekarach"               │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                      BRAIN PIPELINE                          │
│  (brainV2.js / brainRouter.js - NIE ZMIENIONE)              │
│  - Routing                                                   │
│  - Session Management                                        │
│  - Handler Selection                                         │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                     NLU LAYER                                │
│  (NLURouter - NIE ZMIENIONY)                                │
│  - Intent Detection                                          │
│  - Entity Extraction                                         │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                  DOMAIN HANDLERS                             │
│  (FindRestaurantHandler, MenuHandler, etc.)                 │
│                                                              │
│  ┌──────────────────────────────────────────────┐           │
│  │  1. Business Logic (CO powiedzieć)           │           │
│  │     - Fetch data from DB/Repository          │           │
│  │     - Process entities                       │           │
│  │     - Generate rawReply                      │           │
│  └─────────────────┬────────────────────────────┘           │
│                    │                                         │
│                    ▼                                         │
│  ┌──────────────────────────────────────────────┐           │
│  │  2. Call ResponseController.finalizeResponse │  ◄─────┐  │
│  │     - Pass rawReply + context                │        │  │
│  │     - Guard prevents double finalization     │        │  │
│  └─────────────────┬────────────────────────────┘        │  │
└────────────────────┼──────────────────────────────────────┼──┘
                     │                                      │
                     │          ┌───────────────────────────┘
                     │          │ GUARD MECHANISM
                     │          │ (responseFinalized flag)
                     ▼          │
┌─────────────────────────────────────────────────────────────┐
│              RESPONSE CONTROLLER                             │
│  (ResponseController.js - NOWY MODUŁ)                       │
│                                                              │
│  ┌──────────────────────────────────────────────┐           │
│  │  A. Guard Check                              │           │
│  │     - if responseFinalized → THROW ERROR     │           │
│  │     - else: set responseFinalized = true     │           │
│  └─────────────────┬────────────────────────────┘           │
│                    ▼                                         │
│  ┌──────────────────────────────────────────────┐           │
│  │  B. Call ResponsePolicyResolver              │  ◄────┐   │
│  │     - Determine HOW to speak                 │       │   │
│  │     - style, verbosity, shouldUseLLM         │       │   │
│  └─────────────────┬────────────────────────────┘       │   │
│                    ▼                                     │   │
│  ┌──────────────────────────────────────────────┐       │   │
│  │  C. Apply Transformations (if ACTIVE_MODE)   │       │   │
│  │     - Verbosity adjustment                   │       │   │
│  │     - LLM Stylization (GPT-4o)              │       │   │
│  └─────────────────┬────────────────────────────┘       │   │
│                    ▼                                     │   │
│  ┌──────────────────────────────────────────────┐       │   │
│  │  D. Logging & Analytics                      │       │   │
│  │     - Log policy decision                    │       │   │
│  │     - Track transformations                  │       │   │
│  └─────────────────┬────────────────────────────┘       │   │
│                    ▼                                     │   │
│  ┌──────────────────────────────────────────────┐       │   │
│  │  E. Return Finalized Response                │       │   │
│  │     - reply (final)                          │       │   │
│  │     - policy (metadata)                      │       │   │
│  │     - rawReply (debug)                       │       │   │
│  └─────────────────┬────────────────────────────┘       │   │
└────────────────────┼──────────────────────────────────────┼──┘
                     │                                      │
                     │          ┌───────────────────────────┘
                     │          │
                     ▼          ▼
┌─────────────────────────────────────────────────────────────┐
│            RESPONSE POLICY RESOLVER                          │
│  (ResponsePolicyResolver.js - NOWY MODUŁ)                   │
│                                                              │
│  ┌──────────────────────────────────────────────┐           │
│  │  1. Get Default Policy for Intent            │           │
│  │     - Map intent → base policy               │           │
│  └─────────────────┬────────────────────────────┘           │
│                    ▼                                         │
│  ┌──────────────────────────────────────────────┐           │
│  │  2. Adapt to Session Context                 │           │
│  │     - Long session → casual                  │           │
│  │     - After error → empathetic               │           │
│  └─────────────────┬────────────────────────────┘           │
│                    ▼                                         │
│  ┌──────────────────────────────────────────────┐           │
│  │  3. Apply Admin Overrides (Dev Panel)        │           │
│  │     - forceStyle, disableLLM, etc.           │           │
│  └─────────────────┬────────────────────────────┘           │
│                    ▼                                         │
│  ┌──────────────────────────────────────────────┐           │
│  │  4. Return Policy Object                     │           │
│  │     { style, verbosity, shouldUseLLM, ... }  │           │
│  └──────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  FINAL RESPONSE │
                    │  to USER        │
                    └─────────────────┘
```

---

## Flow Diagram: Shadow Mode vs Active Mode

### SHADOW MODE (domyślny - SAFE)
```
┌──────────────┐
│   Handler    │
│ rawReply =   │
│ "Znalazłam   │
│ 5 restauracji│
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────┐
│   ResponseController.finalizeResponse│
│                                      │
│   Policy Resolved: ✅                │
│   - style: 'enthusiastic'            │
│   - shouldUseLLM: true               │
│                                      │
│   Transformations Applied: ❌        │  ◄── SHADOW MODE
│   (SHADOW_MODE=true)                 │
│                                      │
│   finalReply = rawReply              │  ◄── Identyczne!
│   "Znalazłam 5 restauracji"          │
│                                      │
│   Logged: ✅ (analytics)             │
└──────────────┬───────────────────────┘
               │
               ▼
        ┌─────────────┐
        │  USER sees: │
        │ "Znalazłam  │
        │ 5 restauracji"│  ◄── Bez zmian!
        └─────────────┘
```

### ACTIVE MODE (po testach A/B)
```
┌──────────────┐
│   Handler    │
│ rawReply =   │
│ "Znalazłam   │
│ 5 restauracji│
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────┐
│   ResponseController.finalizeResponse│
│                                      │
│   Policy Resolved: ✅                │
│   - style: 'enthusiastic'            │
│   - verbosity: 'concise'             │
│   - shouldUseLLM: true               │
│                                      │
│   Transformations Applied: ✅        │  ◄── ACTIVE MODE
│   (ACTIVE_MODE=true)                 │
│                                      │
│   1. Verbosity → concise             │
│      "Znalazłam 5 restauracji"       │
│      → "Znalazłam 5 restauracji."    │
│                                      │
│   2. LLM Stylization (GPT-4o)        │
│      → "Super! Mam dla Ciebie 5      │
│         knajp. Który wybierasz?"     │  ◄── Transformed!
│                                      │
│   Logged: ✅                         │
└──────────────┬───────────────────────┘
               │
               ▼
        ┌─────────────┐
        │  USER sees: │
        │ "Super! Mam │
        │ dla Ciebie  │
        │ 5 knajp..."  │  ◄── Zmienione!
        └─────────────┘
```

---

## Guard Mechanism - Sequence Diagram

```
Handler                ResponseController              Context
   │                            │                         │
   │  rawReply = "..."         │                         │
   │ ─────────────────────────▶│                         │
   │                            │                         │
   │                            │  Check: responseFinalized?
   │                            │ ───────────────────────▶│
   │                            │                         │
   │                            │◀─ false (fresh context) │
   │                            │                         │
   │                            │  Set: responseFinalized=true
   │                            │ ───────────────────────▶│
   │                            │                         │
   │                            │  Resolve Policy         │
   │                            │  Apply Transformations  │
   │                            │  Log Analytics          │
   │                            │                         │
   │◀──── finalized.reply ──────│                         │
   │                            │                         │
   │                            │                         │
   │  Attempt 2nd finalization │                         │
   │ ─────────────────────────▶│                         │
   │                            │                         │
   │                            │  Check: responseFinalized?
   │                            │ ───────────────────────▶│
   │                            │                         │
   │                            │◀─ TRUE (already set!)   │
   │                            │                         │
   │                            │  ❌ THROW ERROR         │
   │◀──── ERROR ────────────────│  "already finalized"    │
   │                            │                         │
```

---

## Integration Points

### 1. Dev Panel → ResponseController
```
┌───────────────┐
│   Dev Panel   │
│  (Frontend)   │
└───────┬───────┘
        │
        │ POST /api/admin/config
        ▼
┌─────────────────────────┐
│  configService.js       │
│  Saves to Supabase:     │
│  { forceStyle: '...',   │
│    disableLLM: true }   │
└───────┬─────────────────┘
        │
        │ Loaded per request
        ▼
┌─────────────────────────┐
│  session.adminOverrides │
└───────┬─────────────────┘
        │
        │ Passed to ResponseController
        ▼
┌─────────────────────────┐
│  ResponsePolicyResolver │
│  Applies overrides      │
└─────────────────────────┘
```

### 2. ResponseController → TTS
```
┌──────────────────┐
│ ResponseController│
│  policy.ttsMode  │
│  = 'expressive'  │
└────────┬─────────┘
         │
         │ Pass to TTS
         ▼
┌──────────────────┐
│   playTTS(...)   │
│   options = {    │
│     rate: 1.0,   │  ◄── Based on policy.ttsMode
│     pitch: 2     │  ◄── Based on policy.style
│   }              │
└──────────────────┘
```

---

## Data Flow Summary

```
USER INPUT
    │
    ▼
[NLU] → intent + entities
    │
    ▼
[Handler] → rawReply (CO powiedzieć)
    │
    ▼
[ResponsePolicyResolver] → policy (JAK powiedzieć)
    │
    ▼
[ResponseController] → finalReply
    │                     │
    │                     ├─→ [TTS] → audio
    │                     │
    │                     └─→ [Analytics] → logs
    ▼
USER OUTPUT
```

---

## Komponenty (Status)

| Komponent | Status | Zmiana w runtime? |
|-----------|--------|-------------------|
| `BrainPipeline` | ✅ Niezmieniony | Nie |
| `NLURouter` | ✅ Niezmieniony | Nie |
| `Handlers` | ⏳ Do migracji | Nie (shadow mode) |
| `ResponsePolicyResolver` | ✅ Nowy moduł | Nie (tylko obliczenia) |
| `ResponseController` | ✅ Nowy moduł | Nie (shadow mode) |

**Gwarancja:** W shadow mode, system działa **identycznie** jak przed refaktoryzacją.
