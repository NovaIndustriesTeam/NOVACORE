// NovaCore — moteur de stockage SQLite transactionnel.
// Utilise `node:sqlite`, intégré à Node.js (aucune compilation d'addon natif).
// Le fichier JSON historique est importé une seule fois, puis archivé (jamais supprimé).
// Les sauvegardes restent des instantanés JSON portables : elles servent à l'export,
// à la rotation et à la restauration automatique si la base est corrompue.
// Depuis le lot 18 (P0 données), elles sont chiffrées en AES-256-GCM (`.json.enc`) ;
// les anciens `.json` en clair restent lisibles pour la restauration.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const backupCrypto = require('./backup-crypto');

// Keep user data outside the extracted application folder so replacing/updating the app does not erase it.
// Override NOVACORE_DATA_DIR when deploying to a managed persistent volume.
const dataDir = process.env.NOVACORE_DATA_DIR || path.join(os.homedir(), '.novacore', 'data');
const dbFile = path.join(dataDir, 'novacore.sqlite');
const jsonFile = path.join(dataDir, 'novacore.json');
// One-time migration from the legacy in-project data location, without overwriting an existing database.
const legacyJsonFile = path.join(__dirname, '..', 'data', 'novacore.json');

fs.mkdirSync(dataDir, { recursive: true });
const backupDir = path.join(dataDir, 'backups');
fs.mkdirSync(backupDir, { recursive: true });

const SCHEMA_VERSION = 1;
function boundedNumber(raw, fallback, { allowZero = false } = {}) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  if (value === 0 && !allowZero) return fallback;
  return value;
}
const BACKUP_KEEP = Math.max(1, Math.floor(boundedNumber(process.env.NOVACORE_BACKUP_KEEP, 14)));
// 0 désactive la rétention par âge ; valeur décimale acceptée (utile pour les tests).
const BACKUP_MAX_AGE_DAYS = boundedNumber(process.env.NOVACORE_BACKUP_MAX_AGE_DAYS, 30, { allowZero: true });
let lastBackupAt = 0;
let lastBackupName = null;
let lastBackupError = null;
let lastBackupErrorCode = null;
let recoveryNotice = null;
let migrationNotice = null;

