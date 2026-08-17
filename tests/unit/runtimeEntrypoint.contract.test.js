import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('canonical local runtime entrypoint', () => {
  it('starts the same Express application used by Vercel', () => {
    const packageJson = JSON.parse(readRepoFile('package.json'));

    expect(packageJson.main).toBe('api/server-vercel.js');
    expect(packageJson.scripts.start).toBe('node api/server-vercel.js');
    expect(packageJson.scripts.dev).toBe('node api/server-vercel.js');
    expect(fs.existsSync(path.join(repoRoot, 'server.js'))).toBe(false);
  });

  it('keeps the critical local HTTP and Voice LIVE surfaces', () => {
    const source = readRepoFile('api/server-vercel.js');

    expect(source).toContain("app.get('/api/health'");
    expect(source).toContain('app.post("/api/brain/v2"');
    expect(source).toContain('app.all("/api/orders"');
    expect(source).toContain('app.get("/api/menu"');
    expect(source).toContain("process.env.LIVE_MODE === 'true'");
    expect(source).toContain('attachLiveGateway(server)');
  });

  it('does not expose the retired FreeFun experiment', () => {
    const source = readRepoFile('api/server-vercel.js');

    expect(source).not.toContain('/api/freefun/');
    expect(fs.existsSync(path.join(repoRoot, 'api/freefun/add.js'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'api/freefun/list.js'))).toBe(false);
  });

  it('does not retain the local-only debug and watchdog runtime', () => {
    expect(fs.existsSync(path.join(repoRoot, 'api/debug.js'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'api/watchdog/core.js'))).toBe(false);
  });
});
