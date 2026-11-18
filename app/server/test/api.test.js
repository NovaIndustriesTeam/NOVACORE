// Tests d'API NovaCore — roadmap P0 (sécurité, isolation, intégrité) et P1 (erreurs compréhensibles).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { startServer, createVerifiedUser, createUnverifiedUser, ROOT, sleep } = require('./helpers');

let srv, alice, bob;
test.before(async () => { srv = await startServer(); alice = await createVerifiedUser(srv, 'alice@example.test'); bob = await createVerifiedUser(srv, 'bob@example.test'); });
test.after(async () => { await srv.stop(); });

test('en-têtes de sécurité, CSP et identifiant de requête', async () => {
  const res = await fetch(`${srv.base}/api/health`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.match(res.headers.get('content-security-policy') || '', /object-src 'none'/);
  assert.match(res.headers.get('x-request-id') || '', /^[A-Za-z0-9._-]{8,64}$/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('les routes privées exigent une session valide', async () => {
  for (const [m, u] of [['GET', '/api/me'], ['GET', '/api/sync'], ['PUT', '/api/sync'], ['GET', '/api/plugins'], ['GET', '/api/export'], ['POST', '/api/import'], ['GET', '/api/analytics'], ['POST', '/api/ai/chat']]) {
    const r = await srv.api(m, u, { body: m === 'GET' ? undefined : {} });
    assert.equal(r.status, 401, `${m} ${u}`);
  }
  assert.equal((await srv.api('GET', '/api/me', { token: 'pas.un.jwt' })).status, 401);
});

test('mot de passe faible refusé, message explicite', async () => {
  const r = await srv.api('POST', '/api/auth/register', { body: { email: 'faible@example.test', password: 'password123', displayName: 'Faible', termsAccepted: true } });
  assert.equal(r.status, 400); assert.equal(r.json.code, 'WEAK_PASSWORD');
  const short = await srv.api('POST', '/api/auth/register', { body: { email: 'court@example.test', password: 'abc', displayName: 'Court', termsAccepted: true } });
  assert.equal(short.status, 400);
});

test('anti-énumération : inscrire une adresse existante ressemble à une inscription réussie', async () => {
  const dup = await srv.api('POST', '/api/auth/register', { body: { email: 'alice@example.test', password: 'Une-Autre-Phrase-77xz', displayName: 'Usurpateur', termsAccepted: true } });
  assert.equal(dup.status, 201);
  assert.equal(dup.json.verificationRequired, false);
  assert.equal(dup.json.verificationEmailSent, true);
  assert.equal(dup.json.developmentVerificationUrl, undefined, 'aucun lien ne doit fuiter pour un compte existant');
  // et le mot de passe d'Alice n'a pas été remplacé
  const ok = await srv.api('POST', '/api/auth/login', { body: { email: 'alice@example.test', password: alice.password, termsAccepted: true } });
  assert.equal(ok.status, 200);
});

test('vérification facultative : un compte non vérifié utilise l’application de base', async () => {
  const user = await createUnverifiedUser(srv, 'libre@example.test');
  assert.equal(user.register.verificationRequired, false);
  assert.equal(user.register.verificationEmailSent, false, 'sans SMTP, la création ne doit pas échouer');
  const me = await srv.api('GET', '/api/me', { token: user.token });
  assert.equal(me.status, 200);
  assert.equal(me.json.emailVerified, false);
  const put = await srv.api('PUT', '/api/sync', { token: user.token, body: { data: { projects: [{ id: 'base1', name: 'Projet de base' }], tasks: [], notes: [], knowledge: [], preferences: {} } } });
  assert.equal(put.status, 200);
  assert.ok(JSON.stringify((await srv.api('GET', '/api/sync', { token: user.token })).json).includes('Projet de base'));
  assert.equal((await srv.api('POST', '/api/focus/sessions', { token: user.token, body: { minutes: 25, label: 'Session test' } })).status, 201);
  const again = await srv.api('POST', '/api/auth/login', { body: { email: user.email, password: user.password, termsAccepted: true } });
  assert.equal(again.status, 200, 'la connexion ne doit plus exiger la vérification');
  assert.equal(again.json.user.emailVerified, false);
});

test('outils avancés : refusés sans e-mail vérifié, autorisés après vérification', async () => {
  const user = await createUnverifiedUser(srv, 'outils@example.test');
  for (const [m, u] of [['GET', '/api/ai/status'], ['GET', '/api/ai/models'], ['POST', '/api/ai/chat'], ['GET', '/nova-engine/api/status']]) {
    const r = await srv.api(m, u, { token: user.token, body: m === 'GET' ? undefined : { messages: [{ role: 'user', content: 'Bonjour' }] } });
    assert.equal(r.status, 403, `${m} ${u}`);
    assert.equal(r.json.code, 'EMAIL_NOT_VERIFIED', `${m} ${u}`);
  }
  const ver = await srv.api('POST', '/api/auth/verify-email', { body: { token: user.verificationToken } });
  assert.equal(ver.status, 200);
  const me = await srv.api('GET', '/api/me', { token: user.token });
  assert.equal(me.status, 200);
  assert.equal(me.json.emailVerified, true, 'le jeton existant voit la vérification sans reconnexion');
  assert.equal((await srv.api('GET', '/api/ai/status', { token: user.token })).status, 200);
  assert.equal((await srv.api('GET', '/api/ai/models', { token: user.token })).status, 200);
  const engine = await srv.api('GET', '/nova-engine/api/status', { token: user.token });
  assert.notEqual(engine.status, 403, 'Nova Engine ne doit plus refuser un compte vérifié');
});

test('connexion : message identique pour compte inconnu / mauvais mot de passe', async () => {
  const a = await srv.api('POST', '/api/auth/login', { body: { email: 'fantome@example.test', password: 'Quelconque-12345', termsAccepted: true } });
  const b = await srv.api('POST', '/api/auth/login', { body: { email: 'bob@example.test', password: 'Mauvais-mdp-12345', termsAccepted: true } });
  assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.json.error, b.json.error);
});

test('limitation de débit : la connexion est verrouillée après 8 échecs sur un compte', async () => {
  const statuses = [];
  for (let i = 0; i < 10; i++) statuses.push((await srv.api('POST', '/api/auth/login', { body: { email: 'victime@example.test', password: `Mauvais-${i}-mdp-xx`, termsAccepted: true } })).status);
  assert.ok(statuses.slice(0, 8).every(s => s === 401), statuses.join(','));
  assert.equal(statuses[8], 429); assert.equal(statuses[9], 429);
  const blocked = await srv.api('POST', '/api/auth/login', { body: { email: 'victime@example.test', password: 'x'.repeat(12), termsAccepted: true } });
  assert.equal(blocked.json.code, 'RATE_LIMITED'); assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
});

test('isolation entre comptes : espace, export, extensions', async () => {
  const secret = `SECRET-ALICE-${Date.now()}`;
  const put = await srv.api('PUT', '/api/sync', { token: alice.token, body: { data: { projects: [{ id: 'p1', name: secret }], tasks: [], notes: [], knowledge: [], preferences: { theme: 'dark' } } } });
  assert.equal(put.status, 200);
  const bobSync = await srv.api('GET', '/api/sync', { token: bob.token });
  assert.ok(!JSON.stringify(bobSync.json).includes(secret), 'Bob ne doit jamais voir les données d\'Alice');
  const bobExport = await srv.api('GET', '/api/export', { token: bob.token });
  assert.ok(!JSON.stringify(bobExport.json).includes(secret));
  const bobSearch = await srv.api('GET', `/api/search?q=${encodeURIComponent('SECRET-ALICE')}`, { token: bob.token });
  assert.equal(bobSearch.json.count, 0);
  const aliceSearch = await srv.api('GET', `/api/search?q=${encodeURIComponent('SECRET-ALICE')}`, { token: alice.token });
  assert.equal(aliceSearch.json.count, 1);
  // Extensions : l'activation d'Alice ne doit pas modifier celle de Bob
  const before = (await srv.api('GET', '/api/plugins', { token: bob.token })).json.plugins.find(p => p.id === 'nova-focus').enabled;
  const patch = await srv.api('PATCH', '/api/plugins/nova-focus', { token: alice.token, body: { enabled: !before } });
  assert.equal(patch.status, 200);
  assert.equal((await srv.api('GET', '/api/plugins', { token: alice.token })).json.plugins.find(p => p.id === 'nova-focus').enabled, !before);
  assert.equal((await srv.api('GET', '/api/plugins', { token: bob.token })).json.plugins.find(p => p.id === 'nova-focus').enabled, before);
  const analyticsBob = await srv.api('GET', '/api/analytics', { token: bob.token });
  assert.ok(!JSON.stringify(analyticsBob.json).includes('plugin.'), 'les événements d\'Alice ne sont pas visibles par Bob');
});

test('révocation : « déconnecter tous les appareils » invalide les anciens jetons', async () => {
  const carol = await createVerifiedUser(srv, 'carol@example.test');
  assert.equal((await srv.api('GET', '/api/me', { token: carol.token })).status, 200);
  assert.equal((await srv.api('POST', '/api/auth/logout-all', { token: carol.token })).status, 200);
  const after = await srv.api('GET', '/api/me', { token: carol.token });
  assert.equal(after.status, 401); assert.equal(after.json.code, 'SESSION_REVOKED');
  const relog = await srv.api('POST', '/api/auth/login', { body: { email: carol.email, password: carol.password, termsAccepted: true } });
  assert.equal(relog.status, 200);
  assert.equal((await srv.api('GET', '/api/me', { token: relog.json.token })).status, 200);
});

test('export puis import : aller-retour complet, avec sauvegarde préalable', async () => {
  const marker = `ROUNDTRIP-${Date.now()}`;
  await srv.api('PUT', '/api/sync', { token: bob.token, body: { data: { projects: [{ id: 'b1', name: marker }], tasks: [], notes: [], knowledge: [], preferences: {} } } });
  const exported = await srv.api('GET', '/api/export', { token: bob.token });
  assert.equal(exported.status, 200); assert.equal(exported.json.format, 'novacore-export');
  await srv.api('PUT', '/api/sync', { token: bob.token, body: { data: { projects: [], tasks: [], notes: [], knowledge: [], preferences: {} } } });
  const restored = await srv.api('POST', '/api/import', { token: bob.token, body: exported.json });
  assert.equal(restored.status, 200);
  assert.ok(JSON.stringify((await srv.api('GET', '/api/sync', { token: bob.token })).json).includes(marker));
  assert.ok(fs.readdirSync(path.join(srv.dir, 'backups')).some(n => n.includes('pre-import')), 'une sauvegarde pre-import doit exister');
  assert.equal((await srv.api('POST', '/api/import', { token: bob.token, body: { format: 'autre' } })).status, 400);
});

test('erreurs : JSON malformé et charge trop grande renvoient des messages propres', async () => {
  const bad = await srv.api('PUT', '/api/sync', { token: alice.token, body: '{"data": {' });
  assert.equal(bad.status, 400); assert.equal(bad.json.code, 'BAD_JSON');
  assert.ok(!JSON.stringify(bad.json).includes('at '), 'aucune trace de pile');
  const huge = await srv.api('PUT', '/api/sync', { token: alice.token, body: { data: { blob: 'x'.repeat(800_000) } } });
  assert.equal(huge.status, 413);
});

test('sondes de disponibilité', async () => {
  const ready = await srv.api('GET', '/api/ready');
  assert.equal(ready.status, 200); assert.equal(ready.json.ready, true);
  assert.equal(ready.json.storage.engine, 'sqlite');
  assert.equal(ready.json.storage.schemaVersion, 1);
  assert.equal(ready.json.storage.journalMode, 'wal');
});

test('données corrompues : mise en quarantaine puis restauration automatique depuis la sauvegarde', async () => {
  const s1 = await startServer();
  const dave = await createVerifiedUser(s1, 'dave@example.test');
  await s1.api('PUT', '/api/sync', { token: dave.token, body: { data: { projects: [{ id: 'd1', name: 'Projet-Dave' }], tasks: [], notes: [], knowledge: [], preferences: {} } } });
  await s1.stop(); // l'arrêt gracieux crée une sauvegarde « shutdown »
  const dataFile = path.join(s1.dir, 'novacore.sqlite');
  assert.ok(fs.existsSync(dataFile), 'la base SQLite doit exister');
  assert.ok(fs.readdirSync(path.join(s1.dir, 'backups')).length >= 1, 'sauvegarde présente');
  for (const suffix of ['-wal', '-shm']) { try { fs.unlinkSync(dataFile + suffix); } catch { /* absent */ } }
  fs.writeFileSync(dataFile, '{"users": [ CORROMPU ', 'utf8'); // simule une coupure pendant l'écriture
  const s2 = await startServer({ dataDir: s1.dir });
  try {
    const relog = await s2.api('POST', '/api/auth/login', { body: { email: dave.email, password: dave.password, termsAccepted: true } });
    assert.equal(relog.status, 200, 'le compte doit être restauré');
    assert.ok(JSON.stringify((await s2.api('GET', '/api/sync', { token: relog.json.token })).json).includes('Projet-Dave'));
    assert.ok(fs.readdirSync(s1.dir).some(n => n.includes('.corrupt-')), 'le fichier corrompu est conservé pour analyse');
    const ready = (await s2.api('GET', '/api/ready')).json;
    assert.equal(ready.storage.engine, 'sqlite');
    assert.equal(ready.recovery.restoredFrom !== null, true);
  } finally { await s2.stop(); }
});

test('proxy Nova Engine transmet le corps JSON au Workbench', async () => {
  const scene = { schemaVersion: 2, name: 'Proxy Test', updatedAt: null, entities: [] };
  let response;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    response = await fetch(`${srv.base}/nova-engine/api/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.token}` },
      body: JSON.stringify(scene),
      signal: AbortSignal.timeout(8000)
    });
    if (response.status !== 503) break;
    await sleep(150);
  }
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.name, 'Proxy Test');
});