const starterPlugins = [
  { id: 'nova-notes', name: 'Nova Notes', description: 'Quick notes extension example.', version: '1.0.0', permissions: '["notes:read","notes:write"]', enabled: 1 },
  { id: 'nova-focus', name: 'Nova Focus', description: 'Focus timer extension example.', version: '1.0.0', permissions: '["timer:use"]', enabled: 0 },
  { id: 'nova-export', name: 'Nova Export', description: 'Export your workspace data.', version: '1.0.0', permissions: '["workspace:read","files:export"]', enabled: 0 }
];

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    email_verification_token_hash TEXT,
    email_verification_expires_at TEXT,
    email_verified_at TEXT,
    terms_accepted_at TEXT,
    terms_version TEXT,
    token_version INTEGER NOT NULL DEFAULT 0,
    plugin_prefs TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS user_data (
    user_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    version TEXT NOT NULL DEFAULT '1.0.0',
    permissions TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
`;

const now = () => new Date().toISOString();
const stampForFile = () => new Date().toISOString().replace(/[:.]/g, '-');

function normalizeState(parsed) {
  return {
    users: Array.isArray(parsed.users) ? parsed.users : [],
    user_data: Array.isArray(parsed.user_data) ? parsed.user_data : [],
    plugins: Array.isArray(parsed.plugins) ? parsed.plugins : starterPlugins.map(p => ({ ...p })),
    events: Array.isArray(parsed.events) ? parsed.events : [],
    nextEventId: Number.isInteger(parsed.nextEventId) ? parsed.nextEventId : 1
  };
}
function readJsonState(target) {
  const buffer = fs.readFileSync(target);
  if (!isEncryptedBackup(buffer)) return normalizeState(JSON.parse(buffer.toString('utf8')));
  const keyState = resolveBackupKey();
  if (!keyState) throw new Error(`sauvegarde chiffrée illisible : ${backupKeyError ? backupKeyError.message : 'clé de sauvegarde absente'}`);
  return normalizeState(JSON.parse(backupCrypto.decrypt(buffer, keyState.key)));
}

// ---------------------------------------------------------------------------
// Lot 18 — chiffrement AES-256-GCM et rétention des sauvegardes (P0 données).
// La clé vient de NOVACORE_BACKUP_KEY, sinon d'un fichier `backup-key` (0600) créé
// dans le dossier de données. Une clé illisible est une erreur bloquante pour la
// sauvegarde : on ne retombe jamais silencieusement sur des fichiers en clair.
// ---------------------------------------------------------------------------
let backupKeyState = null;
let backupKeyError = null;
// Un échec de résolution n'est pas définitif : une clé verrouillée une seule fois
// (antivirus, synchronisation) ne doit pas désactiver le chiffrement jusqu'au redémarrage.
// On limite seulement la fréquence des nouvelles tentatives pour ne pas marteler le disque.
const BACKUP_KEY_RETRY_MS = 5000;
let backupKeyNextRetryAt = 0;
// Cache de lisibilité : (nom, taille, mtime) → la rotation n'ouvre un fichier chiffré
// qu'une fois, et seulement lorsqu'il est candidat à la suppression. Borné pour éviter
// qu'une longue chaîne de sauvegardes ne fasse croître la mémoire indéfiniment.
const BACKUP_READABLE_CACHE_MAX = 64;
const backupReadableCache = new Map();

function backupKeyErrorCode() {
  if (backupKeyState) return null;
  return (backupKeyError && backupKeyError.code) || 'BACKUP_KEY_UNAVAILABLE';
}

function resolveBackupKey() {
  if (backupKeyState) return backupKeyState;
  const nowMs = Date.now();
  if (nowMs < backupKeyNextRetryAt) return null;
  try {
    backupKeyState = backupCrypto.resolveKey({ dataDir });
    backupKeyError = null;
    backupKeyNextRetryAt = 0;
    if (backupKeyState.source === 'created') console.log(`[NovaCore DB] Clé de sauvegarde créée : ${backupKeyState.file} (sauvegardes chiffrées AES-256-GCM).`);
    if (backupKeyState.source === 'regenerated') console.warn('[NovaCore DB] Clé de sauvegarde régénérée : les sauvegardes chiffrées antérieures restent illisibles et ne seront jamais supprimées automatiquement.');
  } catch (error) {
    backupKeyError = error;
    backupKeyState = null;
    backupKeyNextRetryAt = nowMs + BACKUP_KEY_RETRY_MS;
    console.warn('[NovaCore DB] Chiffrement des sauvegardes indisponible :', error.code || error.message);
  }
  return backupKeyState;
}

function isEncryptedBackup(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= backupCrypto.MAGIC.length && buffer.subarray(0, backupCrypto.MAGIC.length).equals(backupCrypto.MAGIC);
}

function openDatabase(target) {
  const database = new DatabaseSync(target);
  try {
    database.exec('PRAGMA journal_mode = WAL');
    database.exec('PRAGMA synchronous = FULL');
    database.exec('PRAGMA busy_timeout = 5000');
    database.exec('PRAGMA foreign_keys = ON');
    return database;
  } catch (error) {
    // Sous Windows, une connexion laissée ouverte verrouille le fichier et empêche
    // sa mise en quarantaine : on la ferme systématiquement avant de propager l'erreur.
    try { database.close(); } catch { /* déjà fermée */ }
    throw error;
  }
}
function ensureSchema(database) {
  database.exec(SCHEMA_SQL);
  const current = Number(database.prepare('PRAGMA user_version').get().user_version || 0);
  if (current !== SCHEMA_VERSION) database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  const row = database.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (!row) database.prepare("INSERT INTO meta (key,value) VALUES ('schema_version',?)").run(String(SCHEMA_VERSION));
  else if (row.value !== String(SCHEMA_VERSION)) database.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(SCHEMA_VERSION));
}
function integrityOk(database) {
  const check = database.prepare('PRAGMA integrity_check').get();
  return Boolean(check) && check.integrity_check === 'ok';
}
function setMeta(database, key, value) {
  database.prepare("INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, typeof value === 'string' ? value : JSON.stringify(value));
}
function getMeta(database, key) {
  const row = database.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}
function deleteMeta(database, key) {
  database.prepare('DELETE FROM meta WHERE key = ?').run(key);
}
// Un incident de restauration doit survivre au redémarrage : sans cela, /api/ready
// répondrait « prêt » sur une base vide sans aucune trace du problème.
function persistRecoveryNotice(database) {
  if (!recoveryNotice) return;
  try { setMeta(database, 'recovery_notice', recoveryNotice); } catch { /* meta indisponible : l'avis reste en mémoire */ }
}

function backupEntries() {
  let names = [];
  try { names = fs.readdirSync(backupDir).filter(n => /^novacore-.*\.json(\.enc)?$/.test(n)); } catch { return []; }
  return names.map(name => {
    const file = path.join(backupDir, name);
    let stat = null;
    try { stat = fs.statSync(file); } catch { /* fichier disparu entre-temps */ }
    return { name, file, encrypted: name.endsWith('.json.enc'), size: stat ? stat.size : 0, mtimeMs: stat ? stat.mtimeMs : 0 };
  }).sort((a, b) => (b.mtimeMs - a.mtimeMs) || b.name.localeCompare(a.name));
}
function listBackups() { return backupEntries().map(entry => entry.name); }
// Une sauvegarde valide mais vide ne doit jamais masquer un compte réel : on essaie
// d'abord les fichiers qui contiennent des utilisateurs, puis les autres.
// Un fichier chiffré que la clé courante n'ouvre pas est classé « autre » : il sera
// simplement signalé inutilisable, jamais supprimé.
function restoreCandidates() {
  const containingUsers = [], others = [];
  for (const name of listBackups()) {
    try {
      const parsed = readJsonState(path.join(backupDir, name));
      if (parsed.users.length) containingUsers.push(name); else others.push(name);
    } catch { others.push(name); }
  }
  return [...containingUsers, ...others];
}

function transaction(database, fn) {
  database.exec('BEGIN IMMEDIATE');
  try { const result = fn(); database.exec('COMMIT'); return result; }
  catch (error) { try { database.exec('ROLLBACK'); } catch { /* déjà annulée */ } throw error; }
}

function importStateInto(database, parsed) {
  const state = normalizeState(parsed);
  transaction(database, () => {
    const insertUser = database.prepare(`INSERT INTO users
      (id,email,password_hash,display_name,created_at,email_verified,email_verification_token_hash,email_verification_expires_at,email_verified_at,terms_accepted_at,terms_version,token_version,plugin_prefs)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const u of state.users) {
      if (!u || !u.id || !u.email) continue;
      insertUser.run(
        u.id, u.email, u.password_hash || '', u.display_name || u.email, u.created_at || now(),
        u.email_verified ? 1 : 0, u.email_verification_token_hash ?? null, u.email_verification_expires_at ?? null,
        u.email_verified_at ?? null, u.terms_accepted_at ?? null, u.terms_version ?? null,
        Number.isInteger(u.token_version) ? u.token_version : 0,
        JSON.stringify(u.plugin_prefs && typeof u.plugin_prefs === 'object' ? u.plugin_prefs : {})
      );
    }
    const insertData = database.prepare('INSERT INTO user_data (user_id,payload,updated_at) VALUES (?,?,?)');
    for (const d of state.user_data) {
      if (!d || !d.user_id || typeof d.payload !== 'string') continue;
      insertData.run(d.user_id, d.payload, d.updated_at || now());
    }
    const insertPlugin = database.prepare('INSERT INTO plugins (id,name,description,version,permissions,enabled) VALUES (?,?,?,?,?,?)');
    for (const p of state.plugins) {
      if (!p || !p.id) continue;
      insertPlugin.run(p.id, p.name || p.id, p.description || '', p.version || '1.0.0', typeof p.permissions === 'string' ? p.permissions : JSON.stringify(p.permissions || []), p.enabled ? 1 : 0);
    }
    let eventId = 0;
    const insertEvent = database.prepare('INSERT INTO events (id,user_id,event_type,metadata,created_at) VALUES (?,?,?,?,?)');
    for (const e of state.events) {
      if (!e || !e.user_id || !e.event_type) continue;
      const id = Number.isInteger(e.id) && e.id > 0 ? e.id : undefined;
      if (id) { insertEvent.run(id, e.user_id, e.event_type, typeof e.metadata === 'string' ? e.metadata : JSON.stringify(e.metadata || {}), e.created_at || now()); eventId = Math.max(eventId, id); }
      else {
        const res = database.prepare('INSERT INTO events (user_id,event_type,metadata,created_at) VALUES (?,?,?,?)').run(e.user_id, e.event_type, typeof e.metadata === 'string' ? e.metadata : JSON.stringify(e.metadata || {}), e.created_at || now());
        eventId = Math.max(eventId, Number(res.lastInsertRowid) || 0);
      }
    }
    // Vérifie que l'import correspond exactement à la source avant de valider.
    const counts = {
      users: database.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      user_data: database.prepare('SELECT COUNT(*) AS n FROM user_data').get().n,
      events: database.prepare('SELECT COUNT(*) AS n FROM events').get().n,
      plugins: database.prepare('SELECT COUNT(*) AS n FROM plugins').get().n
    };
    const expected = {
      users: state.users.filter(u => u && u.id && u.email).length,
      user_data: state.user_data.filter(d => d && d.user_id && typeof d.payload === 'string').length,
      events: state.events.filter(e => e && e.user_id && e.event_type).length,
      plugins: state.plugins.filter(p => p && p.id).length
    };
    for (const key of Object.keys(expected)) {
      if (counts[key] !== expected[key]) throw new Error(`Import JSON incomplet (${key}: ${counts[key]}/${expected[key]}).`);
    }
    if (eventId > 0) database.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('last_event_id',?)").run(String(eventId));
  });
}

