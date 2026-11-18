# Known limits

Every project has them. The difference is whether they are written where a reader can find them
before spending time on the project.

## Not implemented — do not expect these

| Feature | Status |
|---|---|
| Vulkan backend | Not implemented |
| Metal backend | Not implemented |
| Ray tracing | Not started |
| Path tracing / GI | Not started |
| Multi-instance deployment | Not supported (single instance; PostgreSQL required for that) |
| macOS / Linux GPU backend | Not implemented — D3D12 only |
| macOS / Linux native window | Not implemented — Win32 only |

## Platform reality

- **Browser workbench**: works on modern Chromium/Firefox/Safari (WebGL2, ES modules).
- **Realtime preview**: WebGL2, no shadow maps, no bloom — it is a preview, not the reference.
- **Software rasterizer**: portable C++20, but validated on Windows/MSVC only. Do not assume a
  macOS build works because the code is portable.
- **D3D12 backend and native window**: Windows only, validated on an NVIDIA GeForce GTX 1660
  SUPER. Not tested on AMD or Intel GPUs, so no compatibility claim is made for them.

## Rendering honesty

- The software rasterizer and the D3D12 backend are **not pixel-identical**, and that is by
  design: the software path is the deterministic oracle, the GPU path is the fast path.
- Shadow maps cover directional and spot lights only; point lights cast no shadows; at most two
  shadow maps per scene.
- Supersampling, bloom resolution and shadow-map resolution are configurable but unmeasured for
  performance — **no frame-time claim is made anywhere**.
- The viewport is an editor preview. Treat screenshots of it as illustrative, not as reference
  renders.

## Product and business

- The engine core and the workbench source are **private** during the pilot phase. Public: the
  website, the documentation, this repository and the roadmap.
- No public pricing. No announced date for a public release.
- **RetroEdge** (a separate project in the same ecosystem) is a concept in development. It is
  not a certified OS, not a compatibility list, and no device is claimed as supported. No game,
  BIOS, ROM or firmware is distributed with it.
- Deployment is single-instance; CSP still includes `'unsafe-inline'`. Both are known and
  documented rather than hidden.

## What is deliberately not claimed

- No user counts, no download counts, no revenue figures.
- No "production ready", no "battle tested", no "industry leading".
- No performance benchmarks.
- No compatibility matrix beyond Windows + GTX 1660 SUPER + the test suite.

If a claim is missing from the website, it is usually because it has not been measured yet.
