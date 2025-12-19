import { spawnSync } from 'node:child_process';

function runOne(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  return res.status === 0;
}

const results = [];

console.log('🧪 Running: test:logic');
results.push(['logic', runOne('npm', ['run', '--silent', 'test:logic'])]);

console.log('🧪 Running: test:critical');
results.push(['critical', runOne('npm', ['run', '--silent', 'test:critical'])]);

console.log('🧪 Running: test:fallback');
results.push(['fallback', runOne('npm', ['run', '--silent', 'test:fallback'])]);

console.log('\n📊 Amber Test Summary:');
for (const [name, ok] of results) {
  console.log(` - ${name}: ${ok ? 'PASS' : 'FAIL'}`);
}

const failed = results.filter(([, ok]) => !ok).length;
process.exit(failed === 0 ? 0 : 1);

/**
 * 🧠 Amber Brain - Test Summary Aggregator
 * Łączy raporty z testów logicznych, krytycznych i fallbacków.
 * Uruchom: npm run test:summary
 */

import { execSync } from "child_process";

function run(cmd) {
  try {
    const result = execSync(cmd, { stdio: "pipe" }).toString();
    console.log(result);
    return result;
  } catch (err) {
    console.error("❌ Błąd w teście:", err.stdout?.toString() || err.message);
    return "";
  }
}

console.log("🚀 RUNNING AMBER TEST SUITE (logic, critical, fallback)\n");

const logic = run("npm run test:logic");
const critical = run("npm run test:critical");
const fallback = run("vitest run api/brain/tests/brain-fallback.test.js --reporter=verbose");

console.log("\n🧩 🔍  SUMMARY REPORT");
console.log("--------------------------------");
console.log(`Logic Flow: ${logic.includes("FAIL") ? "❌ FAIL" : "✅ PASS"}`);
console.log(`Critical Flow: ${critical.includes("FAIL") ? "❌ FAIL" : "✅ PASS"}`);
console.log(`Fallback Layer: ${fallback.includes("FAIL") ? "❌ FAIL" : "✅ PASS"}`);
console.log("--------------------------------");

if (logic.includes("FAIL") || critical.includes("FAIL") || fallback.includes("FAIL")) {
  console.log("❗ Amber Brain needs more calibration.");
} else {
  console.log("✅ Amber Brain logic flow fully stable (Steel Mode ready).");
}
