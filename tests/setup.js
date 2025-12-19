/**
 * Setup file for tests
 * Configures test environment and global mocks
 */

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
process.env.GOOGLE_VOICEORDER_KEY_B64 = 'dGVzdC1rZXk=';

// Mock console methods to reduce noise in tests
const originalConsole = { ...console };

beforeAll(() => {
  // Suppress console.log in tests unless explicitly enabled
  if (!process.env.VERBOSE_TESTS) {
    console.log = () => {};
    console.info = () => {};
    console.debug = () => {};
  }
  
  // Keep error and warn for debugging
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
});

afterAll(() => {
  // Restore console
  Object.assign(console, originalConsole);
});

beforeEach(() => {
  // Reset any global state before each test
  // Note: vitest doesn't need clearAllMocks in beforeEach
});

afterEach(() => {
  // Cleanup after each test
  // Note: vitest doesn't need clearAllTimers in afterEach
});

// Global test utilities
global.testUtils = {
  createMockRequest: (body = {}, headers = {}) => ({
    body,
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    method: 'POST',
    url: '/api/brain'
  }),
  
  createMockResponse: () => {
    const res = {
      status: () => res,
      json: () => res,
      send: () => res,
      setHeader: () => res,
      write: () => res,
      end: () => res
    };
    return res;
  },
  
  createMockSession: (overrides = {}) => ({
    id: 'test-session',
    lastIntent: null,
    lastRestaurant: null,
    lastUpdated: Date.now(),
    ...overrides
  }),
  
  createMockCatalog: () => [
    { id: '1', name: 'Pizza Margherita', price: 25.00, category: 'pizza' },
    { id: '2', name: 'Burger Classic', price: 20.00, category: 'burger' },
    { id: '3', name: 'Kebab w bułce', price: 18.00, category: 'kebab' },
    { id: '4', name: 'Mała Pizza Margherita', price: 15.00, category: 'pizza' },
    { id: '5', name: 'Duża Pizza Margherita', price: 35.00, category: 'pizza' }
  ],
  
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  measureTime: async (fn) => {
    const start = Date.now();
    const result = await fn();
    const end = Date.now();
    return { result, duration: end - start };
  }
};

// Mock external dependencies
global.mockSupabase = {
  from: () => ({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({ data: null, error: null }),
        limit: () => Promise.resolve({ data: [], error: null })
      }),
      limit: () => Promise.resolve({ data: [], error: null })
    }),
    insert: () => Promise.resolve({ data: null, error: null }),
    update: () => ({
      eq: () => Promise.resolve({ data: null, error: null })
    }),
    delete: () => ({
      eq: () => Promise.resolve({ data: null, error: null })
    })
  })
};

global.mockGoogleAuth = {
  getVertexAccessToken: () => Promise.resolve('mock-access-token')
};

// Performance monitoring for tests
global.performanceMonitor = {
  start: (name) => {
    global.performanceMonitor._timers = global.performanceMonitor._timers || {};
    global.performanceMonitor._timers[name] = Date.now();
  },
  
  end: (name) => {
    if (!global.performanceMonitor._timers?.[name]) return null;
    const duration = Date.now() - global.performanceMonitor._timers[name];
    delete global.performanceMonitor._timers[name];
    return duration;
  },
  
  measure: async (name, fn) => {
    global.performanceMonitor.start(name);
    const result = await fn();
    const duration = global.performanceMonitor.end(name);
    return { result, duration };
  }
};