function archiveJsonSource(source, reason) {
  try {
    if (source === jsonFile) {
      // Le JSON actif est renommé pour empêcher une double importation au prochain démarrage.
      const target = `${source}.migrated-${stampForFile()}`;
      fs.renameSync(source, target);
      return target;
    }
    // Une sauvegarde utilisée pour restaurer est copiée, jamais déplacée : la chaîne
    // de sauvegardes reste intacte pour les restaurations suivantes.
    // L'extension est conservée : une source chiffrée reste chiffrée (aucun rejeu en clair).
    const extension = source.endsWith('.json.enc') ? '.json.enc' : '.json';
    const target = path.join(dataDir, `novacore.${reason === 'restore' ? 'restored' : 'imported'}-${stampForFile()}${extension}`);
    fs.copyFileSync(source, target);
    return target;
  } catch (error) {
    console.warn('[NovaCore DB] Archivage du fichier JSON impossible :', error.message);
    return null;
  }
}

function isolateCorruptDatabase(error) {
  const stamp = Date.now();
  const quarantined = `${dbFile}.corrupt-${stamp}`;
  try { fs.renameSync(dbFile, quarantined); }
  catch (renameError) {
    // Ne jamais supprimer la base : on échoue explicitement plutôt que de démarrer à l'aveugle.
    throw new Error(`Base SQLite illisible et mise en quarantaine impossible (${renameError.code || renameError.message}). Vérifie les droits du dossier ${dataDir}.`);
  }
  for (const suffix of ['-wal', '-shm']) {
    try { if (fs.existsSync(dbFile + suffix)) fs.renameSync(dbFile + suffix, `${quarantined}${suffix}`); } catch { /* ignoré */ }
  }
  console.error(`[NovaCore DB] Base SQLite corrompue ou illisible (${error && error.message}), mise en quarantaine : ${quarantined}`);
  return path.basename(quarantined);
}

