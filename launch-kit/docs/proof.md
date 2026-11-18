# Proof — how each number is produced

This page exists because "trust me" is not a proof. For each claim: the exact command, what it
measures, and what it does **not** prove.

**Limitation you should read first.** The engine core and workbench are private during the pilot
phase. You cannot run these commands today. That is a real weakness of this page: it documents a
measurement you have to take on my word. It is written down anyway, with the exact command, so
that (a) the claims are falsifiable in principle and (b) nothing here is vague enough to hide
behind.

All measurements below were taken on **Windows 11**, Node 20+, MSVC C++20,
NVIDIA GeForce GTX 1660 SUPER, on **13 November 2026**, on the build identified as
NovaCore 3.10.0 / Workbench 1.9.1 / engine 0.8.0 / C++ API 6 / scene schema 4.

---

## 1. `83/83` — Node test suite

```bash
npm test
# node --test --test-concurrency=1 test/*.test.js
```

Covers: authentication (anti-enumeration, rate limiting, identical error messages), session
revocation, per-account data isolation, export/import round-trip, SQLite migration and rollback,
security headers and CSP, request identifiers, NovaSeries import/export, Feature Lab preferences.

What it does **not** prove: rendering correctness. That is section 3.

---

## 2. `5/5` — CTest suites

```bash
cd nova-engine-workbench/engine/build
ctest -C Debug --output-on-failure
```

| Suite | What it covers |
|---|---|
| `NovaEngine.CoreTests` | scene format v4, validation, CLI |
| `NovaEngine.RenderTests` | software rasterizer, shadows, textures, bloom/ACES |
| `NovaEngine.CameraTests` | camera maths, projection |
| `NovaEngine.GpuTests` | D3D12 backend, offscreen capture |
| `NovaEngine.WindowTests` | native Win32 window, swapchain |

Latest run: `100% tests passed, 0 tests failed out of 5`, total 10.21 s.

What it does **not** prove: that the GPU and software paths produce identical images. They are
not claimed to be identical; the software path is the oracle.

---

## 3. Determinism of the software rasterizer

The claim: same scene + same binary ⇒ byte-identical PNG.

How it is achieved, in the rasterizer:

- fixed draw order (no depth sorting, no per-frame sorting of transparent geometry);
- single-threaded raster loop (no tile scheduling, so no run-to-run variation from work stealing);
- integer-quantized depth comparison rather than float-interpolated.

How it is checked: the render test issues the same render request twice through the local HTTP API
and compares the two PNG files byte for byte (`Two identical renders must produce byte-identical
PNG files`). The same check is repeated for the grid material and for a textured scene.

What it does **not** prove: determinism across compilers, architectures or optimisation levels.
The guarantee is for a given build. It also does not prove the GPU path is deterministic — it is
not claimed to be.

---

## 4. `107` — viewport regression assertions

```bash
cd nova-engine-workbench
npm run test:viewport
# test-viewport: OK - 107 verifications
```

The test loads the JavaScript that is **actually served** (via `node:vm`), then asserts:

- 400 px of simulated vertical drag never puts the eye below `GRID_PLANE_Y + 0.08`;
- the depth-mask ordering around the scene clear (`gl.depthMask(true)` must precede
  `gl.clear(COLOR | DEPTH)`);
- the grid is drawn without depth writes;
- the anti-moiré attenuation terms are present in the grid shader;
- script load order (`viewport-math.js` before `viewport-3d.js`).

What it does **not** prove: the rendered image. Several assertions read source text rather than
pixels. That is deliberate — it catches the class of regression where a future pass leaves
`depthMask(false)` and silently disables the clear — but it is weaker than a pixel test, and the
pixel tests exist separately (`test:render`, `test:gpu`, CTest).

---

## 5. `840 → 1 764` pixels — the depth-mask bug

Method, in a real browser on the real scene, at a fixed camera angle:

1. Call `capture()` (draw + `readPixels`) with the mesh visible → image A.
2. Call `capture()` with `gl.drawElements` neutralised so meshes are skipped → image B.
3. Count pixels where A and B differ by more than 10 (sum of RGB deltas).

This isolates the mesh from the grid and the light gizmos, which an "orange pixel" heuristic would
include.

| State | Mesh pixels |
|---|---|
| depth mask left `false` at the clear | 840 (fragmented: one 45×10 band, one detached 2×10 bar, isolated pixels) |
| `gl.depthMask(true)` before the clear | **1 764** (42×42, solid) |

Same run, after the fix, across interaction states:

| State | Mesh pixels | Bounding box | Fill ratio |
|---|---|---|---|
| initial | 1 982 | 42×48 | 0.983 |
| orbit up 100 px | 1 764 | 42×42 | 1.000 |
| orbit down 120 px | 2 246 | 42×55 | 0.972 |
| zoom in | 6 048 | 72×89 | 0.944 |
| zoom out | 660 | 22×30 | 1.000 |
| zoom out (max) | 80 | 8×10 | 1.000 |

`eye.y` stayed at `0.08` throughout; `pick` at the centre returned `starter-cube`; zero console
errors.

What it does **not** prove: that the GPU path matches. It does not, and does not need to.

---

## 6. `50` — Feature Lab modules

50 modules across 8 categories, each wired to a real preference or a real application action
(page, effect, focus mode, note, prompt, health, cloud, export), with search, filters, a
completion hero, and migration of the old indexed flags.

What it does **not** prove: that each module is *useful* to you. "Actionable" means the switch
changes state; it does not mean the feature is mature.

---

## 7. GPU capture numbers

```bash
npm run test:gpu
# test-gpu passed: D3D12 on NVIDIA GeForce GTX 1660 SUPER, 3 meshes, 1022 triangles,
# 6 draw calls, 1 shadow map, 886 colours, 230663 PNG bytes, ...
```

The same test also asserts that disabling shadows changes the capture, that disabling bloom
changes the capture, that checker/grid materials are distinct and deterministic, that the torus
has more triangles than the cube, and that the native runtime window opens and stops over HTTP.

What it does **not** prove: performance. There is no frame-time benchmark in this table, so no
frame-time claim is made anywhere.
