# Vercel Endpoint Routing

## How it works

Vercel does not run a persistent Express server. Each request is handled by an
individual serverless function. Routes are matched top-to-bottom in `vercel.json`;
the first match wins. A catch-all `/(.*) -> api/server-vercel.js` exists as
fallback for routes that still use the Express app.

Key endpoints have **dedicated serverless handler files** so they are guaranteed
to resolve on Vercel (no reliance on the Express catch-all).

## Serverless endpoints (dedicated files)

| Method | Path | File | Status |
|--------|------|------|--------|
| GET | `/api/health` | `api/health.js` | Probe + Supabase check |
| GET | `/api/voice/live/health` | `api/voice/live/health.js` | Live mode probe |
| GET | `/api/voice/live/tools` | `api/voice/live/tools.js` | Tool schemas |
| POST | `/api/voice/live/tool-call` | `api/voice/live/tool-call.js` | Execute tool call |
| POST | `/api/ai/normalize` | `api/ai/normalize/route.ts` | AI normalize |
| POST | `/api/ai/respond` | `api/ai/respond/route.ts` | AI respond |
| POST | `/api/ai/fallback` | `api/ai/fallback/route.ts` | AI fallback |

## Express catch-all (everything else)

All other `/api/*` paths fall through to `api/server-vercel.js` (Express app).
This includes `/api/brain/v2`, `/api/restaurants/*`, `/api/admin/*`, etc.

## NOT available on Vercel

| Path | Reason | Alternative |
|------|--------|-------------|
| `/api/voice/live/ws` | WebSocket — requires persistent connection; Vercel serverless does not support WS upgrade | Deploy on Railway, Fly.io, or Render for WS. Frontend `useGeminiLiveSession` connects directly to Gemini Live API (no backend WS needed for demo). |

## Environment variables (Vercel dashboard)

```
LIVE_MODE=true
VITE_LIVE_MODE=true
VITE_GEMINI_LIVE_API_KEY=<your Google AI Studio key>
SUPABASE_URL=<url>
SUPABASE_ANON_KEY=<key>
```

## Testing deployed endpoints

PowerShell:
```powershell
Invoke-RestMethod https://YOUR-APP.vercel.app/api/health
Invoke-RestMethod https://YOUR-APP.vercel.app/api/voice/live/health
Invoke-RestMethod https://YOUR-APP.vercel.app/api/voice/live/tools
```

curl:
```bash
curl https://YOUR-APP.vercel.app/api/health
curl https://YOUR-APP.vercel.app/api/voice/live/health
curl https://YOUR-APP.vercel.app/api/voice/live/tools
curl -X POST https://YOUR-APP.vercel.app/api/voice/live/tool-call \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"test","tool":"get_cart_state","args":{}}'
```

## Local development

Local dev still uses the Express server — no change:
```bash
cd backend
LIVE_MODE=true node api/server-vercel.js
```
The Express routes in `api/voice/live/index.js` handle the same paths locally.
