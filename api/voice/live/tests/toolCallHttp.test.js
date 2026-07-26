import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    executeToolCall: vi.fn(),
}));

vi.mock('../../../_cors.js', () => ({
    applyCORS: vi.fn(() => false),
}));

vi.mock('../liveSecurity.js', () => ({
    validateLiveInternalKey: vi.fn(() => ({ ok: true })),
    validateLiveOrigin: vi.fn(() => ({ ok: true })),
}));

vi.mock('../ToolRouter.js', () => ({
    ToolRouter: class ToolRouterMock {
        executeToolCall(...args) {
            return mocks.executeToolCall(...args);
        }
    },
}));

const { default: handler } = await import('../tool-call.js');

function createResponse() {
    return {
        statusCode: null,
        payload: null,
        status: vi.fn(function status(code) {
            this.statusCode = code;
            return this;
        }),
        json: vi.fn(function json(payload) {
            this.payload = payload;
            return this;
        }),
    };
}

describe('live tool-call HTTP handler', () => {
    const originalLiveMode = process.env.LIVE_MODE;

    beforeEach(() => {
        process.env.LIVE_MODE = 'true';
        mocks.executeToolCall.mockReset();
        mocks.executeToolCall.mockResolvedValue({
            ok: true,
            response: { ok: true },
        });
    });

    afterEach(() => {
        if (originalLiveMode == null) {
            delete process.env.LIVE_MODE;
        } else {
            process.env.LIVE_MODE = originalLiveMode;
        }
        vi.clearAllMocks();
    });

    it('keeps live transcript in debug flow only, not as routing input', async () => {
        const req = {
            method: 'POST',
            headers: { origin: 'https://freeflow-final.vercel.app' },
            body: {
                session_id: 'sess_http_trace',
                tool: 'add_item_to_cart',
                args: { dish: 'Kotlet schabowy', quantity: 1 },
                request_id: 'req_http_trace',
                transcript: 'No bien, como?',
                user_text: 'bad fallback',
            },
        };
        const res = createResponse();

        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(mocks.executeToolCall).toHaveBeenCalledTimes(1);
        const call = mocks.executeToolCall.mock.calls[0][0];
        expect(call).not.toHaveProperty('transcript');
        expect(call).not.toHaveProperty('userText');
        expect(call.debugLiveFlow.finalTranscript).toBe('No bien, como?');
        expect(call.debugLiveFlow.userText).toBe('bad fallback');
        expect(call.debugLiveFlow.sttSource).toBe('transcript');
        expect(call.debugLiveFlow.rawArgs).toEqual({ dish: 'Kotlet schabowy', quantity: 1 });
    });
});
