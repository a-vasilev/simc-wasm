// Node ESM smoke harness for the simc WASM build.
//
// Proves the documented driving interface (WASM_REPO_PLAN.md 4.3):
//   1. load the ES6 module
//   2. write a profile into MEMFS
//   3. run main() CLI-style via callMain([... json2=/out.json])
//   4. read /out.json back out of MEMFS
//   5. assert a positive DPS
//
// Usage:
//   node run_smoke.mjs [path-to-simc.js] [path-to-profile.simc] [extra simc args...]
//
// Defaults: ../dist/simc.js and ./quick.simc. Runs single-threaded with a fixed
// seed so the result is deterministic.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const modulePath = resolve(here, argv[0] ?? '../dist/simc.js');
const profilePath = resolve(here, argv[1] ?? 'quick.simc');
const extraArgs = argv.slice(2);

const { default: createSimc } = await import(pathToFileURL(modulePath).href);
const profile = readFileSync(profilePath, 'utf8');

const Module = await createSimc({
  print: (t) => console.log(t),
  printErr: (t) => console.error(t),
});

Module.FS.writeFile('/in.simc', profile);

const args = [
  '/in.simc',
  'iterations=10',
  'threads=1',
  'seed=42',
  'json2=/out.json',
  ...extraArgs,
];

// With PROXY_TO_PTHREAD, main() runs on a worker; callMain may return a Promise.
let rc = Module.callMain(args);
if (rc && typeof rc.then === 'function') rc = await rc;
if (rc) throw new Error(`simc exited with code ${rc}`);

const report = JSON.parse(Module.FS.readFile('/out.json', { encoding: 'utf8' }));
const player = report.sim.players[0];
const dps = player.collected_data.dps.mean;

console.log(`Smoke OK: ${player.name} (${player.specialization}) dps=${dps.toFixed(1)}`);
if (!(dps > 0)) throw new Error(`Expected dps > 0, got ${dps}`);
