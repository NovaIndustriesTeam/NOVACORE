# NovaCore — public launch material

Public companion repository for **NovaCore**, a local-first 3D engine workbench built around a C++20 core.

- Website: https://novaindustries.vercel.app/
- Contact: novaindustriesteam@gmail.com

This repository hosts the **communication material** — press kit, verified numbers, known limits,
and the launch texts for each channel. It is not the engine.

## What this repository is

| Is | Is not |
|---|---|
| The press kit (descriptions in 50/100/250 words) | The engine source code |
| The list of verified numbers, with the command that produces each one | A downloadable build |
| The known limitations, written down | An open-source licence for the engine |
| The launch texts, ready to publish | A promise of dates |

**The engine core and the workbench are private during the pilot phase.** This is stated here
because it is the first question a reader will ask, and answering it late costs credibility.

## What NovaCore does today

- **Scene authoring** in a browser workbench: entities, transforms, lights, picking, autosave
  with rolling backups.
- **Realtime preview** in WebGL2, explicitly documented as an approximation.
- **Deterministic software rasterizer**: same scene, same binary, byte-identical PNG. This is
  the reference renderer and the regression oracle.
- **Direct3D 12 backend** (offscreen and native Win32 window with a flip-model swapchain),
  sharing the same scene graph and pipelines. Windows only.
- Shadow maps (directional and spot, PCF), PNG/JPEG textures, linear HDR with half-resolution
  bloom, ACES tone mapping, eight primitives, basic gameplay blocks.
- Scene format **v4**, backward compatible with v1–v3, validated by the real C++ binary.

## Verified numbers

Every figure below was measured on the build described. See [`docs/proof.md`](docs/proof.md)
for the exact command and what it measures.

| Claim | Value |
|---|---|
| Node test suite | **83/83** |
| CTest suites (core, render, camera, GPU, window) | **5/5** |
| Viewport regression assertions | **107** |
| Feature Lab modules | **50** |
| GPU capture (GTX 1660 SUPER) | 3 meshes, 1 022 triangles, 6 draw calls, 1 shadow map, 886 colours, 230 663-byte PNG |

## Known limits

Read [`docs/limits.md`](docs/limits.md). Short version: **no Vulkan, no Metal, no ray tracing.**
The native window is Windows-only. The browser preview does not render shadow maps and is not
pixel-identical to the reference renderer. The engine core is private.

## The bug that says more than a feature list

A user reported meshes vanishing while orbiting the preview. Three bugs were stacked:

1. Vertical orbit let the camera go below the grid plane.
2. The grid wrote depth, so it occluded the scene at grazing angles.
3. `gl.clear(DEPTH_BUFFER_BIT)` ran while `DEPTH_WRITEMASK` was still `false`, left that way by
   the post-processing passes — so the depth buffer kept the previous frame and stale depths
   rejected fragments of the mesh.

Same camera angle, measured: **840 fragmented pixels → 1 764 solid pixels (42×42)**.

```js
gl.bindFramebuffer(gl.FRAMEBUFFER, renderTargets.scene.framebuffer);
gl.viewport(0, 0, width, height);
gl.depthMask(true);   // gl.clear honours DEPTH_WRITEMASK
gl.clearColor(0.02, 0.03, 0.06, 1);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
```

Full write-up: [`docs/article-depth-mask.md`](docs/article-depth-mask.md).

## Repository layout

```
docs/proof.md              how each number is produced
docs/limits.md             what is not implemented
docs/article-depth-mask.md technical article
launch-kit/                texts per channel, press kit, checklists, tracked links
media/                     where screenshots and the demo GIF go
```

## Licence

Text and documentation in this repository: **MIT**. See [`LICENSE`](LICENSE).
The engine core, the workbench application and the binary builds are **proprietary** and are
not covered by that licence.

## Français

La documentation produit et le kit de lancement sont aussi disponibles en français dans
[`launch-kit/`](launch-kit/). Le site officiel est en français.
