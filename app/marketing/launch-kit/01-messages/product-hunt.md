# Product Hunt

> Nécessite un compte « hunter » ou de soumettre soi-même. Prévoir 3 h de présence le jour J.
> Ne pas lancer le même jour que le Show HN.

## Nom

```
NovaCore
```

## Tagline (≤ 60 caractères)

```
Local-first engine workbench with a deterministic renderer
```
(57 caractères)

## Description courte

```
NovaCore is a local-first workbench around a C++20 engine: author a 3D scene, preview
it in real time, then render a byte-identical reference PNG with a deterministic
software rasterizer. A Direct3D 12 backend handles the fast path on Windows. Every
announced feature ships with a reproducible test — 54 Node tests, 5 CTest suites.
```

## Description longue

```
NovaCore is built around one idea: a renderer you can trust without looking at it.

Authoring: a scene editor in the browser with a WebGL2 realtime preview — orbit,
zoom, lighting, entity picking, autosave and rolling backups.

Reference rendering: the same C++20 core renders through a deterministic software
rasterizer. Same scene, same binary, same PNG. That output is the regression oracle,
so a rendering change that alters the image fails the build instead of quietly
shipping.

Fast path: a Direct3D 12 offscreen backend and a native Win32 window with a
flip-model swapchain, sharing the same scene graph and pipelines. Windows only.

Renderer features: shadow maps (directional and spot, PCF), PNG/JPEG textures, linear
HDR with half-resolution bloom and ACES tone mapping, eight primitives, and basic
gameplay blocks (rigidbody, controller, spinner, collectible).

Under the hood: scene format v4 (v1–v3 still readable), C++ API 6, engine 0.8.0,
workbench 1.9.1. Scenes are validated by the real engine binary, not by a JS
reimplementation.

Honest limits: Vulkan, Metal and ray tracing are not implemented. The native window
is Windows-only. The engine core is still private during the pilot phase. The browser
preview does not render shadow maps and is not pixel-identical to the reference
renderer — by design, and documented as such.

Who it's for: developers who want an engine whose rendering regressions are caught
mechanically, and teams who need a reproducible image pipeline for review.
```

## Premier commentaire (à poster immédiatement)

```
Maker here. The shortest version of the pitch: I wanted a renderer where a visual
regression fails a test instead of waiting for someone to notice.

Concretely, the software rasterizer uses a fixed draw order, a single-threaded raster
loop and an integer-quantized depth compare, so the PNG hash is stable across runs.
The D3D12 backend is the speed path and is not claimed to be pixel-identical.

This week's bug is a good illustration of why state discipline matters: the depth
buffer was never actually cleared because gl.clear(DEPTH_BUFFER_BIT) ran with
DEPTH_WRITEMASK left false by the post passes. Meshes fragmented while orbiting.
840 -> 1764 pixels at the same angle after restoring the mask.

Happy to answer anything about the determinism strategy, the shadow/bloom pipeline,
or what's still missing before the pilot phase.
```

## Galerie (à produire avant le lancement)

1. **Image 1** — viewport avec la scène de démarrage (cube, sphère, sol, grille), titre lisible en surimpression.
2. **Image 2** — comparaison logiciel / GPU côte à côte, avec la mention « not pixel-identical by design ».
3. **Image 3** — capture du Feature Lab (50 modules).
4. **Image 4** — terminal : `54/54` + `5/5` + le hash du PNG de référence.
5. **GIF 15 s** — orbite dans le viewport, zoom, zoom arrière. C'est l'asset le plus important.

## Sujets / tags

```
Developer Tools, 3D Technology, Open Source, Software Engineering
```

## À éviter

- Ne pas promettre « open source » si le noyau reste privé : écrire « workbench and docs public, core private ».
- Ne pas demander d'upvotes, ne pas organiser de vote en interne.
