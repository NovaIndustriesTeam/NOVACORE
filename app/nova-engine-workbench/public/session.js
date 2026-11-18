// Nova Engine Workbench — classification des erreurs de session NovaID.
// Module volontairement sans dépendance : il est chargé par le navigateur et vérifié par
// test-session.mjs (vm.runInThisContext). Il ne contient aucune donnée utilisateur.
(function (root) {
  'use strict';

  const AUTH_CODES = new Set(['AUTH_REQUIRED', 'ACCOUNT_NOT_FOUND', 'SESSION_REVOKED', 'TOKEN_EXPIRED']);

  function classifyApiFailure(status, payload) {
    const code = payload && typeof payload.code === 'string' ? payload.code : null;
    const serverMessage = payload && typeof payload.error === 'string' ? payload.error : null;
    if (status === 401) {
      return {
        kind: 'expired',
        code: code || 'AUTH_REQUIRED',
        message: code === 'SESSION_REVOKED'
          ? 'Ta session a été révoquée. Reconnecte-toi avec NovaID.'
          : 'Session NovaID requise ou expirée.',
        needsLogin: true,
        canRetry: true
      };
    }
    if (status === 403 && code === 'EMAIL_NOT_VERIFIED') {
      return {
        kind: 'unverified',
        code,
        message: serverMessage || 'Vérifie ton adresse e-mail pour accéder à Nova Engine.',
        needsLogin: false,
        canRetry: true
      };
    }
    if (status === 403) {
      return {
        kind: 'forbidden',
        code,
        message: serverMessage || 'Accès refusé par NovaID.',
        needsLogin: false,
        canRetry: false
      };
    }
    if (status >= 500) {
      return {
        kind: 'server',
        code,
        message: serverMessage || `Le serveur local a répondu ${status}.`,
        needsLogin: false,
        canRetry: true
      };
    }
    return {
      kind: 'error',
      code,
      message: serverMessage || `Erreur HTTP ${status}.`,
      needsLogin: false,
      canRetry: false
    };
  }

  function decodeBase64Url(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    return root.atob ? root.atob(padded) : Buffer.from(padded, 'base64').toString('binary');
  }

  function readToken(token, now = Date.now()) {
    if (!token || typeof token !== 'string') {
      return { present: false, parsed: false, expired: false, email: null, name: null, expiresAt: null };
    }
    const parts = token.split('.');
    if (parts.length !== 3) return { present: true, parsed: false, expired: true, email: null, name: null, expiresAt: null };
    try {
      const payload = JSON.parse(decodeBase64Url(parts[1]));
      const expiresAt = Number.isFinite(Number(payload.exp)) ? Number(payload.exp) * 1000 : null;
      return {
        present: true,
        parsed: true,
        expired: expiresAt !== null && expiresAt <= now,
        email: typeof payload.email === 'string' ? payload.email : null,
        name: typeof payload.name === 'string' ? payload.name : null,
        emailVerified: payload.emailVerified === true,
        expiresAt
      };
    } catch {
      return { present: true, parsed: false, expired: true, email: null, name: null, expiresAt: null };
    }
  }

  function bannerFor(kind) {
    if (kind === 'unverified') {
      return {
        title: 'Adresse e-mail non vérifiée',
        text: 'Nova Engine exige un NovaID avec adresse vérifiée. Vérifie ton adresse depuis la page Compte de NovaCore, puis réessaie.',
        loginLabel: 'Ouvrir NovaCore',
        showLogin: true,
        showRetry: true
      };
    }
    if (kind === 'expired' || kind === 'signed-out') {
      return {
        title: 'Session NovaID requise',
        text: 'Le Workbench charge les scènes depuis NovaCore. Connecte-toi avec un NovaID vérifié : la scène et la bibliothèque s’ouvriront automatiquement au retour.',
        loginLabel: 'Se connecter à NovaID',
        showLogin: true,
        showRetry: true
      };
    }
    if (kind === 'offline') {
      return {
        title: 'Serveur local injoignable',
        text: 'NovaCore ou le Workbench ne répond pas. Vérifie que le serveur est démarré, puis réessaie.',
        loginLabel: 'Se connecter à NovaID',
        showLogin: false,
        showRetry: true
      };
    }
    if (kind === 'server') {
      return {
        title: 'Erreur du serveur local',
        text: 'Une erreur est survenue côté serveur. Consulte la console système puis réessaie.',
        loginLabel: 'Se connecter à NovaID',
        showLogin: false,
        showRetry: true
      };
    }
    return null;
  }

  const NovaSession = { classifyApiFailure, readToken, bannerFor, AUTH_CODES: Array.from(AUTH_CODES) };
  root.NovaSession = NovaSession;
  if (typeof module === 'object' && module.exports) module.exports = NovaSession;
})(typeof globalThis !== 'undefined' ? globalThis : this);
