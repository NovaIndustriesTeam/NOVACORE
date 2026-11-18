import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.NOVA_GPU_TEST_PORT || 5298);
const BASE = `http://127.0.0.1:${PORT}`;
const RENDERS_DIR = path.join(ROOT, 'data', 'renders');
const created = [];

if (process.platform !== 'win32') {
  console.log('test-gpu skipped: the Direct3D 12 backend is Windows-only (Metal/Vulkan are not implemented yet).');
  process.exit(0);
}

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

// A receiver floor, a shadow-casting cube, a bright sphere (bloom) and a strong
// directional light so that shadows and bloom are both visible in the capture.
function scene() {
  return {
    schemaVersion: 4,
    name: 'GPU Render Test',
    entities: [
      { id: 'cam', name: 'Main Camera', type: 'Camera', position: [0, 4, 8], rotation: [-18, 0, 0], scale: [1, 1, 1], visible: true, components: ['Camera'], parentId: null, material: null, primitive: null, light: null, rigidbody: null, controller: null, spinner: null, collectible: null },
      { id: 'floor', name: 'Floor', type: 'Mesh', position: [0, -0.25, 0], rotation: [0, 0, 0], scale: [12, 0.5, 12], visible: true, components: ['Mesh Renderer'], parentId: null, primitive: 'plane',
        material: { albedo: [0.75, 0.75, 0.75], metallic: 0, roughness: 0.9, tiling: 6, pattern: 'checker', emissive: false, texture: '' },
        light: null, rigidbody: null, controller: null, spinner: null, collectible: null },
      { id: 'cube', name: 'Center Cube', type: 'Mesh', position: [0, 1.1, 0], rotation: [0, 24, 0], scale: [1.4, 1.4, 1.4], visible: true, components: ['Mesh Renderer'], parentId: null, primitive: 'cube',
        material: { albedo: [0.35, 0.65, 0.98], metallic: 0.25, roughness: 0.3, tiling: 5, pattern: 'none', emissive: false, texture: '' },
        light: null, rigidbody: null, controller: null, spinner: null, collectible: null },
      { id: 'ball', name: 'Glow Ball', type: 'Mesh', position: [2.2, 1.1, -1.2], rotation: [0, 0, 0], scale: [1.2, 1.2, 1.2], visible: true, components: ['Mesh Renderer'], parentId: null, primitive: 'sphere',
        material: { albedo: [1, 0.98, 0.9], metallic: 0, roughness: 0.5, tiling: 1, pattern: 'none', emissive: false, texture: '' },
        light: null, rigidbody: null, controller: null, spinner: null, collectible: null },
      { id: 'sun', name: 'Sun', type: 'Light', position: [3, 6, 2], rotation: [-55, 30, 0], scale: [1, 1, 1], visible: true, components: ['Directional Light'], parentId: null, material: null, primitive: null,
        light: { type: 'directional', color: [1, 0.97, 0.9], intensity: 8, range: 8, spotAngle: 35, castShadow: true },
        rigidbody: null, controller: null, spinner: null, collectible: null }
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

async function render(options, source = scene()) {
  const response = await fetch(`${BASE}/api/engine/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene: source, options })
  });
  return { status: response.status, payload: await response.json() };
}

async function runtimeStatus() {
  const response = await fetch(`${BASE}/api/runtime/status`);
  assert(response.status === 200, `Runtime status must respond 200, got ${response.status}`);
  return response.json();
}
async function waitRuntime(expectRunning, attempts = 80) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    last = await runtimeStatus();
    if (last.running === expectRunning) return last;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return last;
}
async function download(file) {
  const response = await fetch(`${BASE}/api/engine/render/${file}`);
  assert(response.status === 200, `PNG endpoint must respond 200, got ${response.status}`);
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
let runtimeOpen = false;
child.stdout.on('data', d => { serverLog += d.toString(); });
child.stderr.on('data', d => { serverLog += d.toString(); });

try {
  const version = await waitForServer();
  assert(version.version === '1.9.1', `Workbench version must be 1.9.1, got ${version.version}`);
  assert(version.engine === '0.8.0', `Engine version must be 0.8.0, got ${version.engine}`);
  assert(version.sceneSchema === 4, `Scene schema must be 4, got ${version.sceneSchema}`);
  const prefixedResponse = await fetch(`${BASE}/nova-engine/api/version`);
  assert(prefixedResponse.status === 200, `Prefixed Workbench API must respond 200, got ${prefixedResponse.status}`);
  const prefixed = await prefixedResponse.json();
  assert(prefixed.version === '1.9.1' && prefixed.engine === '0.8.0', 'Prefixed Workbench API must expose the current versions');

  const solid = await render({ backend: 'gpu', width: 320, height: 180, shadowResolution: 512 });
  assert(solid.status === 200 && solid.payload.ok === true, `GPU render failed: ${solid.status} ${JSON.stringify(solid.payload)}`);
  const stats = solid.payload.stats;
  assert(stats.backend === 'D3D12', `GPU stats must report D3D12, got ${stats.backend}`);
  assert(typeof stats.adapter === 'string' && stats.adapter.length > 0, 'GPU adapter name must be reported');
  assert(stats.width === 320 && stats.height === 180, 'GPU render dimensions must match the request');
  assert(stats.meshes === 3, `Expected 3 meshes, got ${stats.meshes}`);
  assert(stats.triangles > 1000, `Expected the sphere tessellation, got ${stats.triangles} triangles`);
  // Shadow pass + sky + scene + bloom bright + bloom blur + ACES composite.
  assert(stats.drawCalls === 6, `HDR pipeline must issue 6 draw calls, got ${stats.drawCalls}`);
  assert(stats.shadowMaps === 1, `Directional shadow map must be reported on GPU, got ${stats.shadowMaps}`);
  assert(stats.bloom === true, 'Bloom must be enabled by default on GPU');
  assert(stats.textures === 0, `Untextured scene must report 0 textures, got ${stats.textures}`);
  assert(stats.milliseconds > 0, 'GPU timing must be positive');
  created.push(path.join(RENDERS_DIR, solid.payload.file));

  const solidPng = await download(solid.payload.file);
  const decoded = decodePng(solidPng);
  assert(decoded.width === 320 && decoded.height === 180, 'PNG dimensions must match the GPU render');
  const colors = new Set();
  for (let y = 0; y < decoded.height; y += 2) {
    for (let x = 0; x < decoded.width; x += 2) {
      const index = (y * decoded.width + x) * 4;
      colors.add(`${decoded.pixels[index]},${decoded.pixels[index + 1]},${decoded.pixels[index + 2]}`);
    }
  }
  assert(colors.size > 32, `GPU render must be shaded, got ${colors.size} distinct colours`);
  for (let index = 3; index < decoded.pixels.length; index += 4 * 97) {
    assert(decoded.pixels[index] === 255, 'GPU pixels must be opaque');
  }

  const wire = await render({ backend: 'gpu', width: 320, height: 180, wireframe: true, shadowResolution: 512 });
  assert(wire.status === 200 && wire.payload.ok === true, `GPU wireframe render failed: ${JSON.stringify(wire.payload)}`);
  created.push(path.join(RENDERS_DIR, wire.payload.file));
  const wirePng = await download(wire.payload.file);
  assert(!solidPng.equals(wirePng), 'Wireframe output must differ from the solid GPU render');

  // Per-vertex materials must reach the HLSL pattern evaluation: the same cube
  // rendered with a grid pattern has to differ from the no-pattern capture.
  const gridScene = scene();
  gridScene.entities[2].material = { ...gridScene.entities[2].material, pattern: 'grid' };
  const grid = await render({ backend: 'gpu', width: 320, height: 180, shadowResolution: 512 }, gridScene);
  assert(grid.status === 200 && grid.payload.ok === true, `GPU grid render failed: ${JSON.stringify(grid.payload)}`);
  created.push(path.join(RENDERS_DIR, grid.payload.file));
  const gridPng = await download(grid.payload.file);
  assert(!solidPng.equals(gridPng), 'Grid material must alter the GPU render');
  const gridAgain = await render({ backend: 'gpu', width: 320, height: 180, shadowResolution: 512 }, gridScene);
  created.push(path.join(RENDERS_DIR, gridAgain.payload.file));
  assert(gridPng.equals(await download(gridAgain.payload.file)), 'GPU grid rendering must be deterministic');

  // PNG textures uploaded to the GPU must change the output and be counted.
  const texturedScene = scene();
  texturedScene.entities[2].material = { ...texturedScene.entities[2].material, texture: 'textures/checker.png' };
  const textured = await render({ backend: 'gpu', width: 320, height: 180, shadowResolution: 512 }, texturedScene);
  assert(textured.status === 200 && textured.payload.ok === true, `GPU textured render failed: ${JSON.stringify(textured.payload)}`);
  assert(textured.payload.stats.textures === 1, `GPU textured render must report 1 texture, got ${textured.payload.stats.textures}`);
  created.push(path.join(RENDERS_DIR, textured.payload.file));
  const texturedPng = await download(textured.payload.file);
  assert(!texturedPng.equals(solidPng), 'A PNG texture must alter the GPU render');

  // Schema 4 primitives: a torus produces more triangles than the cube.
  const torusScene = scene();
  torusScene.entities[2].primitive = 'torus';
  const torus = await render({ backend: 'gpu', width: 320, height: 180, shadowResolution: 512 }, torusScene);
  assert(torus.status === 200 && torus.payload.ok === true, `GPU torus render failed: ${JSON.stringify(torus.payload)}`);
  assert(torus.payload.stats.triangles > stats.triangles, `Torus must add triangles to the GPU scene, got ${torus.payload.stats.triangles}`);
  created.push(path.join(RENDERS_DIR, torus.payload.file));

  // The directional shadow map changes the capture: the floor receives the cube
  // and sphere shadows only when shadows are enabled.
  const noShadows = await render({ backend: 'gpu', width: 320, height: 180, shadows: false, shadowResolution: 512 });
  assert(noShadows.status === 200 && noShadows.payload.ok === true, `GPU no-shadow render failed: ${JSON.stringify(noShadows.payload)}`);
  assert(noShadows.payload.stats.shadowMaps === 0, `Disabled shadows must report 0 shadow maps on GPU, got ${noShadows.payload.stats.shadowMaps}`);
  assert(noShadows.payload.stats.drawCalls === 5, `No-shadow GPU pipeline must issue 5 draw calls, got ${noShadows.payload.stats.drawCalls}`);
  created.push(path.join(RENDERS_DIR, noShadows.payload.file));
  const noShadowsPng = await download(noShadows.payload.file);
  assert(!noShadowsPng.equals(solidPng), 'Disabling GPU shadow maps must alter the capture');

  // HDR bloom changes the capture: the bright sphere spreads light around it.
  const noBloom = await render({ backend: 'gpu', width: 320, height: 180, bloom: false, shadowResolution: 512 });
  assert(noBloom.status === 200 && noBloom.payload.ok === true, `GPU no-bloom render failed: ${JSON.stringify(noBloom.payload)}`);
  assert(noBloom.payload.stats.bloom === false, 'Disabled bloom must be reported as false on GPU');
  created.push(path.join(RENDERS_DIR, noBloom.payload.file));
  const noBloomPng = await download(noBloom.payload.file);
  assert(!noBloomPng.equals(solidPng), 'Disabling GPU bloom must alter the capture');

  const cpu = await render({ backend: 'software', width: 160, height: 90, supersample: 1 });
  assert(cpu.status === 200 && cpu.payload.ok === true, `Software render failed: ${JSON.stringify(cpu.payload)}`);
  assert(cpu.payload.stats.backend === 'Software', 'Software stats must report the software backend');
  assert(cpu.payload.stats.shadowMaps === 1, 'Software render must report the directional shadow map');
  created.push(path.join(RENDERS_DIR, cpu.payload.file));

  assert((await runtimeStatus()).running === false, 'Runtime must start closed');

  const captureResponse = await fetch(`${BASE}/api/engine/runtime/capture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene: scene(), options: { width: 320, height: 180, frames: 2, shadowResolution: 512 } })
  });
  const capture = await captureResponse.json();
  assert(captureResponse.status === 200 && capture.ok === true, `Runtime capture failed: ${captureResponse.status} ${JSON.stringify(capture)}`);
  assert(capture.stats.backend === 'D3D12', `Runtime capture must use D3D12, got ${capture.stats.backend}`);
  assert(capture.stats.width === 320 && capture.stats.height === 180, 'Runtime capture dimensions must match the request');
  assert(capture.frames === 2 && capture.stats.meshes === 3, 'Runtime capture must report 2 frames and 3 meshes');
  assert(capture.bytes > 1000, `Runtime capture PNG must exceed 1000 bytes, got ${capture.bytes}`);
  created.push(path.join(RENDERS_DIR, capture.file));
  const capturePng = await download(capture.file);
  const decodedCapture = decodePng(capturePng);
  assert(decodedCapture.width === 320 && decodedCapture.height === 180, 'Runtime capture PNG dimensions must match');
  const captureColors = new Set();
  for (let y = 0; y < decodedCapture.height; y += 2) {
    for (let x = 0; x < decodedCapture.width; x += 2) {
      const index = (y * decodedCapture.width + x) * 4;
      captureColors.add(`${decodedCapture.pixels[index]},${decodedCapture.pixels[index + 1]},${decodedCapture.pixels[index + 2]}`);
    }
  }
  assert(captureColors.size > 32, `Runtime capture must be shaded, got ${captureColors.size} distinct colours`);
  const withCapture = await runtimeStatus();
  assert(withCapture.lastCapture?.id === capture.id, 'Runtime status must expose the last capture');

  const launchResponse = await fetch(`${BASE}/api/runtime/window`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene: scene(), options: { width: 320, height: 240, hidden: true, frames: 100000 } })
  });
  const launch = await launchResponse.json();
  assert(launchResponse.status === 200 && launch.ok === true, `Runtime window launch failed: ${launchResponse.status} ${JSON.stringify(launch)}`);
  assert(Number.isInteger(launch.pid) && launch.pid > 0, 'Runtime window must report a process id');
  runtimeOpen = true;
  const running = await waitRuntime(true);
  assert(running.running === true, 'Runtime window must be reported open after launch');

  const stopResponse = await fetch(`${BASE}/api/runtime/window/stop`, { method: 'POST' });
  assert(stopResponse.status === 200, `Runtime window stop failed: ${stopResponse.status}`);
  const stopped = await waitRuntime(false);
  assert(stopped.running === false, 'Runtime window must be closed after stop');
  runtimeOpen = false;

  console.log(`test-gpu passed: ${stats.backend} on ${stats.adapter}, ${stats.meshes} meshes, ${stats.triangles} triangles, ${stats.drawCalls} draw calls, ${stats.shadowMaps} shadow map, ${colors.size} colours, ${solidPng.length} PNG bytes, wireframe differs, checker/grid materials distinct and deterministic, GPU PNG texture, torus ${torus.payload.stats.triangles} triangles, shadows off alters capture + 5 draw calls, bloom off alters capture, runtime capture ${capture.stats.width}x${capture.stats.height} ${capture.bytes} bytes ${captureColors.size} colours, runtime window pid ${launch.pid} opened/stopped`);
} catch (error) {
  console.error('test-gpu failed:', error.message);
  if (serverLog.trim()) console.error(serverLog.trim().split(/\r?\n/).slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  if (runtimeOpen) { try { await fetch(`${BASE}/api/runtime/window/stop`, { method: 'POST' }); } catch {} }
  child.kill();
  for (const file of created) { try { fs.unlinkSync(file); } catch {} }
}
