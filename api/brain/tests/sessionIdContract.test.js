import { describe, expect, it } from 'vitest';
import {
  generateSessionId,
  requireValidSessionId,
  SESSION_ID_MAX_LENGTH,
  validateSessionId,
} from '../session/sessionIdContract.js';

describe('canonical session_id contract', () => {
  it.each([
    'sess_1712345678901_abc123',
    'sess_diag_1712345678901_abc123',
    'sess_debug_1_a',
    'sess_smoke_1_000000',
  ])('accepts %s', (value) => {
    expect(validateSessionId(value)).toEqual({ ok: true, sessionId: value });
  });

  it('rejects noncanonical values', () => {
    for (const value of ['', null, undefined, 'sess-1', 'test-session', 'diag-123', 'sess_UPPER', 'sess_bad.dot']) {
      expect(validateSessionId(value).ok).toBe(false);
    }
  });

  it('enforces the 128 character limit', () => {
    expect(validateSessionId(`sess_${'a'.repeat(SESSION_ID_MAX_LENGTH - 5)}`).ok).toBe(true);
    expect(validateSessionId(`sess_${'a'.repeat(SESSION_ID_MAX_LENGTH - 4)}`).ok).toBe(false);
  });

  it('throws a stable 400 error at internal boundaries', () => {
    expect(() => requireValidSessionId('sess-1')).toThrowError('invalid_session_id');
    try { requireValidSessionId('sess-1'); } catch (error) { expect(error.statusCode).toBe(400); }
  });

  it('generates canonical six-character random identifiers', () => {
    expect(generateSessionId()).toMatch(/^sess_\d+_[a-z0-9]{6}$/);
    expect(generateSessionId('diag')).toMatch(/^sess_diag_\d+_[a-z0-9]{6}$/);
  });
});
