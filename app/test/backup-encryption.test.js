// Tests du lot 18 (P0 données) : sauvegardes chiffrées AES-256-GCM, clé locale,
// restauration après corruption, refus d'une mauvaise clé et rétention (nombre/âge).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const backupCrypto = require('../server/backup-crypto');
const { startServer, createVerifiedUser } = require('./helpers');

const hexKey = () => crypto.randomBytes(32).toString('hex');
const backupsOf = dir => { try { return fs.readdirSync(path.join(dir, 'backups')); } catch { return []; } };
const keyFromDir = dir => fs.readFileSync(path.join(dir, 'backup-key'), 'utf8').trim();

test('backup-crypto : AES-256-GCM authentifié, altération et mauvaise clé refusées', () => {
  const key = crypto.randomBytes(32);
  const sealed = backupCrypto.encrypt('{"users":[{"email":"a@b.test"}]}', key);
  assert.equal(sealed.subarray(0, 5).toString('ascii'), 'NCBK1', 'en-tête magique attendu');
  assert.equal(backupCrypto.decrypt(sealed, key), '{"users":[{"email":"a@b.test"}]}');

  const tampered = Buffer.from(sealed); tampered[tampered.length - 1] ^= 0xff;
  assert.throws(() => backupCrypto.decrypt(tampered, key), /authenticate|Unsupported state/i, 'toute altération doit être détectée');
  assert.throws(() => backupCrypto.decrypt(sealed, crypto.randomBytes(32)), /authenticate|Unsupported state/i, 'une autre clé ne doit rien déchiffrer');
  assert.throws(() => backupCrypto.decrypt(Buffer.from('NCBK2'), key), /tronquée/i);

  assert.equal(backupCrypto.decodeKey('z'.repeat(32)), null);
  assert.throws(
    () => backupCrypto.resolveKey({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-key-bad-')), env: { NOVACORE_BACKUP_KEY: 'pas-une-cle' } }),
    error => error.code === 'BACKUP_KEY_ENV_INVALID',
    'une clé déclarée mais invalide ne doit jamais retomber silencieusement sur une clé locale'
  );
});

test('clé locale invalide : contenu conservé, aucune clé de remplacement générée', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-key-invalid-file-'));
  const file = path.join(dir, 'backup-key');
  const original = 'ANCIENNE-CLE-ILLISIBLE-MAIS-PRECIEUSE\n';
  fs.writeFileSync(file, original, { encoding: 'utf8', mode: 0o600 });
  assert.throws(
    () => backupCrypto.resolveKey({ dataDir: dir, env: {} }),
    error => error.code === 'BACKUP_KEY_FILE_INVALID',
    'un fichier de clé présent mais invalide doit bloquer, jamais être écrasé'
  );
  assert.equal(fs.readFileSync(file, 'utf8'), original, 'le contenu de la clé existante est intact');
});

test('sauvegarde chiffrée : aucun e-mail ni hash en clair, déchiffrable avec la clé', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-backup-enc-'));
  const key = hexKey();
  const email = 'chiffre@example.test';
  const srv = await startServer({ dataDir: dir, env: { NOVACORE_BACKUP_KEY: key } });
  try {
    const user = await createVerifiedUser(srv, email);

    const ready = (await srv.api('GET', '/api/ready')).json;
    assert.equal(ready.ready, true);
    assert.equal(ready.backup.enabled, true);
    assert.equal(ready.backup.algorithm, 'aes-256-gcm');
    assert.equal(ready.backup.keySource, 'environment');
    assert.equal(ready.backup.keyFilePresent, false, 'une clé fournie par l’environnement ne crée aucun fichier local');
    assert.ok(ready.backup.encryptedCount >= 1, 'au moins une sauvegarde chiffrée doit exister');
    assert.equal(ready.backup.plaintextCount, 0, 'aucune sauvegarde en clair ne doit être écrite');
    assert.deepEqual(ready.backup.unreadable, []);
    assert.equal(ready.storage.encryptedBackups, ready.storage.backups);

    const files = backupsOf(dir).filter(name => name.endsWith('.json.enc'));
    assert.ok(files.length >= 1);
    for (const name of files) {
      const buffer = fs.readFileSync(path.join(dir, 'backups', name));
      assert.equal(buffer.subarray(0, 5).toString('ascii'), 'NCBK1', `${name} doit porter l’en-tête NCBK1`);
      assert.equal(buffer.includes(Buffer.from(email)), false, `${name} ne doit pas contenir l’e-mail en clair`);
      assert.equal(buffer.includes(Buffer.from(user.password)), false, `${name} ne doit pas contenir le mot de passe en clair`);
      assert.equal(buffer.includes(Buffer.from('password_hash')), false, `${name} ne doit pas exposer le schéma utilisateur en clair`);
    }

    const newest = files.map(name => ({ name, mtime: fs.statSync(path.join(dir, 'backups', name)).mtimeMs })).sort((a, b) => b.mtime - a.mtime)[0];
    const decrypted = JSON.parse(backupCrypto.decrypt(fs.readFileSync(path.join(dir, 'backups', newest.name)), Buffer.from(key, 'hex')));
    assert.equal(decrypted.users.find(u => u.email === email)?.id, user.id, 'la sauvegarde reste déchiffrable avec la clé déclarée');
  } finally { await srv.stop(); }
});

