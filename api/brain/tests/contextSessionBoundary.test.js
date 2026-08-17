import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import contextHandler, {
  getSession,
  getSessionsCount,
  updateSession
} from '../context.js';

const CANONICAL = 'sess_context_boundary_1712345678901';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/api/brain/context', (req, res) => contextHandler(req, res));
  return app;
}

describe('api/brain/context.js — session_id boundary', () => {
  it('accepts the canonical contract', async () => {
    const res = await request(buildApp())
      .post('/api/brain/context')
      .send({ sessionId: CANONICAL, tone: 'neutralny', intent: 'find_nearby' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.session.lastIntent).toBe('find_nearby');
    expect(getSession(CANONICAL)).not.toBeNull();
  });

  it('accepts the snake_case session_id alias', async () => {
    const res = await request(buildApp())
      .post('/api/brain/context')
      .send({ session_id: CANONICAL, intent: 'show_menu' });

    expect(res.status).toBe(200);
    expect(res.body.session.lastIntent).toBe('show_menu');
  });

  it('rejects a noncanonical id with 400 invalid_session_id', async () => {
    const res = await request(buildApp())
      .post('/api/brain/context')
      .send({ sessionId: 'sess-1', intent: 'find_nearby' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_session_id');
  });

  it('rejects a missing id with 400 missing_session_id', async () => {
    const res = await request(buildApp())
      .post('/api/brain/context')
      .send({ intent: 'find_nearby' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_session_id');
  });

  it('does not create a store key for an invalid id', () => {
    const before = getSessionsCount();

    expect(() => updateSession('sess-1', { lastIntent: 'find_nearby' })).toThrow(
      'invalid_session_id'
    );
    expect(() => updateSession(undefined, { lastIntent: 'find_nearby' })).toThrow(
      'missing_session_id'
    );
    expect(() => getSession('sess-1')).toThrow('invalid_session_id');

    expect(getSessionsCount()).toBe(before);
  });

  it('carries statusCode 400 on internal contract violations', () => {
    try {
      updateSession('brain_1712345678901', {});
      throw new Error('expected updateSession to reject');
    } catch (error) {
      expect(error.message).toBe('invalid_session_id');
      expect(error.statusCode).toBe(400);
    }
  });

  it('keeps the canonical store round-trip intact', () => {
    updateSession(CANONICAL, { lastRestaurant: { name: 'Stara Kamienica' } });
    const session = getSession(CANONICAL);

    expect(session.lastRestaurant.name).toBe('Stara Kamienica');
    expect(typeof session.lastUpdated).toBe('number');
  });
});
