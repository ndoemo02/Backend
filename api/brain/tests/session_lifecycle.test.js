/**
 * SESSION LIFECYCLE REGRESSION TESTS
 * ═══════════════════════════════════════════════════════════════════════════
 * Tests for conversation isolation (one session_id = one conversation)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
    getSession, 
    updateSession, 
    closeConversation, 
    isSessionClosed, 
    getOrCreateActiveSession,
    generateNewSessionId 
} from '../session/sessionStore.js';

// Mock Supabase
vi.mock('../../_supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      ilike: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null })
    }))
  }
}));

describe('SESSION LIFECYCLE: Conversation Isolation', () => {

  describe('1️⃣ CART_ITEM_ADDED closes conversation', () => {
    it('closeConversation sets status=closed and returns newSessionId', () => {
      const sessionId = generateNewSessionId();
      const session = getSession(sessionId);
      
      // Verify initial state
      expect(session.status).toBe('active');
      expect(session.closedReason).toBeNull();
      
      // Close conversation
      const result = closeConversation(sessionId, 'CART_ITEM_ADDED');
      
      // Verify closed state
      expect(session.status).toBe('closed');
      expect(session.closedReason).toBe('CART_ITEM_ADDED');
      expect(session.closedAt).toBeTruthy();
      
      // Verify new session ID is generated
      expect(result.newSessionId).toBeTruthy();
      expect(result.newSessionId).not.toBe(sessionId);
      expect(result.closedSessionId).toBe(sessionId);
      
      // Verify FSM state is cleared
      expect(session.pendingDish).toBeNull();
      expect(session.awaiting).toBeNull();
      expect(session.expectedContext).toBeNull();
      expect(session.pendingOrder).toBeNull();
    });
  });

  describe('2️⃣ ORDER_CONFIRMED closes conversation', () => {
    it('closeConversation with ORDER_CONFIRMED reason', () => {
      const sessionId = generateNewSessionId();
      const session = getSession(sessionId);
      
      // Simulate active order flow
      updateSession(sessionId, {
        pendingOrder: { items: [{ name: 'Kebab' }] },
        expectedContext: 'confirm_order',
        pendingDish: 'Kebab'
      });
      
      // Verify pre-close state
      expect(session.pendingOrder).toBeTruthy();
      expect(session.expectedContext).toBe('confirm_order');
      
      // Close conversation
      const result = closeConversation(sessionId, 'ORDER_CONFIRMED');
      
      // Verify everything is cleared
      expect(session.status).toBe('closed');
      expect(session.closedReason).toBe('ORDER_CONFIRMED');
      expect(session.pendingOrder).toBeNull();
      expect(session.expectedContext).toBeNull();
      expect(session.pendingDish).toBeNull();
      
      // New session ID provided
      expect(result.newSessionId).toBeTruthy();
    });
  });

  describe('3️⃣ BACKEND FAILSAFE: Auto-create new session', () => {
    it('getOrCreateActiveSession auto-creates new session for closed session', () => {
      const originalId = generateNewSessionId();
      
      // Create and close session
      getSession(originalId);
      closeConversation(originalId, 'CART_ITEM_ADDED');
      
      // Verify original is closed
      expect(isSessionClosed(originalId)).toBe(true);
      
      // Try to get active session with closed ID
      const result = getOrCreateActiveSession(originalId);
      
      // Verify new session was created
      expect(result.isNew).toBe(true);
      expect(result.sessionId).not.toBe(originalId);
      expect(result.session.status).toBe('active');
      expect(result.session.closedReason).toBeNull();
    });

    it('getOrCreateActiveSession returns existing active session', () => {
      const sessionId = generateNewSessionId();
      getSession(sessionId);
      
      const result = getOrCreateActiveSession(sessionId);
      
      expect(result.isNew).toBe(false);
      expect(result.sessionId).toBe(sessionId);
      expect(result.session.status).toBe('active');
    });
  });

  describe('4️⃣ ADMIN PANEL: Session has start, end, and reason', () => {
    it('closed session has all required metadata', () => {
      const sessionId = generateNewSessionId();
      const session = getSession(sessionId);
      
      // Simulate conversation flow
      updateSession(sessionId, { 
        lastIntent: 'create_order',
        currentRestaurant: { name: 'Test Kebab' }
      });
      
      // Close with reason
      closeConversation(sessionId, 'ORDER_CONFIRMED');
      
      // Verify metadata for Admin Panel
      expect(session.status).toBe('closed');
      expect(session.closedReason).toBe('ORDER_CONFIRMED');
      expect(session.closedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
      
      // Verify session ID format (for timeline grouping)
      expect(sessionId).toMatch(/^sess_\d+_[a-z0-9]+$/);
    });

    it('new session has clean state for new timeline', () => {
      const closedId = generateNewSessionId();
      getSession(closedId);
      closeConversation(closedId, 'CART_ITEM_ADDED');
      
      const newResult = getOrCreateActiveSession(closedId);
      const newSession = newResult.session;
      
      // Verify clean slate for new timeline
      expect(newSession.status).toBe('active');
      expect(newSession.closedReason).toBeNull();
      expect(newSession.closedAt).toBeNull();
      expect(newSession.lastIntent).toBeNull();
      expect(newSession.pendingOrder).toBeNull();
      expect(newSession.expectedContext).toBe('neutral');
    });
  });

  describe('HELPER FUNCTIONS', () => {
    it('generateNewSessionId creates unique IDs', () => {
      const id1 = generateNewSessionId();
      const id2 = generateNewSessionId();
      
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^sess_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^sess_\d+_[a-z0-9]+$/);
    });

    it('isSessionClosed returns correct status', () => {
      const sessionId = generateNewSessionId();
      getSession(sessionId);
      
      expect(isSessionClosed(sessionId)).toBe(false);
      
      closeConversation(sessionId, 'CART_ITEM_ADDED');
      
      expect(isSessionClosed(sessionId)).toBe(true);
    });
  });
});
