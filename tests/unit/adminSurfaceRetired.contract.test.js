import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function repoPath(relativePath) {
  return path.join(repoRoot, relativePath);
}

describe('retired experimental admin surface', () => {
  it('removes the api/admin module tree', () => {
    expect(fs.existsSync(repoPath('api/admin'))).toBe(false);
  });

  it('removes the admin-only auth middleware', () => {
    expect(fs.existsSync(repoPath('api/middleware/verifyAmberAdmin.js'))).toBe(false);
  });

  it('does not import the retired admin modules from the runtime entrypoint', () => {
    const source = readRepoFile('api/server-vercel.js');

    expect(source).not.toContain('adminRouter');
    expect(source).not.toContain('verifyAmberAdmin');
  });

  it('registers no /api/admin route on the runtime entrypoint', () => {
    const source = readRepoFile('api/server-vercel.js');

    expect(source).not.toContain('/api/admin');
  });

  it('removes the analytics cron that called the retired admin endpoint', () => {
    expect(fs.existsSync(repoPath('api/utils/trendsCron.js'))).toBe(false);
    expect(readRepoFile('api/server-vercel.js')).not.toContain('trendsCron');
  });

  // Zabezpieczenie przed usunieciem za duzo: ADMIN_TOKEN chroni takze PATCH /api/orders
  // (prace T1). Wyciecie panelu nie moze rozbroic tamtej sciezki.
  it('keeps the orders admin authorization intact', () => {
    const auth = readRepoFile('api/_auth.js');
    const orders = readRepoFile('api/orders.js');

    expect(auth).toContain('ADMIN_TOKEN');
    expect(orders).toContain('requireAdmin');
  });
});