test('clé locale : créée dans le dossier de données (0600), sauvegardes chiffrées par défaut', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-backup-keyfile-'));
  const srv = await startServer({ dataDir: dir });
  try {
    await createVerifiedUser(srv, 'cle-locale@example.test');
    const ready = (await srv.api('GET', '/api/ready')).json;
    assert.equal(ready.backup.enabled, true);
    assert.equal(ready.backup.keySource, 'created');
    assert.equal(ready.backup.keyFilePresent, true);

    const keyFile = path.join(dir, 'backup-key');
    assert.ok(fs.existsSync(keyFile), 'le fichier de clé doit exister hors du dossier backups');
    assert.match(keyFromDir(dir), /^[a-f0-9]{64}$/i, 'la clé locale doit faire 32 octets (64 hexadécimaux)');
    if (process.platform !== 'win32') assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600, 'la clé doit être lisible par le seul propriétaire');

    assert.ok(backupsOf(dir).filter(name => name.endsWith('.json.enc')).length >= 1);
    assert.equal(backupsOf(dir).filter(name => name.endsWith('.json')).length, 0, 'aucune sauvegarde en clair');
  } finally { await srv.stop(); }
});

test('restauration : base corrompue reconstruite depuis une sauvegarde chiffrée', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-backup-restore-'));
  const key = hexKey();
  const email = 'restaure@example.test';
  const password = 'Orbite-Lumineuse-4821';

  const first = await startServer({ dataDir: dir, env: { NOVACORE_BACKUP_KEY: key } });
  try {
    const user = await createVerifiedUser(first, email, password);
    const saved = await first.api('PUT', '/api/sync', { token: user.token, body: { data: { projects: [{ id: 'p1', name: 'Projet-Chiffré' }], tasks: [], notes: [], knowledge: [], preferences: {} } } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
  } finally { await first.stop(); }

  const encrypted = backupsOf(dir).filter(name => name.endsWith('.json.enc'));
  assert.ok(encrypted.length >= 1, 'une sauvegarde chiffrée doit subsister avant corruption');

  // Corruption franche : en-tête SQLite détruit, journaux WAL retirés.
  fs.writeFileSync(path.join(dir, 'novacore.sqlite'), 'ceci n’est pas une base SQLite', 'utf8');
  for (const suffix of ['-wal', '-shm']) { try { fs.unlinkSync(path.join(dir, 'novacore.sqlite') + suffix); } catch { /* absent */ } }

  const second = await startServer({ dataDir: dir, env: { NOVACORE_BACKUP_KEY: key } });
  try {
    const ready = (await second.api('GET', '/api/ready')).json;
    assert.equal(ready.ready, true);
    assert.equal(ready.migration?.corrupted, true, 'la restauration doit être signalée comme telle');
    assert.match(String(ready.recovery?.restoredFrom), /\.json\.enc$/, 'la source restaurée doit être la sauvegarde chiffrée');
    assert.equal(ready.storage.users, 1);
    assert.ok(fs.existsSync(path.join(dir, ready.recovery.quarantined)), 'la base corrompue doit être conservée pour analyse');

    const login = await second.api('POST', '/api/auth/login', { body: { email, password, termsAccepted: true } });
    assert.equal(login.status, 200, JSON.stringify(login.json));
    const sync = await second.api('GET', '/api/sync', { token: login.json.token });
    assert.ok(JSON.stringify(sync.json).includes('Projet-Chiffré'), 'l’espace de travail doit être restauré');

    const archives = fs.readdirSync(dir).filter(name => name.startsWith('novacore.restored-'));
    assert.equal(archives.length, 1);
    assert.match(archives[0], /\.json\.enc$/, 'la copie d’archive conserve l’extension chiffrée');
    assert.equal(fs.readFileSync(path.join(dir, archives[0])).subarray(0, 5).toString('ascii'), 'NCBK1');
  } finally { await second.stop(); }
});

test('mauvaise clé : la base reste intacte et les sauvegardes illisibles ne sont jamais supprimées', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-backup-wrongkey-'));
  const dayKey = hexKey();
  const otherKey = hexKey();

  const first = await startServer({ dataDir: dir, env: { NOVACORE_BACKUP_KEY: dayKey } });
  try { await createVerifiedUser(first, 'origine@example.test'); } finally { await first.stop(); }

  const original = backupsOf(dir).filter(name => name.endsWith('.json.enc'));
  assert.ok(original.length >= 1);

  // Plafond volontairement très bas : la rotation tenterait de supprimer les anciennes.
  const second = await startServer({ dataDir: dir, env: { NOVACORE_BACKUP_KEY: otherKey, NOVACORE_BACKUP_KEEP: '1' } });
  try {
    const ready = (await second.api('GET', '/api/ready')).json;
    assert.equal(ready.ready, true);
    assert.equal(ready.storage.users, 1, 'la base SQLite n’est pas concernée par la clé de sauvegarde');
    assert.equal(ready.backup.keySource, 'environment');
    assert.ok(ready.backup.unreadable.length >= original.length, 'les sauvegardes de l’autre clé doivent être signalées illisibles');

    const login = await second.api('POST', '/api/auth/login', { body: { email: 'origine@example.test', password: 'Orbite-Lumineuse-4821', termsAccepted: true } });
    assert.equal(login.status, 200);

    for (const index of [1, 2, 3]) await createVerifiedUser(second, `nouveau-${index}@example.test`);
    const names = backupsOf(dir);
    for (const name of original) assert.ok(names.includes(name), `${name} doit être conservée malgré la rotation`);
  } finally { await second.stop(); }
});

