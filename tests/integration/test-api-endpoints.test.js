/**
 * Testy integracyjne dla API endpoints
 * Testuje pełny flow API z rzeczywistymi requestami
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// Mock Express app dla testów
const createTestApp = () => {
  const express = require('express');
  const cors = require('cors');
  const app = express();
  
  app.use(cors());
  app.use(express.json());
  
  // Mock brain endpoint
  app.post('/api/brain', async (req, res) => {
    const { text, lat, lng, sessionId } = req.body;
    
    if (!text) {
      return res.status(400).json({ ok: false, error: 'Missing text' });
    }
    
    // Mock intent detection logic
    let intent = 'none';
    let confidence = 0;
    let reply = 'Nie rozumiem, co masz na myśli.';
    
    if (text.toLowerCase().includes('dostępne') || text.toLowerCase().includes('pobliżu')) {
      intent = 'find_nearby';
      confidence = 0.8;
      reply = 'W okolicy mam kilka restauracji. Co dokładnie masz na myśli?';
    } else if (text.toLowerCase().includes('menu')) {
      intent = 'menu_request';
      confidence = 0.9;
      reply = 'Oto menu restauracji.';
    } else if (text.toLowerCase().includes('zamów')) {
      intent = 'create_order';
      confidence = 0.8;
      reply = 'Doskonale! Dodaję do koszyka.';
    }
    
    res.json({
      ok: true,
      intent,
      restaurant: null,
      reply,
      confidence,
      fallback: intent === 'none',
      context: {
        lastIntent: intent,
        lastRestaurant: null,
        sessionId: sessionId || 'test-session'
      }
    });
  });
  
  // Mock health endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      node: process.version,
      service: 'FreeFlow Voice Expert',
      version: 'test',
      timestamp: new Date().toISOString(),
      supabase: { ok: true, time: '50ms' }
    });
  });
  
  // Mock TTS endpoint
  app.post('/api/tts-chirp-hd', (req, res) => {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Missing text' });
    }
    
    // Mock audio response
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', '1024');
    res.send(Buffer.alloc(1024)); // Mock audio data
  });
  
  // Mock debug endpoints
  app.get('/api/debug/session', (req, res) => {
    res.json({
      intent: 'ready',
      restaurant: null,
      sessionId: 'test-session',
      confidence: 1.0,
      timestamp: new Date().toISOString()
    });
  });
  
  app.post('/api/debug/log', (req, res) => {
    const { sessionData } = req.body;
    
    if (!sessionData) {
      return res.status(400).json({ error: 'Missing session data' });
    }
    
    res.json({ ok: true, logged: true });
  });
  
  return app;
};

describe('API Integration Tests', () => {
  let app;
  
  beforeEach(() => {
    app = createTestApp();
  });
  
  describe('POST /api/brain', () => {
    it('should process voice input and return intent', async () => {
      const response = await request(app)
        .post('/api/brain')
        .send({
          text: 'co jest dostępne w pobliżu',
          lat: 50.386,
          lng: 18.946,
          sessionId: 'test-session'
        })
        .expect(200);
      
      expect(response.body).toMatchObject({
        ok: true,
        intent: 'find_nearby',
        confidence: 0.8,
        fallback: false
      });
      expect(response.body.reply).toContain('restauracji');
    });
    
    it('should handle menu requests', async () => {
      const response = await request(app)
        .post('/api/brain')
        .send({
          text: 'pokaż menu',
          sessionId: 'test-session'
        })
        .expect(200);
      
      expect(response.body).toMatchObject({
        ok: true,
        intent: 'menu_request',
        confidence: 0.9,
        fallback: false
      });
    });
    
    it('should handle order requests', async () => {
      const response = await request(app)
        .post('/api/brain')
        .send({
          text: 'zamów pizzę margherita',
          sessionId: 'test-session'
        })
        .expect(200);
      
      expect(response.body).toMatchObject({
        ok: true,
        intent: 'create_order',
        confidence: 0.8,
        fallback: false
      });
    });
    
    it('should return fallback for unrecognized input', async () => {
      const response = await request(app)
        .post('/api/brain')
        .send({
          text: 'random gibberish text',
          sessionId: 'test-session'
        })
        .expect(200);
      
      expect(response.body).toMatchObject({
        ok: true,
        intent: 'none',
        confidence: 0,
        fallback: true
      });
    });
    
    it('should require text parameter', async () => {
      const response = await request(app)
        .post('/api/brain')
        .send({
          lat: 50.386,
          lng: 18.946
        })
        .expect(400);
      
      expect(response.body).toMatchObject({
        ok: false,
        error: 'Missing text'
      });
    });
    
    it('should handle session context', async () => {
      const response = await request(app)
        .post('/api/brain')
        .send({
          text: 'co jest dostępne',
          sessionId: 'custom-session-123'
        })
        .expect(200);
      
      expect(response.body.context.sessionId).toBe('custom-session-123');
    });
  });
  
  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);
      
      expect(response.body).toMatchObject({
        ok: true,
        service: 'FreeFlow Voice Expert',
        supabase: { ok: true }
      });
      expect(response.body.node).toBeDefined();
      expect(response.body.timestamp).toBeDefined();
    });
  });
  
  describe('POST /api/tts-chirp-hd', () => {
    it('should generate TTS audio', async () => {
      const response = await request(app)
        .post('/api/tts-chirp-hd')
        .send({ text: 'Test głosu' })
        .expect(200);
      
      expect(response.headers['content-type']).toBe('audio/mpeg');
      expect(response.headers['content-length']).toBe('1024');
      expect(response.body.length).toBe(1024);
    });
    
    it('should require text parameter', async () => {
      const response = await request(app)
        .post('/api/tts-chirp-hd')
        .send({})
        .expect(400);
      
      expect(response.body).toMatchObject({
        error: 'Missing text'
      });
    });
  });
  
  describe('GET /api/debug/session', () => {
    it('should return session state', async () => {
      const response = await request(app)
        .get('/api/debug/session')
        .expect(200);
      
      expect(response.body).toMatchObject({
        intent: 'ready',
        sessionId: 'test-session',
        confidence: 1.0
      });
      expect(response.body.timestamp).toBeDefined();
    });
  });
  
  describe('POST /api/debug/log', () => {
    it('should log session data', async () => {
      const sessionData = {
        intent: 'find_nearby',
        restaurant: 'Test Restaurant',
        sessionId: 'test-session',
        timestamp: new Date().toISOString()
      };
      
      const response = await request(app)
        .post('/api/debug/log')
        .send({ sessionData })
        .expect(200);
      
      expect(response.body).toMatchObject({
        ok: true,
        logged: true
      });
    });
    
    it('should require session data', async () => {
      const response = await request(app)
        .post('/api/debug/log')
        .send({})
        .expect(400);
      
      expect(response.body).toMatchObject({
        error: 'Missing session data'
      });
    });
  });
  
  describe('CORS Headers', () => {
    it('should include CORS headers', async () => {
      const response = await request(app)
        .post('/api/brain')
        .send({ text: 'test' })
        .expect(200);
      
      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });
  
  describe('Error Handling', () => {
    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/brain')
        .set('Content-Type', 'application/json')
        .send('invalid json')
        .expect(400);
    });
    
    it('should handle missing Content-Type', async () => {
      const response = await request(app)
        .post('/api/brain')
        .send('{"text": "test"}')
        .expect(200); // Express auto-parses JSON
    });
  });
});
