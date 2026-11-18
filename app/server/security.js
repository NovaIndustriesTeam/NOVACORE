// NovaCore — briques de sécurité (roadmap P0 « Sécurité et protection des comptes »).
// Aucune dépendance externe : tout repose sur Node.js.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const isProduction = () => process.env.NODE_ENV === 'production';

// Chemin du secret de développement : hors du dossier applicatif, à côté de la base SQLite.
// Le secret doit survivre aux redémarrages, sinon tous les jetons NovaID déjà émis deviennent
// invalides et le Workbench (ou toute autre page) affiche des 401 sans raison visible.
function devSecretFile() {
  const dataDir = process.env.NOVACORE_DATA_DIR || path.join(os.homedir(), '.novacore', 'data');
  return path.join(dataDir, 'jwt-secret');
}

function readDevSecret(file) {
  try {
    const value = fs.readFileSync(file, 'utf8').trim();
    return secretIsStrong(value) ? value : null;
  } catch {
    return null;
  }
}

function writeDevSecret(file, secret) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, secret, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows : ACL héritées du dossier utilisateur. */ }
}

// Valeurs d'exemple connues : elles ne sont jamais acceptées en production.
const WEAK_SECRET_PATTERNS = [/replace-with/i, /change[-_ ]?me/i, /^(secret|password|jwt|nova)/i];

function secretIsStrong(secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  if (WEAK_SECRET_PATTERNS.some(re => re.test(secret))) return false;
  return new Set(secret).size >= 10; // refuse « aaaaaaaa… »
}

/**
 * Valide la configuration au démarrage.
 * - production : JWT_SECRET fort obligatoire, sinon le démarrage est refusé.
 * - développement : un secret persistant est lu/créé dans ~/.novacore/data/jwt-secret afin que
 *   les sessions survivent aux redémarrages. Un secret fourni dans l'environnement reste prioritaire.
 */
function ensureConfig() {
  const secret = process.env.JWT_SECRET;
  if (secretIsStrong(secret)) return { jwtSecret: 'configured', ephemeral: false };
  if (isProduction()) {
    throw new Error('JWT_SECRET absent, trop court (< 32) ou factice : démarrage refusé en production. Génère-en un avec : node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  }
  const file = devSecretFile();
  const stored = readDevSecret(file);
  if (stored) {
    process.env.JWT_SECRET = stored;
    return { jwtSecret: 'persistent', ephemeral: false, file };
  }
  const generated = crypto.randomBytes(48).toString('hex');
  try {
    writeDevSecret(file, generated);
    process.env.JWT_SECRET = generated;
    console.warn(`JWT_SECRET absent : secret de développement persistant créé dans ${file} (les sessions survivent aux redémarrages).`);
    return { jwtSecret: 'persistent', ephemeral: false, file };
  } catch (error) {
    // Dernier recours (dossier non inscriptible) : clé éphémère, signalée explicitement.
    console.warn(`JWT_SECRET absent et secret persistant inutilisable (${error.message}) : clé temporaire générée pour cette session (développement uniquement).`);
    process.env.JWT_SECRET = generated;
    return { jwtSecret: 'ephemeral', ephemeral: true, file, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Limiteur de débit à fenêtre glissante, en mémoire (mono-instance).
// Pour un déploiement multi-instance, remplacer le store par Redis.
// ---------------------------------------------------------------------------
function createRateLimiter({ name, windowMs, max, keyFn, message }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, list] of hits) { const fresh = list.filter(t => t > cutoff); if (fresh.length) hits.set(key, fresh); else hits.delete(key); }
  }, Math.min(windowMs, 60_000));
  sweep.unref();
  const middleware = (req, res, next) => {
    const key = (keyFn ? keyFn(req) : req.ip) || 'unknown';
    const nowMs = Date.now(), cutoff = nowMs - windowMs;
    const list = (hits.get(key) || []).filter(t => t > cutoff);
    if (list.length >= max) {
      const retry = Math.max(1, Math.ceil((list[0] + windowMs - nowMs) / 1000));
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: message || 'Trop de requêtes. Réessaie plus tard.', code: 'RATE_LIMITED', limiter: name, retryAfterSeconds: retry });
    }
    list.push(nowMs); hits.set(key, list);
    next();
  };
  middleware.reset = () => hits.clear();
  return middleware;
}

