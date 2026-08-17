import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ select: vi.fn() }));

// supabaseClient.js throws at import time without credentials, so the boundary
// under test must be exercised against a stubbed client.
vi.mock('../supabaseClient.js', () => ({
  default: {
    from: () => ({
      insert: () => ({ select: mocks.select }),
    }),
  },
}));

import debugRouter from '../../debug.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', debugRouter);
  return app;
}

describe('POST /api/debug/log — session_id boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockResolvedValue({ data: [{}], error: null });
  });

  it('rejects a noncanonical session_id with 400, not 500', async () => {
    const res = await request(buildApp())
      .post('/api/debug/log')
      .send({ session_id: 'debug-1712345678901' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_session_id');
  });

  it('rejects a noncanonical legacy camelCase sessionId with 400', async () => {
    const res = await request(buildApp())
      .post('/api/debug/log')
      .send({ sessionId: 'test-session' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_session_id');
  });

  it('accepts the canonical contract and persists the normalized id', async () => {
    const res = await request(buildApp())
      .post('/api/debug/log')
      .send({ session_id: 'sess_debug_1712345678901_abc123' });

    expect(res.status).toBe(200);
    expect(res.body.logged.session_id).toBe('sess_debug_1712345678901_abc123');
  });

  it('still degrades to 500 for genuine failures', async () => {
    mocks.select.mockRejectedValue(new Error('supabase_unreachable'));

    const res = await request(buildApp())
      .post('/api/debug/log')
      .send({ session_id: 'sess_debug_1712345678901_abc123' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to log session');
  });
});
