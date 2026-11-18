import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.NOVA_RENDER_TEST_PORT || 5299);
const BASE = `http://127.0.0.1:${PORT}`;
const RENDERS_DIR = path.join(ROOT, 'data', 'renders');
const created = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function decodePng(buffer) {
  assert(buffer.length > 33 && buffer.readUInt32BE(0) === 0x89504e47, 'PNG signature missing');
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    assert(raw[row] === 0, `Unexpected PNG filter ${raw[row]}`);
    raw.copy(pixels, y * width * 4, row + 1, row + 1 + width * 4);
  }
  return { width, height, pixels };
}

function scene() {
  return {
    schemaVersion: 4,
    name: 'API Render Test',
    entities: [
      { id: 'cam', name: 'Main Camera', type: 'Camera', position: [0, 1.2, 6], rotation: [-5, 0, 0], scale: [1, 1, 1], visible: true, components: ['Camera'], parentId: null, material: null, primitive: null, light: null },
      { id: 'cube', name: 'Center Cube', type: 'Mesh', position: [0, 0.6, 0], rotation: [0, 24, 0], scale: [1.4, 1.4, 1.4], visible: true, components: ['Mesh Renderer'], parentId: null, primitive: 'cube', material: { albedo: [0.35, 0.65, 0.98], metallic: 0.2, roughness: 0.35, tiling: 4, pattern: 'checker', emissive: false, texture: '' } },
      { id: 'sun', name: 'Sun', type: 'Light', position: [2, 4, 2], rotation: [-40, 30, 0], scale: [1, 1, 1], visible: true, components: ['Directional Light'], parentId: null, material: null, primitive: null, light: { type: 'directional', color: [1, 0.94, 0.84], intensity: 1.2, range: 8, spotAngle: 35, castShadow: true } }
    ]
  };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`${BASE}/api/version`);
      if (response.ok) return await response.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Workbench server did not start');
}

