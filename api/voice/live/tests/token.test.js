import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createToken: vi.fn(),
    getConfig: vi.fn(),
    isLiveOriginAllowed: vi.fn(),
}));

vi.mock('@google/genai', () => ({
    GoogleGenAI: class GoogleGenAI {
        constructor() {
            this.authTokens = { create: mocks.createToken };
        }
    },
}));

vi.mock('../../../config/configService.js', () => ({
    getConfig: mocks.getConfig,
}));

vi.mock('../liveSecurity.js', () => ({
    isLiveOriginAllowed: mocks.isLiveOriginAllowed,
}));

const { default: handler, resetLiveTokenRateLimitForTests } = await import('../token.js');

function createResponse() {
    return {
        statusCode: null,
        payload: null,
        headers: {},
        status: vi.fn(function status(code) {
            this.statusCode = code;
            return this;
        }),
        setHeader: vi.fn(function setHeader(name, value) {
            this.headers[name] = value;
            return this;
        }),
        json: vi.fn(function json(payload) {
            this.payload = payload;
            return this;
        }),
        end: vi.fn(function end() {
            return this;
        }),
    };
}

describe('Gemini Live ephemeral token handler', () => {
    const originalLiveMode = process.env.LIVE_MODE;
    const originalGoogleApiKey = process.env.GOOGLE_API_KEY;
    const originalAllowedModels = process.env.GEMINI_LIVE_ALLOWED_MODELS;

    beforeEach(() => {
        process.env.LIVE_MODE = 'true';
        process.env.GOOGLE_API_KEY = 'test-server-key';
        delete process.env.GEMINI_LIVE_ALLOWED_MODELS;
        mocks.getConfig.mockReset().mockResolvedValue({ live_model: 'gemini-live-test' });
        mocks.isLiveOriginAllowed.mockReset().mockReturnValue(true);
        mocks.createToken.mockReset().mockResolvedValue({ name: 'ephemeral-test-token' });
        resetLiveTokenRateLimitForTests();
    });

    afterEach(() => {
        if (originalLiveMode === undefined) delete process.env.LIVE_MODE;
        else process.env.LIVE_MODE = originalLiveMode;
        if (originalGoogleApiKey === undefined) delete process.env.GOOGLE_API_KEY;
        else process.env.GOOGLE_API_KEY = originalGoogleApiKey;
        if (originalAllowedModels === undefined) delete process.env.GEMINI_LIVE_ALLOWED_MODELS;
        else process.env.GEMINI_LIVE_ALLOWED_MODELS = originalAllowedModels;
        vi.clearAllMocks();
    });

    it('returns a one-use constrained token without exposing the server key', async () => {
        const req = {
            method: 'POST',
            headers: { origin: 'https://freeflow-final.vercel.app', 'x-forwarded-for': '203.0.113.7' },
            body: {
                model: 'gemini-live-test',
                session_id: 'sess_token_test',
            },
        };
        const res = createResponse();

        await handler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.payload.token).toBe('ephemeral-test-token');
        expect(JSON.stringify(res.payload)).not.toContain('test-server-key');
        expect(mocks.createToken).toHaveBeenCalledWith(expect.objectContaining({
            config: expect.objectContaining({
                uses: 1,
                liveConnectConstraints: { model: 'gemini-live-test' },
                lockAdditionalFields: [],
            }),
        }));
        expect(res.headers['Cache-Control']).toBe('no-store');
    });

    it('handles trusted CORS preflight for the dedicated Vercel route', async () => {
        const req = {
            method: 'OPTIONS',
            headers: { origin: 'https://freeflow-final.vercel.app' },
        };
        const res = createResponse();

        await handler(req, res);

        expect(res.statusCode).toBe(204);
        expect(res.headers['Access-Control-Allow-Origin']).toBe('https://freeflow-final.vercel.app');
        expect(res.end).toHaveBeenCalledOnce();
        expect(mocks.createToken).not.toHaveBeenCalled();
    });

    it('rejects a model outside the runtime allowlist', async () => {
        const req = {
            method: 'POST',
            headers: { origin: 'https://freeflow-final.vercel.app', 'x-forwarded-for': '203.0.113.8' },
            body: { model: 'other-model' },
        };
        const res = createResponse();

        await handler(req, res);

        expect(res.statusCode).toBe(400);
        expect(res.payload.error).toBe('live_model_not_allowed');
        expect(mocks.createToken).not.toHaveBeenCalled();
    });

    it('rejects an untrusted origin before issuing a token', async () => {
        mocks.isLiveOriginAllowed.mockReturnValue(false);
        const req = {
            method: 'POST',
            headers: { origin: 'https://evil.example', 'x-forwarded-for': '203.0.113.9' },
            body: { model: 'gemini-live-test' },
        };
        const res = createResponse();

        await handler(req, res);

        expect(res.statusCode).toBe(403);
        expect(res.payload.error).toBe('origin_not_allowed');
        expect(mocks.createToken).not.toHaveBeenCalled();
    });

    it('rejects a noncanonical runtime session before issuing a token', async () => {
        const req = {
            method: 'POST',
            headers: { origin: 'https://freeflow-final.vercel.app', 'x-forwarded-for': '203.0.113.10' },
            body: { model: 'gemini-live-test', session_id: 'session-with-dashes' },
        };
        const res = createResponse();
        await handler(req, res);
        expect(res.statusCode).toBe(400);
        expect(res.payload.error).toBe('invalid_session_id');
        expect(mocks.createToken).not.toHaveBeenCalled();
    });
});
