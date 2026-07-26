import { afterEach, describe, expect, it } from 'vitest';
import {
    summarizeLiveToolResult,
    validateLiveInternalKey,
    validateLiveOrigin,
} from '../liveSecurity.js';

const ORIGINAL_ENV = {
    NODE_ENV: process.env.NODE_ENV,
    LIVE_STRICT_ORIGIN: process.env.LIVE_STRICT_ORIGIN,
    LIVE_ALLOWED_ORIGINS: process.env.LIVE_ALLOWED_ORIGINS,
    LIVE_ALLOW_PRIVATE_NETWORK_ORIGINS: process.env.LIVE_ALLOW_PRIVATE_NETWORK_ORIGINS,
    LIVE_INTERNAL_KEY: process.env.LIVE_INTERNAL_KEY,
};

function restoreEnv(key, value) {
    if (typeof value === 'undefined') {
        delete process.env[key];
        return;
    }
    process.env[key] = value;
}

afterEach(() => {
    restoreEnv('NODE_ENV', ORIGINAL_ENV.NODE_ENV);
    restoreEnv('LIVE_STRICT_ORIGIN', ORIGINAL_ENV.LIVE_STRICT_ORIGIN);
    restoreEnv('LIVE_ALLOWED_ORIGINS', ORIGINAL_ENV.LIVE_ALLOWED_ORIGINS);
    restoreEnv('LIVE_ALLOW_PRIVATE_NETWORK_ORIGINS', ORIGINAL_ENV.LIVE_ALLOW_PRIVATE_NETWORK_ORIGINS);
    restoreEnv('LIVE_INTERNAL_KEY', ORIGINAL_ENV.LIVE_INTERNAL_KEY);
});

describe('liveSecurity.validateLiveOrigin', () => {
    it('allows the canonical production frontend by default', () => {
        process.env.NODE_ENV = 'production';
        process.env.LIVE_STRICT_ORIGIN = 'true';
        process.env.LIVE_ALLOWED_ORIGINS = '';
        const result = validateLiveOrigin('https://freeflow-final.vercel.app');
        expect(result.ok).toBe(true);
    });

    it('allows configured origin when strict mode enabled', () => {
        process.env.LIVE_STRICT_ORIGIN = 'true';
        process.env.LIVE_ALLOWED_ORIGINS = 'https://app.example.com';
        const result = validateLiveOrigin('https://app.example.com');
        expect(result.ok).toBe(true);
    });

    it('rejects missing origin in strict mode', () => {
        process.env.LIVE_STRICT_ORIGIN = 'true';
        process.env.LIVE_ALLOWED_ORIGINS = 'https://app.example.com';
        const result = validateLiveOrigin('');
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('missing_origin');
    });

    it('allows origin when strict mode disabled', () => {
        process.env.LIVE_STRICT_ORIGIN = 'false';
        const result = validateLiveOrigin('');
        expect(result.ok).toBe(true);
    });

    it('defaults strict mode to disabled in development when env flag missing', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.LIVE_STRICT_ORIGIN;
        const result = validateLiveOrigin('');
        expect(result.ok).toBe(true);
    });

    it('defaults strict mode to enabled in production when env flag missing', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.LIVE_STRICT_ORIGIN;
        process.env.LIVE_ALLOWED_ORIGINS = 'https://app.example.com';
        const result = validateLiveOrigin('');
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('missing_origin');
    });

    it('allows private LAN origins in strict mode when LIVE_ALLOW_PRIVATE_NETWORK_ORIGINS=true', () => {
        process.env.NODE_ENV = 'production';
        process.env.LIVE_STRICT_ORIGIN = 'true';
        process.env.LIVE_ALLOW_PRIVATE_NETWORK_ORIGINS = 'true';
        process.env.LIVE_ALLOWED_ORIGINS = 'https://app.example.com';
        const result = validateLiveOrigin('http://192.168.1.25:5173');
        expect(result.ok).toBe(true);
    });

    it('rejects private LAN origins in strict mode when LIVE_ALLOW_PRIVATE_NETWORK_ORIGINS=false', () => {
        process.env.NODE_ENV = 'production';
        process.env.LIVE_STRICT_ORIGIN = 'true';
        process.env.LIVE_ALLOW_PRIVATE_NETWORK_ORIGINS = 'false';
        process.env.LIVE_ALLOWED_ORIGINS = 'https://app.example.com';
        const result = validateLiveOrigin('http://192.168.1.25:5173');
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('origin_not_allowed');
    });
});

describe('liveSecurity.validateLiveInternalKey', () => {
    it('passes when LIVE_INTERNAL_KEY is not configured', () => {
        process.env.LIVE_INTERNAL_KEY = '';
        const result = validateLiveInternalKey({});
        expect(result.ok).toBe(true);
    });

    it('rejects missing key when LIVE_INTERNAL_KEY is configured', () => {
        process.env.LIVE_INTERNAL_KEY = 'secret-123';
        const result = validateLiveInternalKey({});
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('missing_internal_key');
    });

    it('accepts correct key when LIVE_INTERNAL_KEY is configured', () => {
        process.env.LIVE_INTERNAL_KEY = 'secret-123';
        const result = validateLiveInternalKey({ 'x-live-internal-key': 'secret-123' });
        expect(result.ok).toBe(true);
    });
});

describe('liveSecurity.summarizeLiveToolResult', () => {
    it('extracts intent + match summary fields', () => {
        const summary = summarizeLiveToolResult({
            response: {
                intent: 'create_order',
                restaurants: [{ id: 'r1' }],
                meta: {
                    restaurantLocked: true,
                    match: {
                        candidateCount: 7,
                        topMatch: { name: 'Kebab XXL', score: 0.91 },
                    },
                },
            },
        }, 'add_item_to_cart');

        expect(summary.intent).toBe('create_order');
        expect(summary.restaurantLocked).toBe(true);
        expect(summary.candidateCount).toBe(7);
        expect(summary.topMatch).toBe('Kebab XXL');
        expect(summary.score).toBe(0.91);
    });
});
