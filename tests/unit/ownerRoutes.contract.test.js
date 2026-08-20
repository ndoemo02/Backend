/**
 * ownerRoutes.contract.test.js
 * ===========================================================================
 * Kazdy handler w `api/owner/` MUSI miec rejestracje trasy w `server-vercel.js`.
 *
 * DLACZEGO TEN TEST ISTNIEJE: przez dlugi czas frontend (`lib/kdsApi.ts`)
 * wolal `GET/PATCH /api/owner/orders[/:id]`, a backend nie mial ani handlera,
 * ani trasy. KDS dostawal `404` z `app.use((req,res) => 404)` i po prostu nie
 * widzial zamowien. Nic tego nie zlapalo, bo testy jednostkowe handlerow
 * sprawdzaja WNETRZE modulu, a nie to, czy modul jest w ogole podpiety.
 *
 * Ten test pilnuje styku: plik handlera bez trasy jest martwym kodem,
 * a trasa bez pliku to `500` przy dynamicznym imporcie.
 * ===========================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ownerDir = path.join(repoRoot, 'api/owner');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

/** Handlery, czyli wszystko w `api/owner/` poza plikami pomocniczymi (`_*`). */
function ownerHandlers() {
  return fs
    .readdirSync(ownerDir)
    .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
    .map((f) => f.replace(/\.js$/, ''));
}

describe('kontrakt tras api/owner', () => {
  it('kazdy handler jest podpiety w server-vercel.js', () => {
    const source = readRepoFile('api/server-vercel.js');
    const brakujace = ownerHandlers().filter(
      (name) => !source.includes(`./owner/${name}.js`),
    );

    expect(brakujace).toEqual([]);
  });

  it('trasy KDS istnieja dokladnie w ksztalcie, ktorego uzywa kdsApi.ts', () => {
    const source = readRepoFile('api/server-vercel.js');

    // GET  /api/owner/orders?restaurant_id=…  (kdsApi.ts fetchKDSOrders)
    expect(source).toContain("app.get('/api/owner/orders'");
    // PATCH /api/owner/orders/:id             (startOrder / markOrderReady / completeOrder)
    expect(source).toContain("app.patch('/api/owner/orders/:id'");
  });

  it('kazda trasa /api/owner/* wskazuje na istniejacy plik handlera', () => {
    const source = readRepoFile('api/server-vercel.js');
    const importy = [...source.matchAll(/\.\/owner\/([a-zA-Z0-9_-]+)\.js/g)].map((m) => m[1]);

    const nieistniejace = [...new Set(importy)].filter(
      (name) => !fs.existsSync(path.join(ownerDir, `${name}.js`)),
    );

    expect(nieistniejace).toEqual([]);
  });
});
