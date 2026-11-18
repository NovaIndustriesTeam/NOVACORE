/*
 * Nova Engine Workbench — viewport orbit / grid regression test.
 *
 * The defect this covers: orbiting the camera upward used to slide the eye
 * under the editor grid plane. The grid quad wrote depth, so it then covered
 * the whole viewport and every mesh disappeared (only the sky and a thin
 * silhouette stayed visible). This test exercises the exact orbit math served
 * to the browser and pins the rendering invariants that prevent the
 * regression.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
let checks = 0;

function assert(condition, message) {
  checks += 1;
  if (!condition) {
    console.error(`test-viewport: FAIL - ${message}`);
    process.exit(1);
  }
}
function close(actual, expected, epsilon, message) {
  assert(Math.abs(actual - expected) <= epsilon, `${message} (attendu ${expected}, obtenu ${actual})`);
}

// ---------------------------------------------------------------- orbit math
const sandbox = { window: {} };
sandbox.globalThis = sandbox.window;
const mathSource = fs.readFileSync(path.join(ROOT, 'public', 'viewport-math.js'), 'utf8');
vm.runInNewContext(mathSource, sandbox, { filename: 'viewport-math.js' });
const math = sandbox.window.NovaViewportMath;
assert(math && typeof math.clampOrbitPitch === 'function', 'viewport-math.js doit exposer NovaViewportMath.clampOrbitPitch');
assert(math.GRID_PLANE_Y === 0, 'le plan de grille doit rester a y = 0');
assert(math.CAMERA_FLOOR_MARGIN > 0, 'la marge de securite camera doit etre positive');

const floor = math.GRID_PLANE_Y;
const margin = math.CAMERA_FLOOR_MARGIN;
const distance = 8;

// Target on the ground: the eye must stay above the grid plane.
const minPitch = math.minOrbitPitch(0, distance, floor, margin);
close(minPitch, Math.asin(margin / distance), 1e-9, 'pitch minimal pour une cible au sol');
const eyeAtFloor = math.orbitEye([0, 0, 0], 0.62, minPitch, distance);
close(eyeAtFloor[1], floor + margin, 1e-9, 'l oeil clampe doit rester juste au-dessus du plan');

// A drag that used to bury the camera is clamped, and the eye stays above.
const buried = math.clampOrbitPitch(-1.45, 0, distance, floor, margin);
close(buried, minPitch, 1e-9, 'un pitch negatif doit etre releve au minimum');
for (let pixels = 0; pixels <= 400; pixels += 5) {
  const raw = 0.245 - pixels * 0.006;
  const clamped = math.clampOrbitPitch(raw, 0, distance, floor, margin);
  const eye = math.orbitEye([0, 0, 0], 0.62, clamped, distance);
  assert(eye[1] >= floor + margin - 1e-9, `l oeil doit rester au-dessus du plan apres ${pixels} px de glissement (y = ${eye[1]})`);
}
// Pitch above the limit is untouched (the fix must not block normal orbiting).
assert(math.clampOrbitPitch(0.6, 0, distance, floor, margin) === 0.6, 'un pitch valide doit rester inchange');
assert(math.clampOrbitPitch(1.45, 0, distance, floor, margin) === 1.45, 'le pitch maximal doit rester inchange');

// A pivot below the grid means the designer panned under the floor on purpose:
// orbiting must stay free, which is why the grid no longer writes depth.
const under = math.clampOrbitPitch(-0.9, -3, distance, floor, margin);
assert(under === -0.9, 'un pivot sous la grille doit laisser le pitch libre');
assert(math.minOrbitPitch(-3, distance, floor, margin) === -Infinity, 'aucun minimum quand le pivot est sous la grille');

// Pivot above the floor: the camera may look up until it reaches the margin.
const highPivot = math.clampOrbitPitch(-1.0, 5, distance, floor, margin);
const highEye = math.orbitEye([0, 5, 0], 0.62, highPivot, distance);
close(highEye[1], floor + margin, 1e-9, 'pivot surélevé : l oeil reste au-dessus du plan');

// Short orbits (wheel zoom) must not produce a non-finite eye.
const near = math.clampOrbitPitch(-1.45, 0, 0.8, floor, margin);
const nearEye = math.orbitEye([0, 0, 0], 0, near, 0.8);
assert(Number.isFinite(nearEye[1]) && nearEye[1] >= floor + margin - 1e-9, 'les orbites courtes doivent rester finies au-dessus du plan');

// ------------------------------------------------------------ render invariants
const viewport = fs.readFileSync(path.join(ROOT, 'public', 'viewport-3d.js'), 'utf8');
assert(/The grid is a reference plane/.test(viewport), 'le role non-occludant de la grille doit rester documente');
assert(/gl\.depthMask\(false\);\s*gl\.useProgram\(gridProgram\);/.test(viewport), 'gl.depthMask(false) doit preceder le dessin de la grille');
assert(/gl\.depthMask\(true\);\s*gl\.useProgram\(meshProgram\);/.test(viewport), 'l ecriture de profondeur doit etre restauree avant les meshes');
assert(/clampOrbitPitch\(orbit\.pitch, orbit\.target\[1\], orbit\.distance, GRID_PLANE_Y\)/.test(viewport), 'updateMatrices doit clamper le pitch orbital');
assert(/const eye = orbitEye\(orbit\.target, orbit\.yaw, orbit\.pitch, orbit\.distance\);/.test(viewport), 'la position de l oeil doit venir de viewport-math.js');
assert(/float minorFade = clamp\(/.test(viewport) && /float majorFade = clamp\(/.test(viewport), 'la grille doit attenuer ses lignes en incidence rasante');
assert(/minorLine \* 0\.55 \* fade \* minorFade/.test(viewport), 'les lignes mineures doivent utiliser l attenuation anti-moire');
assert(/majorLine \* 0\.85 \* fade \* majorFade/.test(viewport), 'les lignes majeures doivent utiliser l attenuation anti-moire');

// gl.clear(DEPTH_BUFFER_BIT) honours DEPTH_WRITEMASK, and the bloom/composite
// passes leave depthMask(false). If the clear of the scene target happens
// while depth writes are still masked off, the depth buffer keeps the previous
// frame: meshes are then rejected by stale depths and vanish while orbiting.
// (Measured in the browser: 840 px vs 1764 px for the same cube.)
const clearIndex = viewport.indexOf('gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)');
const preamble = clearIndex >= 0 ? viewport.slice(Math.max(0, clearIndex - 700), clearIndex) : '';
assert(clearIndex >= 0, 'le clear de la cible de scene (couleur + profondeur) doit exister');
assert(preamble.includes('renderTargets.scene.framebuffer'), 'la cible de scene doit etre liee avant le clear');
const lastTrue = preamble.lastIndexOf('gl.depthMask(true)');
const lastFalse = preamble.lastIndexOf('gl.depthMask(false)');
assert(lastTrue >= 0 && lastTrue > lastFalse, 'gl.depthMask(true) doit preceder le clear du depth buffer (sinon la profondeur de la frame precedente persiste)');
assert(/gl\.clearColor\(0\.02, 0\.03, 0\.06, 1\);/.test(viewport), 'la couleur de clear de la scene doit rester explicite');

const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const mathTag = html.indexOf('/nova-engine/viewport-math.js');
const viewportTag = html.indexOf('/nova-engine/viewport-3d.js');
assert(mathTag >= 0, 'index.html doit charger viewport-math.js');
assert(mathTag < viewportTag, 'viewport-math.js doit etre charge avant viewport-3d.js');

console.log(`test-viewport: OK - ${checks} verifications (orbite clampee au-dessus de la grille, grille sans ecriture de profondeur, anti-moire)`);
