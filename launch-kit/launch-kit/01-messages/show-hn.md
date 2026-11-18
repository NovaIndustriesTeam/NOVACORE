# Show HN

> Une seule tentative. Si le post ne décolle pas, ne pas le reposter : HN le détecte et pénalise le domaine.
> Meilleur créneau : mardi–jeudi, 14h–16h UTC. Rester disponible 3 h pour répondre.

## Titre

```
Show HN: NovaCore – a local-first engine workbench with a deterministic software renderer
```

## Texte

```
I'm building NovaCore, a local-first workbench around a C++20 engine. The pitch is
narrow on purpose: every feature I announce has a reproducible test attached.

What exists today:
- A WebGL2 realtime preview in the browser (scene authoring, orbit/zoom, entity picking).
- A deterministic software rasterizer that writes reference PNGs: same scene, same
  binary, byte-identical output. That's the ground truth for regressions.
- A Direct3D 12 offscreen backend plus a native Win32 window with a flip-model
  swapchain, sharing the same pipelines. Windows only.
- Shadow maps (directional + spot, PCF), PNG/JPEG textures, linear HDR with
  half-res bloom and ACES tone mapping, 8 primitives, simple gameplay blocks.
- Scene format v4, backward compatible with v1–v3, validated by the real C++ binary
  through the workbench API.

Evidence: 83/83 Node tests, 5/5 CTest (core, render, camera, GPU, window). The
viewport fix I shipped this week is a good example of how I work: a user reported
meshes disappearing while orbiting; the root cause was gl.clear(DEPTH_BUFFER_BIT)
running with DEPTH_WRITEMASK left false by the post-processing passes, so the depth
buffer kept the previous frame. 840 fragmented pixels -> 1764 solid pixels after
restoring the depth mask before the clear.

Not implemented, and I'd rather say it: Vulkan, Metal, ray tracing, and the core
runtime itself (still private). The native window is Windows-only.

The workbench, docs and roadmap are public: https://novaindustries.vercel.app/

I'd value hard feedback on two things: whether a deterministic software renderer is
a useful regression oracle in practice, and what's missing in the editor UX before
I open the pilot phase.
```

## Premier commentaire (à poster vous-même juste après)

```
Author here. A few details people usually ask about:

- Determinism: the software rasterizer is fixed-point-ish by design (fixed draw
  order, integer-ish depth compare, no threading in the raster loop), so the PNG
  hash is stable across runs on the same build. That's what I use in CI.
- Why both a software and a GPU renderer: the software one is the oracle, the D3D12
  one is the speed path. They are not expected to be pixel-identical, and I don't
  claim they are.
- The viewport in the browser is a preview, not the reference renderer: no shadow
  maps there yet.
```

## À éviter

- Ne pas mettre « revolution », « game changer », « AI-powered ».
- Ne pas demander d'upvotes.
- Ne pas mettre plusieurs liens.
- Ne pas répondre aux trolls : répondre une fois, factuellement, puis ignorer.
