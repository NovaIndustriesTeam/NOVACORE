# dev.to — article technique

> Objectif : référencement durable + preuve de compétence. Un article utile vaut mieux
> que dix posts promotionnels. Le lien vers le projet va à la fin, une seule fois.
> Tags suggérés : `#cpp #graphics #webgl #testing`.

## Titre

```
Why I clear the depth buffer twice as carefully as I clear the colour buffer
```

## Sous-titre

```
A state-leak bug that made meshes vanish while orbiting, and the invariants I now test to prevent it
```

## Corps de l'article (à copier tel quel dans l'éditeur dev.to)

A user sent me a screenshot last week: a cube rendered as scattered fragments when the camera moved. The grid was fine. The lighting was fine. Only the mesh was breaking apart.

Three separate bugs were stacked on top of each other. The third one is the interesting one, and it's a trap that any hand-written OpenGL pipeline can fall into.

### Bug 1 — the camera went under the floor

The orbit controller applied pitch directly:

```js
eye.y = target.y + distance * Math.sin(pitch);
```

After about 40 pixels of vertical drag, the eye went below y = 0. My grid is a quad of ±200 units at y = 0, so from below it filled the entire viewport. It looked like "the 3D disappeared"; actually the camera was looking at the underside of the grid.

Fix: clamp the pitch so the eye stays above `GRID_PLANE_Y + margin`, unless the pivot itself is deliberately below the grid (in which case free orbit is the right behaviour).

### Bug 2 — the grid wrote depth

The grid was drawn with depth writes enabled. At grazing angles it became an occluder: it wasn't just visually dense from moiré, it actively hid geometry behind it.

Fix:

```js
gl.depthMask(false);
drawGrid();
gl.depthMask(true);   // restore before meshes
```

A reference grid should never be an obstacle. And the shader now fades minor and major lines at grazing incidence, which removes the moiré sheet as a side effect.

### Bug 3 — `gl.clear` was not clearing depth

This is the one worth writing down.

```js
gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
gl.clearColor(0.02, 0.03, 0.06, 1);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
```

It looks correct. It is not.

`gl.clear(DEPTH_BUFFER_BIT)` is governed by `DEPTH_WRITEMASK`. If depth writes are masked off, the depth buffer is **not** cleared — no error, no warning. And my post-processing chain (bloom, composite, overlays) ended the previous frame with:

```js
gl.depthMask(false);
```

so `DEPTH_WRITEMASK` was still `false` when the next frame started. The depth buffer kept the previous frame's values forever, and those stale depths rejected fragments of the cube as soon as the camera moved by more than a fraction of a pixel.

Measured effect at the same camera angle:

| state | cube pixels |
|---|---|
| clear with `DEPTH_WRITEMASK = false` | 840 (fragmented) |
| `gl.depthMask(true)` before the clear | 1764 (42×42, solid) |

The fix is one line, in the right place:

```js
gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
gl.viewport(0, 0, width, height);
gl.depthMask(true);   // clear must not inherit the previous pass's state
gl.clearColor(0.02, 0.03, 0.06, 1);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
```

### The real lesson: passes should not inherit state

Every one of these bugs is a state leak. The pipeline worked because of the order in which passes happened to run, not because each pass established what it needed.

What I changed in my own code, beyond the fix:

1. **No pass assumes depth state.** The scene pass sets `depthMask(true)`; the grid and the overlays set `depthMask(false)` and restore it.
2. **The clear is part of the scene pass**, not a preamble owned by nobody.
3. **Invariants are tested**, not reviewed. My viewport test now asserts, against the source that is actually served:

```js
const clearIndex = src.indexOf('gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)');
const preamble = src.slice(Math.max(0, clearIndex - 700), clearIndex);
const lastTrue = preamble.lastIndexOf('gl.depthMask(true)');
const lastFalse = preamble.lastIndexOf('gl.depthMask(false)');
assert(lastTrue >= 0 && lastTrue > lastFalse);
```

That's 107 assertions in total: 400 pixels of simulated vertical drag (the eye never goes below the grid), depth-mask ordering, grid non-occlusion, anti-moiré attenuation, script load order.

A static assertion on source code is not as strong as a rendering test, and I'd rather have both. But it catches exactly this class of regression: someone adds a post pass, forgets to restore the mask, and the next clear silently stops working.

### Why I also keep a deterministic renderer

The WebGL2 preview is not my reference renderer — it doesn't even do shadow maps. The reference is a software rasterizer in the C++ core: fixed draw order, single-threaded raster loop, integer-quantized depth compare. Same scene, same binary, byte-identical PNG.

That gives the editor a property I find more useful than a prettier viewport: a change that alters the image fails a test, instead of waiting for a human to notice. It is also why the screenshot in this article could be diagnosed in minutes — I had a known-good image and a hash to compare against.

---

The workbench, docs and roadmap are public: https://novaindustries.vercel.app/
The engine core is private during the pilot phase. Vulkan, Metal and ray tracing are not implemented; the native window is Windows-only. If you want the honest limits alongside the features, that's the page.

## Notes de publication

- Ajouter les deux images avant/après (fragments / bloc plein) avec un texte alternatif.
- Publier un mardi ou mercredi matin ; répondre aux commentaires pendant 24 h.
- Réutiliser l'article sur Hashnode avec `canonical_url` vers dev.to (évite le contenu dupliqué).