test('production : démarrage refusé avec un JWT_SECRET faible ou factice', () => {
  for (const secret of ['', 'court', 'replace-with-a-long-random-secret-at-least-32-characters']) {
    const r = spawnSync(process.execPath, ['-e', "require('./server/security').ensureConfig()"], { cwd: ROOT, env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: secret }, encoding: 'utf8' });
    assert.notEqual(r.status, 0, `secret « ${secret} » doit être refusé`);
    assert.match(r.stderr, /JWT_SECRET/);
  }
  const ok = spawnSync(process.execPath, ['-e', "require('./server/security').ensureConfig()"], { cwd: ROOT, env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: require('./helpers').STRONG_SECRET }, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
});

test('production : routes développeur masquées, inscription sans SMTP possible, diagnostics protégés', async () => {
  const prod = await startServer({ env: { NODE_ENV: 'production' } });
  try {
    assert.equal((await prod.api('POST', '/api/developer/activate', { body: { code: 'NOVA-DEV-6300-ORBIT-7Q4M' } })).status, 404);
    assert.equal((await prod.api('GET', '/api/developer/smtp')).status, 404);
    const reg = await prod.api('POST', '/api/auth/register', { body: { email: 'prod@example.test', password: 'Orbite-Lumineuse-4821', displayName: 'Prod', termsAccepted: true } });
    assert.equal(reg.status, 201, 'la vérification facultative ne doit pas bloquer les inscriptions sans SMTP');
    assert.equal(reg.json.developmentVerificationUrl, undefined);
    assert.equal(reg.json.verificationEmailSent, false);
    const login = await prod.api('POST', '/api/auth/login', { body: { email: 'prod@example.test', password: 'Orbite-Lumineuse-4821', termsAccepted: true } });
    assert.equal(login.status, 200);
    assert.equal(login.json.user.emailVerified, false);
    assert.equal((await prod.api('GET', '/api/ai/status', { token: login.json.token })).status, 403, 'outil avancé bloqué sans vérification');
    assert.equal((await prod.api('GET', '/api/diagnostics')).status, 401);
    assert.equal((await prod.api('GET', '/api/health')).status, 200);
  } finally { await prod.stop(); }
});
