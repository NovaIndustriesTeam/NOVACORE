import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = 5298;
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) }, stdio: 'ignore', windowsHide: true });
const base = `http://127.0.0.1:${port}`;
const root = path.dirname(fileURLToPath(import.meta.url));
const sceneFile = path.join(root, 'data', 'scenes', 'api-test-scene.json');
const renamedFile = path.join(root, 'data', 'scenes', 'api-test-renamed.json');
const scene = { schemaVersion: 4, name: 'API Test', entities: [
  { id: 'root', name: 'Root', type: 'Empty', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true, components: [], parentId: null },
  { id: 'child', name: 'Child', type: 'Mesh', position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true, components: ['Mesh Renderer'], parentId: 'root',
    material: { albedo: [0.2, 0.6, 0.9], metallic: 0.4, roughness: 0.3, tiling: 6, pattern: 'grid', emissive: false, texture: 'textures/checker.png' },
    primitive: 'torus', spinner: { axis: 'y', degreesPerSecond: 90 } },
  { id: 'spot', name: 'Spot Light', type: 'Light', position: [0, 5, 2], rotation: [-45, 0, 0], scale: [1, 1, 1], visible: true, components: ['Spot Light'], parentId: null,
    light: { type: 'spot', color: [1, 0.8, 0.6], intensity: 2, range: 12, spotAngle: 30, castShadow: true } }
] };
async function ready() { for (let attempt = 0; attempt < 40; attempt += 1) { try { if ((await fetch(`${base}/api/status`)).ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Workbench server did not start.'); }
async function json(url, options) { const response = await fetch(`${base}${url}`, options); return { status: response.status, body: await response.json(), response }; }
try {
  await ready();
  const version = await json('/api/version');
  assert.equal(version.status, 200);
  assert.equal(version.body.version, '1.9.1');
  assert.equal(version.body.engine, '0.8.0');
  assert.equal(version.body.sceneSchema, 4);

  const saved = await json('/api/scenes/save', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'api-test-scene', scene }) });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.scene.schemaVersion, 4);
  assert.equal(saved.body.scene.entities[1].parentId, 'root');
  assert.equal(saved.body.scene.entities[1].material.pattern, 'grid');
  assert.equal(saved.body.scene.entities[1].material.tiling, 6);
  assert.equal(saved.body.scene.entities[1].material.texture, 'textures/checker.png');
  assert.equal(saved.body.scene.entities[1].primitive, 'torus');
  assert.deepEqual(saved.body.scene.entities[1].spinner, { axis: [0, 1, 0], degreesPerSecond: 90 });
  assert.equal(saved.body.scene.entities[2].light.type, 'spot');
  assert.equal(saved.body.scene.entities[2].light.castShadow, true);
  assert.equal(saved.body.scene.entities[0].material, null);
  assert.equal(saved.body.scene.entities[0].light, null);

  const list = await json('/api/scenes');
  const listed = list.body.scenes.find(item => item.id === 'api-test-scene');
  assert.ok(listed);
  assert.equal(listed.name, 'API Test');
  assert.equal(listed.entityCount, 3);

  const loaded = await json('/api/scenes/load?id=api-test-scene');
  assert.equal(loaded.body.entities[1].parentId, 'root');
  assert.equal(loaded.body.entities[1].material.texture, 'textures/checker.png');

  const exported = await fetch(`${base}/api/scenes/export?id=api-test-scene`);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition') || '', /api-test-scene\.scene\.json/);
  assert.equal((await exported.json()).name, 'API Test');

  const asset = await fetch(`${base}/api/assets/textures/checker.png`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type') || '', /^image\/png/);
  assert.ok((await asset.arrayBuffer()).byteLength > 40, 'PNG asset must be served');
  const assetTraversal = await fetch(`${base}/api/assets/..%2F..%2Fserver.mjs`);
  assert.ok([400, 403, 404].includes(assetTraversal.status), 'Asset path traversal must be rejected');

  const duplicate = await json('/api/scenes/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'api-test-scene', scene }) });
  assert.equal(duplicate.status, 409);
  const overwritten = await json('/api/scenes/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'api-test-scene', scene: { ...scene, name: 'API Test v2' }, overwrite: true }) });
  assert.equal(overwritten.status, 200);
  assert.equal(overwritten.body.scene.name, 'API Test v2');

  const renamed = await json('/api/scenes/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'api-test-scene', name: 'API Test renommé', newId: 'api-test-renamed' }) });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.id, 'api-test-renamed');
  assert.equal(fs.existsSync(sceneFile), false);
  assert.equal((await json('/api/scenes/load?id=api-test-renamed')).body.name, 'API Test renommé');

  const invalid = await json('/api/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scene: { ...scene, entities: [{ ...scene.entities[0], parentId: 'missing' }] } }) });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /Parent introuvable/);

  const invalidMaterial = await json('/api/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scene: { ...scene, entities: [scene.entities[0], { ...scene.entities[1], material: { ...scene.entities[1].material, pattern: 'stripes' } }] } }) });
  assert.equal(invalidMaterial.status, 400);
  assert.match(invalidMaterial.body.error, /Motif de surface invalide/);

  const invalidTexture = await json('/api/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scene: { ...scene, entities: [scene.entities[0], { ...scene.entities[1], material: { ...scene.entities[1].material, texture: '../secret.png' } }] } }) });
  assert.equal(invalidTexture.status, 400);
  assert.match(invalidTexture.body.error, /Texture PNG\/JPEG invalide/);

  const invalidPrimitive = await json('/api/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scene: { ...scene, entities: [scene.entities[0], { ...scene.entities[1], primitive: 'dodecahedron' }] } }) });
  assert.equal(invalidPrimitive.status, 400);
  assert.match(invalidPrimitive.body.error, /Primitive invalide/);

  const invalidLight = await json('/api/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scene: { ...scene, entities: [scene.entities[0], { ...scene.entities[2], light: { ...scene.entities[2].light, intensity: 64 } }] } }) });
  assert.equal(invalidLight.status, 400);
  assert.match(invalidLight.body.error, /Intensité de lumière invalide/);

  const invalidSpinner = await json('/api/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scene: { ...scene, entities: [scene.entities[0], { ...scene.entities[1], spinner: { axis: [0, 0, 0], degreesPerSecond: 90 } }] } }) });
  assert.equal(invalidSpinner.status, 400);
  assert.match(invalidSpinner.body.error, /Spinner invalide/);

  const engine = await json('/api/engine/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scene }) });
  assert.equal(engine.status, 200, engine.body.error || engine.body.output);
  assert.equal(engine.body.ok, true);
  assert.match(engine.body.output, /Scène valide/);

  const deleted = await json('/api/scenes/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'api-test-renamed' }) });
  assert.equal(deleted.status, 200);
  assert.equal(fs.existsSync(renamedFile), false);
  console.log('Named scene API, schema 4 light/primitive/texture/gameplay, asset route, export, rename, delete and C++ validation tests passed.');
} finally { server.kill(); for (const file of [sceneFile, renamedFile]) { try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {} } }
