// Lot 16 — vérifie la classification des erreurs de session et les endpoints de fiabilité
// du Workbench : sonde légère, version et scène de démarrage complète.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
vm.runInThisContext(fs.readFileSync(path.join(root, 'public', 'session.js'), 'utf8'));
const Session = globalThis.NovaSession;
assert.ok(Session, 'session.js doit exposer NovaSession');

// --- Classification des erreurs -------------------------------------------------
let info = Session.classifyApiFailure(401, { code: 'AUTH_REQUIRED', error: 'Connexion requise.' });
assert.equal(info.kind, 'expired');
assert.equal(info.needsLogin, true);
assert.equal(info.canRetry, true);

info = Session.classifyApiFailure(401, { code: 'SESSION_REVOKED', error: 'Session révoquée.' });
assert.equal(info.kind, 'expired');
assert.match(info.message, /révoquée/);

info = Session.classifyApiFailure(403, { code: 'EMAIL_NOT_VERIFIED', error: 'Vérifie ton adresse e-mail.' });
assert.equal(info.kind, 'unverified');
assert.equal(info.needsLogin, false);

info = Session.classifyApiFailure(403, { code: 'NOPE', error: 'Refusé.' });
assert.equal(info.kind, 'forbidden');
assert.equal(info.canRetry, false);

info = Session.classifyApiFailure(503, { error: 'Indisponible' });
assert.equal(info.kind, 'server');
assert.equal(info.canRetry, true);

info = Session.classifyApiFailure(400, { error: 'JSON invalide' });
assert.equal(info.kind, 'error');
assert.equal(info.message, 'JSON invalide');

assert.ok(Session.bannerFor('expired').showLogin);
assert.equal(Session.bannerFor('expired').showRetry, true);
assert.equal(Session.bannerFor('offline').showLogin, false);
assert.equal(Session.bannerFor('unknown-state'), null);

// --- Lecture d'un jeton sans le valider côté client -----------------------------
const tokenFor = (payload) => ['x', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'y'].join('.');
let token = Session.readToken(tokenFor({ email: 'a@b.test', name: 'A', exp: Math.floor(Date.now() / 1000) + 3600 }));
assert.equal(token.present, true);
assert.equal(token.expired, false);
assert.equal(token.email, 'a@b.test');

token = Session.readToken(tokenFor({ email: 'a@b.test', exp: Math.floor(Date.now() / 1000) - 10 }));
assert.equal(token.expired, true);

assert.equal(Session.readToken(null).present, false);
assert.equal(Session.readToken('pas-un-jeton').parsed, false);

// --- Endpoints Workbench --------------------------------------------------------
const port = 5299;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-workbench-session-'));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: root,
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NOVA_WORKBENCH_DATA_DIR: dataDir },
  stdio: 'ignore',
  windowsHide: true
});
async function ready() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${base}/api/ping`)).ok) return; } catch { /* démarrage */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Workbench server did not start.');
}
try {
  await ready();
  const ping = await (await fetch(`${base}/api/ping`)).json();
  assert.equal(ping.ok, true);
  assert.equal(ping.version, '1.9.1');

  const version = await (await fetch(`${base}/api/version`)).json();
  assert.equal(version.version, '1.9.1');
  assert.equal(version.engine, '0.8.0');
  assert.equal(version.sceneSchema, 4);

  const template = await (await fetch(`${base}/api/scene/template`)).json();
  assert.equal(template.schemaVersion, 4);
  const names = template.entities.map(entity => entity.name);
  assert.ok(names.includes('Main Camera'), 'caméra de démarrage');
  assert.ok(names.includes('Key Light'), 'lumière directionnelle');
  assert.ok(names.includes('Ground'), 'sol');
  assert.ok(names.includes('Starter Cube'), 'objet de départ');
  const ground = template.entities.find(entity => entity.name === 'Ground');
  assert.equal(ground.primitive, 'plane');
  assert.ok(ground.scale[0] >= 10 && ground.scale[2] >= 10, 'le sol couvre la scène');
  assert.ok(template.entities.filter(entity => entity.light?.castShadow).length <= 2, 'deux shadow maps au maximum');
  assert.ok(template.entities.some(entity => entity.light?.type === 'spot'));

  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  const html = await index.text();
  assert.match(html, /session\.js\?v=1\.9\.1/);
  assert.match(html, /viewport-math\.js\?v=1\.9\.1/);
  assert.match(html, /viewport-3d\.js\?v=1\.9\.1/);
  assert.match(html, /session-banner/);
  assert.match(html, /scene-save-state/);
  assert.match(html, /Workbench 1\.9\.1/);

  // Scène par défaut complète lorsque le dossier de données est vide.
  const fresh = await (await fetch(`${base}/api/scene`)).json();
  assert.ok(fresh.entities.some(entity => entity.name === 'Ground'), 'scène par défaut avec sol');
  assert.ok(fresh.entities.some(entity => entity.name === 'Main Camera'), 'scène par défaut avec caméra');

  // Autosave : chaque écrasement crée une sauvegarde roulante.
  const putScene = async (name) => {
    const response = await fetch(`${base}/api/scene`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...template, name }) });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await putScene('Autosave 1')).status, 200);
  const second = await putScene('Autosave 2');
  assert.equal(second.status, 200);
  assert.ok(second.body.backup, 'la deuxième sauvegarde doit produire une copie de sécurité');
  const backups = fs.readdirSync(path.join(dataDir, 'backups')).filter(name => name.endsWith('.json'));
  assert.ok(backups.length >= 1, 'au moins une sauvegarde roulante');
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'scene.json'), 'utf8'));
  assert.equal(onDisk.name, 'Autosave 2');
  assert.equal(onDisk.entities.length, template.entities.length);
} finally {
  server.kill();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows peut garder un handle quelques ms. */ }
}
console.log('test-session: OK — classification 401/403, jeton expiré, ping, template complet, autosave/backup, UI 1.9.1');