function bootstrapFromJson(database, { corrupted = false } = {}) {
  // Priorité : la base précédente peut avoir été corrompue après migration →
  // on restaure la sauvegarde la plus récente qui contient des comptes.
  const candidates = [];
  if (!corrupted && fs.existsSync(jsonFile)) candidates.push({ name: path.basename(jsonFile), file: jsonFile });
  for (const name of restoreCandidates()) candidates.push({ name, file: path.join(backupDir, name) });
  if (!corrupted && fs.existsSync(jsonFile) && !candidates.some(c => c.file === jsonFile)) candidates.push({ name: path.basename(jsonFile), file: jsonFile });
  if (!corrupted && fs.existsSync(legacyJsonFile) && !fs.existsSync(jsonFile)) candidates.push({ name: 'legacy:' + path.basename(legacyJsonFile), file: legacyJsonFile });

  let imported = null;
  for (const candidate of candidates) {
    try {
      const parsed = readJsonState(candidate.file);
      importStateInto(database, parsed);
      imported = candidate;
      break;
    } catch (error) {
      console.warn(`[NovaCore DB] Source ${candidate.name} inutilisable : ${error.message}`);
    }
  }

  if (!imported) {
    // Aucune source exploitable (clé absente au premier démarrage, sauvegardes toutes
    // illisibles) : base neuve avec les extensions de démarrage, mais on persiste un
    // marqueur pour retenter la restauration au prochain démarrage. Sans ce marqueur,
    // une base vide « saine » ne serait plus jamais confrontée aux sauvegardes.
    transaction(database, () => {
      const insertPlugin = database.prepare('INSERT INTO plugins (id,name,description,version,permissions,enabled) VALUES (?,?,?,?,?,?)');
      for (const p of starterPlugins) insertPlugin.run(p.id, p.name, p.description, p.version, p.permissions, p.enabled);
    });
    setMeta(database, 'bootstrapped', now());
    // Une installation neuve sans aucune source n'est pas un incident : ne pas marquer
    // de restauration en attente. En revanche, si des sources existaient mais qu'aucune
    // n'était lisible (clé erronée), il faut retenter au prochain démarrage.
    if (corrupted || candidates.length) setMeta(database, 'restore_pending', { at: now(), reason: corrupted ? 'corrupted_no_readable_backup' : 'no_readable_backup' });
    return null;
  }

  const counts = {
    users: database.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    user_data: database.prepare('SELECT COUNT(*) AS n FROM user_data').get().n,
    events: database.prepare('SELECT COUNT(*) AS n FROM events').get().n,
    plugins: database.prepare('SELECT COUNT(*) AS n FROM plugins').get().n
  };
  migrationNotice = { at: now(), source: imported.name, corrupted, ...counts };
  setMeta(database, 'json_import', migrationNotice);
  setMeta(database, 'bootstrapped', now());
  deleteMeta(database, 'restore_pending');
  if (!imported.name.startsWith('legacy:') && imported.file !== legacyJsonFile) archiveJsonSource(imported.file, corrupted ? 'restore' : 'migration');
  if (imported.name.startsWith('legacy:')) {
    // Conserve la copie dans le dossier persistant pour que la migration soit auditable.
    try { fs.copyFileSync(legacyJsonFile, path.join(dataDir, `novacore.legacy-import-${stampForFile()}.json`)); } catch { /* ignoré */ }
  }
  console.log(`[NovaCore DB] Import JSON → SQLite terminé depuis ${imported.name} : ${counts.users} comptes, ${counts.user_data} espaces, ${counts.events} événements, ${counts.plugins} extensions.`);
  return migrationNotice;
}

