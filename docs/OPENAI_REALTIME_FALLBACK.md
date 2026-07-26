# OpenAI Realtime fallback for FreeFlow

## Confirmed intent

- Gemini Live remains the primary browser voice provider.
- OpenAI Realtime is a demo fallback for provider failures and quota/connectivity errors.
- Microphone permission or missing-device errors do not trigger a paid provider switch.
- Both providers use the existing FreeFlow `ToolRouter`; OpenAI owns no menu or order state.
- The standard OpenAI API key remains server-side and is never returned to the browser.
- The public demo is low-traffic and uses sandbox restaurant, order, payment and user data.
- If both live providers fail, the existing classic Voice Dock remains the final manual fallback.

## Decision log

1. **WebRTC unified interface** was selected over a browser WebSocket. OpenAI recommends WebRTC for browser speech-to-speech, and the unified `/v1/realtime/calls` flow keeps the standard API key on the backend.
2. **`gpt-realtime-2.1-mini`** is the default model because this fallback is budget-constrained and intended for demo traffic.
3. **`coral`** is the initial voice. It is configured through an environment variable so live comparison with `shimmer` or `marin` requires no code change.
4. **Server-owned tool schemas and grounding guard** are appended to every OpenAI session. The client may send the current Amber conversation prompt, but cannot replace backend order validation.
5. **Provider failure classification** prevents quota/connectivity fallback from masking microphone permission problems.

## Runtime flow

1. The user starts Live and Gemini connects normally.
2. Gemini uses bounded reconnect attempts for recoverable provider failures.
3. When Gemini exhausts recovery, `useLiveVoiceSession` stops it and starts OpenAI Realtime.
4. The browser sends its SDP offer and Amber instructions to `/api/voice/live/openai-session`.
5. The backend appends grounding rules and server-owned tools, then creates the OpenAI session through `/v1/realtime/calls`.
6. OpenAI function calls are relayed to `/api/voice/live/tool-call`, exactly like Gemini calls.
7. Tool results update the same frontend conversation store and return to OpenAI as `function_call_output` events.

## Environment variables

```env
OPENAI_API_KEY=sk-...
OPENAI_REALTIME_FALLBACK_ENABLED=true
OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini
OPENAI_REALTIME_VOICE=coral
```

The feature flag defaults to `false`. The health/runtime-config response exposes only safe booleans plus model and voice; it never exposes the API key.

## Demo verification

1. Verify normal Gemini Live first.
2. Temporarily make the Gemini token/session unavailable and start Live again.
3. Confirm the status changes to `Łączę z OpenAI Live`, then `Słucham przez OpenAI`.
4. Ask for a real menu item and confirm the same restaurant/menu cards render.
5. Ask for a nonexistent drink and verify Amber does not invent it.
6. Deny microphone permission and confirm OpenAI is not started.