test('clé locale invalide : contenu conservé, serveur sans sauvegarde en clair', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-backup-badkeyfile-'));
  const file = path.join(dir, 'backup-key');
  const original = 'CLE-LOCALE-ILLISIBLE-A-NE-PAS-ECRASER\n';
  fs.writeFileSync(file, original, { encoding: 'utf8', mode: 0o600 });

  const srv = await startServer({ dataDir: dir, env: { NOVACORE_BACKUP_KEY: '' } });
  try {
    const ready = (await srv.api('GET', '/api/ready')).json;
    assert.equal(ready.ready, true, 'le serveur démarre : seule la sauvegarde est bloquée');
    assert.equal(ready.backup.enabled, false);
    assert.equal(ready.backup.keyError, 'BACKUP_KEY_FILE_INVALID');

    await createVerifiedUser(srv, 'cle-invalide-locale@example.test');
    assert.deepEqual(backupsOf(dir), [], 'aucune sauvegarde en clair ne doit être écrite');
    assert.equal(fs.readFileSync(file, 'utf8'), original, 'la clé existante n’est jamais remplacée');
  } finally { await srv.stop(); }
});

test('rotation : après un passage en mauvaise clé, revenir à la bonne clé conserve une sauvegarde lisible', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-backup-returnkey-'));
  const keyA = hexKey();
  const keyB = hexKey();
  const envA = { NOVACORE_BACKUP_KEY: keyA, NOVACORE_BACKUP_KEEP: '50', NOVACORE_BACKUP_MAX_AGE_DAYS: '0' };
  const envB = { NOVACORE_BACKUP_KEY: keyB, NOVACORE_BACKUP_KEEP: '50', NOVACORE_BACKUP_MAX_AGE_DAYS: '0' };

  const first = await startServer({ dataDir: dir, env: envA });
  try {
    await createVerifiedUser(first, 'retour-a1@example.test');
    await createVerifiedUser(first, 'retour-a2@example.test');
  } finally { await first.stop(); }
  const filesA = backupsOf(dir).filter(name => name.endsWith('.json.enc'));
  assert.ok(filesA.length >= 3, 'plusieurs sauvegardes de la clé A');

  const second = await startServer({ dataDir: dir, env: envB });
  try {
    await createVerifiedUser(second, 'retour-b1@example.test');
    await createVerifiedUser(second, 'retour-b2@example.test');
  } finally { await second.stop(); }
  const filesB = backupsOf(dir).filter(name => name.endsWith('.json.enc') && !filesA.includes(name));
  assert.ok(filesB.length >= 2, 'des sauvegardes de la clé B existent');

  // Plafond de 1 : l'ancienne rotation comptait les fichiers B illisibles dans le quota
  // et supprimait toutes les sauvegardes A. Les illisibles ne doivent plus compter.
  const third = await startServer({ dataDir: dir, env: { NOVACORE_BACKUP_KEY: keyA, NOVACORE_BACKUP_KEEP: '1', NOVACORE_BACKUP_MAX_AGE_DAYS: '0' } });
  try {
    const readable = [];
    for (const name of backupsOf(dir).filter(entry => entry.endsWith('.json.enc'))) {
      try {
        const parsed = JSON.parse(backupCrypto.decrypt(fs.readFileSync(path.join(dir, 'backups', name)), Buffer.from(keyA, 'hex')));
        readable.push({ name, users: parsed.users.length });
      } catch { /* sauvegarde d'une autre clé */ }
    }
    assert.ok(readable.length >= 1, 'au moins une sauvegarde de la clé A doit survivre à la rotation');
    assert.ok(readable.some(entry => entry.users >= 1), 'la sauvegarde conservée contient les comptes');
    const ready = (await third.api('GET', '/api/ready')).json;
    assert.ok(ready.backup.unreadable.length >= 2, 'les sauvegardes de la clé B restent signalées illisibles');
    const names = backupsOf(dir);
    for (const name of filesB) assert.ok(names.includes(name), `${name} ne doit jamais être supprimée automatiquement`);
  } finally { await third.stop(); }
});

