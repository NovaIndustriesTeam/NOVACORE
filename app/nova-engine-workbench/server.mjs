import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(ROOT, 'engine');
const BUILD = path.join(ENGINE, 'build');
const DATA = process.env.NOVA_WORKBENCH_DATA_DIR ? path.resolve(process.env.NOVA_WORKBENCH_DATA_DIR) : path.join(ROOT, 'data');
const SCENE_FILE = path.join(DATA, 'scene.json');
const SCENES_DIR = path.join(DATA, 'scenes');
const RENDERS_DIR = path.join(DATA, 'renders');
const BACKUPS_DIR = path.join(DATA, 'backups');
const ASSETS_DIR = path.join(ROOT, 'assets');
const WORKBENCH_VERSION = '1.9.1';
const ENGINE_VERSION = '0.8.0';
const SCENE_SCHEMA = 4;
const BACKUP_KEEP = 12;
const MAX_SCENE_BYTES = 2 * 1024 * 1024;
const MAX_RENDERS = 24;
const SURFACE_PATTERNS = ['none', 'checker', 'grid'];
const PRIMITIVES = ['cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus', 'capsule', 'pyramid'];
const LIGHT_TYPES = ['directional', 'point', 'spot'];
const DEFAULT_MATERIAL = { albedo: [0.82, 0.85, 0.90], metallic: 0, roughness: 0.5, tiling: 4, pattern: 'none', emissive: false, texture: '' };

const defaultScene = (name = 'Nouvelle scène') => ({ schemaVersion: SCENE_SCHEMA, name, updatedAt: null, entities: [
  { id: 'camera-main', name: 'Main Camera', type: 'Camera', position: [6, 4.2, 10], rotation: [-14, 20, 0], scale: [1, 1, 1], visible: true, components: ['Camera', 'Audio Listener'], parentId: null, material: null, primitive: null, light: null, rigidbody: null, controller: null, spinner: null, collectible: null },
  { id: 'key-light', name: 'Key Light', type: 'Light', position: [4, 7, 3], rotation: [-45, 35, 0], scale: [1, 1, 1], visible: true, components: ['Directional Light'], parentId: null, material: null, primitive: null, light: { type: 'directional', color: [1, 0.94, 0.84], intensity: 2.2, range: 8, spotAngle: 35, castShadow: true }, rigidbody: null, controller: null, spinner: null, collectible: null },
  { id: 'rim-spot', name: 'Rim Spot', type: 'Light', position: [-3.5, 5.5, -2.5], rotation: [-55, -30, 0], scale: [1, 1, 1], visible: true, components: ['Spot Light'], parentId: null, material: null, primitive: null, light: { type: 'spot', color: [0.62, 0.78, 1], intensity: 6, range: 22, spotAngle: 42, castShadow: true }, rigidbody: null, controller: null, spinner: null, collectible: null },
  { id: 'ground', name: 'Ground', type: 'Mesh', position: [0, 0, 0], rotation: [0, 0, 0], scale: [14, 1, 14], visible: true, components: ['Mesh Renderer'], parentId: null, material: { albedo: [0.16, 0.19, 0.24], metallic: 0, roughness: 0.82, tiling: 14, pattern: 'grid', emissive: false, texture: '' }, primitive: 'plane', light: null, rigidbody: null, controller: null, spinner: null, collectible: null },
  { id: 'starter-cube', name: 'Starter Cube', type: 'Mesh', position: [0, 0.9, 0], rotation: [0, 25, 0], scale: [1.8, 1.8, 1.8], visible: true, components: ['Mesh Renderer', 'Collider'], parentId: null, material: { albedo: [0.32, 0.62, 0.98], metallic: 0.1, roughness: 0.35, tiling: 4, pattern: 'checker', emissive: false, texture: '' }, primitive: 'cube', light: null, rigidbody: null, controller: null, spinner: null, collectible: null },
  { id: 'starter-sphere', name: 'Starter Sphere', type: 'Mesh', position: [2.7, 0.85, 0], rotation: [0, 0, 0], scale: [1.7, 1.7, 1.7], visible: true, components: ['Mesh Renderer', 'Collider'], parentId: null, material: { albedo: [0.96, 0.58, 0.28], metallic: 0.25, roughness: 0.28, tiling: 3, pattern: 'none', emissive: false, texture: '' }, primitive: 'sphere', light: null, rigidbody: null, controller: null, spinner: null, collectible: null }
] });

