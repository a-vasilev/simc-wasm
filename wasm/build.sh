#!/usr/bin/env bash
#
# Canonical Emscripten build for the simc WASM artifact.
#
# Prereqs: a pinned emsdk active on PATH (emcmake/emcc), plus ninja.
# See wasm/README.md for the pinned emsdk version and setup.
#
# Output: wasm/dist/{simc.js, simc.wasm} (+ simc.worker.js on older emsdk).
#
# Usage:
#   wasm/build.sh                 # Release build into wasm/dist
#   BUILD_TYPE=Debug wasm/build.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
build_dir="${BUILD_DIR:-$here/build}"
dist_dir="${DIST_DIR:-$here/dist}"
build_type="${BUILD_TYPE:-Release}"

if ! command -v emcmake >/dev/null 2>&1; then
  echo "error: emcmake not found on PATH. Activate emsdk first (see wasm/README.md)." >&2
  exit 1
fi

# Configure with the Emscripten toolchain. The if(EMSCRIPTEN) block in the
# top-level CMakeLists.txt forces BUILD_GUI=OFF, SC_NO_NETWORKING=ON,
# SC_NO_THREADING=OFF, BUILD_TESTING=OFF and includes wasm/emscripten.cmake.
emcmake cmake -G Ninja \
  -S "$root" \
  -B "$build_dir" \
  -DCMAKE_BUILD_TYPE="$build_type"

# Build only the CLI target (skips the Qt GUI entirely).
cmake --build "$build_dir" --target simc

mkdir -p "$dist_dir"
# add_executable(simc ...) under Emscripten emits simc.js + simc.wasm.
cp "$build_dir/simc.js"   "$dist_dir/"
cp "$build_dir/simc.wasm" "$dist_dir/"
# Older emsdk emits a separate pthread worker shim; newer embeds it.
if [ -f "$build_dir/simc.worker.js" ]; then
  cp "$build_dir/simc.worker.js" "$dist_dir/"
fi

echo "Build complete -> $dist_dir"
ls -lh "$dist_dir"