test('reprise de restauration : corruption + mauvaise clé, puis retour à la bonne clé', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-backup-pending-'));
  const keyA = hexKey();
  const keyB = hexKey();
  const email = 'differe@example.test';
  const password = 'Orbite-Lumineuse-4821';

  const first = await startServer({ dataDir: dir, env: { NOVACORE_BACKUP_KEY: keyA, NOVACORE_BACKUP_MAX_AGE_DAYS: '0' } });
  try {
    const user = await createVerifiedUser(first, email, password);
    const saved = await first.api('PUT', '/api/sync', { token: user.token, body: { data: { projects: [{ id: 'p1', name: 'Projet-Différé' }], tasks: [], notes: [], knowledge: [], preferences: {} } } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
  } finally { await first.stop(); }

  fs.writeFileSync(path.join(dir, 'novacore.sqlite'), 'ceci n’est pas une base SQLite', 'utf8');
  for (const suffix of ['-wal', '-shm']) { try { fs.unlinkSync(path.join(dir, 'novacore.sqlite') + suffix); } catch { /* absent */ } }

  const second = await startServer({ dataDir: dir, env: { NOVACORE_BACKUP_KEY: keyB, NOVACORE_BACKUP_KEEP: '50', NOVACORE_BACKUP_MAX_AGE_DAYS: '0' } });
  try {
    const ready = (await second.api('GET', '/api/ready')).json;
    assert.equal(ready.ready, true);
    assert.equal(ready.storage.users, 0, 'aucune source n’est lisible avec la mauvaise clé');
    assert.equal(ready.recovery?.pending, true, 'la restauration doit rester en attente');
  } finally { await second.stop(); }

  const third = await startServer({ dataDir: dir, env: { NOVACORE_BACKUP_KEY: keyA, NOVACORE_BACKUP_KEEP: '50', NOVACORE_BACKUP_MAX_AGE_DAYS: '0' } });
  try {
    const ready = (await third.api('GET', '/api/ready')).json;
    assert.equal(ready.storage.users, 1, 'la restauration différée doit s’exécuter au retour de la bonne clé');
    assert.equal(ready.recovery?.retried, true);
    assert.match(String(ready.recovery?.restoredFrom), /\.json\.enc$/);
    const login = await third.api('POST', '/api/auth/login', { body: { email, password, termsAccepted: true } });
    assert.equal(login.status, 200, JSON.stringify(login.json));
    const sync = await third.api('GET', '/api/sync', { token: login.json.token });
    assert.ok(JSON.stringify(sync.json).includes('Projet-Différé'), 'l’espace de travail doit être restauré');
  } finally { await third.stop(); }
});

test('rétention par nombre : NOVACORE_BACKUP_KEEP plafonne les sauvegardes chiffrées', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-backup-keep-'));
  const srv = await startServer({ dataDir: dir, env: { NOVACORE_BACKUP_KEEP: '3', NOVACORE_BACKUP_MAX_AGE_DAYS: '0' } });
  try {
    for (const index of [1, 2, 3, 4]) await createVerifiedUser(srv, `keep-${index}@example.test`);
    const ready = (await srv.api('GET', '/api/ready')).json;
    assert.equal(ready.backup.keep, 3);
    assert.equal(ready.backup.maxAgeDays, 0, '0 désactive la rétention par âge');
    assert.ok(ready.storage.backups >= 1 && ready.storage.backups <= 3, `sauvegardes restantes : ${ready.storage.backups}`);
    assert.ok(backupsOf(dir).every(name => name.endsWith('.json.enc')));
  } finally { await srv.stop(); }
});

