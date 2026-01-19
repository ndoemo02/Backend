# Architecture Overview

## 🏗️ Mono-API Architecture

### Struktura przed migracją (❌ Przekroczony limit Vercel Trial)

```
┌─────────────────────────────────────────┐
│          Vercel Serverless              │
│                                         │
│  /api/health.js        (1 function)     │
│  /api/tts.js           (1 function)     │
│  /api/nlu.js           (1 function)     │
│  /api/restaurants.js   (1 function)     │
│  /api/menu.js          (1 function)     │
│  /api/orders.js        (1 function)     │
│  /api/search.js        (1 function)     │
│  /api/places.js        (1 function)     │
│                                         │
│  RAZEM: 8 functions (limit: 12)        │
└─────────────────────────────────────────┘
```

### Struktura po migracji (✅ Tylko 1 function!)

```
┌─────────────────────────────────────────┐
│          Vercel Serverless              │
│                                         │
│  /api/index.js         (1 function)     │
│  │                                      │
│  ├─ handleHealth()                     │
│  ├─ handleTts()                        │
│  ├─ handleNlu()                        │
│  ├─ handleRestaurants()                │
│  ├─ handleMenu()                       │
│  ├─ handleOrders()                     │
│  ├─ handleSearch()                     │
│  └─ handlePlaces()                     │
│                                         │
│  RAZEM: 1 function (limit: 12) ✅      │
└─────────────────────────────────────────┘
```

## 🔄 Request Flow

```
User Request
    │
    ↓
┌─────────────────────┐
│   /api/health       │ ← przykładowy request
└─────────────────────┘
    │
    ↓
┌─────────────────────────────────────────┐
│         vercel.json (rewrites)          │
│                                         │
│  {                                      │
│    "source": "/api/health",             │
│    "destination": "/api/index/health"   │
│  }                                      │
└─────────────────────────────────────────┘
    │
    ↓
┌─────────────────────────────────────────┐
│         /api/index.js                   │
│                                         │
│  1. Parse URL → extract "health"        │
│  2. Route to handleHealth()             │
│  3. Execute logic                       │
│  4. Return response                     │
└─────────────────────────────────────────┘
    │
    ↓
┌─────────────────────┐
│   Response to User  │
│   { status: "ok" }  │
└─────────────────────┘
```

## 📊 Endpoint Mapping

| User Request | Vercel Rewrite | Handler Function |
|-------------|----------------|------------------|
| `GET /api/health` | `/api/index/health` | `handleHealth()` |
| `POST /api/tts` | `/api/index/tts` | `handleTts()` |
| `POST /api/nlu` | `/api/index/nlu` | `handleNlu()` |
| `GET /api/restaurants` | `/api/index/restaurants` | `handleRestaurants()` |
| `GET /api/menu` | `/api/index/menu` | `handleMenu()` |
| `GET/POST /api/orders` | `/api/index/orders` | `handleOrders()` |
| `GET /api/search` | `/api/index/search` | `handleSearch()` |
| `GET /api/places` | `/api/index/places` | `handlePlaces()` |

## 🔌 External Integrations

