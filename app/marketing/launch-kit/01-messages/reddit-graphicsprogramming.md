# r/GraphicsProgramming

> Subreddit technique. Le post doit apporter quelque chose, pas vendre.
> Lire les règles du sub le jour J (elles changent). Répondre à tous les commentaires.

## Titre

```
A deterministic software rasterizer as a regression oracle for a small C++20 engine (with the depth-mask bug that made meshes vanish)
```

## Texte

```
I maintain a small engine (C++20, no third-party renderer) and I wanted a renderer I
could trust more than my eyes: something that produces the same PNG every run, so CI
fails when a change alters the image.

Design choices in the software path:
- Fixed draw order, single-threaded raster loop: no per-tile scheduling, so no
  run-to-run variation from work stealing.
- Depth compare is integer-quantized rather than float-interpolated, which removes
  most of the "same input, different edge pixels" problem at triangle boundaries.
- The pipeline is the reference: shadow maps (directional + spot, PCF), linear HDR,
  half-res bloom, ACES tone mapping, PNG/JPEG textures through stb_image.
- The D3D12 backend mirrors the same scene graph and pipelines. I do NOT claim the
  two are pixel-identical; the software one is the oracle, the GPU one is the speed
  path.

Concrete example of it paying off, from this week. A user reported meshes
disappearing while orbiting the WebGL2 preview. The preview is not the reference
renderer, but the same class of bug applies everywhere:

  gl.bindFramebuffer(sceneFbo);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);   // depth mask left false

gl.clear honours DEPTH_WRITEMASK. The bloom/composite/overlay passes at the end of
the frame leave depthMask(false), so the depth buffer was never actually cleared and
kept the previous frame's depths. Result: stale depths rejected fragments of the cube
as soon as the camera moved. Measured at the same camera angle: 840 fragmented pixels
before, 1764 solid pixels (42x42) after moving `gl.depthMask(true)` before the clear.

Two lessons I'd pass on:
1. State leakage across render passes is the most expensive bug class in a
   hand-written pipeline. Clear/render code should assert its own state, not inherit.
2. A deterministic renderer turns "looks wrong" into "this hash changed", which is
   the difference between an afternoon and a five-minute bisect.

Happy to answer questions about the determinism strategy or the shadow/bloom setup.

(Project, if useful: https://novaindustries.vercel.app/ — the engine core is private
for now, the workbench and the roadmap are public.)
```

## Variante courte (si le sub préfère les posts courts)

```
Deterministic software rasterizer as a regression oracle: fixed draw order,
single-threaded raster, integer-quantized depth compare -> same PNG every run.
The D3D12 path is the speed path; I don't claim they match pixel for pixel.

This week it helped find a classic state-leak bug: gl.clear(DEPTH_BUFFER_BIT) ran
with DEPTH_WRITEMASK still false (left by the post passes), so the depth buffer kept
the previous frame and meshes fragmented while orbiting. Fixed by restoring
gl.depthMask(true) before the clear. 840 -> 1764 px at the same angle.
```

## Notes

- Ne pas poster de lien dans le titre.
- Ne pas mettre « check out my project » dans la première phrase.
- Si un modérateur demande de retirer le lien : le retirer et laisser le contenu.