// Une corruption est un échec structurel : seuls ces cas justifient une mise en
// quarantaine. Un verrou (SQLITE_BUSY), un disque plein ou un refus de droits doivent
// faire échouer le démarrage explicitement, jamais déplacer une base saine.
function isStructuralError(error) {
  if (!error) return false;
  if (error.code === 'SQLITE_CORRUPT' || error.code === 'SQLITE_NOTADB') return true;
  return /file is not a database|database disk image is malformed|database corruption|SQLITE_CORRUPT|SQLITE_NOTADB/i.test(String(error.message || ''));
}

function databaseIsEmpty(database) {
  return database.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0
    && database.prepare('SELECT COUNT(*) AS n FROM user_data').get().n === 0
    && database.prepare('SELECT COUNT(*) AS n FROM events').get().n === 0;
}

function retryPendingRestore(database) {
  const pending = getMeta(database, 'restore_pending');
  if (!pending) return false;
  if (!databaseIsEmpty(database)) {
    // Des comptes ont été créés depuis le démarrage sur base vide : importer une
    // sauvegarde écraserait des écritures récentes. On arrête les tentatives
    // automatiques et on conserve l'avis pour l'exploitant.
    deleteMeta(database, 'restore_pending');
    recoveryNotice = { restoredFrom: null, pending: false, skipped: true, at: now(), engine: 'sqlite', previous: pending };
    persistRecoveryNotice(database);
    console.warn('[NovaCore DB] Restauration en attente abandonnée : la base contient déjà des comptes.');
    return false;
  }
  // Les tables remplies par le démarrage sur base vide (extensions de départ) doivent
  // être vidées avant un import complet, sinon l'insertion échouerait en doublon.
  transaction(database, () => {
    database.exec('DELETE FROM plugins');
    database.exec('DELETE FROM events');
    database.exec('DELETE FROM user_data');
  });
  const notice = bootstrapFromJson(database, { corrupted: true });
  recoveryNotice = notice
    ? { restoredFrom: notice.source, corrupted: true, retried: true, at: now(), engine: 'sqlite', ...notice }
    : { restoredFrom: null, pending: true, retried: true, at: now(), engine: 'sqlite', previous: pending };
  persistRecoveryNotice(database);
  if (notice) console.error(`[NovaCore DB] Restauration différée réussie depuis ${notice.source}.`);
  return Boolean(notice);
}

function quarantineAndRestore(error) {
  const quarantined = isolateCorruptDatabase(error);
  const database = openDatabase(dbFile);
  ensureSchema(database);
  const notice = bootstrapFromJson(database, { corrupted: true });
  recoveryNotice = { restoredFrom: notice ? notice.source : null, pending: !notice, quarantined, at: now(), engine: 'sqlite' };
  persistRecoveryNotice(database);
  console.error(notice ? `[NovaCore DB] Restauration automatique depuis ${notice.source}.` : '[NovaCore DB] Aucune sauvegarde valide : démarrage avec une base vide. Le fichier corrompu est conservé pour analyse.');
  return database;
}