test('rétention par âge : les sauvegardes plus vieilles que la limite sont retirées au démarrage', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-backup-age-'));
  const first = await startServer({ dataDir: dir });
  try { await createVerifiedUser(first, 'age@example.test'); } finally { await first.stop(); }

  const old = backupsOf(dir).filter(name => name.endsWith('.json.enc'));
  assert.ok(old.length >= 1);
  const tenDaysAgo = (Date.now() - 10 * 86_400_000) / 1000;
  for (const name of old) fs.utimesSync(path.join(dir, 'backups', name), tenDaysAgo, tenDaysAgo);

  const second = await startServer({ dataDir: dir, env: { NOVACORE_BACKUP_MAX_AGE_DAYS: '7', NOVACORE_BACKUP_KEEP: '50' } });
  try {
    const ready = (await second.api('GET', '/api/ready')).json;
    assert.equal(ready.backup.maxAgeDays, 7);
    assert.equal(ready.backup.total, 0, 'les sauvegardes de 10 jours doivent être retirées avec une limite de 7 jours');
    assert.equal(ready.storage.users, 1, 'la base SQLite reste intacte');

    await createVerifiedUser(second, 'age-2@example.test');
    const after = (await second.api('GET', '/api/ready')).json;
    assert.ok(after.backup.total >= 1, 'une nouvelle sauvegarde récente est conservée');
    assert.equal(after.backup.plaintextCount, 0);
  } finally { await second.stop(); }
});