function readScene() {
  try { return JSON.parse(fs.readFileSync(SCENE_FILE, 'utf8')); } catch { return defaultScene(); }
}
function readSceneFile(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function safeSceneId(value) { return String(value || '').trim().replace(/[^a-z0-9_-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80); }
function namedSceneFile(id) { return path.join(SCENES_DIR, `${safeSceneId(id)}.json`); }
function writeJsonAtomic(file, value) { const temporary = `${file}.tmp`; fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8'); fs.renameSync(temporary, file); }
// Sauvegarde roulante avant écrasement de la scène courante (protège les autosaves et les
// manipulations involontaires). Les 12 dernières versions restent dans data/backups.
function backupCurrentScene(reason = 'save') {
  try {
    if (!fs.existsSync(SCENE_FILE)) return null;
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(BACKUPS_DIR, `scene-${stamp}-${safeSceneId(reason) || 'save'}.json`);
    fs.copyFileSync(SCENE_FILE, target);
    const files = fs.readdirSync(BACKUPS_DIR).filter(name => /^scene-.*\.json$/.test(name)).sort();
    for (const name of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) {
      try { fs.unlinkSync(path.join(BACKUPS_DIR, name)); } catch { /* best effort */ }
    }
    return target;
  } catch { return null; }
}
function finiteIn(value, minimum, maximum) { return Number.isFinite(Number(value)) && Number(value) >= minimum && Number(value) <= maximum; }
function isVec3(value, minimum = -1000000, maximum = 1000000) { return Array.isArray(value) && value.length === 3 && value.every(n => finiteIn(n, minimum, maximum)); }
function isValidTexturePath(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || value.length > 160 || value.startsWith('/') || value.startsWith('\\') || /^[a-z]:/i.test(value)) return false;
  if (value.split(/[\\/]/).some(part => part === '..')) return false;
  return /\.(png|jpe?g)$/i.test(value);
}
function isValidAxis(value) {
  if (typeof value === 'string') return ['x', 'y', 'z'].includes(value.toLowerCase());
  return isVec3(value, -1, 1) && Math.abs(value[0]) + Math.abs(value[1]) + Math.abs(value[2]) >= 1e-4;
}
function sceneSummary(id) {
  try {
    const file = namedSceneFile(id);
    const scene = readSceneFile(file);
    return {
      id: safeSceneId(id),
      name: typeof scene.name === 'string' ? scene.name : 'Scène sans nom',
      entityCount: Array.isArray(scene.entities) ? scene.entities.length : 0,
      updatedAt: scene.updatedAt || fs.statSync(file).mtime.toISOString(),
      bytes: fs.statSync(file).size
    };
  } catch { return null; }
}
function listScenes() {
  return fs.readdirSync(SCENES_DIR)
    .filter(name => name.endsWith('.json'))
    .map(name => sceneSummary(name.slice(0, -5)))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function validateScene(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Scène invalide.';
  if (!Array.isArray(input.entities) || input.entities.length > 250) return 'Scène invalide (maximum 250 entités).';
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) return 'Le nom de scène doit contenir entre 1 et 120 caractères.';
  const ids = new Set();
  let lightCount = 0;
  for (const e of input.entities) {
    if (!e || typeof e.id !== 'string' || !e.id || e.id.length > 80 || ids.has(e.id)) return 'Chaque entité doit avoir un identifiant unique.';
    ids.add(e.id);
    if (typeof e.name !== 'string' || !e.name.trim() || e.name.length > 100) return 'Nom d’entité invalide.';
    if (!['Empty', 'Mesh', 'Camera', 'Light', 'Audio', 'Prefab'].includes(e.type)) return 'Type d’entité non pris en charge.';
    for (const k of ['position', 'rotation', 'scale']) if (!Array.isArray(e[k]) || e[k].length !== 3 || !e[k].every(n => Number.isFinite(n) && Math.abs(n) <= 1000000)) return `Transform ${k} invalide pour ${e.name}.`;
    if (e.scale.some(n => n === 0)) return `L’échelle de ${e.name} ne peut pas être nulle.`;
    if (typeof e.visible !== 'boolean') return `Visibilité invalide pour ${e.name}.`;
    if (!Array.isArray(e.components) || e.components.length > 32 || !e.components.every(c => typeof c === 'string' && c.length <= 80)) return `Composants invalides pour ${e.name}.`;
    if (e.material != null) {
      const m = e.material;
      if (typeof m !== 'object' || Array.isArray(m)) return `Matériau invalide pour ${e.name}.`;
      if (!Array.isArray(m.albedo) || m.albedo.length !== 3 || !m.albedo.every(n => Number.isFinite(n) && n >= 0 && n <= 1)) return `Albedo invalide pour ${e.name}.`;
      for (const [key, min, max] of [['metallic', 0, 1], ['roughness', 0.04, 1], ['tiling', 1, 64]]) {
        if (!Number.isFinite(m[key]) || m[key] < min || m[key] > max) return `Matériau ${key} invalide pour ${e.name}.`;
      }
      if (!SURFACE_PATTERNS.includes(m.pattern)) return `Motif de surface invalide pour ${e.name}.`;
      if (typeof m.emissive !== 'boolean') return `Emissif invalide pour ${e.name}.`;
      if (m.texture != null && (typeof m.texture !== 'string' || !isValidTexturePath(m.texture))) return `Texture PNG/JPEG invalide pour ${e.name} (chemin relatif attendu).`;
    }
    if (e.primitive != null && (typeof e.primitive !== 'string' || !PRIMITIVES.includes(e.primitive.toLowerCase()))) return `Primitive invalide pour ${e.name} (${PRIMITIVES.join(', ')}).`;
    if (e.light != null) {
      const l = e.light;
      if (typeof l !== 'object' || Array.isArray(l)) return `Lumière invalide pour ${e.name}.`;
      if (typeof l.type !== 'string' || !LIGHT_TYPES.includes(l.type.toLowerCase())) return `Type de lumière invalide pour ${e.name} (directional, point, spot).`;
      if (!Array.isArray(l.color) || l.color.length !== 3 || !l.color.every(n => finiteIn(n, 0, 1))) return `Couleur de lumière invalide pour ${e.name}.`;
      if (!finiteIn(l.intensity, 0, 32)) return `Intensité de lumière invalide pour ${e.name} (0-32).`;
      if (!finiteIn(l.range, 0.1, 200)) return `Portée de lumière invalide pour ${e.name} (0.1-200).`;
      if (!finiteIn(l.spotAngle, 1, 89)) return `Angle de spot invalide pour ${e.name} (1-89).`;
      if (typeof l.castShadow !== 'boolean') return `castShadow invalide pour ${e.name}.`;
      lightCount++;
    }
    if (e.rigidbody != null) {
      const b = e.rigidbody;
      if (typeof b !== 'object' || Array.isArray(b) || !isVec3(b.velocity) || !finiteIn(b.mass, 0.01, 10000) || !finiteIn(b.bounciness, 0, 1) || typeof b.gravity !== 'boolean') return `Rigidbody invalide pour ${e.name}.`;
    }
    if (e.controller != null) {
      const c = e.controller;
      if (typeof c !== 'object' || Array.isArray(c) || !finiteIn(c.speed, 0.1, 60) || !finiteIn(c.jumpSpeed, 0, 40)) return `Controller invalide pour ${e.name}.`;
    }
    if (e.spinner != null) {
      const s = e.spinner;
      if (typeof s !== 'object' || Array.isArray(s) || !isValidAxis(s.axis) || !finiteIn(s.degreesPerSecond, -1440, 1440)) return `Spinner invalide pour ${e.name}.`;
    }
    if (e.collectible != null) {
      const c = e.collectible;
      if (typeof c !== 'object' || Array.isArray(c) || !finiteIn(c.radius, 0.1, 50) || !Number.isInteger(Number(c.value)) || Number(c.value) < 1 || Number(c.value) > 1000) return `Collectible invalide pour ${e.name}.`;
    }
    if (e.parentId != null && (typeof e.parentId !== 'string' || !e.parentId || e.parentId.length > 80 || e.parentId === e.id)) return `Parent invalide pour ${e.name}.`;
  }
  if (lightCount > 16) return 'Une scène ne peut pas dépasser 16 lumières.';
  for (const e of input.entities) {
    if (e.parentId && !ids.has(e.parentId)) return `Parent introuvable pour ${e.name}.`;
    let parent = e.parentId;
    const visited = new Set([e.id]);
    while (parent) {
      if (visited.has(parent)) return 'La hiérarchie contient un cycle.';
      visited.add(parent);
      parent = input.entities.find(candidate => candidate.id === parent)?.parentId;
    }
  }
  return null;
}
function normalizeMaterial(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    albedo: Array.isArray(source.albedo) && source.albedo.length === 3 ? source.albedo.map(Number) : [...DEFAULT_MATERIAL.albedo],
    metallic: Number.isFinite(source.metallic) ? Number(source.metallic) : DEFAULT_MATERIAL.metallic,
    roughness: Number.isFinite(source.roughness) ? Number(source.roughness) : DEFAULT_MATERIAL.roughness,
    tiling: Number.isFinite(source.tiling) ? Number(source.tiling) : DEFAULT_MATERIAL.tiling,
    pattern: SURFACE_PATTERNS.includes(source.pattern) ? source.pattern : DEFAULT_MATERIAL.pattern,
    emissive: source.emissive === true,
    texture: typeof source.texture === 'string' && isValidTexturePath(source.texture) ? source.texture : ''
  };
}
function normalizeLight(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    type: typeof source.type === 'string' && LIGHT_TYPES.includes(source.type.toLowerCase()) ? source.type.toLowerCase() : 'directional',
    color: Array.isArray(source.color) && source.color.length === 3 ? source.color.map(value => Math.min(1, Math.max(0, Number(value) || 0))) : [1, 0.94, 0.84],
    intensity: finiteIn(source.intensity, 0, 32) ? Number(source.intensity) : 1,
    range: finiteIn(source.range, 0.1, 200) ? Number(source.range) : 8,
    spotAngle: finiteIn(source.spotAngle, 1, 89) ? Number(source.spotAngle) : 35,
    castShadow: source.castShadow !== false
  };
}
function normalizeRigidbody(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    velocity: isVec3(source.velocity) ? source.velocity.map(Number) : [0, 0, 0],
    mass: finiteIn(source.mass, 0.01, 10000) ? Number(source.mass) : 1,
    bounciness: finiteIn(source.bounciness, 0, 1) ? Number(source.bounciness) : 0.25,
    gravity: source.gravity !== false
  };
}
function normalizeController(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return { speed: finiteIn(source.speed, 0.1, 60) ? Number(source.speed) : 4, jumpSpeed: finiteIn(source.jumpSpeed, 0, 40) ? Number(source.jumpSpeed) : 5 };
}
function normalizeSpinner(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const axis = typeof source.axis === 'string' && ['x', 'y', 'z'].includes(source.axis.toLowerCase())
    ? { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[source.axis.toLowerCase()]
    : (isVec3(source.axis, -1, 1) ? source.axis.map(Number) : [0, 1, 0]);
  return { axis, degreesPerSecond: finiteIn(source.degreesPerSecond, -1440, 1440) ? Number(source.degreesPerSecond) : 45 };
}
function normalizeCollectible(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return { radius: finiteIn(source.radius, 0.1, 50) ? Number(source.radius) : 1, value: Number.isInteger(Number(source.value)) && Number(source.value) >= 1 && Number(source.value) <= 1000 ? Number(source.value) : 1 };
}
function normalizeScene(input, nameOverride) {
  return {
    schemaVersion: SCENE_SCHEMA,
    name: (nameOverride || input.name).trim(),
    updatedAt: new Date().toISOString(),
    entities: input.entities.map(entity => ({
      id: entity.id,
      name: entity.name.trim(),
      type: entity.type,
      position: entity.position.map(Number),
      rotation: entity.rotation.map(Number),
      scale: entity.scale.map(Number),
      visible: entity.visible,
      components: [...entity.components],
      parentId: entity.parentId || null,
      material: entity.material ? normalizeMaterial(entity.material) : null,
      primitive: typeof entity.primitive === 'string' && PRIMITIVES.includes(entity.primitive.toLowerCase()) ? entity.primitive.toLowerCase() : null,
      light: entity.light ? normalizeLight(entity.light) : null,
      rigidbody: entity.rigidbody ? normalizeRigidbody(entity.rigidbody) : null,
      controller: entity.controller ? normalizeController(entity.controller) : null,
      spinner: entity.spinner ? normalizeSpinner(entity.spinner) : null,
      collectible: entity.collectible ? normalizeCollectible(entity.collectible) : null
    }))
  };
}

fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(SCENES_DIR, { recursive: true });
fs.mkdirSync(RENDERS_DIR, { recursive: true });
fs.mkdirSync(ASSETS_DIR, { recursive: true });
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 5201);
let active = null;
let runtime = null;
let lastRuntimeCapture = null;
let logs = [];
let lastAction = { name: 'Ready', status: 'idle', code: null, endedAt: null };