function initDatabase() {
  if (fs.existsSync(dbFile)) {
    let candidate = null;
    try {
      candidate = openDatabase(dbFile);
    } catch (error) {
      // SQLITE_NOTADB / « file is not a database » : fichier structurellement invalide.
      // Toute autre erreur (verrou, droits, disque) est un échec de démarrage explicite.
      if (isStructuralError(error)) return quarantineAndRestore(error);
      throw new Error(`Base SQLite inaccessible au démarrage (${error.code || error.message}). Aucune mise en quarantaine n’a été effectuée.`);
    }
    let healthy = false;
    try {
      healthy = integrityOk(candidate);
    } catch (error) {
      try { candidate.close(); } catch { /* déjà fermée */ }
      if (isStructuralError(error)) return quarantineAndRestore(error);
      throw new Error(`Contrôle d’intégrité SQLite impossible (${error.code || error.message}). Aucune mise en quarantaine n’a été effectuée.`);
    }
    if (!healthy) {
      // La connexion doit être fermée avant le rename : sous Windows, un fichier
      // encore ouvert ne peut pas être déplacé vers la quarantaine.
      try { candidate.close(); } catch { /* déjà fermée */ }
      return quarantineAndRestore(new Error('integrity_check a échoué'));
    }
    try {
      ensureSchema(candidate);
    } catch (error) {
      // D5 : un échec transitoire (verrou, disque plein, lecture seule) ne prouve
      // aucune corruption. Fermer la connexion et échouer explicitement.
      try { candidate.close(); } catch { /* déjà fermée */ }
      throw new Error(`Schéma SQLite non applicable (${error.code || error.message}). Vérifie les droits et l’espace disque.`);
    }
    // D7 : réafficher le dernier incident de récupération après un redémarrage.
    if (!recoveryNotice) {
      const stored = getMeta(candidate, 'recovery_notice');
      if (stored && typeof stored === 'object') recoveryNotice = stored;
    }
    // D2 : une base vide laissée par une restauration impossible doit réessayer.
    retryPendingRestore(candidate);
    return candidate;
  }
  const database = openDatabase(dbFile);
  ensureSchema(database);
  bootstrapFromJson(database, { corrupted: false });
  persistRecoveryNotice(database);
  return database;
}

let database = initDatabase();

// Complète une base existante avec les extensions de démarrage manquantes.
transaction(database, () => {
  const insertPlugin = database.prepare('INSERT OR IGNORE INTO plugins (id,name,description,version,permissions,enabled) VALUES (?,?,?,?,?,?)');
  for (const plugin of starterPlugins) insertPlugin.run(plugin.id, plugin.name, plugin.description, plugin.version, plugin.permissions, plugin.enabled);
});

// Lot 18 : la clé est résolue (et créée au besoin) dès le démarrage, puis la rétention
// est appliquée pour que les anciennes sauvegardes ne s'accumulent pas sans limite.
resolveBackupKey();
try { rotateBackups(); } catch (error) { console.warn('[NovaCore DB] Rétention des sauvegardes impossible :', error.message); }

function mapUser(row) {
  if (!row) return undefined;
  const out = { ...row };
  out.email_verified = row.email_verified === 1 || row.email_verified === true;
  out.token_version = Number(row.token_version || 0);
  if (typeof row.plugin_prefs === 'string') {
    try { out.plugin_prefs = JSON.parse(row.plugin_prefs) || {}; } catch { out.plugin_prefs = {}; }
  } else if (!row.plugin_prefs || typeof row.plugin_prefs !== 'object') out.plugin_prefs = {};
  return out;
}
const USER_COLUMNS = new Set(['email', 'password_hash', 'display_name', 'created_at', 'email_verified', 'email_verification_token_hash', 'email_verification_expires_at', 'email_verified_at', 'terms_accepted_at', 'terms_version', 'token_version', 'plugin_prefs']);
function columnValue(key, value) {
  if (key === 'email_verified') return value ? 1 : 0;
  if (key === 'plugin_prefs') return JSON.stringify(value && typeof value === 'object' ? value : {});
  if (value === undefined) return null;
  return value;
}

function dumpState() {
  return {
    users: database.prepare('SELECT * FROM users ORDER BY created_at').all().map(mapUser),
    user_data: database.prepare('SELECT user_id,payload,updated_at FROM user_data ORDER BY user_id').all().map(r => ({ ...r })),
    plugins: database.prepare('SELECT * FROM plugins ORDER BY name').all().map(r => ({ ...r })),
    events: database.prepare('SELECT id,user_id,event_type,metadata,created_at FROM events ORDER BY id').all().map(r => ({ ...r })),
    nextEventId: (Number(database.prepare('SELECT COALESCE(MAX(id),0) AS maxId FROM events').get().maxId) || 0) + 1
  };
}

function rotateBackups({ nowMs = Date.now() } = {}) {
  const entries = backupEntries();
  const maxAgeMs = BACKUP_MAX_AGE_DAYS > 0 ? BACKUP_MAX_AGE_DAYS * 86_400_000 : 0;
  const removed = [], skipped = [];
  let counted = 0;
  for (const entry of entries) {
    const readable = !entry.encrypted || backupReadable(entry);
    // Un fichier chiffré illisible (clé perdue) ne consomme pas de place dans le quota :
    // sinon il finit par chasser toutes les sauvegardes lisibles, et la chaîne ne
    // contient plus que des fichiers indéchiffrables (défaut D1 de la revue).
    const withinCount = readable ? counted++ < BACKUP_KEEP : true;
    const beyondAge = maxAgeMs > 0 && nowMs - entry.mtimeMs > maxAgeMs;
    if (withinCount && !beyondAge) continue;
    // Une sauvegarde chiffrée illisible n'est jamais supprimée : elle peut encore être
    // restaurée avec sa clé d'origine, hors ligne.
    if (!readable) { skipped.push(entry.name); continue; }
    try { fs.unlinkSync(entry.file); removed.push(entry.name); } catch { skipped.push(entry.name); }
  }
  if (removed.length) console.log(`[NovaCore DB] Rétention des sauvegardes : ${removed.length} fichier(s) supprimé(s).`);
  if (skipped.length) console.warn(`[NovaCore DB] Rétention : ${skipped.length} sauvegarde(s) chiffrée(s) illisible(s) conservée(s) pour analyse.`);
  return { removed, skipped, kept: backupEntries().map(entry => entry.name) };
}