test('rétrocompatibilité : une sauvegarde `.json` en clair reste restaurable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-backup-legacy-'));
  const email = 'heritage-backup@example.test';
  const password = 'Orbite-Lumineuse-4821';
  const stamp = new Date().toISOString();
  const name = 'novacore-2020-01-01T00-00-00-000Z-auto.json';
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'backups', name), JSON.stringify({
    users: [{
      id: 'legacy-backup-user', email, password_hash: bcrypt.hashSync(password, 4), display_name: 'Archive claire',
      created_at: stamp, email_verified: true, email_verification_token_hash: null, email_verification_expires_at: null,
      terms_accepted_at: stamp, terms_version: '1.0', token_version: 0, plugin_prefs: {}
    }],
    user_data: [{ user_id: 'legacy-backup-user', payload: JSON.stringify({ projects: [{ id: 'p1', name: 'Projet-Hérité-Clair' }], tasks: [], notes: [], knowledge: [], preferences: {} }), updated_at: stamp }],
    plugins: [], events: [], nextEventId: 1
  }, null, 2), 'utf8');

  const srv = await startServer({ dataDir: dir, env: { NOVACORE_BACKUP_MAX_AGE_DAYS: '0' } });
  try {
    const ready = (await srv.api('GET', '/api/ready')).json;
    assert.equal(ready.migration?.source, name, 'la sauvegarde en clair doit rester une source de restauration');
    assert.equal(ready.storage.users, 1);
    const login = await srv.api('POST', '/api/auth/login', { body: { email, password, termsAccepted: true } });
    assert.equal(login.status, 200, JSON.stringify(login.json));
    assert.ok(JSON.stringify((await srv.api('GET', '/api/sync', { token: login.json.token })).json).includes('Projet-Hérité-Clair'));
    assert.ok(fs.readdirSync(dir).some(entry => entry.startsWith('novacore.imported-') && entry.endsWith('.json')), 'une copie d’archive en clair est conservée');
  } finally { await srv.stop(); }
});

test('clé invalide : démarrage sans sauvegarde en clair, erreur exposée et compte créé', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novacore-backup-badkey-'));
  const srv = await startServer({ dataDir: dir, env: { NOVACORE_BACKUP_KEY: 'clé-trop-courte' } });
  try {
    const ready = (await srv.api('GET', '/api/ready')).json;
    assert.equal(ready.ready, true, 'un mauvais réglage de clé ne doit pas empêcher l’application de démarrer');
    assert.equal(ready.backup.enabled, false);
    assert.equal(ready.backup.keySource, null);
    assert.equal(ready.backup.keyError, 'BACKUP_KEY_ENV_INVALID', 'seul un code normalisé est exposé, jamais un chemin système');

    await createVerifiedUser(srv, 'sans-chiffrement@example.test');
    assert.deepEqual(backupsOf(dir), [], 'aucune donnée utilisateur ne doit être écrite en clair');
    assert.equal(fs.existsSync(path.join(dir, 'backup-key')), false, 'une clé explicite invalide ne doit pas générer de clé locale de secours');

    const again = (await srv.api('GET', '/api/ready')).json;
    assert.equal(again.storage.users, 1, 'l’écriture reste possible : seule la sauvegarde échoue explicitement');
    assert.equal(again.backup.lastError, 'BACKUP_WRITE_FAILED');
  } finally { await srv.stop(); }
});
