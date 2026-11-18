// Utilitaires de test : démarre un vrai serveur NovaCore isolé (dossier de données temporaire, port libre).
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const STRONG_SECRET = 'test-secret-9f3a1c77b2d84e65a0c1f2e3d4b5a697-NOVA';

function freePort() {
  return new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); s.on('error', reject); });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startServer({ env = {}, dataDir } = {}) {
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-test-'));
  const port = await freePort(), enginePort = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1', JWT_SECRET: STRONG_SECRET, NOVACORE_DATA_DIR: dir, NOVA_ENGINE_WORKBENCH_PORT: String(enginePort), SMTP_HOST: '', SMTP_FROM: '', ...env }
  });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`Le serveur s'est arrêté (${child.exitCode}) :\n${logs}`);
    try { const r = await fetch(`${base}/api/health`); if (r.ok) break; } catch { /* pas encore prêt */ }
    await sleep(150);
  }
  const stop = () => new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 6000).unref(); });
  const api = async (method, url, { token, body, headers } = {}) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    let json = null; try { json = await res.json(); } catch { /* corps non JSON */ }
    return { status: res.status, json, headers: res.headers };
  };
  return { base, port, dir, child, logs: () => logs, stop, api };
}

// Crée un compte vérifié (mode développement : le lien de vérification est renvoyé dans la réponse).
async function createVerifiedUser(srv, email, password = 'Orbite-Lumineuse-4821', displayName = 'Testeur') {
  const reg = await srv.api('POST', '/api/auth/register', { body: { email, password, displayName, termsAccepted: true } });
  if (reg.status !== 201) throw new Error(`register ${reg.status} ${JSON.stringify(reg.json)}`);
  const token = new URL(reg.json.developmentVerificationUrl).searchParams.get('verifyEmail');
  const ver = await srv.api('POST', '/api/auth/verify-email', { body: { token } });
  if (ver.status !== 200) throw new Error(`verify ${ver.status}`);
  const login = await srv.api('POST', '/api/auth/login', { body: { email, password, termsAccepted: true } });
  if (login.status !== 200) throw new Error(`login ${login.status} ${JSON.stringify(login.json)}`);
  return { email, password, token: login.json.token, id: login.json.user.id };
}

// Crée un compte non vérifié : la connexion doit réussir (vérification facultative).
async function createUnverifiedUser(srv, email, password = 'Orbite-Lumineuse-4821', displayName = 'Testeur') {
  const reg = await srv.api('POST', '/api/auth/register', { body: { email, password, displayName, termsAccepted: true } });
  if (reg.status !== 201) throw new Error(`register ${reg.status} ${JSON.stringify(reg.json)}`);
  const login = await srv.api('POST', '/api/auth/login', { body: { email, password, termsAccepted: true } });
  if (login.status !== 200) throw new Error(`login ${login.status} ${JSON.stringify(login.json)}`);
  const verificationToken = reg.json.developmentVerificationUrl ? new URL(reg.json.developmentVerificationUrl).searchParams.get('verifyEmail') : null;
  return { email, password, token: login.json.token, id: login.json.user.id, verificationToken, register: reg.json };
}

module.exports = { startServer, createVerifiedUser, createUnverifiedUser, STRONG_SECRET, ROOT, sleep };
