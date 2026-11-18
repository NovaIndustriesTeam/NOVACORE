// Tests du stockage SQLite transactionnel : import JSON unique, schéma versionné,
// absence d'import partiel et démarrage propre sans fichier historique.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers');

const STARTER_PLUGINS = [
  { id: 'nova-notes', name: 'Nova Notes', description: 'Quick notes extension example.', version: '1.0.0', permissions: '["notes:read","notes:write"]', enabled: 1 },
  { id: 'nova-focus', name: 'Nova Focus', description: 'Focus timer extension example.', version: '1.0.0', permissions: '["timer:use"]', enabled: 0 },
  { id: 'nova-export', name: 'Nova Export', description: 'Export your workspace data.', version: '1.0.0', permissions: '["workspace:read","files:export"]', enabled: 0 }
];

function legacyFixture({ id, email, password, projectName, duplicate = false }) {
  const stamp = new Date().toISOString();
  const user = {
    id, email, password_hash: bcrypt.hashSync(password, 4), display_name: 'Compte historique',
    created_at: stamp, email_verified: true, email_verification_token_hash: null,
    email_verification_expires_at: null, terms_accepted_at: stamp, terms_version: '1.0', token_version: 0,
    plugin_prefs: { 'nova-focus': true }
  };
  return {
    users: duplicate ? [user, { ...user }] : [user],
    user_data: [{ user_id: id, payload: JSON.stringify({ projects: [{ id: 'p1', name: projectName }], tasks: [], notes: [], knowledge: [], preferences: { theme: 'dark' } }), updated_at: stamp }],
    plugins: STARTER_PLUGINS.map(p => ({ ...p })),
    events: [
      { id: 1, user_id: id, event_type: 'account.created', metadata: '{}', created_at: stamp },
      { id: 2, user_id: id, event_type: 'sync.saved', metadata: '{"bytes":42}', created_at: stamp }
    ],
    nextEventId: 3
  };
}

test('migration JSON → SQLite : comptes, espace, événements et extensions conservés', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-sqlite-migration-'));
  const email = 'heritage@example.test';
  const password = 'Orbite-Lumineuse-4821';
  const fixture = legacyFixture({ id: 'legacy-user-1', email, password, projectName: 'Projet-Hérité' });
  const jsonPath = path.join(dir, 'novacore.json');
  fs.writeFileSync(jsonPath, JSON.stringify(fixture, null, 2), 'utf8');

  const srv = await startServer({ dataDir: dir });
  try {
    const ready = (await srv.api('GET', '/api/ready')).json;
    assert.equal(ready.ready, true);
    assert.equal(ready.storage.engine, 'sqlite');
    assert.equal(ready.migration.source, 'novacore.json');
    assert.equal(ready.migration.users, 1);
    assert.equal(ready.migration.user_data, 1);
    assert.equal(ready.migration.events, 2);
    assert.equal(ready.migration.plugins, 3);
    assert.equal(ready.storage.users, 1);
    assert.equal(ready.storage.workspaces, 1);
    assert.equal(ready.storage.events, 2);

    const login = await srv.api('POST', '/api/auth/login', { body: { email, password, termsAccepted: true } });
    assert.equal(login.status, 200, JSON.stringify(login.json));
    assert.equal(login.json.user.id, 'legacy-user-1');
    assert.equal(login.json.user.emailVerified, true);

    const sync = await srv.api('GET', '/api/sync', { token: login.json.token });
    assert.ok(JSON.stringify(sync.json).includes('Projet-Hérité'), 'l’espace de travail doit être conservé');

    const plugins = (await srv.api('GET', '/api/plugins', { token: login.json.token })).json.plugins;
    assert.equal(plugins.find(p => p.id === 'nova-focus').enabled, true, 'les préférences de plugins sont conservées');

    const analytics = (await srv.api('GET', '/api/analytics', { token: login.json.token })).json;
    assert.ok(Array.isArray(analytics.recent) && analytics.recent.length >= 2, 'les événements sont conservés');

    assert.ok(fs.existsSync(path.join(dir, 'novacore.sqlite')), 'base SQLite créée');
    const archived = fs.readdirSync(dir).filter(n => n.startsWith('novacore.json.migrated-'));
    assert.equal(archived.length, 1, 'le JSON source est archivé, pas supprimé');
    const archivedState = JSON.parse(fs.readFileSync(path.join(dir, archived[0]), 'utf8'));
    assert.equal(archivedState.users.length, 1, 'l’archive contient toujours le compte d’origine');
    assert.equal(fs.existsSync(jsonPath), false, 'le JSON actif est renommé pour éviter une double importation');
  } finally { await srv.stop(); }

  // Redémarrage : aucune double importation, les données restent disponibles.
  const again = await startServer({ dataDir: dir });
  try {
    const ready = (await again.api('GET', '/api/ready')).json;
    assert.equal(ready.storage.users, 1);
    assert.equal(ready.migration.source, 'novacore.json');
    const login = await again.api('POST', '/api/auth/login', { body: { email, password, termsAccepted: true } });
    assert.equal(login.status, 200);
    assert.ok(JSON.stringify((await again.api('GET', '/api/sync', { token: login.json.token })).json).includes('Projet-Hérité'));
  } finally { await again.stop(); }
});

