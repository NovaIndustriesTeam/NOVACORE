// Lot 17 — bordure HTTP (origine/CORS), divulgation responsable et limiteur d'écriture.
// Ces tests parlent à un vrai serveur NovaCore isolé : ils vérifient le comportement
// observable, pas seulement la présence d'une fonction.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const security = require('../server/security');
const { startServer, createVerifiedUser, ROOT } = require('./helpers');

// Isole les tests de la configuration locale .env (chargée par server/index.js).
const CLEAN = { PUBLIC_BASE_URL: '', NOVACORE_URL: '', NOVACORE_ALLOWED_ORIGINS: '', NOVACORE_SECURITY_CONTACT: '' };
const LOGIN = { email: 'inconnu@example.test', password: 'MotDePasse-Long-4821', termsAccepted: true };

test('bordure HTTP : une écriture venue d’une origine tierce est refusée', async t => {
  const srv = await startServer({ env: CLEAN });
  t.after(() => srv.stop());

  const foreign = await srv.api('POST', '/api/auth/login', { body: LOGIN, headers: { Origin: 'https://attaquant.example' } });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.json.code, 'ORIGIN_REJECTED');
  assert.equal(foreign.headers.get('access-control-allow-origin'), null, 'aucun CORS accordé à une origine tierce');

  const same = await srv.api('POST', '/api/auth/login', { body: LOGIN, headers: { Origin: srv.base } });
  assert.equal(same.status, 401, 'même origine : la requête atteint la route de connexion');
  assert.equal(same.headers.get('access-control-allow-origin'), srv.base);
  assert.match(String(same.headers.get('vary')), /Origin/);

  const nullOrigin = await srv.api('POST', '/api/auth/login', { body: LOGIN, headers: { Origin: 'null' } });
  assert.equal(nullOrigin.status, 403);
  assert.equal(nullOrigin.json.code, 'ORIGIN_REJECTED');

  const crossSite = await srv.api('POST', '/api/auth/login', { body: LOGIN, headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(crossSite.status, 403);
  assert.equal(crossSite.json.code, 'ORIGIN_REJECTED');

  const read = await srv.api('GET', '/api/health', { headers: { Origin: 'https://attaquant.example' } });
  assert.equal(read.status, 200, 'les lectures publiques restent accessibles');
  assert.equal(read.headers.get('access-control-allow-origin'), null);
});

test('bordure HTTP : une origine déclarée est acceptée, une autre reste refusée', async t => {
  const srv = await startServer({ env: { ...CLEAN, NOVACORE_ALLOWED_ORIGINS: 'https://app.example.test/, https://second.example.test' } });
  t.after(() => srv.stop());

  const allowed = await srv.api('POST', '/api/auth/login', { body: LOGIN, headers: { Origin: 'https://app.example.test' } });
  assert.equal(allowed.status, 401);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.example.test');

  const other = await srv.api('POST', '/api/auth/login', { body: LOGIN, headers: { Origin: 'https://autre.example.test' } });
  assert.equal(other.status, 403);

  const preflight = await srv.api('OPTIONS', '/api/sync', { headers: { Origin: 'https://second.example.test', 'Access-Control-Request-Method': 'PUT' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://second.example.test');
  assert.match(String(preflight.headers.get('access-control-allow-methods')), /PUT/);

  const foreignPreflight = await srv.api('OPTIONS', '/api/sync', { headers: { Origin: 'https://autre.example.test' } });
  assert.notEqual(foreignPreflight.status, 204);
  assert.equal(foreignPreflight.headers.get('access-control-allow-origin'), null);
});

test('divulgation responsable : /.well-known/security.txt est conforme et jamais périmé', async t => {
  const srv = await startServer({ env: CLEAN });
  t.after(() => srv.stop());

  const redirect = await fetch(`${srv.base}/security.txt`, { redirect: 'manual' });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), '/.well-known/security.txt');

  const res = await fetch(`${srv.base}/.well-known/security.txt`);
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/plain/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const body = await res.text();
  assert.match(body, /^Contact: mailto:[^\s@]+@[^\s@]+$/m);
  assert.match(body, /^Preferred-Languages: fr, en$/m);
  assert.match(body, /^Canonical: https?:\/\/.+\/\.well-known\/security\.txt$/m);
  assert.match(body, /^Policy: https?:\/\/.+\/security-policy$/m);
  const expires = /^Expires: (.+)$/m.exec(body)?.[1];
  assert.ok(expires, 'le champ Expires est obligatoire (RFC 9116)');
  const expiresAt = Date.parse(expires);
  assert.ok(Number.isFinite(expiresAt), `Expires doit être une date ISO 8601 : ${expires}`);
  assert.ok(expiresAt > Date.now(), 'Expires doit être dans le futur');
  assert.ok(expiresAt < Date.now() + 366 * 24 * 60 * 60 * 1000, 'Expires doit rester sous un an');

  const policy = await fetch(`${srv.base}/security-policy`);
  assert.equal(policy.status, 200);
  assert.match(String(policy.headers.get('content-type')), /text\/plain/);
  assert.match(await policy.text(), /Politique de sécurité/);
});

function getWithHost(url, host) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'GET',
      headers: { Host: host }
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('divulgation responsable : une origine déclarée prime sur un en-tête Host forgé', async t => {
  const srv = await startServer({ env: { ...CLEAN, NOVACORE_ALLOWED_ORIGINS: 'https://novacore.example' } });
  t.after(() => srv.stop());

  // `fetch` interdit de forger Host : on passe par node:http pour reproduire l'attaque.
  const res = await getWithHost(`${srv.base}/.well-known/security.txt`, 'attaquant.example');
  assert.equal(res.status, 200);
  assert.match(res.body, /^Canonical: https:\/\/novacore\.example\/\.well-known\/security\.txt$/m);
  assert.match(res.body, /^Policy: https:\/\/novacore\.example\/security-policy$/m);
  assert.equal(res.body.includes('attaquant.example'), false, 'un Host forgé ne doit pas apparaître dans le fichier public');
});

test('limiteur d’écriture : PATCH /api/plugins/:id renvoie 429 après 60 actions', async t => {
  const srv = await startServer({ env: CLEAN });
  t.after(() => srv.stop());
  const user = await createVerifiedUser(srv, 'limiteur@example.test');

  const list = await srv.api('GET', '/api/plugins', { token: user.token });
  assert.equal(list.status, 200);
  const id = list.json.plugins[0].id;

  for (let index = 1; index <= 60; index++) {
    const action = await srv.api('PATCH', `/api/plugins/${encodeURIComponent(id)}`, { token: user.token, body: { enabled: index % 2 === 0 } });
    assert.equal(action.status, 200, `action ${index} doit passer (${JSON.stringify(action.json)})`);
  }
  const blocked = await srv.api('PATCH', `/api/plugins/${encodeURIComponent(id)}`, { token: user.token, body: { enabled: true } });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.code, 'RATE_LIMITED');
  assert.equal(blocked.json.limiter, 'write');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0, 'Retry-After doit être annoncé');
});

