# simc → WebAssembly build

This directory carries the small, rebase-friendly delta that compiles simc's
`engine/` CLI to a **threaded, SIMD WebAssembly** artifact via Emscripten, plus
the local build script, a Node smoke harness, and CI helpers. It implements the
engine half of v1 (Phase 0 spine). See `WASM_REPO_PLAN.md` at the repo root for
the full plan and `OVERALL_PLAN.md` for project context.

## Current pin

| | |
|---|---|
| Upstream base SHA | see [`BASE_SHA`](./BASE_SHA) |
| simc version (`SC_VERSION`) | `1205-01` → release tag `v1205.01` |
| emsdk (pinned) | **`6.0.0`** — latest stable; bump deliberately, CI validates (O5) |

The base SHA is a commit on simc's upstream `midnight` branch (the rebase target
and reproducibility record). It is **not** a release tag — the release tag points
at our `wasm` branch tip. See `WASM_REPO_PLAN.md` §2.

### How upstream versions itself (and why our tags carry a `-N` suffix)

Don't expect a clean upstream version to rebase against — there isn't one:

- **No releases.** simc's `release-NNNN` git tags died at `release-830-01` (patch
  8.3.0, Jan 2020). There are no GitHub Releases and no current tags to track.
- **`SC_VERSION` is bumped by hand, irregularly.** It changes only when a
  maintainer commits a new string to `engine/config.hpp` (e.g. *"update version to
  1205"*, *"Disable PTR and update version"*) — on no schedule, and skipping
  numbers (it jumped `1201 → 1205` with nothing in between). So the number only
  loosely tracks the live WoW patch.
- **Data outruns the version.** New game data and next-patch class work land on
  `midnight` continuously *without* bumping `SC_VERSION`. At any given rebase the
  engine may already contain newer data than its version string admits — commit
  messages naming a future patch (e.g. "start work on 12.1") do **not** mean the
  version moved.

Consequence: two of our rebases onto different base SHAs can share the **same**
`SC_VERSION`. That's why our tag scheme is `v<SC_VERSION>[-N]` — the first release
at a version is `v1205.01`, and a later rebase still at `1205-01` becomes
`v1205.01-2`, `-3`, … The durable anchor is always the `BASE_SHA` recorded in the
release `manifest.json`; the tag is just the human-readable identity.

## Prerequisites

- [emsdk](https://emscripten.org/docs/getting_started/downloads.html) at the
  pinned version above:
  ```bash
  git clone https://github.com/emscripten-core/emsdk
  cd emsdk && ./emsdk install 6.0.0 && ./emsdk activate 6.0.0
  source ./emsdk_env.sh        # puts emcmake/emcc on PATH
  ```
- [Ninja](https://ninja-build.org/) and CMake ≥ 3.10.
- Node ≥ 20 (for the smoke harness; uses WASM threads + SharedArrayBuffer,
  enabled by default in modern Node).

## Build locally

```bash
wasm/build.sh                 # Release build -> wasm/dist/{simc.js,simc.wasm}
BUILD_TYPE=Debug wasm/build.sh
```

The build configures with `emcmake cmake`. The `if(EMSCRIPTEN)` block in the
top-level `CMakeLists.txt` forces `BUILD_GUI=OFF`, `SC_NO_NETWORKING=ON`,
`SC_NO_THREADING=OFF` (real threads kept), `BUILD_TESTING=OFF`, and includes
[`emscripten.cmake`](./emscripten.cmake) for the compile/link flags.

## Run the smoke test

```bash
node wasm/smoke/run_smoke.mjs        # loads dist/simc.js, runs quick.simc, asserts dps>0
```

This proves the documented driving interface: write a profile into MEMFS, run
`main()` via `callMain([... json2=/out.json])`, read `/out.json` back. The web
repo wires the same interface from a Web Worker; no embind API is needed.

## Driving interface (the contract for the `web` repo)

1. Write the user profile + options to `/in.simc` in MEMFS.
2. `Module.callMain(['/in.simc', 'json2=/out.json', ...options])`.
3. Read `/out.json` from MEMFS — simc's native JSON report is the render input.

Module is built `MODULARIZE + EXPORT_ES6` with `EXPORT_NAME=createSimc`; import
the default export and `await createSimc(...)`. COOP/COEP headers (required for
`SharedArrayBuffer`/threads) are the host/web-repo's concern.

## Per-patch update runbook

When a new WoW patch (or an upstream fix you want) lands, **you decide** when to
rebase. The rebase + tag is what cuts a new web-consumable release.

```bash
git fetch upstream
# 1. pick a newer base on the retail branch (prefer a data-update-live-* point)
NEW_SHA=<chosen-upstream-sha>

# 2. rebase our delta onto it (plain rebase for patch->patch)
git rebase "$NEW_SHA" wasm        # resolve the small conflicts in wasm/ guards

# 3. record the new pin and fold it into the pin commit
echo "$NEW_SHA" > wasm/BASE_SHA
git add wasm/BASE_SHA && git commit --amend     # or --fixup the pin commit

# 4. push -> CI gate (build + validation diff, no release)
git push --force-with-lease origin wasm

# 5. once green, tag wasm HEAD to publish a Release.
#    derive v<MAJOR>.<MINOR> from engine/config.hpp SC_VERSION; add -N if it exists.
git tag -a v1205.01 -m "simc 1205-01 @ $NEW_SHA"   # or v1205.01-2 if v1205.01 exists
git push origin v1205.01
```

- The **release tag points at our `wasm` HEAD**, never at `$NEW_SHA`.
- **Yearly expansion switch only:** `git rebase --onto <new-expansion-sha> <old-base-sha> wasm`.
- If a pinned SHA lands mid-data-update and fails the validation sims, bump to a
  slightly later commit and re-tag.

## Layout

```
wasm/
  BASE_SHA            upstream pin (rebase target; tracked source of truth)
  README.md           this file
  build.sh            canonical emcmake + ninja build -> dist/
  emscripten.cmake    emcc compile/link flags (included from top-level CMakeLists)
  smoke/
    quick.simc        tiny single-actor profile
    run_smoke.mjs     Node harness: MEMFS in -> callMain -> json2 out -> assert dps>0
  ci/
    run_wasm.mjs      generic runner: profile -> json2 host file (validation diff)
    compare-dps.mjs   per-player DPS comparator with relative tolerance
```
