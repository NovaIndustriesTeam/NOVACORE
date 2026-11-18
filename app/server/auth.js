const jwt = require('jsonwebtoken');
const db = require('./db');

// Vérifie le jeton, le compte et la « version de session » : « Déconnecter tous les appareils »
// incrémente token_version, ce qui révoque immédiatement tous les jetons émis auparavant.
// La vérification e-mail est facultative pour l'usage général : requireAuth n'exige plus
// un compte vérifié. L'état réel est relu depuis la base (jamais depuis le jeton seul).
function authenticate(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) { res.status(401).json({ error: 'Connexion requise.', code: 'AUTH_REQUIRED' }); return false; }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const account = db.getUserById(payload.sub);
    if (!account) {
      res.status(401).json({ error: 'Compte introuvable.', code: 'ACCOUNT_NOT_FOUND' });
      return false;
    }
    if ((payload.tv ?? 0) !== (account.token_version ?? 0)) {
      res.status(401).json({ error: 'Session révoquée. Reconnecte-toi.', code: 'SESSION_REVOKED' });
      return false;
    }
    req.user = { ...payload, emailVerified: account.email_verified === true };
    return true;
  } catch {
    res.status(401).json({ error: 'Session invalide ou expirée.' });
    return false;
  }
}

function requireAuth(req, res, next) {
  if (authenticate(req, res)) next();
}

// Outils avancés (Nova Engine, NovaOS, Nova Series, Nova IA, RetroEdge) : adresse vérifiée obligatoire.
function requireVerified(req, res, next) {
  if (!authenticate(req, res)) return;
  if (req.user.emailVerified !== true) return res.status(403).json({ error: 'Vérifie ton adresse e-mail pour accéder à cet outil.', code: 'EMAIL_NOT_VERIFIED' });
  next();
}

module.exports = { requireAuth, requireVerified };
