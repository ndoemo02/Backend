import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: [
      'tests/**/*.test.{js,ts}',
      'api/brain/tests/**/*.test.{js,ts}'
    ],
    globals: true,
    environment: 'node',
    reporters: ['verbose'],
    setupFiles: [],
    testTimeout: 10000,
    hookTimeout: 10000,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage'
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@api': path.resolve(__dirname, './api'),
      '@tests': path.resolve(__dirname, './tests'),
      '@brain': path.resolve(__dirname, './api/brain'),
      '@brainTests': path.resolve(__dirname, './api/brain/tests')
    }
  }
});

