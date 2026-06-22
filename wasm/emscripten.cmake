# Emscripten compile/link flags for the simc WASM target.
#
# Included from the top-level CMakeLists.txt only when EMSCRIPTEN is set, so the
# in-place delta against upstream stays to a single include() line. See
# WASM_REPO_PLAN.md section 4.2 for the rationale behind each flag.
#
# Flags split into:
#   * common  -> must match at BOTH compile and link (threads, SIMD, exceptions)
#   * link    -> only meaningful for the final `simc` executable
#
# Applied globally via add_compile_options / add_link_options so both the
# `engine` static library and the `simc` executable pick them up. (Link options
# on a static archive are inert, so applying them globally is harmless.)

# -- common: compile AND link --------------------------------------------------
set(SC_WASM_COMMON_FLAGS
  -pthread             # real threads via Web Workers + SharedArrayBuffer
  -msimd128            # WASM SIMD
  -fwasm-exceptions    # native Wasm EH (simc uses C++ exceptions; avoid the
                       #   slow/large emulated legacy path)
)

add_compile_options(${SC_WASM_COMMON_FLAGS})
add_link_options(${SC_WASM_COMMON_FLAGS})

# -- link only -----------------------------------------------------------------
add_link_options(
  # Threading: pre-spawn a generous fixed pool for v1 (revisit vs on-demand spawn
  # with the web repo -- see plan O3).
  #
  # NOT using -sPROXY_TO_PTHREAD: the web app hosts this module inside a dedicated
  # orchestration Web Worker (OVERALL_PLAN.md s3), so main() is already off the UI
  # thread. Proxying would make callMain() return before the sim finishes (and the
  # exit code unreliable), breaking the synchronous "run main() -> read /out.json"
  # pattern that both the Node CI harness and the worker rely on. Without it,
  # callMain() blocks the host thread until the report is written, then MEMFS has
  # /out.json. The pool still pre-spawns regardless, so parallelism is unaffected.
  -sPTHREAD_POOL_SIZE=8

  # Memory: simc bakes ~95 MB of WoW game data into static memory, so the 16 MB
  # default initial heap is far too small to link. Size the initial heap to 256 MB
  # (static data + quick-sim working set) and keep growth (up to the 2 GB default
  # max) for heavier multi-profileset runs. (plan O2/O3; revisit after profiling.)
  -sINITIAL_MEMORY=268435456
  -sALLOW_MEMORY_GROWTH=1

  # Module shape: clean ES6 import into a Web Worker (web repo) and Node (smoke).
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createSimc
  -sENVIRONMENT=web,worker,node

  # Drive the CLI main() repeatedly from JS and read/write MEMFS, rather than
  # auto-running once at load. (plan 4.3)
  -sINVOKE_RUN=0
  -sEXIT_RUNTIME=0
  "-sEXPORTED_RUNTIME_METHODS=['callMain','FS']"

  # Release optimization also drives wasm-opt + symbol stripping during link.
  $<$<CONFIG:Release>:-O3>
)
