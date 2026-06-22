// Generic Node ESM runner for the simc WASM build, used by the CI validation
// diff (Job B). Runs a profile through the wasm module CLI-style and writes the
// json2 report out to a host file for comparison against native simc.
//
// Usage:
//   node run_wasm.mjs <simc.js> <profile.simc> <out.json> [extra simc args...]
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const [modArg, profileArg, outArg, ...extraArgs] = process.argv.slice(2);
if (!modArg || !profileArg || !outArg) {
  console.error('usage: node run_wasm.mjs <simc.js> <profile.simc> <out.json> [args...]');
  process.exit(2);
}

const modulePath = resolve(process.cwd(), modArg);
const { default: createSimc } = await import(pathToFileURL(modulePath).href);
const profile = readFileSync(resolve(process.cwd(), profileArg), 'utf8');

const Module = await createSimc({
  print: (t) => console.log(t),
  printErr: (t) => console.error(t),
});

Module.FS.writeFile('/in.simc', profile);

let rc = Module.callMain(['/in.simc', 'json2=/out.json', ...extraArgs]);
if (rc && typeof rc.then === 'function') rc = await rc;
if (rc) throw new Error(`simc exited with code ${rc}`);

const json = Module.FS.readFile('/out.json', { encoding: 'utf8' });
writeFileSync(resolve(process.cwd(), outArg), json);
console.log(`wrote ${outArg} (${json.length} bytes)`);
