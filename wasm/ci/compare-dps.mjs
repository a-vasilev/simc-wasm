// Statistical validation-diff comparator for the CI regression guard
// (WASM_REPO_PLAN.md 6, Job B; open item O4).
//
// Native (x86-64) and wasm are built by different compilers, so floating-point
// rounding differs by ~1e-16 per op. Even with an identical integer RNG, those
// differences occasionally flip an event-ordering or proc-threshold decision,
// after which the two sims walk independent random trajectories. At finite
// iterations they are therefore two INDEPENDENT samples of the same underlying
// distribution -- a fixed relative tolerance flags this Monte Carlo noise as if
// it were a porting bug.
//
// The correct test is whether the two means agree within their combined Monte
// Carlo standard error, which simc reports per actor as dps.mean_std_dev:
//
//     z = |nMean - wMean| / sqrt(nSE^2 + wSE^2)
//
// Pass if z <= Z_MAX (default 5 ~ a 1-in-3.5M per-tail false-positive rate).
// This auto-scales the tolerance per actor by its real variance, tolerating
// noise while still catching a genuine regression (which is either large/local
// -> huge z, or systematic across all actors -> a clear one-sided pattern).
//
// Run the sims with enough iterations that the standard error is small (the CI
// job uses iterations=1000), or the test loses sensitivity to real bugs.
//
// Usage:
//   node compare-dps.mjs <native.json> <wasm.json>
// Env:
//   Z_MAX          z-score threshold (default 5)
//   REL_FALLBACK   relative tolerance used only if a run lacks mean_std_dev
//                  (simple sample data); default 0.02 (2%)
import { readFileSync } from 'node:fs';

const [nativePath, wasmPath] = process.argv.slice(2);
if (!nativePath || !wasmPath) {
  console.error('usage: node compare-dps.mjs <native.json> <wasm.json>');
  process.exit(2);
}

const Z_MAX = Number(process.env.Z_MAX ?? '5');
const REL_FALLBACK = Number(process.env.REL_FALLBACK ?? '0.02');

function statsByPlayer(path) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const map = new Map();
  for (const p of report.sim.players) {
    const dps = p.collected_data.dps;
    // mean_std_dev is only emitted for non-simple sample data; may be undefined.
    map.set(p.name, { mean: dps.mean, se: dps.mean_std_dev });
  }
  return map;
}

const native = statsByPlayer(nativePath);
const wasm = statsByPlayer(wasmPath);

const rows = [];
let failed = 0;

for (const [name, n] of native) {
  if (!wasm.has(name)) {
    rows.push({ name, ...blank(n.mean), status: 'MISSING' });
    failed++;
    continue;
  }
  const w = wasm.get(name);
  const rel = n.mean === 0 ? (w.mean === 0 ? 0 : Infinity) : (w.mean - n.mean) / n.mean;

  let z = NaN;
  let ok;
  if (Number.isFinite(n.se) && Number.isFinite(w.se) && (n.se > 0 || w.se > 0)) {
    const combined = Math.sqrt(n.se * n.se + w.se * w.se);
    z = Math.abs(w.mean - n.mean) / combined;
    ok = z <= Z_MAX;
  } else {
    // No error bars available -> fall back to a loose relative tolerance.
    ok = Math.abs(rel) <= REL_FALLBACK;
  }
  if (!ok) failed++;
  rows.push({ name, native: n.mean, wasm: w.mean, rel, z, status: ok ? 'ok' : 'FAIL' });
}

function blank(mean) {
  return { native: mean, wasm: NaN, rel: NaN, z: NaN };
}

const pad = (s, n) => String(s).padEnd(n);
const num = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const pct = (v) => (Number.isFinite(v) ? (v * 100).toFixed(3) + '%' : String(v));
const zfmt = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');

console.log(`z-test threshold: ${Z_MAX} sigma  (fallback rel tolerance ${(REL_FALLBACK * 100).toFixed(1)}% when no error bars)\n`);
console.log(`${pad('player', 24)} ${pad('native', 12)} ${pad('wasm', 12)} ${pad('delta', 11)} ${pad('z', 7)} status`);
console.log('-'.repeat(78));
for (const r of rows) {
  console.log(`${pad(r.name, 24)} ${pad(num(r.native), 12)} ${pad(num(r.wasm), 12)} ${pad(pct(r.rel), 11)} ${pad(zfmt(r.z), 7)} ${r.status}`);
}
console.log('-'.repeat(78));

const meanRel = rows.filter((r) => Number.isFinite(r.rel)).reduce((a, r) => a + r.rel, 0) / rows.length;
console.log(`mean delta across actors: ${pct(meanRel)} (near 0 => no systematic bias)`);

if (failed > 0) {
  console.error(`\nFAILED: ${failed} player(s) exceed ${Z_MAX} sigma.`);
  process.exit(1);
}
console.log(`\nPASS: all ${rows.length} player(s) statistically consistent with native.`);
