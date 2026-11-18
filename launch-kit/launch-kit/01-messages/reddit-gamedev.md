# r/gamedev

> Angle : outil / workflow d'éditeur, pas moteur. Ce sub est saturé de « my engine ».
> Choisir le flair approprié (ex. *Tools* ou *Discussion*) le jour J.

## Titre

```
What I learned building a scene editor where the "render" button is a deterministic reference, not a screenshot
```

## Texte

```
Most small engines validate rendering by looking at the screen. That works until the
screen looks the same but the output is subtly wrong, or until a change breaks
something you weren't looking at.

So I built my editor the other way around: the authoritative render is a PNG produced
by a deterministic software rasterizer, and the interactive 3D view is explicitly a
preview.

How that changes the editor:
- Every scene has a reference PNG. A change that alters it is a regression, by
  definition, and CI catches it.
- The preview doesn't need to match the reference, so it can be fast and simple
  (WebGL2, no shadow maps). That removes a lot of "why doesn't my viewport look like
  my render" debates: it's documented as an approximation.
- Authoring stays honest: the same C++ binary validates the scene file, so the editor
  can't produce a scene the runtime rejects.

Recent example, because it's a good one. A user sent a screenshot: the cube was
rendering as scattered fragments while orbiting. Three separate bugs were stacked:

1. Vertical orbit let the eye go below the grid plane, so the grid quad filled the
   screen.
2. The grid wrote depth, so it occluded everything at grazing angles.
3. gl.clear(DEPTH_BUFFER_BIT) was running while DEPTH_WRITEMASK was still false,
   left that way by the post-processing passes. The depth buffer therefore kept the
   previous frame, and stale depths rejected chunks of the mesh.

Same camera angle, measured: 840 fragmented pixels -> 1764 solid pixels (42x42) once
the depth mask was restored before the clear. 107 assertions now guard those three
invariants.

Question for people shipping editors: do you keep a reference image per scene, or do
you rely on visual review? I've found the former catches things I would never have
looked at.

(Workbench and roadmap are public: https://novaindustries.vercel.app/ — engine core
still private.)
```

## Notes

- r/gamedev est strict sur l'auto-promotion : privilégier *Feedback Friday* si le post est refusé.
- Ne pas poster le même jour que le post r/GraphicsProgramming.
