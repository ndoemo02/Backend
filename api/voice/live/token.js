import { GoogleGenAI } from '@google/genai';
import { isLiveOriginAllowed } from './liveSecurity.js';

const DEFAULT_LIVE_MODEL =
    process.env.GEMINI_LIVE_MODEL
    || process.env.LIVE_MODEL
    || 'gemini-2.5-flash-native-audio-preview-12-2025';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 6;
const rateLimitBuckets = new Map();

function getClientKey(req) {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.socket?.remoteAddress || req.ip || 'unknown';
}

function consumeRateLimit(req, now = Date.now()) {
    const key = getClientKey(req);
    const current = rateLimitBuckets.get(key);
    if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
        rateLimitBuckets.set(key, { startedAt: now, count: 1 });
        return { ok: true, retryAfterSeconds: 0 };
    }

    if (current.count >= RATE_LIMIT_MAX) {
        const remainingMs = Math.max(0, RATE_LIMIT_WINDOW_MS - (now - current.startedAt));
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
    }

    current.count += 1;
    return { ok: true, retryAfterSeconds: 0 };
}

function getConfiguredAllowedModels(runtimeModel) {
    const configured = String(process.env.GEMINI_LIVE_ALLOWED_MODELS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    return new Set([runtimeModel, DEFAULT_LIVE_MODEL, ...configured].filter(Boolean));
}

async function resolveRuntimeLiveModel() {
    try {
        const { getConfig } = await import('../../config/configService.js');
        const config = await getConfig();
        const model = typeof config?.live_model === 'string' ? config.live_model.trim() : '';
        return model || DEFAULT_LIVE_MODEL;
    } catch {
        return DEFAULT_LIVE_MODEL;
    }
}

export function resetLiveTokenRateLimitForTests() {
    rateLimitBuckets.clear();
}

export default async function handler(req, res) {
    const origin = String(req.headers?.origin || '').trim();
    const originAllowed = Boolean(origin) && isLiveOriginAllowed(origin);
    if (originAllowed) {
        res.setHeader?.('Access-Control-Allow-Origin', origin);
        res.setHeader?.('Access-Control-Allow-Methods', 'POST,OPTIONS');
        res.setHeader?.('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader?.('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
        return res.status(originAllowed ? 204 : 403).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    if (!originAllowed) {
        return res.status(403).json({ ok: false, error: 'origin_not_allowed' });
    }

    const limit = consumeRateLimit(req);
    if (!limit.ok) {
        res.setHeader?.('Retry-After', String(limit.retryAfterSeconds));
        return res.status(429).json({ ok: false, error: 'live_token_rate_limited' });
    }

    if (String(process.env.LIVE_MODE || '').toLowerCase() !== 'true') {
        return res.status(409).json({ ok: false, error: 'live_mode_disabled' });
    }

    const apiKey = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    if (!apiKey) {
        return res.status(503).json({ ok: false, error: 'gemini_server_key_missing' });
    }

    const runtimeModel = await resolveRuntimeLiveModel();
    const requestedModel = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
    const model = requestedModel || runtimeModel;
    if (!model || model.length > 160 || !getConfiguredAllowedModels(runtimeModel).has(model)) {
        return res.status(400).json({ ok: false, error: 'live_model_not_allowed' });
    }

    const now = Date.now();
    const expireTime = new Date(now + 30 * 60_000).toISOString();
    const newSessionExpireTime = new Date(now + 60_000).toISOString();

    try {
        const ai = new GoogleGenAI({
            apiKey,
            httpOptions: { apiVersion: 'v1alpha' },
        });
        const token = await ai.authTokens.create({
            config: {
                uses: 1,
                expireTime,
                newSessionExpireTime,
                liveConnectConstraints: { model },
                // An empty lock list keeps the model constraint, but allows the
                // browser to provide the Live session config (system prompt,
                // function tools and audio transcriptions). Without this field,
                // Google locks the entire LiveConnectConfig and silently ignores
                // those client-side settings.
                lockAdditionalFields: [],
                httpOptions: { apiVersion: 'v1alpha' },
            },
        });

        if (!token?.name) {
            throw new Error('empty_ephemeral_token');
        }

        res.setHeader?.('Cache-Control', 'no-store');
        return res.status(200).json({
            ok: true,
            token: token.name,
            model,
            expires_at: expireTime,
            new_session_expires_at: newSessionExpireTime,
        });
    } catch {
        console.error('[LIVE_TOKEN_ISSUE_FAILED]');
        return res.status(502).json({ ok: false, error: 'live_token_issue_failed' });
    }
}
