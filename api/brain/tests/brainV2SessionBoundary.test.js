import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  process: vi.fn(),
  getSession: vi.fn(),
  setSession: vi.fn(),
  updateSessionAsync: vi.fn(),
}));

vi.mock('../core/pipeline.js', () => ({
  BrainPipeline: class BrainPipeline { process(...args) { return mocks.process(...args); } },
}));
vi.mock('../nlu/router.js', () => ({ NLURouter: class NLURouter {} }));
vi.mock('../core/securityGuards.js', () => ({ sanitizeAssistantResponse: (value) => value }));
vi.mock('../session/sessionStore.js', () => ({
  getSession: mocks.getSession,
  setSession: mocks.setSession,
  updateSessionAsync: mocks.updateSessionAsync,
}));
vi.mock('../../demo/demoContext.js', () => ({
  buildDemoSessionPatch: () => ({}),
  resolveDemoContextFromRequest: () => ({}),
}));

import handler from '../brainV2.js';

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe('Brain V2 session boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSessionAsync.mockResolvedValue({});
    mocks.getSession.mockReturnValue({ status: 'active' });
    mocks.setSession.mockResolvedValue({});
    mocks.process.mockResolvedValue({ ok: true, session_id: 'sess_boundary_1', reply: 'ok' });
  });

  it('rejects a noncanonical client session before pipeline work', async () => {
    const res = response();
    await handler({ method: 'POST', body: { session_id: 'sess-with-dashes', input: 'czesc' } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'invalid_session_id' });
    expect(mocks.updateSessionAsync).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it('accepts the canonical contract', async () => {
    const res = response();
    await handler({ method: 'POST', body: { session_id: 'sess_boundary_1', input: 'czesc' } }, res);
    expect(res.statusCode).toBe(200);
    expect(mocks.process).toHaveBeenCalledWith('sess_boundary_1', 'czesc', expect.any(Object));
  });

  it('fails closed for a noncanonical pipeline session', async () => {
    mocks.process.mockResolvedValue({ ok: true, session_id: 'invalid-session', reply: 'ok' });
    const res = response();
    await handler({ method: 'POST', body: { session_id: 'sess_boundary_1', input: 'czesc' } }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'internal_server_error' });
  });

  it('fails closed for a noncanonical lifecycle recovery session', async () => {
    mocks.process.mockResolvedValue({ ok: true, session_id: 'sess_boundary_1', newSessionId: 'next-session' });
    const res = response();
    await handler({ method: 'POST', body: { session_id: 'sess_boundary_1', input: 'czesc' } }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('internal_server_error');
  });
});
