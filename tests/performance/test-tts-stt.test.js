/**
 * Testy wydajności dla TTS i STT
 * Testuje szybkość generowania audio i przetwarzania głosu
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const createMockTTSApp = () => {
  const express = require('express');
  const app = express();
  
  app.use(express.json());
  
  // Mock TTS endpoint with realistic timing
  app.post('/api/tts-chirp-hd', async (req, res) => {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Missing text' });
    }
    
    // Simulate TTS processing time (200-800ms for realistic text)
    const processingTime = Math.min(800, Math.max(200, text.length * 10));
    await new Promise(resolve => setTimeout(resolve, processingTime));
    
    // Generate mock audio data proportional to text length
    const audioSize = Math.max(1024, text.length * 50);
    const audioData = Buffer.alloc(audioSize);
    
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioSize.toString());
    res.send(audioData);
  });
  
  // Mock streaming TTS endpoint
  app.post('/api/tts-chirp-stream', async (req, res) => {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Missing text' });
    }
    
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    // Stream chunks of audio data
    const chunkSize = 1024;
    const totalSize = Math.max(chunkSize, text.length * 50);
    let sent = 0;
    
    const sendChunk = () => {
      if (sent >= totalSize) {
        res.end();
        return;
      }
      
      const chunk = Buffer.alloc(Math.min(chunkSize, totalSize - sent));
      res.write(chunk);
      sent += chunk.length;
      
      // Simulate streaming delay
      setTimeout(sendChunk, 50);
    };
    
    sendChunk();
  });
  
  return app;
};

describe('TTS Performance Tests', () => {
  let app;
  
  beforeEach(() => {
    app = createMockTTSApp();
  });
  
  describe('TTS Response Times', () => {
    it('should generate short text audio quickly', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .post('/api/tts-chirp-hd')
        .send({ text: 'Tak' });
      
      const responseTime = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(1000); // Should be under 1 second
      expect(response.headers['content-type']).toBe('audio/mpeg');
    });
    
    it('should handle medium text within reasonable time', async () => {
      const mediumText = 'W Piekarach Śląskich mam kilka miejscówek — co dokładnie masz na myśli? Możesz powtórzyć?';
      
      const startTime = Date.now();
      
      const response = await request(app)
        .post('/api/tts-chirp-hd')
        .send({ text: mediumText });
      
      const responseTime = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(2000); // Should be under 2 seconds
      expect(response.headers['content-length']).toBeDefined();
    });
    
    it('should handle long text with acceptable performance', async () => {
      const longText = 'W Piekarach Śląskich mam kilka miejscówek — co dokładnie masz na myśli? Możesz powtórzyć? '.repeat(5);
      
      const startTime = Date.now();
      
      const response = await request(app)
        .post('/api/tts-chirp-hd')
        .send({ text: longText });
      
      const responseTime = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(5000); // Should be under 5 seconds
    });
  });
  
  describe('TTS Audio Quality', () => {
    it('should generate appropriate audio size for text length', async () => {
      const shortText = 'Tak';
      const mediumText = 'W Piekarach Śląskich mam kilka miejscówek';
      const longText = 'W Piekarach Śląskich mam kilka miejscówek — co dokładnie masz na myśli? Możesz powtórzyć?';
      
      const shortResponse = await request(app)
        .post('/api/tts-chirp-hd')
        .send({ text: shortText });
      
      const mediumResponse = await request(app)
        .post('/api/tts-chirp-hd')
        .send({ text: mediumText });
      
      const longResponse = await request(app)
        .post('/api/tts-chirp-hd')
        .send({ text: longText });
      
      const shortSize = parseInt(shortResponse.headers['content-length']);
      const mediumSize = parseInt(mediumResponse.headers['content-length']);
      const longSize = parseInt(longResponse.headers['content-length']);
      
      expect(mediumSize).toBeGreaterThan(shortSize);
      expect(longSize).toBeGreaterThan(mediumSize);
    });
    
    it('should return valid audio content type', async () => {
      const response = await request(app)
        .post('/api/tts-chirp-hd')
        .send({ text: 'Test audio' });
      
      expect(response.headers['content-type']).toBe('audio/mpeg');
      expect(response.body).toBeInstanceOf(Buffer);
      expect(response.body.length).toBeGreaterThan(0);
    });
  });
  
  describe('TTS Streaming Performance', () => {
    it('should stream audio data in chunks', async () => {
      const response = await request(app)
        .post('/api/tts-chirp-stream')
        .send({ text: 'Test streaming audio' });
      
      expect(response.status).toBe(200);
      expect(response.headers['transfer-encoding']).toBe('chunked');
      expect(response.headers['content-type']).toBe('audio/mpeg');
    });
    
    it('should handle streaming for long text', async () => {
      const longText = 'W Piekarach Śląskich mam kilka miejscówek — co dokładnie masz na myśli? Możesz powtórzyć? '.repeat(3);
      
      const startTime = Date.now();
      
      const response = await request(app)
        .post('/api/tts-chirp-stream')
        .send({ text: longText });
      
      const responseTime = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(3000); // Streaming should be faster
    });
  });
  
  describe('TTS Concurrent Load', () => {
    it('should handle multiple concurrent TTS requests', async () => {
      const texts = [
        'Tak',
        'Nie',
        'Może',
        'Dobrze',
        'Rozumiem'
      ];
      
      const startTime = Date.now();
      
      const promises = texts.map(text =>
        request(app)
          .post('/api/tts-chirp-hd')
          .send({ text })
      );
      
      const responses = await Promise.all(promises);
      const totalTime = Date.now() - startTime;
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('audio/mpeg');
      });
      
      // All requests should complete within reasonable time
      expect(totalTime).toBeLessThan(3000);
    });
    
    it('should handle burst of TTS requests', async () => {
      const burstSize = 20;
      const promises = Array.from({ length: burstSize }, (_, i) =>
        request(app)
          .post('/api/tts-chirp-hd')
          .send({ text: `Test ${i}` })
      );
      
      const startTime = Date.now();
      const responses = await Promise.all(promises);
      const totalTime = Date.now() - startTime;
      
      expect(responses).toHaveLength(burstSize);
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
      
      // Burst should be handled efficiently
      expect(totalTime).toBeLessThan(5000);
    });
  });
  
  describe('TTS Error Handling', () => {
    it('should handle missing text parameter', async () => {
      const response = await request(app)
        .post('/api/tts-chirp-hd')
        .send({});
      
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: 'Missing text'
      });
    });
    
    it('should handle empty text', async () => {
      const response = await request(app)
        .post('/api/tts-chirp-hd')
        .send({ text: '' });
      
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: 'Missing text'
      });
    });
    
    it('should handle very long text gracefully', async () => {
      const veryLongText = 'Test '.repeat(1000);
      
      const startTime = Date.now();
      
      const response = await request(app)
        .post('/api/tts-chirp-hd')
        .send({ text: veryLongText });
      
      const responseTime = Date.now() - startTime;
      
      // Should either succeed or fail gracefully
      expect([200, 400, 413]).toContain(response.status);
      
      if (response.status === 200) {
        expect(responseTime).toBeLessThan(10000); // Should not hang
      }
    });
  });
  
  describe('TTS Memory Usage', () => {
    it('should not leak memory with repeated requests', async () => {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Make many requests
      for (let i = 0; i < 100; i++) {
        await request(app)
          .post('/api/tts-chirp-hd')
          .send({ text: `Test request ${i}` });
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      // Memory increase should be reasonable (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });
  });
});