function backupReadable(entry) {
  // Les fichiers en clair gardent l'ancien comportement de rotation.
  if (!entry.encrypted) return true;
  const token = `${entry.name}|${entry.size}|${entry.mtimeMs}`;
  if (backupReadableCache.has(token)) {
    const cached = backupReadableCache.get(token);
    // Rafraîchit l'ordre LRU sans dépasser la borne.
    backupReadableCache.delete(token);
    backupReadableCache.set(token, cached);
    return cached;
  }
  let readable = false;
  try { readJsonState(entry.file); readable = true; } catch { readable = false; }
  backupReadableCache.set(token, readable);
  if (backupReadableCache.size > BACKUP_READABLE_CACHE_MAX) {
    const oldest = backupReadableCache.keys().next().value;
    backupReadableCache.delete(oldest);
  }
  return readable;
}

/**
 * Sauvegarde logique JSON, atomique et portable, chiffrée AES-256-GCM.
 * Elle est prise APRÈS les écritures : elle reflète donc des données réellement persistées.
 * Si la clé est indisponible, l'opération échoue explicitement au lieu d'écrire en clair.
 */
function backupNow(reason = 'auto') {
  if (!database) return null;
  const keyState = resolveBackupKey();
  if (!keyState) {
    const error = new Error(`Sauvegarde chiffrée impossible : ${backupKeyError ? backupKeyError.message : 'clé de sauvegarde indisponible'}`);
    // Code interne conservé pour le mapping HTTP 507 (import/synchronisation) ;
    // /api/ready n'expose qu'un code normalisé, jamais le message système.
    error.code = 'STORAGE_WRITE_FAILED';
    lastBackupError = error.message;
    lastBackupErrorCode = 'BACKUP_WRITE_FAILED';
    throw error;
  }
  const stamp = stampForFile();
  let name = `novacore-${stamp}-${reason}.json.enc`;
  if (fs.existsSync(path.join(backupDir, name))) name = `novacore-${stamp}-${process.pid}-${reason}.json.enc`;
  const target = path.join(backupDir, name);
  const temp = `${target}.${process.pid}.tmp`;
  try {
    const sealed = backupCrypto.encrypt(Buffer.from(JSON.stringify(dumpState(), null, 2), 'utf8'), keyState.key);
    const fd = fs.openSync(temp, 'w', 0o600);
    try {
      let offset = 0;
      while (offset < sealed.length) offset += fs.writeSync(fd, sealed, offset, sealed.length - offset);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temp, target);
    lastBackupAt = Date.now(); lastBackupName = name; lastBackupError = null; lastBackupErrorCode = null;
    rotateBackups();
    return name;
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* déjà absent */ }
    const wrapped = new Error(`Sauvegarde impossible (${error.code || error.message}). Vérifie l’espace disque et les droits du dossier de données.`);
    wrapped.code = 'STORAGE_WRITE_FAILED'; wrapped.cause = error;
    lastBackupError = wrapped.message; lastBackupErrorCode = 'BACKUP_WRITE_FAILED';
    throw wrapped;
  }
}

// État public (exposé par /api/ready) : jamais de clé, uniquement sa provenance.
// Les erreurs sont réduites à des codes normalisés : un message système brut
// divulguerait le chemin absolu du dossier, le compte de service et le PID.
function backupStatus() {
  const entries = backupEntries();
  const encrypted = entries.filter(entry => entry.encrypted);
  const unreadable = encrypted.filter(entry => !backupReadable(entry)).map(entry => entry.name);
  const keyState = resolveBackupKey();
  return {
    enabled: Boolean(keyState && keyState.key),
    algorithm: 'aes-256-gcm',
    keySource: keyState ? keyState.source : null,
    keyFilePresent: Boolean(keyState && keyState.file && fs.existsSync(keyState.file)),
    keyError: keyState ? null : backupKeyErrorCode(),
    keep: BACKUP_KEEP,
    maxAgeDays: BACKUP_MAX_AGE_DAYS,
    total: entries.length,
    encryptedCount: encrypted.length,
    plaintextCount: entries.length - encrypted.length,
    unreadable,
    lastBackupAt: lastBackupAt ? new Date(lastBackupAt).toISOString() : null,
    lastBackupName,
    lastError: lastBackupErrorCode
  };
}
function maybeBackup() {
  try { backupNow('auto'); } catch (e) { console.warn('[NovaCore DB] Sauvegarde automatique impossible :', e.message); }
}
function go(fn) {
  try { return fn(); }
  catch (error) {
    if (error && error.code === 'STORAGE_WRITE_FAILED') throw error;
    const wrapped = new Error(`Écriture des données impossible (${error.code || error.message}). Vérifie l’espace disque et les droits du dossier de données.`);
    wrapped.code = 'STORAGE_WRITE_FAILED'; wrapped.cause = error; throw wrapped;
  }
}