const minutes = n => n * 60_000;
const limiters = {
  // Brute-force : par IP, puis par IP + e-mail pour limiter le bourrage d'identifiants.
  loginIp: createRateLimiter({ name: 'login-ip', windowMs: minutes(15), max: 30, message: 'Trop de tentatives de connexion depuis cette adresse. Réessaie dans quelques minutes.' }),
  loginAccount: createRateLimiter({ name: 'login-account', windowMs: minutes(15), max: 8, keyFn: req => `${req.ip}|${String(req.body?.email || '').trim().toLowerCase().slice(0, 254)}`, message: 'Trop d’essais pour ce compte. Patiente quelques minutes avant de réessayer.' }),
  register: createRateLimiter({ name: 'register', windowMs: minutes(60), max: 10, message: 'Trop de créations de compte depuis cette adresse. Réessaie plus tard.' }),
  verify: createRateLimiter({ name: 'verify', windowMs: minutes(15), max: 20, message: 'Trop de vérifications. Réessaie dans quelques minutes.' }),
  resend: createRateLimiter({ name: 'resend', windowMs: minutes(60), max: 5, keyFn: req => `${req.ip}|${String(req.body?.email || '').trim().toLowerCase().slice(0, 254)}`, message: 'Trop de demandes de lien. Réessaie dans une heure.' }),
  ai: createRateLimiter({ name: 'ai', windowMs: minutes(1), max: 20, keyFn: req => req.user?.sub || req.ip, message: 'Trop de messages envoyés à l’assistant. Patiente une minute.' }),
  sync: createRateLimiter({ name: 'sync', windowMs: minutes(1), max: 120, keyFn: req => req.user?.sub || req.ip, message: 'Trop de synchronisations. Patiente une minute.' }),
  sensitive: createRateLimiter({ name: 'sensitive', windowMs: minutes(15), max: 10, keyFn: req => req.user?.sub || req.ip, message: 'Trop d’actions sensibles. Réessaie plus tard.' }),
  // Écritures courantes (préférences, sessions de concentration, plugins) : plafond large
  // mais explicite, pour qu'une route d'écriture ne dépende pas du seul limiteur global /api.
  write: createRateLimiter({ name: 'write', windowMs: minutes(15), max: 60, keyFn: req => req.user?.sub || req.ip, message: 'Trop d’enregistrements en peu de temps. Patiente quelques minutes.' }),
  developer: createRateLimiter({ name: 'developer', windowMs: minutes(1), max: 12, message: 'Trop de requêtes développeur. Réessaie dans une minute.' }),
  api: createRateLimiter({ name: 'api', windowMs: minutes(1), max: 600, message: 'Trop de requêtes. Ralentis un peu.' })
};

// ---------------------------------------------------------------------------
// Politique de mot de passe (OWASP : longueur > complexité forcée).
// ---------------------------------------------------------------------------
const COMMON_PASSWORDS = new Set(['password', 'password1', 'password123', '1234567890', '123456789012', 'qwertyuiop', 'azertyuiop', 'motdepasse', 'motdepasse1', 'novacore', 'novacore123', 'iloveyou123', 'administrator', 'letmein1234']);
function checkPassword(password, { email = '', displayName = '' } = {}) {
  if (typeof password !== 'string') return 'Mot de passe invalide.';
  if (password.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (password.length > 128) return 'Le mot de passe ne doit pas dépasser 128 caractères.';
  const lowered = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lowered)) return 'Ce mot de passe est trop courant. Choisis une phrase de passe plus originale.';
  if (new Set(password).size < 5) return 'Le mot de passe est trop répétitif.';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && lowered.includes(local)) return 'Le mot de passe ne doit pas contenir ton adresse e-mail.';
  const name = String(displayName).trim().toLowerCase();
  if (name.length >= 4 && lowered.includes(name)) return 'Le mot de passe ne doit pas contenir ton nom affiché.';
  return null;
}

