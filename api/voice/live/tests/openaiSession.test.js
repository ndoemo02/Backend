import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler, {
  buildSessionConfig,
  getOpenAIRealtimeFallbackConfig,
} from '../openai-session.js';

function makeReq(body = {}, method = 'POST') {
  return {
    method,
    body,
    headers: { origin: 'http://localhost:5173' },
  };
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    end() { return this; },
  };
}

describe('OpenAI Realtime fallback session', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.OPENAI_REALTIME_FALLBACK_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'sk-test-private';
    process.env.OPENAI_REALTIME_MODEL = 'gpt-realtime-2.1-mini';
    process.env.OPENAI_REALTIME_VOICE = 'coral';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('stays disabled unless the explicit feature flag is enabled', async () => {
    process.env.OPENAI_REALTIME_FALLBACK_ENABLED = 'false';
    const res = makeRes();
    await handler(makeReq({ sdp: 'v=0' }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('openai_realtime_fallback_disabled');
  });

  it('reports safe provider metadata without exposing the API key', () => {
    const config = getOpenAIRealtimeFallbackConfig();
    expect(config).toEqual({
      enabled: true,
      configured: true,
      available: true,
      model: 'gpt-realtime-2.1-mini',
      voice: 'coral',
    });
    expect(JSON.stringify(config)).not.toContain('sk-test-private');
  });

  it('creates a grounded WebRTC session through the unified interface', async () => {
    const upstreamFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"value":"ek_test_ephemeral"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const res = makeRes();
    await handler(makeReq({
      instructions: 'Jesteś Amber.',
      session_id: 'sess_demo_session',
      demo_context: {
        scenario_id: 'krakow-tourist',
        preferred_locale: 'pl',
        source: 'query',
      },
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.client_secret).toBe('ek_test_ephemeral');
    expect(upstreamFetch).toHaveBeenCalledOnce();

    const [url, init] = upstreamFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/realtime/client_secrets');
    expect(init.headers.Authorization).toBe('Bearer sk-test-private');
    expect(init.headers['OpenAI-Safety-Identifier']).toMatch(/^[a-f0-9]{64}$/);
    expect(init.headers['Content-Type']).toBe('application/json');
    const session = JSON.parse(init.body).session;
    expect(session.model).toBe('gpt-realtime-2.1-mini');
    expect(session.audio.output.voice).toBe('coral');
    expect(session.instructions).toContain('Jesteś Amber.');
    expect(session.instructions).toContain('Never claim');
    expect(session.instructions).toContain('Active demo city: Kraków');
    expect(session.instructions).toContain('dominant language');
    expect(session.audio.input.transcription).not.toHaveProperty('language');
    expect(session.tools.some((tool) => tool.name === 'search_menu_items')).toBe(true);
  });

  it('keeps the initial language independent from the active city', () => {
    const session = buildSessionConfig('Amber base.', {
      city: 'Piekary Śląskie',
      preferredLocale: 'en',
    });

    expect(session.instructions).toContain('Active demo city: Piekary Śląskie');
    expect(session.instructions).toContain('Start in English');
    expect(session.instructions).toContain('language change never changes');
    expect(session.audio.input.transcription).not.toHaveProperty('language');
  });

  it('maps upstream quota failures to a stable application error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":{"message":"quota"}}', { status: 429 }),
    );
    const res = makeRes();
    await handler(makeReq({ session_id: 'sess_quota_test_session' }), res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ ok: false, error: 'openai_realtime_quota_exceeded' });
  });

  it('rejects a noncanonical runtime session before contacting OpenAI', async () => {
    const upstreamFetch = vi.spyOn(globalThis, 'fetch');
    const res = makeRes();
    await handler(makeReq({ session_id: 'sess-with-dashes' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_session_id');
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