async function render(options = {}, source = scene()) {
  const response = await fetch(`${BASE}/api/engine/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene: source, options })
  });
  return { status: response.status, payload: await response.json() };
}

async function download(file) {
  const response = await fetch(`${BASE}/api/engine/render/${file}`);
  assert(response.status === 200, 'PNG endpoint must respond 200');
  assert((response.headers.get('content-type') || '').startsWith('image/png'), 'PNG content type missing');
  return Buffer.from(await response.arrayBuffer());
}

const child = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
});
let serverLog = '';
child.stdout.on('data', d => { serverLog += d.toString(); });
child.stderr.on('data', d => { serverLog += d.toString(); });

try {
  const version = await waitForServer();
  assert(version.version === '1.9.1', `Workbench version must be 1.9.1, got ${version.version}`);
  assert(version.engine === '0.8.0', `Engine version must be 0.8.0, got ${version.engine}`);
  assert(version.sceneSchema === 4, `Scene schema must be 4, got ${version.sceneSchema}`);

  const first = await render({ width: 160, height: 90, supersample: 1 });
  assert(first.status === 200 && first.payload.ok === true, `Render failed: ${first.status} ${JSON.stringify(first.payload)}`);
  const stats = first.payload.stats;
  assert(stats.width === 160 && stats.height === 90, 'Render dimensions must match the request');
  assert(stats.triangles >= 12, `Expected at least 12 triangles, got ${stats.triangles}`);
  assert(stats.meshPixels > 300, `Expected visible mesh pixels, got ${stats.meshPixels}`);
  assert(stats.camera === 'Main Camera', `Expected the scene camera, got ${stats.camera}`);
  assert(stats.shadowMaps === 1, `Directional shadow map must be reported, got ${stats.shadowMaps}`);
  assert(stats.bloom === true, 'Bloom must be enabled by default');
  assert(typeof first.payload.url === 'string' && first.payload.url.startsWith('/nova-engine/api/engine/render/'), 'Render URL missing');
  created.push(path.join(RENDERS_DIR, first.payload.file));

  const firstPng = await download(first.payload.file);
  const decoded = decodePng(firstPng);
  assert(decoded.width === 160 && decoded.height === 90, 'PNG dimensions must match the render');

  const colors = new Set();
  for (let y = 0; y < decoded.height; y += 3) {
    for (let x = 0; x < decoded.width; x += 3) {
      const index = (y * decoded.width + x) * 4;
      colors.add(`${decoded.pixels[index]},${decoded.pixels[index + 1]},${decoded.pixels[index + 2]}`);
    }
  }
  assert(colors.size > 40, `Rendered PNG must not be flat (distinct colours: ${colors.size})`);
  const center = (Math.floor(decoded.height / 2) * decoded.width + Math.floor(decoded.width / 2)) * 4;
  assert(decoded.pixels[center + 3] === 255, 'Rendered pixels must be opaque');
  assert(decoded.pixels[center] !== decoded.pixels[0], 'The mesh must cover the center of the frame');

  const second = await render({ width: 160, height: 90, supersample: 1 });
  assert(second.payload.ok === true, 'Second render must succeed');
  created.push(path.join(RENDERS_DIR, second.payload.file));
  const secondPng = await download(second.payload.file);
  assert(firstPng.equals(secondPng), 'Two identical renders must produce byte-identical PNG files');

  // Procedural materials: the same geometry rendered with a grid pattern must
  // differ from the checker version while staying deterministic.
  const gridScene = scene();
  gridScene.entities[1].material = { ...gridScene.entities[1].material, pattern: 'grid', tiling: 6 };
  const grid = await render({ width: 160, height: 90, supersample: 1 }, gridScene);
  assert(grid.status === 200 && grid.payload.ok === true, `Grid render failed: ${JSON.stringify(grid.payload)}`);
  assert(grid.payload.stats.triangles === stats.triangles, 'Grid render must keep the same triangle count');
  created.push(path.join(RENDERS_DIR, grid.payload.file));
  const gridPng = await download(grid.payload.file);
  assert(!firstPng.equals(gridPng), 'Grid and checker materials must produce different PNG files');
  const gridAgain = await render({ width: 160, height: 90, supersample: 1 }, gridScene);
  created.push(path.join(RENDERS_DIR, gridAgain.payload.file));
  assert(gridPng.equals(await download(gridAgain.payload.file)), 'Grid material rendering must be deterministic');

  const noneScene = scene();
  noneScene.entities[1].material = { ...noneScene.entities[1].material, pattern: 'none' };
  const none = await render({ width: 160, height: 90, supersample: 1 }, noneScene);
  created.push(path.join(RENDERS_DIR, none.payload.file));
  const nonePng = await download(none.payload.file);
  assert(!nonePng.equals(firstPng), 'No-pattern material must differ from the checker material');
  assert(!nonePng.equals(gridPng), 'No-pattern material must differ from the grid material');

  // PNG textures: an explicit material texture must be decoded, cached and
  // change the output; the engine reports the loaded texture count.
  const texturedScene = scene();
  texturedScene.entities[1].material = { ...texturedScene.entities[1].material, texture: 'textures/checker.png' };
  const textured = await render({ width: 160, height: 90, supersample: 1 }, texturedScene);
  assert(textured.status === 200 && textured.payload.ok === true, `Textured render failed: ${JSON.stringify(textured.payload)}`);
  assert(textured.payload.stats.textures === 1, `Textured render must load one texture, got ${textured.payload.stats.textures}`);
  created.push(path.join(RENDERS_DIR, textured.payload.file));
  const texturedPng = await download(textured.payload.file);
  assert(!texturedPng.equals(firstPng), 'A PNG texture must alter the rendered image');
  const texturedAgain = await render({ width: 160, height: 90, supersample: 1 }, texturedScene);
  created.push(path.join(RENDERS_DIR, texturedAgain.payload.file));
  assert(texturedPng.equals(await download(texturedAgain.payload.file)), 'Texture rendering must be deterministic');

  // Primitives: torus and capsule are new schema 4 geometry and must produce
  // more triangles than the 12-triangle cube.
  const torusScene = scene();
  torusScene.entities[1].primitive = 'torus';
  const torus = await render({ width: 160, height: 90, supersample: 1 }, torusScene);
  assert(torus.status === 200 && torus.payload.ok === true, `Torus render failed: ${JSON.stringify(torus.payload)}`);
  assert(torus.payload.stats.triangles > 12, `Torus must produce more than 12 triangles, got ${torus.payload.stats.triangles}`);
  created.push(path.join(RENDERS_DIR, torus.payload.file));

  // Shadow maps and bloom can be disabled deterministically.
  const plain = await render({ width: 160, height: 90, supersample: 1, shadows: false, bloom: false });
  assert(plain.status === 200 && plain.payload.ok === true, `No-shadow render failed: ${JSON.stringify(plain.payload)}`);
  assert(plain.payload.stats.shadowMaps === 0, `Disabled shadows must report 0 shadow maps, got ${plain.payload.stats.shadowMaps}`);
  assert(plain.payload.stats.bloom === false, 'Disabled bloom must be reported as false');
  created.push(path.join(RENDERS_DIR, plain.payload.file));
  const plainPng = await download(plain.payload.file);
  assert(!plainPng.equals(firstPng), 'Disabling shadows and bloom must alter the rendered image');

  const invalidMaterial = await render({ width: 160, height: 90, supersample: 1 }, (() => {
    const bad = scene();
    bad.entities[1].material = { ...bad.entities[1].material, metallic: 4 };
    return bad;
  })());
  assert(invalidMaterial.status === 400, 'Out-of-range metallic must be rejected before rendering');

  const invalidTexture = await render({ width: 160, height: 90, supersample: 1 }, (() => {
    const bad = scene();
    bad.entities[1].material = { ...bad.entities[1].material, texture: '../secret.png' };
    return bad;
  })());
  assert(invalidTexture.status === 400, 'Absolute/traversal texture paths must be rejected before rendering');

  const listResponse = await fetch(`${BASE}/api/engine/renders`);
  const list = await listResponse.json();
  assert(listResponse.status === 200 && Array.isArray(list.renders), 'Render listing must return an array');
  assert(list.renders.some(entry => entry.file === first.payload.file), 'Listing must include the produced render');

  const traversal = await fetch(`${BASE}/api/engine/render/..%2Fscene.json`);
  assert(traversal.status === 400 || traversal.status === 404, 'Path traversal must be rejected');
  const missing = await fetch(`${BASE}/api/engine/render/render-000000000000-deadbeef.png`);
  assert(missing.status === 404, 'Unknown render must respond 404');

  const invalid = await fetch(`${BASE}/api/engine/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene: { name: '', entities: [] } })
  });
  assert(invalid.status === 400, 'Invalid scene must be rejected before rendering');

  console.log(`test-render passed: ${stats.triangles} triangles, ${stats.meshPixels} pixels, ${firstPng.length} PNG bytes, ${colors.size} colours, shadow map + bloom stats, checker/grid/none/texture deterministic and distinct, torus > 12 triangles`);
} catch (error) {
  console.error('test-render failed:', error.message);
  if (serverLog.trim()) console.error(serverLog.trim().split(/\r?\n/).slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  child.kill();
  for (const file of created) { try { fs.unlinkSync(file); } catch {} }
}