// ---------------------------------------------------------------------------
// Identifiant de requête (corrélation des logs, sans donnée privée).
// ---------------------------------------------------------------------------
function requestId(req, res, next) {
  const incoming = String(req.headers['x-request-id'] || '');
  req.id = /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

// ---------------------------------------------------------------------------
// Content-Security-Policy.
// 'unsafe-inline' reste nécessaire pour les scripts : l'interface actuelle génère ~170 gestionnaires
// onclick= dans app.js. Les retirer est un chantier P1 distinct (voir roadmap) ; en attendant,
// tout le reste est verrouillé (origines, objets, frames, formulaires, base-uri).
// ---------------------------------------------------------------------------
function contentSecurityPolicy() {
  return {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:', 'data:'],
      connectSrc: ["'self'"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      frameSrc: ["'self'"],
      frameAncestors: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  };
}

// Les en-têtes de cache : l'API ne doit jamais être mise en cache par un proxy.
function noStoreApi(req, res, next) { if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store'); next(); }

// ---------------------------------------------------------------------------
// Bordure HTTP : contrôle d'origine (CORS strict) sur les méthodes d'écriture.
//
// L'authentification NovaID utilise un jeton Bearer lu par JavaScript, jamais un cookie :
// le navigateur d'un site tiers ne peut donc pas joindre le jeton. Ce contrôle est une
// défense en profondeur (et une exigence de la roadmap P0) : il empêche un site tiers de
// déclencher des écritures non authentifiées (inscription, connexion, formulaires) et il
// rend explicite la liste des origines de confiance au lieu d'accepter n'importe quoi.
// ---------------------------------------------------------------------------
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEFAULT_SECURITY_CONTACT = 'mailto:novaindustriesteam@gmail.com';

// Normalise une origine en « scheme://host[:port] ». Renvoie null pour tout le reste
// (valeur vide, « null », schéma non HTTP, URL relative, chaîne non analysable).
function normalizeOrigin(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replace(/\/+$/, '');
  if (!value || value === 'null') return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

// Origines de confiance déclarées par l'exploitant : liste explicite + URL publiques.
function configuredOrigins() {
  const raw = [process.env.NOVACORE_ALLOWED_ORIGINS, process.env.PUBLIC_BASE_URL, process.env.NOVACORE_URL]
    .filter(value => typeof value === 'string' && value.trim())
    .join(',');
  return [...new Set(raw.split(',').map(normalizeOrigin).filter(Boolean))];
}

// Origines réellement servies pour cette requête (le Host vu par le serveur).
// `X-Forwarded-Proto` n'est utilisé que pour le schéma, jamais pour le Host : une page
// tierce ne peut pas produire une origine dont l'hôte est le nôtre.
function requestOrigins(req) {
  const host = String(req.headers.host || '').trim();
  if (!host) return [];
  const schemes = new Set([req.protocol === 'https' ? 'https' : 'http']);
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (forwarded === 'https' || forwarded === 'http') schemes.add(forwarded);
  return [...schemes].map(scheme => normalizeOrigin(`${scheme}://${host}`)).filter(Boolean);
}

function isAllowedOrigin(req, origin) {
  if (!origin) return false;
  if (configuredOrigins().includes(origin)) return true;
  return requestOrigins(req).includes(origin);
}

function rejectOrigin(req, res, detail) {
  // `req.path` est relatif au point de montage (« /auth/login ») : on journalise l'URL
  // réellement demandée, sans la chaîne de requête (aucune donnée privée dans les logs).
  const target = String(req.originalUrl || req.url || '').split('?')[0];
  console.warn(`[${req.id || '-'}] Origine refusée : ${req.method} ${target} (${detail})`);
  return res.status(403).json({
    error: 'Origine non autorisée pour cette action. Ouvre NovaCore depuis son adresse officielle.',
    code: 'ORIGIN_REJECTED'
  });
}

function originGuard(req, res, next) {
  const declared = req.headers.origin;
  const origin = normalizeOrigin(declared);
  const malformed = typeof declared === 'string' && declared.trim() && !origin;
  if (origin) res.vary('Origin');
  const allowed = origin ? isAllowedOrigin(req, origin) : false;
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id, Retry-After');
  }
  // Lecture : une origine tierce n'obtient aucun en-tête CORS et le navigateur bloque la
  // réponse. La requête n'est pas refusée (les clients non-navigateur envoient parfois Origin).
  if (SAFE_METHODS.has(req.method)) {
    if (req.method === 'OPTIONS' && allowed) {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
      res.setHeader('Access-Control-Max-Age', '600');
      return res.status(204).end();
    }
    return next();
  }
  if (malformed) return rejectOrigin(req, res, `valeur invalide: ${String(declared).slice(0, 120)}`);
  if (!origin) {
    // Certains navigateurs / formulaires n'envoient pas Origin mais déclarent le contexte.
    if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
      return rejectOrigin(req, res, 'Sec-Fetch-Site: cross-site sans Origin');
    }
    return next();
  }
  if (!allowed) return rejectOrigin(req, res, `inconnue: ${origin}`);
  next();
}

// ---------------------------------------------------------------------------
// Divulgation responsable : /.well-known/security.txt (RFC 9116).
// Expires est calculé à chaque réponse pour ne jamais servir un fichier périmé.
// ---------------------------------------------------------------------------
function securityContact() {
  const value = String(process.env.NOVACORE_SECURITY_CONTACT || DEFAULT_SECURITY_CONTACT).replace(/[\r\n]+/g, ' ').trim();
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(value) || /^https?:\/\/\S+$/i.test(value)) return value.slice(0, 200);
  return DEFAULT_SECURITY_CONTACT;
}

function securityTxtExpiry(now = Date.now()) {
  const declared = String(process.env.NOVACORE_SECURITY_EXPIRES || '').trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(declared) && Date.parse(declared) > now) return declared;
  return new Date(now + 180 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function declaredBase(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (/^https?:$/.test(url.protocol)) return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch { /* URL illisible : on essaie la suivante. */ }
  return null;
}

function publicBase(req) {
  // Une origine déclarée est prioritaire sur l'en-tête Host : sinon un Host forgé
  // ferait pointer Canonical/Policy de security.txt vers un domaine attaquant.
  const explicit = declaredBase(process.env.PUBLIC_BASE_URL);
  if (explicit) return explicit;
  const novacoreUrl = declaredBase(process.env.NOVACORE_URL);
  if (novacoreUrl) return novacoreUrl;
  const configured = configuredOrigins();
  if (configured.length) return configured[0];
  return `${req.protocol === 'https' ? 'https' : 'http'}://${req.get('host')}`;
}

function securityTxt(req) {
  const base = publicBase(req).replace(/\/+$/, '');
  return [
    `# Politique de divulgation : ${base}/security-policy`,
    `Contact: ${securityContact()}`,
    `Expires: ${securityTxtExpiry()}`,
    'Preferred-Languages: fr, en',
    `Canonical: ${base}/.well-known/security.txt`,
    `Policy: ${base}/security-policy`
  ].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Avertissements de démarrage : uniquement en production, jamais bloquants.
// Le but est de rendre visibles les configurations qui dégradent silencieusement la
// sécurité (IP de proxy commune, liens dépendants du Host, origines non déclarées).
// ---------------------------------------------------------------------------
function startupWarnings() {
  if (!isProduction()) return [];
  const warnings = [];
  if (!process.env.TRUST_PROXY) warnings.push('TRUST_PROXY absent : derrière un reverse proxy, req.ip sera l’IP du proxy (limiteurs partagés par tous les utilisateurs) et req.protocol restera « http ».');
  if (!process.env.PUBLIC_BASE_URL) warnings.push('PUBLIC_BASE_URL absent : les liens de vérification et security.txt dépendent de l’en-tête Host. Déclare l’URL HTTPS publique.');
  if (!configuredOrigins().length) warnings.push('Aucune origine de confiance déclarée (NOVACORE_ALLOWED_ORIGINS ou PUBLIC_BASE_URL) : seules les requêtes de même origine sont acceptées.');
  if (!process.env.NOVACORE_SECURITY_CONTACT) warnings.push(`NOVACORE_SECURITY_CONTACT absent : /.well-known/security.txt publie l’adresse par défaut (${DEFAULT_SECURITY_CONTACT}).`);
  if (!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_FROM)) warnings.push('SMTP incomplet : les nouveaux comptes seront créés sans e-mail de vérification (les outils avancés restent verrouillés).');
  return warnings;
}

module.exports = {
  isProduction, secretIsStrong, devSecretFile, ensureConfig, createRateLimiter, limiters, checkPassword,
  requestId, contentSecurityPolicy, noStoreApi,
  normalizeOrigin, configuredOrigins, requestOrigins, isAllowedOrigin, originGuard,
  securityContact, securityTxtExpiry, securityTxt, startupWarnings,
  DEFAULT_SECURITY_CONTACT
};