test('import partiel impossible : une source invalide est ignorée et le fichier est conservé', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-sqlite-invalid-'));
  const fixture = legacyFixture({ id: 'legacy-user-2', email: 'doublon@example.test', password: 'Orbite-Lumineuse-4821', projectName: 'Jamais-Importé', duplicate: true });
  const jsonPath = path.join(dir, 'novacore.json');
  fs.writeFileSync(jsonPath, JSON.stringify(fixture, null, 2), 'utf8');

  const srv = await startServer({ dataDir: dir });
  try {
    const ready = (await srv.api('GET', '/api/ready')).json;
    assert.equal(ready.ready, true);
    assert.equal(ready.storage.users, 0, 'aucun compte ne doit être importé partiellement');
    assert.equal(ready.storage.workspaces, 0);
    assert.equal(ready.migration, null);
    assert.ok(fs.existsSync(jsonPath), 'la source invalide reste intacte pour analyse');
    assert.equal(fs.readdirSync(dir).some(n => n.startsWith('novacore.json.migrated-')), false);
  } finally { await srv.stop(); }
});

test('installation neuve : schéma SQLite versionné, extensions de démarrage, écriture immédiate', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-sqlite-fresh-'));
  const srv = await startServer({ dataDir: dir });
  try {
    const ready = (await srv.api('GET', '/api/ready')).json;
    assert.equal(ready.storage.engine, 'sqlite');
    assert.equal(ready.storage.schemaVersion, 1);
    assert.equal(ready.storage.users, 0);
    assert.equal(ready.storage.plugins, 3);
    assert.equal(ready.migration, null);

    const reg = await srv.api('POST', '/api/auth/register', { body: { email: 'neuf@example.test', password: 'Orbite-Lumineuse-4821', displayName: 'Neuf', termsAccepted: true } });
    assert.equal(reg.status, 201, JSON.stringify(reg.json));
    const login = await srv.api('POST', '/api/auth/login', { body: { email: 'neuf@example.test', password: 'Orbite-Lumineuse-4821', termsAccepted: true } });
    assert.equal(login.status, 200);
    const saved = await srv.api('PUT', '/api/sync', { token: login.json.token, body: { data: { projects: [{ id: 'a', name: 'Premier-Projet' }], tasks: [], notes: [], knowledge: [], preferences: {} } } });
    assert.equal(saved.status, 200);
    assert.ok(JSON.stringify((await srv.api('GET', '/api/sync', { token: login.json.token })).json).includes('Premier-Projet'));
    assert.equal((await srv.api('GET', '/api/ready')).json.storage.users, 1);
  } finally { await srv.stop(); }
});