function log(message, type = 'info') {
  const entry = { time: new Date().toISOString(), message: String(message).replace(/\u001b\[[0-9;]*m/g, ''), type };
  logs.push(entry); if (logs.length > 800) logs = logs.slice(-800);
}
function hasTool(tool, args = ['--version']) {
  try { const out = execFileSync(tool, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 4000 }); return { ok: true, version: out.trim().split('\n')[0] }; }
  catch (e) { return { ok: false, version: null, error: e.code || e.message }; }
}
function status() {
  const cmake = hasTool('cmake');
  const compiler = [hasTool('cl', []), hasTool('c++', ['--version']), hasTool('g++', ['--version']), hasTool('clang++', ['--version'])].find(x => x.ok) || { ok: false, version: null, error: 'not-found' };
  const scenes = listScenes();
  return { app: 'Nova Engine Workbench', version: WORKBENCH_VERSION, host: HOST, port: PORT, platform: process.platform, arch: process.arch,
    node: process.version, cmake, compiler, engineDir: ENGINE, buildDir: BUILD, configured: fs.existsSync(path.join(BUILD, 'CMakeCache.txt')),
    executable: executablePath(), executableExists: fs.existsSync(executablePath()), engineCli: fs.existsSync(executablePath()), active: active ? { name: active.name, pid: active.child.pid } : null, lastAction,
    runtime: runtimeStatus(),
    scenes: { count: scenes.length, current: readScene().name || 'Nouvelle scène' },
    cpuCores: os.cpus().length, memoryGb: Math.round(os.totalmem() / 1024 ** 3), project: { name: 'Nova Engine', version: ENGINE_VERSION, language: 'C++20', buildSystem: 'CMake', tests: 'CTest', sceneSchema: SCENE_SCHEMA,
      renderer: { kind: process.platform === 'win32' ? 'software-rasterizer+gpu-d3d12' : 'software-rasterizer', format: 'png', output: 'RGBA8', camera: 'entity-or-auto', lighting: ['directional', 'point', 'spot'], shadows: 'shadow-maps', shadowResolution: [128, 2048], textures: ['png', 'jpeg'], postProcess: ['hdr', 'bloom', 'aces', 'srgb'], grid: true, supersampling: [1, 2, 3, 4], wireframe: true, materials: 'pbr', patterns: SURFACE_PATTERNS, primitives: PRIMITIVES, gameplay: ['rigidbody', 'controller', 'spinner', 'collectible'], proceduralTextures: true,
        backends: process.platform === 'win32' ? ['software', 'd3d12'] : ['software'], gpu: { implemented: process.platform === 'win32', api: 'Direct3D 12', present: process.platform === 'win32', nativeWindow: process.platform === 'win32', windowCapture: process.platform === 'win32', msaa: false, rayTracing: false, textures: true, shadowMaps: true, bloom: true, hdr: true } } } };
}
function executablePath() {
  if (process.platform === 'win32') {
    // Une version Release est préférée pour la distribution : elle ne dépend pas des DLL
    // de débogage MSVC (MSVCP140D/ucrtbased), absentes d'un poste standard.
    const candidates = [
      path.join(BUILD, 'Release', 'NovaEngine.exe'),
      path.join(BUILD, 'Debug', 'NovaEngine.exe'),
      path.join(BUILD, 'NovaEngine.exe')
    ];
    return candidates.find(file => fs.existsSync(file)) || candidates[0];
  }
  return path.join(BUILD, 'NovaEngine');
}
function runCommand(name, command, args, cwd = ENGINE) {
  if (active) return { error: `Une action est déjà en cours : ${active.name}` };
  logs = logs.slice(-500); log(`$ ${command} ${args.join(' ')}`, 'command');
  lastAction = { name, status: 'running', code: null, endedAt: null };
  const child = spawn(command, args, { cwd, shell: false, windowsHide: true, env: { ...process.env, CMAKE_COLOR_DIAGNOSTICS: 'OFF' } });
  active = { name, child };
  child.stdout.on('data', d => log(d.toString(), 'stdout'));
  child.stderr.on('data', d => log(d.toString(), 'stderr'));
  child.on('error', e => { log(`Erreur de lancement : ${e.message}`, 'error'); lastAction = { name, status: 'failed', code: null, endedAt: new Date().toISOString() }; active = null; });
  child.on('close', code => { log(`Action terminée : code ${code}`, code === 0 ? 'success' : 'error'); lastAction = { name, status: code === 0 ? 'success' : 'failed', code, endedAt: new Date().toISOString() }; active = null; });
  return { started: true, name, pid: child.pid };
}
function validateWithEngine(scene) {
  if (!fs.existsSync(executablePath())) {
    return { ok: false, code: null, output: '', error: 'Exécutable NovaEngine absent. Configure puis compile le projet dans Build & compilation.' };
  }
  if (active && active.name.startsWith('Build')) {
    return { ok: false, code: null, output: '', error: `Une action est déjà en cours : ${active.name}` };
  }
  const temporary = path.join(DATA, `scene.validate-${process.pid}-${Date.now()}.json`);
  try {
    writeJsonAtomic(temporary, normalizeScene(scene));
    const output = execFileSync(executablePath(), ['--scene', temporary, '--validate'], { encoding: 'utf8', timeout: 20000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    log(`Validation moteur : ${output.trim()}`, 'success');
    return { ok: true, code: 0, output: output.trim(), error: null };
  } catch (e) {
    const output = `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message;
    log(`Validation moteur refusée : ${output}`, 'error');
    return { ok: false, code: e.status ?? null, output, error: output };
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
}
function json(res, code, data) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(data)); }
function listRenders() {
  try {
    return fs.readdirSync(RENDERS_DIR)
      .filter(name => /^render-[a-z0-9-]+\.png$/.test(name))
      .map(name => { const stat = fs.statSync(path.join(RENDERS_DIR, name)); return { name, mtime: stat.mtimeMs, bytes: stat.size }; })
      .sort((a, b) => b.mtime - a.mtime);
  } catch { return []; }
}
function cleanupRenders() {
  for (const render of listRenders().slice(MAX_RENDERS)) {
    try { fs.unlinkSync(path.join(RENDERS_DIR, render.name)); } catch {}
  }
}
function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback;
}
function renderWithEngine(scene, options = {}) {
  const executable = executablePath();
  if (!fs.existsSync(executable)) {
    return { ok: false, error: 'Exécutable NovaEngine absent. Configure puis compile le projet dans Build & compilation.' };
  }
  if (active) {
    return { ok: false, error: `Une action est déjà en cours : ${active.name}` };
  }
  if (scene.entities.length > 250) {
    return { ok: false, error: 'Scène trop volumineuse pour le rendu (250 entités maximum).' };
  }

  const id = `render-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const output = path.join(RENDERS_DIR, `${id}.png`);
  const temporary = path.join(DATA, `scene.render-${process.pid}-${Date.now()}.json`);
  const width = clampInteger(options.width, 64, 1920, 960);
  const height = clampInteger(options.height, 64, 1080, 540);
  const supersample = clampInteger(options.supersample, 1, 4, 2);
  const exposure = Math.min(8, Math.max(0.1, Number(options.exposure) || 1));
  const shadows = options.shadows !== false;
  const bloom = options.bloom !== false;
  const bloomIntensity = Math.min(2, Math.max(0, Number.isFinite(Number(options.bloomIntensity)) ? Number(options.bloomIntensity) : 0.45));
  const shadowResolution = clampInteger(options.shadowResolution, 128, 2048, 1024);
  const cameraId = typeof options.cameraId === 'string' ? options.cameraId.slice(0, 80) : '';
  const selectedId = typeof options.selectedId === 'string' ? options.selectedId.slice(0, 80) : '';
  const gpu = options.backend === 'gpu' || options.backend === 'd3d12';
  if (gpu && process.platform !== 'win32') {
    return { ok: false, error: 'Le backend GPU Direct3D 12 est disponible uniquement sous Windows. Utilise le rastériseur logiciel sur cette plateforme.' };
  }
  const args = ['--scene', temporary, '--stats-json', '--width', String(width), '--height', String(height), '--exposure', String(exposure), '--assets', ASSETS_DIR, '--shadow-resolution', String(shadowResolution)];
  if (!shadows) args.push('--no-shadows');
  if (!bloom) args.push('--no-bloom');
  else args.push('--bloom-intensity', String(bloomIntensity));
  if (gpu) {
    // The D3D12 backend shares the multi-light, texture, shadow-map, HDR bloom
    // and ACES pipeline with the software path. Only the CPU grid is skipped.
    args.push('--render-gpu', output, '--backend', 'd3d12');
  } else {
    args.push('--render', output, '--supersample', String(supersample));
    if (options.grid === false) args.push('--no-grid');
  }
  if (cameraId) args.push('--camera', cameraId);
  if (selectedId) args.push('--selected', selectedId);
  if (options.wireframe === true) args.push('--wireframe');

  try {
    writeJsonAtomic(temporary, normalizeScene(scene));
    const started = Date.now();
    const outputText = execFileSync(executable, args, { encoding: 'utf8', timeout: 120000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const statsLine = outputText.trim().split(/\r?\n/).filter(Boolean).pop();
    let stats;
    try { stats = JSON.parse(statsLine); } catch { stats = { width, height, supersample }; }
    const bytes = fs.statSync(output).size;
    const wallMs = Date.now() - started;
    cleanupRenders();
    const pathLabel = gpu ? `GPU ${stats.backend || 'D3D12'}` : 'logiciel';
    log(`Rendu 3D ${id} (${pathLabel}) : ${stats.width}×${stats.height}, ${stats.triangles ?? 0} triangles, ${stats.meshes ?? 0} maillage(s), ${bytes} octets (${wallMs} ms).`, 'success');
    return { ok: true, id, file: `${id}.png`, url: `/nova-engine/api/engine/render/${id}.png`, stats: { ...stats, backend: gpu ? (stats.backend || 'D3D12') : 'Software', bytes, wallMs } };
  } catch (e) {
    const detail = `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message;
    log(`Rendu 3D refusé : ${detail}`, 'error');
    try { if (fs.existsSync(output)) fs.unlinkSync(output); } catch {}
    return { ok: false, error: detail };
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
}
function runtimeStatus() {
  if (!runtime) {
    return { running: false, pid: null, sceneName: null, startedAt: null, elapsedMs: 0, width: null, height: null, wireframe: false, hidden: false, lastCapture: lastRuntimeCapture, error: null };
  }
  return {
    running: true,
    pid: runtime.pid,
    sceneName: runtime.sceneName,
    startedAt: runtime.startedAt,
    elapsedMs: Date.now() - runtime.startedAtMs,
    width: runtime.width,
    height: runtime.height,
    wireframe: runtime.wireframe,
    hidden: runtime.hidden,
    lastCapture: lastRuntimeCapture,
    error: runtime.error
  };
}
function startRuntimeWindow(scene, options = {}) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'La fenêtre native Direct3D 12 est disponible uniquement sous Windows. Utilise la capture logicielle sur cette plateforme.' };
  }
  const executable = executablePath();
  if (!fs.existsSync(executable)) {
    return { ok: false, error: 'Exécutable NovaEngine absent. Configure puis compile le projet dans Build & compilation.' };
  }
  if (runtime) return { ok: false, error: `La fenêtre runtime est déjà ouverte (PID ${runtime.pid}).` };
  if (active) return { ok: false, error: `Une action est déjà en cours : ${active.name}` };

  const width = clampInteger(options.width, 320, 3840, 1280);
  const height = clampInteger(options.height, 240, 2160, 720);
  const wireframe = options.wireframe === true;
  const hidden = options.hidden === true;
  const frames = hidden ? clampInteger(options.frames, 1, 100000, 600) : 0;
  const cameraId = typeof options.cameraId === 'string' ? options.cameraId.slice(0, 80) : '';
  const exposure = Math.min(8, Math.max(0.1, Number(options.exposure) || 1));
  const shadows = options.shadows !== false;
  const bloom = options.bloom !== false;
  const bloomIntensity = Math.min(2, Math.max(0, Number.isFinite(Number(options.bloomIntensity)) ? Number(options.bloomIntensity) : 0.45));
  const shadowResolution = clampInteger(options.shadowResolution, 128, 2048, 1024);
  const temporary = path.join(DATA, `scene.runtime-${process.pid}-${Date.now()}.json`);
  const args = ['--scene', temporary, '--run', '--width', String(width), '--height', String(height), '--exposure', String(exposure), '--assets', ASSETS_DIR, '--shadow-resolution', String(shadowResolution)];
  if (!shadows) args.push('--no-shadows');
  if (!bloom) args.push('--no-bloom');
  else args.push('--bloom-intensity', String(bloomIntensity));
  if (hidden) args.push('--window-hidden', '--frames', String(frames));
  if (wireframe) args.push('--wireframe');
  if (cameraId) args.push('--camera', cameraId);

  try {
    writeJsonAtomic(temporary, normalizeScene(scene));
  } catch (e) {
    return { ok: false, error: e.message || 'Scène runtime illisible.' };
  }

  let child;
  try {
    child = spawn(executable, args, { cwd: BUILD, windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    try { fs.unlinkSync(temporary); } catch {}
    return { ok: false, error: e.message || 'Lancement de la fenêtre impossible.' };
  }

  runtime = { child, pid: child.pid, sceneName: scene.name, startedAt: new Date().toISOString(), startedAtMs: Date.now(), width, height, wireframe, hidden, temporary, error: null };
  log(`Fenêtre runtime ${hidden ? 'cachée ' : ''}ouverte : ${width}×${height}, scène « ${scene.name} » (PID ${child.pid}).`, 'success');
  child.stdout.on('data', d => log(d.toString(), 'stdout'));
  child.stderr.on('data', d => log(d.toString(), 'stderr'));
  child.on('error', e => {
    log(`Erreur fenêtre runtime : ${e.message}`, 'error');
    if (runtime && runtime.child === child) runtime.error = e.message;
  });
  child.on('close', code => {
    log(`Fenêtre runtime fermée (code ${code}).`, code === 0 ? 'success' : 'warning');
    try { fs.unlinkSync(temporary); } catch {}
    if (runtime && runtime.child === child) runtime = null;
  });
  return { ok: true, pid: child.pid, sceneName: scene.name, width, height, wireframe, startedAt: runtime.startedAt };
}
function stopRuntimeWindow() {
  if (!runtime) return { ok: false, error: 'Aucune fenêtre runtime n’est ouverte.' };
  const proc = runtime;
  log(`Arrêt de la fenêtre runtime demandé (PID ${proc.pid}).`, 'warning');
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else proc.child.kill('SIGTERM');
  return { ok: true, pid: proc.pid, stopping: true };
}
function captureRuntime(scene, options = {}) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'La capture de fenêtre Direct3D 12 est disponible uniquement sous Windows.' };
  }
  const executable = executablePath();
  if (!fs.existsSync(executable)) {
    return { ok: false, error: 'Exécutable NovaEngine absent. Configure puis compile le projet dans Build & compilation.' };
  }
  if (runtime) return { ok: false, error: 'Ferme la fenêtre runtime avant de lancer une capture automatisée.' };
  if (active) return { ok: false, error: `Une action est déjà en cours : ${active.name}` };

  const id = `render-runtime-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const output = path.join(RENDERS_DIR, `${id}.png`);
  const temporary = path.join(DATA, `scene.capture-${process.pid}-${Date.now()}.json`);
  const width = clampInteger(options.width, 64, 1920, 960);
  const height = clampInteger(options.height, 64, 1080, 540);
  const frames = clampInteger(options.frames, 1, 600, 2);
  const wireframe = options.wireframe === true;
  const cameraId = typeof options.cameraId === 'string' ? options.cameraId.slice(0, 80) : '';
  const exposure = Math.min(8, Math.max(0.1, Number(options.exposure) || 1));
  const shadows = options.shadows !== false;
  const bloom = options.bloom !== false;
  const bloomIntensity = Math.min(2, Math.max(0, Number.isFinite(Number(options.bloomIntensity)) ? Number(options.bloomIntensity) : 0.45));
  const shadowResolution = clampInteger(options.shadowResolution, 128, 2048, 1024);
  const args = ['--scene', temporary, '--run', '--window-hidden', '--stats-json',
    '--width', String(width), '--height', String(height), '--frames', String(frames),
    '--capture', output, '--exposure', String(exposure), '--assets', ASSETS_DIR,
    '--shadow-resolution', String(shadowResolution)];
  if (!shadows) args.push('--no-shadows');
  if (!bloom) args.push('--no-bloom');
  else args.push('--bloom-intensity', String(bloomIntensity));
  if (wireframe) args.push('--wireframe');
  if (cameraId) args.push('--camera', cameraId);

  try {
    writeJsonAtomic(temporary, normalizeScene(scene));
    const started = Date.now();
    const outputText = execFileSync(executable, args, { encoding: 'utf8', timeout: 120000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const statsLine = outputText.trim().split(/\r?\n/).filter(Boolean).pop();
    let stats;
    try { stats = JSON.parse(statsLine); } catch { stats = { width, height, frames }; }
    const bytes = fs.statSync(output).size;
    const wallMs = Date.now() - started;
    lastRuntimeCapture = {
      id,
      file: `${id}.png`,
      url: `/nova-engine/api/engine/render/${id}.png`,
      bytes,
      frames: stats.frames ?? frames,
      stats: { ...stats, bytes, wallMs, backend: stats.backend || 'D3D12' },
      at: new Date().toISOString()
    };
    cleanupRenders();
    log(`Capture runtime ${id} : ${stats.width}×${stats.height}, ${stats.frames ?? frames} frame(s), ${stats.triangles ?? 0} triangles, ${bytes} octets (${wallMs} ms).`, 'success');
    return { ok: true, ...lastRuntimeCapture };
  } catch (e) {
    const detail = `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message;
    log(`Capture runtime refusée : ${detail}`, 'error');
    try { if (fs.existsSync(output)) fs.unlinkSync(output); } catch {}
    return { ok: false, error: detail };
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
}
function body(req) {
  return new Promise((resolve, reject) => {
    let content = '';
    req.on('data', chunk => {
      content += chunk;
      if (content.length > MAX_SCENE_BYTES) reject(new Error('Payload trop volumineux (2 Mo maximum).'));
    });
    req.on('end', () => { try { resolve(content ? JSON.parse(content) : {}); } catch { reject(new Error('JSON invalide')); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const pathname = url.pathname === '/nova-engine' ? '/' : url.pathname.startsWith('/nova-engine/') ? url.pathname.slice('/nova-engine'.length) : url.pathname;
  if (req.method === 'GET' && pathname === '/api/ping') return json(res, 200, { ok: true, service: 'nova-engine-workbench', version: WORKBENCH_VERSION });
  if (req.method === 'GET' && pathname === '/api/scene/template') return json(res, 200, defaultScene());
  if (req.method === 'GET' && pathname === '/api/version') return json(res, 200, { app: 'Nova Engine Workbench', version: WORKBENCH_VERSION, engine: ENGINE_VERSION, sceneSchema: SCENE_SCHEMA });
  if (req.method === 'GET' && pathname === '/api/scene') return json(res, 200, readScene());
  if (req.method === 'GET' && pathname === '/api/scenes') return json(res, 200, { scenes: listScenes() });
  if (req.method === 'GET' && pathname === '/api/scenes/load') {
    const id = safeSceneId(url.searchParams.get('id'));
    if (!id || !fs.existsSync(namedSceneFile(id))) return json(res, 404, { error: 'Scène introuvable.' });
    try { return json(res, 200, readSceneFile(namedSceneFile(id))); } catch { return json(res, 500, { error: 'Scène enregistrée illisible.' }); }
  }
  if (req.method === 'GET' && pathname === '/api/scenes/export') {
    const id = safeSceneId(url.searchParams.get('id'));
    if (!id || !fs.existsSync(namedSceneFile(id))) return json(res, 404, { error: 'Scène introuvable.' });
    try {
      const scene = readSceneFile(namedSceneFile(id));
      const payload = JSON.stringify(scene, null, 2);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${id}.scene.json"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      return res.end(payload);
    } catch { return json(res, 500, { error: 'Scène enregistrée illisible.' }); }
  }
  if (req.method === 'PUT' && pathname === '/api/scene') {
    try {
      const input = await body(req); const invalid = validateScene(input);
      if (invalid) return json(res, 400, { error: invalid });
      const saved = normalizeScene(input);
      const backup = backupCurrentScene('autosave');
      writeJsonAtomic(SCENE_FILE, saved);
      log(`Scène enregistrée : ${saved.name} (${saved.entities.length} entités)`); return json(res, 200, { ok: true, scene: saved, backup: backup ? path.basename(backup) : null });
    } catch (e) { return json(res, 400, { error: e.message || 'JSON de scène invalide.' }); }
  }
  if (req.method === 'PUT' && pathname === '/api/scenes/save') {
    try {
      const input = await body(req); const id = safeSceneId(input.id || input.scene?.name); const invalid = validateScene(input.scene);
      if (!id || invalid) return json(res, 400, { error: invalid || 'Identifiant de scène invalide.' });
      const saved = normalizeScene(input.scene);
      writeJsonAtomic(namedSceneFile(id), saved); log(`Scène nommée enregistrée : ${id}`, 'success');
      return json(res, 200, { ok: true, id, scene: saved });
    } catch (e) { return json(res, 400, { error: e.message || 'Scène invalide.' }); }
  }
  if (req.method === 'POST' && pathname === '/api/scenes/import') {
    try {
      const input = await body(req); const id = safeSceneId(input.id || input.scene?.name); const invalid = validateScene(input.scene);
      if (!id || invalid) return json(res, 400, { error: invalid || 'Identifiant de scène invalide.' });
      if (fs.existsSync(namedSceneFile(id)) && input.overwrite !== true) return json(res, 409, { error: `Une scène « ${id} » existe déjà.` });
      const saved = normalizeScene(input.scene, input.name || input.scene.name);
      writeJsonAtomic(namedSceneFile(id), saved); log(`Scène importée : ${id} (${saved.entities.length} entités)`, 'success');
      return json(res, 200, { ok: true, id, scene: saved });
    } catch (e) { return json(res, 400, { error: e.message || 'Scène invalide.' }); }
  }
  if (req.method === 'POST' && pathname === '/api/scenes/rename') {
    try {
      const input = await body(req); const id = safeSceneId(input.id); const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!id || !fs.existsSync(namedSceneFile(id))) return json(res, 404, { error: 'Scène introuvable.' });
      if (!name || name.length > 120) return json(res, 400, { error: 'Le nom de scène doit contenir entre 1 et 120 caractères.' });
      const scene = readSceneFile(namedSceneFile(id)); scene.name = name; scene.updatedAt = new Date().toISOString();
      const nextId = input.newId ? safeSceneId(input.newId) : id;
      if (!nextId) return json(res, 400, { error: 'Identifiant de scène invalide.' });
      if (nextId !== id && fs.existsSync(namedSceneFile(nextId))) return json(res, 409, { error: `Une scène « ${nextId} » existe déjà.` });
      writeJsonAtomic(namedSceneFile(nextId), scene);
      if (nextId !== id) { try { fs.unlinkSync(namedSceneFile(id)); } catch {} }
      log(`Scène renommée : ${nextId} → ${name}`, 'success');
      return json(res, 200, { ok: true, id: nextId, scene });
    } catch (e) { return json(res, 404, { error: e.message || 'Scène introuvable.' }); }
  }
  if ((req.method === 'DELETE' && pathname === '/api/scenes') || (req.method === 'POST' && pathname === '/api/scenes/delete')) {
    try {
      const input = req.method === 'DELETE' ? { id: url.searchParams.get('id') } : await body(req);
      const id = safeSceneId(input.id);
      if (!id || !fs.existsSync(namedSceneFile(id))) return json(res, 404, { error: 'Scène introuvable.' });
      fs.unlinkSync(namedSceneFile(id)); log(`Scène supprimée : ${id}`, 'warning');
      return json(res, 200, { ok: true, id });
    } catch (e) { return json(res, 400, { error: e.message || 'Suppression impossible.' }); }
  }
  if (req.method === 'POST' && pathname === '/api/validate') {
    try {
      const input = await body(req); const invalid = validateScene(input.scene || input);
      if (invalid) return json(res, 400, { ok: false, error: invalid });
      const scene = input.scene || input;
      return json(res, 200, { ok: true, name: scene.name.trim(), entities: scene.entities.length });
    } catch (e) { return json(res, 400, { ok: false, error: e.message || 'Scène invalide.' }); }
  }
  if (req.method === 'POST' && pathname === '/api/engine/validate') {
    try {
      const input = await body(req);
      const scene = input.scene || readScene();
      const invalid = validateScene(scene);
      if (invalid) return json(res, 400, { ok: false, error: invalid, output: '' });
      const result = validateWithEngine(scene);
      return json(res, result.ok ? 200 : (result.code === null ? 409 : 422), result);
    } catch (e) { return json(res, 400, { ok: false, error: e.message || 'Validation impossible.', output: '' }); }
  }
  if (req.method === 'POST' && pathname === '/api/engine/render') {
    try {
      const input = await body(req);
      const scene = input.scene || readScene();
      const invalid = validateScene(scene);
      if (invalid) return json(res, 400, { ok: false, error: invalid });
      const result = renderWithEngine(scene, input.options || {});
      return json(res, result.ok ? 200 : (result.error?.includes('en cours') || result.error?.includes('absent') ? 409 : 422), result);
    } catch (e) { return json(res, 400, { ok: false, error: e.message || 'Rendu 3D impossible.' }); }
  }
  if (req.method === 'GET' && pathname === '/api/engine/renders') return json(res, 200, { renders: listRenders().map(({ name, bytes, mtime }) => ({ id: name.replace(/\.png$/, ''), file: name, bytes, mtime, url: `/nova-engine/api/engine/render/${name}` })) });
  if (req.method === 'GET' && pathname.startsWith('/api/engine/render/')) {
    const name = decodeURIComponent(pathname.slice('/api/engine/render/'.length));
    if (!/^render-[a-z0-9-]+\.png$/.test(name)) return json(res, 400, { error: 'Identifiant de rendu invalide.' });
    const file = path.join(RENDERS_DIR, name);
    if (!fs.existsSync(file)) return json(res, 404, { error: 'Rendu introuvable.' });
    return fs.readFile(file, (err, data) => {
      if (err) return json(res, 500, { error: 'Rendu illisible.' });
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': data.length, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' });
      res.end(data);
    });
  }
  if (req.method === 'GET' && pathname.startsWith('/api/assets/')) {
    const relative = decodeURIComponent(pathname.slice('/api/assets/'.length)).replace(/\\/g, '/');
    if (!relative || relative.length > 200 || relative.includes('..') || !/^[a-z0-9][a-z0-9/_\-. ]*\.(png|jpe?g)$/i.test(relative)) {
      return json(res, 400, { error: 'Chemin d’asset PNG/JPEG invalide.' });
    }
    const assetRoot = path.resolve(ASSETS_DIR);
    const file = path.resolve(ASSETS_DIR, relative);
    if (!file.startsWith(assetRoot + path.sep)) return json(res, 403, { error: 'Forbidden' });
    if (!fs.existsSync(file)) return json(res, 404, { error: 'Asset introuvable.' });
    return fs.readFile(file, (err, data) => {
      if (err) return json(res, 500, { error: 'Asset illisible.' });
      const type = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg';
      res.writeHead(200, { 'content-type': type, 'content-length': data.length, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' });
      res.end(data);
    });
  }
  if (req.method === 'GET' && pathname === '/api/status') return json(res, 200, status());
  if (req.method === 'GET' && pathname === '/api/runtime/status') return json(res, 200, runtimeStatus());
  if (req.method === 'POST' && pathname === '/api/runtime/window') {
    try {
      const input = await body(req);
      const scene = input.scene || readScene();
      const invalid = validateScene(scene);
      if (invalid) return json(res, 400, { ok: false, error: invalid });
      const result = startRuntimeWindow(scene, input.options || {});
      const busy = /absent|déjà|en cours|Windows/.test(result.error || '');
      return json(res, result.ok ? 200 : (busy ? 409 : 422), result);
    } catch (e) { return json(res, 400, { ok: false, error: e.message || 'Ouverture de la fenêtre impossible.' }); }
  }
  if (req.method === 'POST' && pathname === '/api/runtime/window/stop') {
    const result = stopRuntimeWindow();
    return json(res, result.ok ? 200 : 409, result);
  }
  if (req.method === 'POST' && pathname === '/api/engine/runtime/capture') {
    try {
      const input = await body(req);
      const scene = input.scene || readScene();
      const invalid = validateScene(scene);
      if (invalid) return json(res, 400, { ok: false, error: invalid });
      const result = captureRuntime(scene, input.options || {});
      const busy = /absent|déjà|en cours|Ferme|Windows/.test(result.error || '');
      return json(res, result.ok ? 200 : (busy ? 409 : 422), result);
    } catch (e) { return json(res, 400, { ok: false, error: e.message || 'Capture runtime impossible.' }); }
  }
  if (req.method === 'GET' && pathname === '/api/logs') return json(res, 200, { logs, lastAction });
  if (req.method === 'POST' && pathname.startsWith('/api/')) {
    let result;
    try {
      if (pathname === '/api/configure') result = runCommand('Configure CMake', 'cmake', ['-S', ENGINE, '-B', BUILD, '-DCMAKE_BUILD_TYPE=Debug']);
      else if (pathname === '/api/build') result = runCommand('Build Nova Engine', 'cmake', ['--build', BUILD, '--config', 'Debug', '--parallel']);
      else if (pathname === '/api/test') result = runCommand('Run tests', 'ctest', ['--test-dir', BUILD, '-C', 'Debug', '--output-on-failure']);
      else if (pathname === '/api/run') {
        if (!fs.existsSync(executablePath())) return json(res, 409, { error: 'Exécutable absent. Configure puis compile le projet.' });
        result = runCommand('Launch Nova Engine', executablePath(), [], BUILD);
      } else if (pathname === '/api/stop') {
        if (!active) return json(res, 409, { error: 'Aucun processus géré par Workbench n’est en cours.' });
        const proc = active; log(`Arrêt demandé pour ${proc.name}`, 'warning');
        if (process.platform === 'win32') spawn('taskkill', ['/PID', String(proc.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); else proc.child.kill('SIGTERM');
        return json(res, 200, { stopped: true });
      } else if (pathname === '/api/clear-logs') { logs = []; log('Journal effacé'); return json(res, 200, { cleared: true }); }
      else return json(res, 404, { error: 'Route inconnue' });
    } catch (e) { return json(res, 400, { error: e.message }); }
    if (result?.error) return json(res, 409, result);
    return json(res, 202, result);
  }
  if (req.method === 'GET') {
    const requested = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
    const file = path.resolve(ROOT, 'public', `.${requested}`);
    if (!file.startsWith(path.resolve(ROOT, 'public') + path.sep) && file !== path.resolve(ROOT, 'public', 'index.html')) return json(res, 403, { error: 'Forbidden' });
    fs.readFile(file, (err, data) => { if (err) return json(res, 404, { error: 'Not found' }); const ext = path.extname(file); const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' }; res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(data); }); return;
  }
  json(res, 405, { error: 'Method not allowed' });
});
server.listen(PORT, HOST, () => { log(`Nova Engine Workbench ${WORKBENCH_VERSION} prêt sur http://${HOST}:${PORT}`); console.log(`Nova Engine Workbench ${WORKBENCH_VERSION} : http://${HOST}:${PORT}`); console.log(`Projet : ${ENGINE}`); });
process.on('SIGINT', () => {
  if (runtime) {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(runtime.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else runtime.child.kill('SIGTERM');
  }
  if (active) active.child.kill('SIGTERM');
  server.close(() => process.exit(0));
});
