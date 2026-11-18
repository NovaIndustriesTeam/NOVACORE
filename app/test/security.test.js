// Lot 16 : le secret JWT de développement doit survivre aux redémarrages.
// Sans cela, chaque relance du serveur invalide les jetons NovaID existants et les pages
// protégées (dont le Workbench Nova Engine) affichent des 401 inexpliqués.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const script = "const s=require('./server/security');const r=s.ensureConfig();process.stdout.write(JSON.stringify({secret:process.env.JWT_SECRET,mode:r.jwtSecret,ephemeral:r.ephemeral,file:r.file}));";
const cleanEnv = () => {
  const env = { ...process.env };
  delete env.JWT_SECRET;
  delete env.NODE_ENV;
  return env;
};

test('développement : le secret JWT persiste entre deux démarrages sans JWT_SECRET', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-secret-'));
  const env = { ...cleanEnv(), NOVACORE_DATA_DIR: dataDir };
  const run = () => spawnSync(process.execPath, ['-e', script], { cwd: ROOT, env, encoding: 'utf8' });
  const first = run();
  const second = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  const a = JSON.parse(first.stdout);
  const b = JSON.parse(second.stdout);
  assert.equal(a.mode, 'persistent');
  assert.equal(a.ephemeral, false);
  assert.match(a.secret, /^[a-f0-9]{96}$/);
  assert.equal(a.secret, b.secret, 'le second démarrage doit réutiliser le même secret');
  assert.equal(b.mode, 'persistent');
  const file = path.join(dataDir, 'jwt-secret');
  assert.equal(a.file, file);
  assert.equal(fs.readFileSync(file, 'utf8').trim(), a.secret);
  assert.equal(fs.readFileSync(file, 'utf8').trim().length, 96);
});

test('développement : un JWT_SECRET fourni reste prioritaire et n’écrit aucun fichier', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-secret-env-'));
  const provided = 'environnement-test-0123456789abcdef-NOVA-LONG';
  const result = spawnSync(process.execPath, ['-e', script], { cwd: ROOT, env: { ...cleanEnv(), NOVACORE_DATA_DIR: dataDir, JWT_SECRET: provided }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.secret, provided);
  assert.equal(payload.mode, 'configured');
  assert.equal(fs.existsSync(path.join(dataDir, 'jwt-secret')), false);
});

test('production : aucun secret de développement ne peut être créé', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-secret-prod-'));
  const result = spawnSync(process.execPath, ['-e', script], { cwd: ROOT, env: { ...cleanEnv(), NOVACORE_DATA_DIR: dataDir, NODE_ENV: 'production' }, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JWT_SECRET/);
  assert.equal(fs.existsSync(path.join(dataDir, 'jwt-secret')), false);
});