```
┌─────────────────────────────────────────┐
│         /api/index.js                   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  handleRestaurants()            │   │
│  │  handleMenu()                   │───┼──→ Supabase
│  │  handleOrders()                 │   │   (Database)
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  handleSearch()                 │───┼──→ Google Maps API
│  │  handlePlaces()                 │   │   (Places)
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  handleTts()                    │───┼──→ Google Cloud TTS
│  └─────────────────────────────────┘   │   (planned)
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  handleNlu()                    │   │
│  │  (internal logic)               │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

## 📂 Project Structure

```
freeflow-backend/
│
├── api/
│   └── index.js              # 🎯 MONO-API (wszystkie endpointy)
│
├── lib/
│   ├── cors.js               # CORS helpers (legacy)
│   └── handlers/             # Legacy handlers (nie używane)
│       ├── health.js
│       ├── tts.js
│       └── nlu.js
│
├── public/
│   ├── drweb.html            # Demo UI
│   └── ff-assist.js          # Frontend helper
│
├── scripts/
│   ├── smoke.mjs             # Integration tests
│   └── ...                   # Utility scripts
│
├── tests/
│   └── api.spec.ts           # API tests (Vitest)
│
├── vercel.json               # ⚙️  Vercel config (rewrites + CORS)
├── package.json              # Dependencies
├── server.js                 # 🔧 Local dev server (Express)
│
├── README.md                 # Main documentation
├── QUICK_START.md            # 🚀 Quick deployment guide
├── MONO_API_INFO.md          # Mono-API details
├── DEPLOYMENT.md             # Full deployment guide
├── ARCHITECTURE.md           # This file
└── CHANGELOG.md              # Change history
```

## 🔐 Environment Variables

```
┌─────────────────────────────────────────┐
│         Vercel Environment              │
│                                         │
│  SUPABASE_URL ──────────────────┐       │
│  SUPABASE_ANON_KEY ─────────────┼──→ Supabase
│  SUPABASE_SERVICE_ROLE_KEY ─────┘       │
│                                         │
│  GOOGLE_MAPS_API_KEY ────────────→ Google Maps
│                                         │
│  OPENAI_API_KEY ─────────────────→ OpenAI
│                                   (planned)
└─────────────────────────────────────────┘
```

## 🚀 Deployment Flow

```
Developer
    │
    ↓ (git push)
┌─────────────────────┐
│   GitHub Repo       │
└─────────────────────┘
    │
    ↓ (auto deploy)
┌─────────────────────────────────────────┐
│         Vercel Platform                 │
│                                         │
│  1. Build: npm install                  │
│  2. Deploy: /api/index.js               │
│  3. Apply: vercel.json config           │
│  4. Set: Environment variables          │
└─────────────────────────────────────────┘
    │
    ↓
┌─────────────────────┐
│   Production URL    │
│  your-app.vercel.app│
└─────────────────────┘
```

## 🔄 Request Lifecycle

```
1. CLIENT REQUEST
   GET /api/health
   │
   ↓
2. VERCEL EDGE NETWORK
   - Apply CORS headers
   - Rewrite to /api/index/health
   │
   ↓
3. SERVERLESS FUNCTION (cold/warm start)
   - Import /api/index.js
   - Parse URL path
   │
   ↓
4. ROUTING
   - Extract "health" from path
   - Call handleHealth()
   │
   ↓
5. HANDLER EXECUTION
   - Run business logic
   - Query database (if needed)
   │
   ↓
6. RESPONSE
   - Set headers (CORS)
   - Return JSON
   │
   ↓
7. CLIENT RECEIVES
   { status: "ok", ... }
```

## 📈 Scaling Considerations

### Current (Trial Plan)
- ✅ 1 serverless function
- ✅ Automatic HTTPS
- ✅ Global CDN
- ✅ Automatic scaling
- ⚠️  Shared cold starts

### Future (Pro Plan)
- 🔄 Split to multiple functions
- 🔄 Function-specific limits
- 🔄 Better cold start isolation
- 🔄 Advanced monitoring

## 🎯 Benefits of Mono-API

✅ **Function Limit**: 1 zamiast 8 (mieści się w trial)  
✅ **DRY Code**: Wspólny CORS, error handling  
✅ **Easy Deploy**: Jeden plik do zarządzania  
✅ **Fast Iteration**: Szybkie dodawanie endpointów  

⚠️ **Trade-offs**:
- Shared cold starts
- Larger bundle size
- All-or-nothing deployments

## 🔍 Debugging

```bash
# Local testing
npm start
curl http://localhost:3003/api/health

# Vercel logs
vercel logs [deployment-url]

# Or Vercel Dashboard:
# Deployments → Functions → /api/index → Logs
```