test('rotation de JWT_SECRET : un jeton émis avant la rotation est refusé', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-rotate-'));
  const first = await startServer({ dataDir, env: { ...CLEAN, JWT_SECRET: 'rotation-avant-0123456789abcdef0123456789abcdef' } });
  const user = await createVerifiedUser(first, 'rotation@example.test');
  const before = await first.api('GET', '/api/me', { token: user.token });
  assert.equal(before.status, 200);
  await first.stop();

  const second = await startServer({ dataDir, env: { ...CLEAN, JWT_SECRET: 'rotation-apres-fedcba9876543210fedcba9876543210' } });
  try {
    const after = await second.api('GET', '/api/me', { token: user.token });
    assert.equal(after.status, 401, 'le jeton signé avec l’ancien secret ne doit plus être accepté');
    const login = await second.api('POST', '/api/auth/login', { body: { email: 'rotation@example.test', password: 'Orbite-Lumineuse-4821', termsAccepted: true } });
    assert.equal(login.status, 200);
    const fresh = await second.api('GET', '/api/me', { token: login.json.token });
    assert.equal(fresh.status, 200);
  } finally {
    await second.stop();
  }
});

test('avertissements de production : les configurations de bordure manquantes sont signalées', () => {
  const keys = ['NODE_ENV', 'TRUST_PROXY', 'PUBLIC_BASE_URL', 'NOVACORE_URL', 'NOVACORE_ALLOWED_ORIGINS', 'NOVACORE_SECURITY_CONTACT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.NODE_ENV = 'production';
    for (const key of keys.slice(1)) delete process.env[key];
    const warnings = security.startupWarnings();
    for (const expected of ['TRUST_PROXY', 'PUBLIC_BASE_URL', 'NOVACORE_ALLOWED_ORIGINS', 'NOVACORE_SECURITY_CONTACT', 'SMTP']) {
      assert.ok(warnings.some(w => w.includes(expected)), `avertissement attendu pour ${expected} : ${JSON.stringify(warnings)}`);
    }
    process.env.TRUST_PROXY = '1';
    process.env.PUBLIC_BASE_URL = 'https://novacore.example';
    process.env.SMTP_HOST = 'smtp.example'; process.env.SMTP_PORT = '587'; process.env.SMTP_FROM = 'no-reply@example.test';
    assert.equal(security.startupWarnings().some(w => w.includes('TRUST_PROXY')), false);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  if (saved.NODE_ENV !== 'production') assert.equal(security.startupWarnings().length, 0, 'aucun avertissement hors production');
});

test('invariants : les routes d’écriture du lot 17 portent le limiteur et le garde d’origine', () => {
  const source = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  assert.match(source, /app\.use\(\['\/api', '\/nova-engine'\], security\.originGuard\)/);
  assert.match(source, /app\.patch\('\/api\/plugins\/:id', requireAuth, limiters\.write/);
  assert.match(source, /app\.post\('\/api\/focus\/sessions', requireAuth, limiters\.write/);
  assert.match(source, /app\.get\('\/\.well-known\/security\.txt'/);
});
