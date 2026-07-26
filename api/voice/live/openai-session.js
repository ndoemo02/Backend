import { createHash } from 'node:crypto';
import { LIVE_TOOL_SCHEMAS } from './ToolSchemas.js';
import { validateLiveOrigin } from './liveSecurity.js';
import { updateSession } from '../../brain/session/sessionStore.js';
import {
  buildDemoSessionPatch,
  resolveDemoContextFromRequest,
} from '../../demo/demoContext.js';

const DEFAULT_MODEL = 'gpt-realtime-2.1-mini';
const DEFAULT_VOICE = 'coral';
const MAX_INSTRUCTIONS_LENGTH = 24_000;

const ALLOWED_MODELS = new Set([
  'gpt-realtime-2.1-mini',
  'gpt-realtime-mini',
  'gpt-realtime-1.5',
  'gpt-realtime',
  'gpt-realtime-2',
  'gpt-realtime-2.1',
]);

const ALLOWED_VOICES = new Set([
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
]);

const SERVER_GROUNDING_GUARD = [
  'FreeFlow demo safety rules:',
  'Never claim that a restaurant, dish, drink, ingredient, price, allergen, or availability exists without a matching backend tool result.',
  'When a tool result contains restaurant cards but no menu items, do not name dishes. Fetch the menu first.',
  'Use the provided tools for every menu lookup and order mutation.',
  'If the cart contains items, search companions such as drinks and desserts only in the cart restaurant unless the user explicitly asks to switch restaurants.',
  'Act as a concise local culinary guide: describe only cuisine traits and representative dishes explicitly present in the latest tool result.',
  'Reply in the dominant language of the latest user turn, Polish or English. A language change never changes the selected city or demo dataset.',
  'Never mention internal tool names to the user.',
].join(' ');

function parseBoolean(value, fallback = false) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function getConfiguredModel() {
  const requested = String(process.env.OPENAI_REALTIME_MODEL || DEFAULT_MODEL).trim();
  return ALLOWED_MODELS.has(requested) ? requested : DEFAULT_MODEL;
}

function getConfiguredVoice() {
  const requested = String(process.env.OPENAI_REALTIME_VOICE || DEFAULT_VOICE).trim().toLowerCase();
  return ALLOWED_VOICES.has(requested) ? requested : DEFAULT_VOICE;
}

export function getOpenAIRealtimeFallbackConfig() {
  const configured = Boolean(String(process.env.OPENAI_API_KEY || '').trim());
  const enabled = parseBoolean(process.env.OPENAI_REALTIME_FALLBACK_ENABLED, false);
  return {
    enabled,
    configured,
    available: enabled && configured,
    model: getConfiguredModel(),
    voice: getConfiguredVoice(),
  };
}

function setCorsHeaders(req, res) {
  const origin = String(req.headers?.origin || '').trim();
  const originCheck = validateLiveOrigin(origin);
  if (!originCheck.ok) return originCheck;

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  return originCheck;
}

function safetyIdentifier(sessionId) {
  return createHash('sha256')
    .update(`freeflow-demo:${String(sessionId || 'anonymous')}`)
    .digest('hex');
}

function buildServerDemoGuard(demoContext) {
  const city = String(demoContext?.city || 'Piekary Śląskie').trim();
  const initialLanguage = demoContext?.preferredLocale === 'en' ? 'English' : 'Polish';
  return [
    `Active demo city: ${city}. Use only the backend dataset selected for this scenario.`,
    `Start in ${initialLanguage}, then follow the dominant language of each user turn.`,
    'If the user struggles with a word or mixes languages, give the missing term briefly and offer English once.',
  ].join(' ');
}

export function buildSessionConfig(instructions, demoContext) {
  const config = getOpenAIRealtimeFallbackConfig();
  const clientInstructions = String(instructions || '').trim().slice(0, MAX_INSTRUCTIONS_LENGTH);
  const combinedInstructions = [
    clientInstructions,
    SERVER_GROUNDING_GUARD,
    buildServerDemoGuard(demoContext),
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    type: 'realtime',
    model: config.model,
    output_modalities: ['audio'],
    instructions: combinedInstructions,
    audio: {
      input: {
        transcription: {
          model: 'gpt-4o-mini-transcribe',
        },
        turn_detection: {
          type: 'semantic_vad',
        },
      },
      output: {
        voice: config.voice,
      },
    },
    tools: LIVE_TOOL_SCHEMAS.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
    tool_choice: 'auto',
  };
}

export default async function openAIRealtimeSessionHandler(req, res) {
  const originCheck = setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    return res.status(originCheck.ok ? 204 : 403).end();
  }
  if (!originCheck.ok) {
    return res.status(403).json({ ok: false, error: 'origin_not_allowed' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const fallback = getOpenAIRealtimeFallbackConfig();
  if (!fallback.enabled) {
    return res.status(503).json({ ok: false, error: 'openai_realtime_fallback_disabled' });
  }
  if (!fallback.configured) {
    return res.status(503).json({ ok: false, error: 'openai_realtime_key_missing' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: 'missing_session_id' });
  }
  let demoContext;
  try {
    demoContext = resolveDemoContextFromRequest(body);
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_demo_context',
      detail: error?.message || 'invalid_demo_context',
    });
  }
  updateSession(sessionId, buildDemoSessionPatch(demoContext));
  const sessionConfig = buildSessionConfig(body.instructions, demoContext);

  try {
    const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(process.env.OPENAI_API_KEY).trim()}`,
        'OpenAI-Safety-Identifier': safetyIdentifier(body.session_id),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session: sessionConfig }),
    });
    const responseText = await upstream.text();
    if (!upstream.ok) {
      console.error('[OPENAI_REALTIME_SESSION_ERROR]', {
        status: upstream.status,
        requestId: upstream.headers.get('x-request-id') || null,
        detail: responseText.slice(0, 500),
      });
      return res.status(upstream.status >= 500 ? 502 : upstream.status).json({
        ok: false,
        error: upstream.status === 429 ? 'openai_realtime_quota_exceeded' : 'openai_realtime_session_failed',
      });
    }

    let upstreamData;
    try {
      upstreamData = JSON.parse(responseText);
    } catch {
      return res.status(502).json({ ok: false, error: 'openai_realtime_invalid_token_response' });
    }
    const clientSecret = String(upstreamData?.value || '').trim();
    if (!clientSecret) {
      return res.status(502).json({ ok: false, error: 'openai_realtime_token_missing' });
    }
    return res.status(200).json({
      ok: true,
      client_secret: clientSecret,
      model: fallback.model,
      voice: fallback.voice,
    });
  } catch (error) {
    console.error('[OPENAI_REALTIME_SESSION_UNAVAILABLE]', error?.message || 'unknown_error');
    return res.status(502).json({ ok: false, error: 'openai_realtime_unavailable' });
  }
}
