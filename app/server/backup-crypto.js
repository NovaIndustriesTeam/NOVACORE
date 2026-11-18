// NovaCore — chiffrement des sauvegardes locales (lot 18, P0 données).
// AES-256-GCM, clé de 32 octets. Aucune dépendance externe : node:crypto.
//
// Format du fichier `.json.enc` :
//   « NCBK1 » (5 octets) | version (1 octet = 1) | IV (12 octets) | tag GCM (16 octets) | texte chiffré
//
// La clé est lue dans `NOVACORE_BACKUP_KEY` (64 caractères hexadécimaux ou 32 octets base64)
// sinon dans `<NOVACORE_DATA_DIR>/backup-key` (créée en 0600 au premier besoin).
// Important : une clé stockée à côté des sauvegardes protège contre la copie ou l'exfiltration
// du seul dossier `backups/`, pas contre la compromission complète de la machine.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAGIC = Buffer.from('NCBK1', 'ascii');
const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const HEADER_BYTES = MAGIC.length + 1 + IV_BYTES + TAG_BYTES;

function decodeKey(raw) {
  const value = String(raw || '').trim();
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  if (/^[A-Za-z0-9+/]{43}=?$/.test(value)) {
    try { const key = Buffer.from(value, 'base64'); if (key.length === KEY_BYTES) return key; } catch { /* ignoré */ }
  }
  return null;
}

function keyFile(dataDir) { return path.join(dataDir, 'backup-key'); }

function keyError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function writeKeyFile(target, key) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temp, key.toString('hex'), { encoding: 'utf8', mode: 0o600 });
    // Ne jamais écraser une clé qui aurait été créée entre la lecture et l'écriture.
    if (fs.existsSync(target)) throw keyError('fichier de clé créé pendant l’initialisation', 'BACKUP_KEY_FILE_INVALID');
    fs.renameSync(temp, target);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* déjà absent */ }
    throw error;
  }
  try { fs.chmodSync(target, 0o600); } catch { /* Windows : ACL héritées du dossier utilisateur. */ }
}

/**
 * Résout la clé de chiffrement.
 * - `environment` : NOVACORE_BACKUP_KEY valide (aucun fichier écrit, aucune clé sur disque) ;
 * - `file` : clé persistante existante ;
 * - `created` : première clé générée ;
 * - `regenerated` : clé générée alors que des `.json.enc` existent déjà — ils resteront
 *   illisibles, et la rotation ne les supprimera pas (voir db.js).
 */
function resolveKey({ dataDir, env = process.env } = {}) {
  const declared = String(env.NOVACORE_BACKUP_KEY || '').trim();
  if (declared) {
    const provided = decodeKey(declared);
    // Une clé déclarée mais illisible est une erreur de configuration : on refuse de
    // retomber silencieusement sur une clé locale, sinon l'exploitant croirait ses
    // sauvegardes protégées par SA clé alors qu'elles ne le sont pas.
    if (!provided) throw keyError('NOVACORE_BACKUP_KEY invalide : attendu 64 caractères hexadécimaux ou 32 octets en base64.', 'BACKUP_KEY_ENV_INVALID');
    return { key: provided, source: 'environment' };
  }
  const file = keyFile(dataDir);
  let stored = null;
  try {
    stored = fs.readFileSync(file, 'utf8');
  } catch (error) {
    // Fichier absent : première initialisation. Toute autre erreur (droits, verrou,
    // disque) ne doit jamais conduire à remplacer la clé existante : sans elle, toutes
    // les sauvegardes déjà chiffrées deviendraient définitivement illisibles.
    if (error.code !== 'ENOENT') {
      throw keyError(`fichier de clé illisible (${error.code || 'lecture impossible'})`, 'BACKUP_KEY_FILE_UNREADABLE');
    }
  }
  if (stored !== null) {
    const key = decodeKey(stored);
    if (!key) throw keyError('fichier de clé présent mais invalide : contenu conservé, aucune clé de remplacement générée.', 'BACKUP_KEY_FILE_INVALID');
    return { key, source: 'file', file };
  }
  let existingEncrypted = false;
  try { existingEncrypted = fs.readdirSync(path.join(dataDir, 'backups')).some(name => name.endsWith('.json.enc')); } catch { /* dossier absent */ }
  const key = crypto.randomBytes(KEY_BYTES);
  writeKeyFile(file, key);
  return { key, source: existingEncrypted ? 'regenerated' : 'created', file, existingEncrypted };
}

function encrypt(plaintext, key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw new Error('clé de sauvegarde invalide');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  return Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION]), iv, cipher.getAuthTag(), body]);
}

function decrypt(buffer, key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw new Error('clé de sauvegarde invalide');
  if (!Buffer.isBuffer(buffer) || buffer.length <= HEADER_BYTES) throw new Error('sauvegarde chiffrée tronquée');
  if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('format de sauvegarde inconnu');
  if (buffer[MAGIC.length] !== FORMAT_VERSION) throw new Error(`version de sauvegarde non supportée (${buffer[MAGIC.length]})`);
  let offset = MAGIC.length + 1;
  const iv = buffer.subarray(offset, offset + IV_BYTES); offset += IV_BYTES;
  const tag = buffer.subarray(offset, offset + TAG_BYTES); offset += TAG_BYTES;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buffer.subarray(offset)), decipher.final()]).toString('utf8');
}

module.exports = { MAGIC, FORMAT_VERSION, KEY_BYTES, HEADER_BYTES, decodeKey, keyFile, resolveKey, encrypt, decrypt };