const db = {
  engine() {
    const p = database.prepare('PRAGMA journal_mode').get();
    return { type: 'sqlite', file: dbFile, schemaVersion: Number(database.prepare('PRAGMA user_version').get().user_version || 0), journalMode: p && p.journal_mode, synchronous: 'full' };
  },
  migration() { return migrationNotice || getMeta(database, 'json_import'); },
  getUserByEmail(email) { return mapUser(database.prepare('SELECT * FROM users WHERE email = ?').get(email)); },
  getUserById(id) { return mapUser(database.prepare('SELECT * FROM users WHERE id = ?').get(id)); },
  getUserByVerificationHash(hash) { return mapUser(database.prepare('SELECT * FROM users WHERE email_verification_token_hash = ? AND email_verification_token_hash IS NOT NULL').get(hash)); },
  insertUser(user) {
    return go(() => {
      const row = {
        email_verified: 0, email_verification_token_hash: null, email_verification_expires_at: null,
        email_verified_at: null, terms_accepted_at: null, terms_version: null, token_version: 0, plugin_prefs: {},
        ...user
      };
      try {
        database.prepare(`INSERT INTO users
          (id,email,password_hash,display_name,created_at,email_verified,email_verification_token_hash,email_verification_expires_at,email_verified_at,terms_accepted_at,terms_version,token_version,plugin_prefs)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          row.id, row.email, row.password_hash, row.display_name, row.created_at,
          columnValue('email_verified', row.email_verified), row.email_verification_token_hash,
          row.email_verification_expires_at, row.email_verified_at, row.terms_accepted_at,
          row.terms_version, Number.isInteger(row.token_version) ? row.token_version : 0,
          columnValue('plugin_prefs', row.plugin_prefs)
        );
      } catch (error) {
        if (/UNIQUE|PRIMARY/i.test(error.message)) throw new Error('Duplicate user');
        throw error;
      }
      maybeBackup();
      return { changes: 1 };
    });
  },
  updateUser(id, patch) {
    return go(() => {
      const keys = Object.keys(patch || {}).filter(k => USER_COLUMNS.has(k));
      if (!keys.length) return { changes: 0 };
      const assignments = keys.map(k => `${k} = ?`).join(', ');
      const values = keys.map(k => columnValue(k, patch[k]));
      const result = database.prepare(`UPDATE users SET ${assignments} WHERE id = ?`).run(...values, id);
      maybeBackup();
      return { changes: Number(result.changes) };
    });
  },
  bumpTokenVersion(id) {
    return go(() => {
      database.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(id);
      const row = database.prepare('SELECT token_version FROM users WHERE id = ?').get(id);
      if (!row) return 0;
      maybeBackup();
      return Number(row.token_version);
    });
  },
  getWorkspaceRaw(userId) { const row = database.prepare('SELECT payload,updated_at FROM user_data WHERE user_id = ?').get(userId); return row ? { payload: row.payload, updated_at: row.updated_at } : null; },
  backupNow, listBackups, rotateBackups, backupStatus,
  recoveryNotice() { return recoveryNotice; },
  stats() {
    const entries = backupEntries();
    return {
      engine: 'sqlite',
      users: database.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      workspaces: database.prepare('SELECT COUNT(*) AS n FROM user_data').get().n,
      events: database.prepare('SELECT COUNT(*) AS n FROM events').get().n,
      plugins: database.prepare('SELECT COUNT(*) AS n FROM plugins').get().n,
      backups: entries.length,
      encryptedBackups: entries.filter(entry => entry.encrypted).length,
      schemaVersion: Number(database.prepare('PRAGMA user_version').get().user_version || 0),
      file: dbFile
    };
  },
  pragma(expr) { return expr ? database.prepare(`PRAGMA ${expr}`).all() : this; },
  exec(sql) { database.exec(sql); return this; },
  prepare(sql) { return database.prepare(sql); },
  close() { try { database.close(); } catch { /* déjà fermée */ } }
};

module.exports = db;
