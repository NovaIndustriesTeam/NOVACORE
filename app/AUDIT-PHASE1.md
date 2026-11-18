# NovaCore 2.20.1 — Audit technique complet

**Date :** 6 novembre 2026
**Version auditée :** `package.json` → **2.20.1** (dossier `NovaCore-2.10/`)
**Périmètre :** application web, serveur API, NovaID, stockage, noyau C++, Workbench, tests, sauvegardes.
**Méthode :** lecture intégrale du code, exécution des suites de tests, serveur d'audit isolé (port **6301**, dossier de données temporaire), sonde HTTP de 48 contrôles, parcours navigateur des 25 vues, Lighthouse, compilation et sonde C++.
**Garanties :** aucune donnée réelle de `~/.novacore/data/novacore.json` n'a été modifiée. Une sauvegarde ZIP complète a été créée avant l'audit : `NovaCore-2.10-backup-2026-11-06.zip`.

> **Règle appliquée :** une fonctionnalité n'est déclarée « opérationnelle » que si un test reproductible le prouve. Une fonctionnalité seulement affichée est classée « fictive » ou « inachevée ».

---

## 0. Synthèse exécutive

L'application **démarre, authentifie et fonctionne réellement**, mais elle ne respecte pas encore deux promesses structurantes :

1. **« Chaque utilisateur retrouve son environnement après une mise à jour »** → non démontré. Trois défauts P0 : secret JWT factice, workspace local non rattaché au compte, absence de restauration automatique à la connexion.
2. **« Aucune fonctionnalité affichée ne doit être fictive »** → non respecté. Données de démonstration présentées comme réelles, calendrier qui invente des dates, automatisations partielles, Feature Lab majoritairement conceptuel.

**Score global de l'audit :**

| Axe | État | Preuve principale |
|---|---|---|
| Démarrage / disponibilité | ✅ | `/api/health`, `/api/ready` → 200 |
| Routes API | 🟡 **47/48** | seul `GET /api/ai/models` → 503 |
| NovaID (serveur) | 🟢 solide | bcrypt 12, JWT HS256, révocation, anti-énumération, rate limiting |
| NovaID (configuration) | 🔴 | `JWT_SECRET` factice → clé éphémère |
| Isolation serveur entre comptes | ✅ | test dédié vert |
| Isolation client entre comptes | 🔴 | fuite `leak-marker` reproduite |
| Persistance / sauvegardes | 🔴 | `npm test` 13/14, restauration après corruption en échec |
| Frontend (25 vues) | 🟡 | 0 exception JS, 1 erreur console, Lighthouse a11y 91 |
| Noyau C++ | 🟡 | build OK, 1/1 test, mais 2 bugs non couverts |
| Tests automatisés | 🔴 insuffisant | 14 tests API, 1 test C++, 1 test Workbench |

**Décision recommandée :** appliquer le sprint **2.21 « Foundation »** (lots A + B + C partiel) avant toute nouvelle fonctionnalité. Aucun nouveau gros module.

---

# Livrable 1 — Inventaire des fichiers et modules

**Total : 47 fichiers, 4,71 Mo** hors `node_modules` et `.git`.

### 1.1 Répartition par dossier

| Dossier | Fichiers | Taille | Rôle |
|---|---:|---:|---|
| `public/` | 17 | 4 396,5 Ko | Interface NovaOS, styles, motion, PWA, images |
| racine | 8 | 264,7 Ko | `package.json`, docs, `.env`, `AUDIT-PHASE1.md` |
| `nova-engine-workbench/` | 14 | 79,6 Ko | Workbench web + noyau C++ + tests |
| `server/` | 5 | 64,9 Ko | API Express, stockage, auth, sécurité |
| `test/` | 2 | 14,8 Ko | Tests API Node + helpers |
| `desktop/` | 1 | 0,8 Ko | Enveloppe Electron |

### 1.2 Répartition par extension

| Extension | Nombre | Extension | Nombre |
|---|---:|---|---:|
| `.js` | 11 | `.cpp` | 3 |
| `.md` | 5 | `.json` | 3 |
| `.png` | 5 | `.css` | 3 |
| `.txt` | 3 | `.cjs` | 2 |
| `.html` | 2 | `.mjs` | 2 |
| `.woff2` | 2 | `.hpp` | 1 |
| `.bat` | 1 | `.webmanifest` | 1 |

### 1.3 Sources principales (taille en lignes)

| Fichier | Lignes | Taille | Rôle |
|---|---:|---:|---|
| `public/app.js` | 532 | 173,9 Ko | État global, routing, 25 vues, 169 handlers inline |
| `server/index.js` | 437 | 43,5 Ko | 29 routes, auth, sync, IA, proxy Workbench, arrêt gracieux |
| `public/styles.css` | 402 | 123,9 Ko | Thème principal |
| `public/motion.js` | 278 | 18,0 Ko | Animations, Noxa, étoiles |
| `public/polish.css` | 210 | 22,7 Ko | Couche de finition visuelle |
| `server/db.js` | 197 | 11,7 Ko | Base JSON, sauvegardes, restauration |
| `test/api.test.js` | 161 | 11,4 Ko | 14 tests API |
| `server/security.js` | 134 | 8,0 Ko | Rate limiting, CSP, politique mot de passe |
| `nova-engine-workbench/server.mjs` | 128 | 12,1 Ko | API Scene Lab |
| `public/index.html` | 108 | 14,2 Ko | Coquille HTML, 25 entrées de navigation |
| `nova-engine-workbench/engine/src/nova_core.cpp` | 90 | 4,4 Ko | Noyau C++ (scène, transforms) |
| `nova-engine-workbench/engine/include/nova/nova_core.hpp` | 79 | 2,3 Ko | API publique C++ |
| `test/helpers.js` | 52 | 3,4 Ko | Serveur isolé, création de compte vérifié |
| `nova-engine-workbench/engine/tests/core_tests.cpp` | 49 | 2,9 Ko | Test C++ unique |
| `nova-engine-workbench/public/app.js` | 49 | 18,7 Ko | UI Workbench |
| `nova-engine-workbench/test-scenes.mjs` | 26 | 1,8 Ko | Test API scènes |
| `server/auth.js` | 23 | 1,3 Ko | Vérification JWT + `token_version` |
| `desktop/main.cjs` | 18 | 0,8 Ko | Electron |
| `server/restart-dev.cjs` | 13 | 0,5 Ko | Relance locale |
| `public/boot.js` | 10 | 0,5 Ko | Boot / PWA |
| `public/sw.js` | 2 | 1,1 Ko | Service worker (2 lignes très denses) |

### 1.4 Modules logiques

| Module | Fichiers | État |
|---|---|---|
| **NovaID** (authentification) | `server/auth.js`, `server/security.js`, routes `/api/auth/*` dans `server/index.js` | 🟢 serveur, 🔴 configuration |
| **Stockage / persistance** | `server/db.js`, `~/.novacore/data/` | 🟡 fonctionnel mais fragile |
| **API REST** | `server/index.js` | 🟢 47/48 |
| **NovaOS (frontend)** | `public/app.js`, `index.html`, `styles.css`, `polish.css`, `motion.js`, `boot.js`, `sw.js` | 🟡 25 vues, dettes P1/P2 |
| **Nova Engine** | `nova-engine-workbench/**`, noyau C++ | 🟡 2 bugs non couverts |
| **Nova Desktop** | `desktop/main.cjs` | 🟡 enveloppe minimale, non testée |
| **Tests** | `test/**`, `core_tests.cpp`, `test-scenes.mjs` | 🔴 couverture insuffisante |
| **Documentation** | `README.md`, `CHANGELOG.md`, `PUBLIC_LAUNCH_ROADMAP.md`, 2 README Workbench | 🟢 honnête sur les limites |

**Poids des images :** 5 PNG = **3,87 Mo**, soit **82 %** du poids du projet. Les deux plus lourds : `nova-industries-poster.png` (1 442 Ko) et `retroedge-metal-logo.png` (1 374 Ko).

---

# Livrable 2 — Cartographie frontend / backend

### 2.1 Chaîne technique

```
Navigateur
├── localStorage
│   ├── novaToken        → JWT NovaID
│   └── novaWorkspace    → état complet du workspace (CLÉ GLOBALE, non liée au compte)
├── public/app.js        → 25 vues, état `state`, appels `api()`
└── public/sw.js         → cache PWA (nom figé v2.20.1-...-6300)
        │
        ▼  HTTPS/HTTP (Authorization: Bearer)
Serveur Express (port 6300)
├── /api/auth/*          → NovaID (register, verify, login, logout-all)
├── /api/me, /api/sync   → profil + workspace serveur (table user_data)
├── /api/search          → recherche dans le workspace du compte
├── /api/plugins         → catalogue + préférences par utilisateur
├── /api/analytics       → événements du compte
├── /api/focus/sessions  → sessions de concentration
├── /api/ai/chat         → routage Ollama local / cloud (clés côté serveur)
├── /api/export|import   → export/import JSON complet
├── /nova-engine         → proxy vers le Workbench enfant (127.0.0.1:5201)
└── server/db.js         → fichier JSON unique ~/.novacore/data/novacore.json
        │
        ├── backups/     → 14 derniers fichiers (rotation)
        ├── Ollama local / fournisseur cloud compatible OpenAI
        └── SMTP (optionnel, vérification e-mail)
```

### 2.2 Les 25 vues et leur source de données

| # | Vue (`data-page`) | Source de données | Backend | Persistance |
|---|---|---|---|---|
| 1 | `retroedge` | contenu statique (concept) | — | aucun |
| 2 | `overview` | `state` + analytics + plugins + dev status | `/api/analytics`, `/api/plugins`, `/api/developer/status` | localStorage |
| 3 | `projects` | `state.projects` | — (sync manuelle) | localStorage |
| 4 | `tasks` | `state.tasks` | — | localStorage |
| 5 | `notes` | `state.notes` | — | localStorage |
| 6 | `calendar` | `state.tasks` (dates inventées) | — | localStorage |
| 7 | `focus` | `state.focusSessions` + serveur | `POST /api/focus/sessions` | localStorage + serveur |
| 8 | `knowledge` | `state.knowledge` | — | localStorage |
| 9 | `studio` | `state.codeFiles` | — | localStorage |
| 10 | `novaengine` | iframe Workbench | `/nova-engine/*` | `data/scenes/*.json` |
| 11 | `novaseries` | `state.seriesStudio` | — | localStorage |
| 12 | `roadmap` | `state.roadmap` | — | localStorage |
| 13 | `search` | `state` + serveur | `/api/search` | lecture seule |
| 14 | `ai` | `chatHistory` + statut IA | `/api/ai/status`, `/api/ai/chat` | mémoire locale + serveur |
| 15 | `learnlab` | `state.learn*` + modèles | `/api/ai/models` | localStorage |
| 16 | `cloud` | `state` | `/api/sync` (GET/PUT, **manuel**) | localStorage + serveur |
| 17 | `plugins` | plugins serveur | `/api/plugins`, `PATCH /api/plugins/:id` | serveur |
| 18 | `novastore` | `state.storeDrafts` (prototype) | — | localStorage |
| 19 | `api` | documentation statique + `testApi()` | `/api/health` | aucun |
| 20 | `automation` | `state.automations` | — | localStorage |
| 21 | `analytics` | événements serveur | `/api/analytics` | serveur |
| 22 | `system` | diagnostics | `/api/diagnostics` | lecture seule |
| 23 | `developer` | statut + SMTP | `/api/developer/*` | serveur (mode dev) |
| 24 | `featurelab` | `state.featureFlags` | — | localStorage |
| 25 | `account` | préférences + auth | `/api/me`, `/api/auth/logout-all` | localStorage + serveur |

### 2.3 Appels frontend → backend (relevé dans `app.js`)

| Fonction frontend | Endpoint | Verbe |
|---|---|---|
| `runGlobalSearch` | `/api/search` | GET |
| `renderSystem` | `/api/diagnostics` | GET |
| `completeFocus` | `/api/focus/sessions` | POST |
| `testApi` | `/api/health` | GET |
| `loadApiDocs` | `/api/docs` | GET |
| `renderDeveloper` | `/api/developer/status` | GET |
| `loadSmtpSettings` / `saveSmtpSettings` | `/api/developer/smtp` | GET / POST |
| `testSmtpSettings` | `/api/developer/smtp/test` | POST |
| `activateDeveloperMode` | `/api/developer/activate` | POST |
| `render` | `/api/plugins` | GET |
| `togglePlugin` | `/api/plugins/:id` | PATCH |
| `render` | `/api/analytics` | GET |
| `refreshAIStatus` | `/api/ai/status` | GET |
| `refreshLearnModels` | `/api/ai/models` | GET |
| `sendChat` | `/api/ai/chat` | POST |
| `cloudPush` / `cloudPull` | `/api/sync` | PUT / GET |
| `routeAfterTerms` | `/api/me` | GET |
| `routeStartup` | `/api/auth/verify-email` | POST |
| `resendVerification` | `/api/auth/resend-verification` | POST |

**Constat de cartographie :** chaque bouton de navigation correspond à une vue réelle. En revanche, **la majorité des vues « métier » ne persistent qu'en `localStorage`** ; seules les vues `focus`, `plugins`, `analytics`, `cloud`, `search`, `account` et `ai` parlent réellement au serveur.

---

# Livrable 3 — Vérification de toutes les routes API

**Méthode :** sonde HTTP exécutée sur le serveur d'audit isolé (`http://localhost:6301`), 48 contrôles : codes attendus, protection sans jeton, validation d'entrée, révocation.

### 3.1 Résultat global

```
RÉSULTAT: 47/48 conformes
FAIL | 503 | attendu 200 | GET /api/ai/models (Ollama arrêté)
```

**Seul écart :** `GET /api/ai/models` renvoie **503** quand Ollama est indisponible, au lieu de dégrader proprement en liste vide / statut « non détecté ». C'est aussi la seule erreur console du parcours navigateur.

### 3.2 Tableau des routes (29 déclarations, dont 2 attrape-tout)

| Méthode | Route | Auth | Résultat vérifié |
|---|---|---|---|
| GET | `/api/health` | non | 200 |
| GET | `/api/ready` | non | 200 |
| GET | `/api/diagnostics` | non (401 en prod) | 200 / 401 en prod |
| GET | `/api/docs` | non | 200 |
| GET | `/api/system` | non | 200 |
| GET | `/api/ai/status` | non | 200 |
| GET | `/api/ai/models` | non | **503 si Ollama absent** |
| GET | `/api/developer/status` | non | 200 (404 en prod) |
| GET | `/api/developer/smtp` | non | 403 hors mode dev, 404 en prod |
| POST | `/api/developer/smtp` | non | 403 hors loopback / mode dev |
| POST | `/api/developer/smtp/test` | non | 403 hors mode dev |
| POST | `/api/developer/activate` | non | 400/403, 404 en prod |
| POST | `/api/auth/register` | non | 201 ; 400 faible ; 428 CGU ; 503 SMTP en prod |
| POST | `/api/auth/verify-email` | non | 200 ; 400 jeton invalide ; 410 expiré |
| POST | `/api/auth/resend-verification` | non | 200 (anti-énumération) |
| POST | `/api/auth/login` | non | 200 ; 401 ; 403 non vérifié ; 428 CGU |
| POST | `/api/auth/logout-all` | **oui** | 200 ; révoque les anciens jetons (401 après) |
| GET | `/api/export` | **oui** | 200 |
| POST | `/api/import` | **oui** | 200 export réel ; 400 format invalide ; 413 trop gros |
| GET | `/api/me` | **oui** | 200 ; 401 sans jeton |
| GET | `/api/sync` | **oui** | 200 ; 401 sans jeton |
| PUT | `/api/sync` | **oui** | 200 ; 400 JSON malformé ; 413 charge |
| GET | `/api/search?q=` | **oui** | 200 ; 400 si `q` vide ou > 120 |
| GET | `/api/plugins` | **oui** | 200 ; 401 sans jeton |
| PATCH | `/api/plugins/:id` | **oui** | 200 ; 400 booléen ; 404 inconnu |
| GET | `/api/analytics` | **oui** | 200 ; 401 sans jeton |
| POST | `/api/focus/sessions` | **oui** | 201 ; 400 minutes invalides |
| POST | `/api/ai/chat` | **oui** | 400 historique vide ; 502/503 fournisseur absent ; 200 fournisseur réel |
| GET | `/api/*` | — | 404 JSON |
| GET | `*` | — | fallback SPA `index.html` |
| (proxy) | `/nova-engine/*` | pages publiques ; `/api/` **auth requise** | proxy 127.0.0.1:5201 |

### 3.3 Points de sécurité confirmés par la sonde

- **Toutes les routes privées renvoient 401 sans jeton** (11/11).
- **Révocation effective** : après `logout-all`, l'ancien jeton → 401 (`token_version`).
- **Isolation serveur** : l'espace, l'export et les extensions d'un compte ne sont pas accessibles à un autre.
- **Limites d'entrée** : JSON malformé → 400 `BAD_JSON`, charge > 1 Mo → 413, workspace > 750 Ko → 413/507.
- **Recherche** : `q` vide ou > 120 → 400.
- **Rate limiting** actif sur auth, sync, IA, actions sensibles et API globale.
- **Aucune fuite de secret** : `/api/ai/status` et `/api/diagnostics` ne renvoient jamais les clés.

### 3.4 Écarts et manques

| # | Constat | Sévérité |
|---|---|---|
| API-1 | `GET /api/ai/models` → 503 non géré | P1 |
| API-2 | `GET /api/version` **n'existe pas** ; la version n'est pas exposée dynamiquement | P1 |
| API-3 | `/api/diagnostics` est public en développement (protégé en production) | P2 (acceptable, à documenter) |

---

# Livrable 4 — Audit NovaID et de la base de données

## 4.1 NovaID — ce qui est réellement sécurisé

| Contrôle | Implémentation | Preuve |
|---|---|---|
| Hachage mot de passe | **bcrypt, coût 12** | `server/index.js:263,266` |
| Politique mot de passe | ≥ 10 caractères, liste noire, anti-répétition, anti-email/nom | `security.checkPassword` |
| JWT | **HS256**, `expiresIn` 7 jours (`SESSION_TTL`), claims `sub`, `email`, `tv` | `issueToken` |
| Révocation | `token_version` incrémenté par `logout-all`, vérifié à chaque requête | `auth.js`, test vert |
| Vérification e-mail | jeton 32 octets, **haché SHA-256** en base, expiration **24 h** | `register`, `verify-email` |
| Anti-énumération | inscription d'un e-mail existant → même réponse 201 ; login → message identique | tests verts |
| Timing attack | `DUMMY_HASH` bcrypt comparé même si le compte n'existe pas | `server/index.js:306-312` |
| Rate limiting | login IP 30/15 min, login compte 8/15 min, register 10/h, resend 5/h, IA 20/min, sync 120/min, API 600/min | `security.limiters` |
| CGU | version `1.0`, acceptation obligatoire (428 sinon) | `register`, `login` |
| CSP / en-têtes | Helmet, `default-src 'self'`, `object-src 'none'`, HSTS en prod, `no-store` sur l'API | test 1 vert |
| Production | refus de démarrer sans secret fort | test 13 vert |

**Conclusion :** NovaID est un **vrai système d'authentification côté serveur**, pas une simple interface de connexion. Les primitives sont correctes.

## 4.2 NovaID — faiblesses réelles

| # | Faiblesse | Preuve | Impact |
|---|---|---|---|
| ID-1 | **`JWT_SECRET` factice** dans `.env` (56 caractères, 19 distincts) ; `secretIsStrong()` le refuse → clé éphémère à chaque démarrage | `stats.cjs`, log serveur | Toutes les sessions sont invalidées à chaque redémarrage/mise à jour |
| ID-2 | **`NODE_ENV` non défini** : le serveur tourne en développement, donc les garde-fous production ne s'activent pas | `.env` | Le mode « production » n'est jamais exercé en réel |
| ID-3 | **`.env.example` absent** du dossier extrait | racine | Installation et documentation incohérentes |
| ID-4 | Jeton stocké en **`localStorage`** | `app.js:6` | Vol de jeton en cas de XSS (CSP affaiblie par `unsafe-inline`) |
| ID-5 | **Aucune réinitialisation de mot de passe** | routes absentes | Un utilisateur qui oublie son mot de passe est bloqué |
| ID-6 | **Pas de 2FA**, pas de liste des sessions actives | routes absentes | Fonctionnalités de sécurité attendues non disponibles |
| ID-7 | Rate limiter **en mémoire**, mono-instance | `security.js:33` | Contournable en multi-instance / après redémarrage |
| ID-8 | `DEV_CODE_FALLBACK` en dur dans le code | `index.js:137` | Acceptable en dev, à exclure en production (déjà fait) |

## 4.3 Base de données — architecture réelle

**Ce n'est pas une base de données** : c'est un **fichier JSON unique** manipulé en mémoire, avec un adaptateur qui imite une API SQL (`prepare/get/all/run`).

- Fichier : `~/.novacore/data/novacore.json`
- Tables logiques : `users`, `user_data`, `plugins`, `events`, `nextEventId`
- Écriture : fichier temporaire + `fsync` + `rename` atomique, permissions `0600`
- Migration : ancien `data/novacore.json` copié une fois vers le dossier persistant
- Limite workspace : **750 Ko** par utilisateur
- Sauvegardes : dossier `backups/`, rotation à **14**, une toutes les **10 min**

**État observé (données réelles, lecture seule) :**

```
DB: 7,9 Ko
users=2  workspaces=2  events=28  plugins=3
BACKUPS: 14 fichiers, 82,1 Ko
backup « shutdown » présent (2026-11-05)
```

**Verdict :** l'isolation **serveur** est réelle (chaque `user_data` est indexé par `user_id`). En revanche :

- pas de transactions, pas de contraintes, pas de migrations versionnées ;
- pas de SQL réel, donc pas de requêtes complexes ni d'index ;
- mono-instance uniquement ;
- la restauration peut choisir une sauvegarde **périmée** (voir Livrable 8).

**Recommandation Phase 2 :** SQLite (`better-sqlite3`) ou PostgreSQL, avec migrations versionnées et sauvegarde avant migration.

---

# Livrable 5 — Fonctionnalités réellement opérationnelles

**Critère :** preuve reproductible (test automatisé vert, sonde HTTP, ou scénario navigateur rejoué).

### 5.1 Opérationnel (prouvé)

| Fonctionnalité | Preuve |
|---|---|
| Inscription NovaID | `POST /api/auth/register` → 201 (sonde) |
| Vérification e-mail (mode dev) | jeton réel → 200, puis login 200 |
| Connexion / déconnexion | login 200, `logout()` côté client |
| Politique de mot de passe | mot de passe faible → 400 (test vert) |
| Anti-énumération | réponses identiques (test vert) |
| Verrouillage après 8 échecs | 429 (test vert) |
| Révocation tous appareils | ancien jeton → 401 (test vert) |
| Isolation serveur entre comptes | espace/export/extensions (test vert) |
| Export / import complet | aller-retour (test vert) |
| Erreurs JSON / charge | 400/413 propres (test vert) |
| Refus de démarrer en prod sans secret | test vert |
| Routes développeur masquées en prod | test vert |
| Recherche dans le compte | `/api/search` → résultats (sonde) |
| Plugins : liste + activation par utilisateur | `GET`/`PATCH` (sonde) |
| Analytics du compte | `/api/analytics` (sonde) |
| Sessions Focus | `POST /api/focus/sessions` → 201 (sonde) |
| Chat IA (si fournisseur joignable) | `/api/ai/chat` → 200 ou 502 explicite |
| Workbench Scene Lab | `npm run test:scene-api` → OK |
| Noyau C++ (scène de base) | CTest 1/1 |

### 5.2 Partiel (fonctionne mais incomplet)

| Fonctionnalité | Limite |
|---|---|
| Synchronisation NovaCloud | **manuelle** (`cloudPush`/`cloudPull`), pas automatique à la connexion |
| Calendrier | affiche les tâches, mais **invente les dates** |
| Automatisations | seule « ajouter une note / exporter » agit ; déclencheurs simulés |
| Learn Lab | présent, dépend d'Ollama ; 503 non géré |
| NovaSeries | données locales, pas de backend dédié |
| NovaStore | prototype explicitement annoncé, paiements désactivés |
| RetroEdge | concept explicitement annoncé, compatibilité non validée |
| Workbench | build/test C++ réels, mais 2 bugs de scène non couverts |

### 5.3 Non opérationnel / fictif

Voir **Livrable 9** pour le détail.

---

# Livrable 6 — Analyse des erreurs JavaScript et C++

## 6.1 JavaScript — parcours navigateur

**Méthode :** serveur isolé `http://localhost:6301`, clic sur les **25 vues**, capture des `error`, `unhandledrejection` et console.

| Mesure | Résultat |
|---|---|
| Vues parcourues | **25/25** |
| Exceptions JavaScript | **0** |
| Promesses rejetées non gérées | **0** |
| Erreurs console | **1** : `GET /api/ai/models` → 503 (vue Learn Lab) |
| Handlers inline | **169** (dont **146 `onclick=`**) |
| Fonctions ciblées par un handler | 104 |
| Handlers appelant une fonction inexistante | **0** |
| Fonctions déclarées jamais référencées | 22 (dont `chart()` = code mort avéré) |

**Analyse statique :** aucune référence cassée dans les handlers. Les 22 fonctions « non appelées » sont majoritairement des helpers internes (motion, canvas) utilisés indirectement ; `chart()` est réellement morte.

### Lighthouse (serveur 6301)

| Catégorie | Score |
|---|---:|
| Accessibilité | **91** |
| Bonnes pratiques | **100** |
| SEO | **83** |

**Échecs détectés :**

| Audit | Détail |
|---|---|
| `button-name` | boutons `.task-row > button.check` sans nom accessible |
| `color-contrast` | texte du pied de page `#6f7690` sur `#070d1a` → 4,31 (insuffisant, 9 px) |
| `label-content-name-mismatch` | `.novaos-retroedge-spotlight` : texte non inclus dans le nom accessible |
| `robots-txt` | `robots.txt` absent |

### Défauts JavaScript / frontend identifiés

| # | Constat | Preuve |
|---|---|---|
| JS-1 | Workspace global `novaWorkspace`, non lié au compte, non vidé par `logout()` | `app.js:29-30,332` |
| JS-2 | Pas de `cloudPull()` à la connexion | `app.js:427` (routing post-login) |
| JS-3 | Données de démonstration injectées par `defaultState()` | `app.js:14-27` |
| JS-4 | Calendrier : dates fabriquées (`Date.now()+i*86500000`) | `app.js:172` |
| JS-5 | 146 `onclick=` → CSP `'unsafe-inline'` obligatoire | `security.js:104-114` |
| JS-6 | Version figée dans le footer (`2.20.0`) et le cache SW | `index.html:98`, `sw.js` |
| JS-7 | Aucune gestion du 503 `/api/ai/models` | console navigateur |

## 6.2 C++ — build, tests et bugs non couverts

**Environnement :** CMake 3.24+, Visual Studio 2026 Insiders, **MSVC 19.51.36243.0**, C++23.

```
cmake --build ... --config Release   → OK
ctest --test-dir ... -C Release      → 1/1 test passé (0,27 s)
```

**Le test existant** (`core_tests.cpp`) valide : nom/version du moteur, versions d'API, création d'entités, comptage, visibilité, recherche, hiérarchie de base, transforms simples.

**Sonde complémentaire écrite pour l'audit — 2 bugs réels :**

| # | Bug | Résultat de la sonde | Impact |
|---|---|---|---|
| C++-1 | **Suppression d'un parent** : l'enfant conserve un `parentId` orphelin | `world_before=1`, `parent_id_after_remove=set`, `world_after=0` | `worldTransform()` échoue silencieusement pour l'enfant |
| C++-2 | **Rotation du parent ignorée** dans le transform monde | position attendue ≈ `(0,1)`, obtenue `(1,0)` | Toute hiérarchie pivotée est fausse |

**Conclusion :** le noyau C++ compile et son test passe, mais **il ne couvre pas les cas limites structurants**. Un seul test réussi ne valide pas le module.

---

# Livrable 7 — Tests automatisés par module

## 7.1 Suites existantes

| Commande | Résultat | Détail |
|---|---|---|
| `npm test` | **13/14** | échec `test/api.test.js:122` → `401 !== 200` |
| `npm run check` | ✅ | syntaxe `index.js`, `app.js`, `motion.js`, `boot.js` |
| `npm run check --prefix nova-engine-workbench` | ✅ | `server.mjs`, `public/app.js` |
| `npm run test:scene-api --prefix nova-engine-workbench` | ✅ | « Named scene API test passed » |
| `cmake` + `ctest` | ✅ **1/1** | test C++ unique |

## 7.2 Matrice de couverture

| Module | Tests existants | Statut | Angles morts |
|---|---|---|---|
| Sécurité HTTP / CSP | 1 test | ✅ | — |
| Auth : routes privées sans jeton | 1 test | ✅ | — |
| Politique mot de passe | 1 test | ✅ | — |
| Anti-énumération | 1 test | ✅ | — |
| Login (messages identiques) | 1 test | ✅ | — |
| Rate limiting login | 1 test | ✅ | Autres limiteurs non testés |
| Isolation serveur | 1 test | ✅ | — |
| Révocation de session | 1 test | ✅ | — |
| Export / import | 1 test | ✅ | Très gros volumes non testés |
| Erreurs JSON / charge | 1 test | ✅ | — |
| Sondes de disponibilité | 1 test | ✅ | — |
| **Sauvegardes / restauration** | 1 test | 🔴 **ÉCHEC** | Cause identifiée (Livrable 8) |
| Configuration production | 2 tests | ✅ | — |
| Sync (GET/PUT) | indirect | 🟡 | Pas de test dédié de conflit/version |
| Recherche | sonde seulement | 🟡 | Accents, 120 car., types non testés |
| Plugins | sonde seulement | 🟡 | Isolation par utilisateur non testée |
| Analytics | sonde seulement | 🟡 | Agrégation non testée |
| Focus | sonde seulement | 🟡 | Limites 1–240 non testées |
| IA | sonde seulement | 🟡 | Aucun faux fournisseur, fallback non testé |
| **Frontend (25 vues)** | aucune | 🔴 | Aucun test de rendu / d'interaction |
| **NovaID client (fuite)** | aucune | 🔴 | Le bug P0-2 n'est couvert par aucun test |
| Workbench Scene API | 1 test | ✅ | 1 seul scénario |
| Noyau C++ | 1 test | 🟡 | Cas limites non couverts (2 bugs) |
| Desktop Electron | aucun | 🔴 | — |

**Verdict :** les tests actuels valident **la sécurité serveur** (bien) mais **pas le produit** : aucune couverture du frontend, de la fuite inter-comptes, de la restauration réelle, ni des cas limites C++.

---

# Livrable 8 — Sauvegardes et persistance

## 8.1 Ce qui existe

| Élément | Détail |
|---|---|
| Dossier persistant | `~/.novacore/data/` (hors dossier d'application → survit aux mises à jour) |
| Fichier principal | `novacore.json` (7,9 Ko observés) |
| Sauvegardes | `backups/novacore-<ISO>-<raison>.json` |
| Raisons | `auto`, `shutdown`, `pre-import` |
| Rotation | 14 fichiers (`NOVACORE_BACKUP_KEEP`) |
| Fréquence auto | au plus une toutes les 10 min (`NOVACORE_BACKUP_INTERVAL_MS`) |
| Écriture | temporaire + `fsync` + `rename` atomique, `0600` |
| Corruption | mise en quarantaine `.corrupt-<timestamp>` puis tentative de restauration |
| Export/import | sauvegarde `pre-import` avant écrasement |
| État observé | **14 backups, 82,1 Ko**, dont un `shutdown` du 2026-11-05 |

## 8.2 Cause exacte de l'échec du test de restauration

Le test (`api.test.js:122`) fait :

1. démarre un serveur isolé, crée un compte `dave`, écrit un workspace `Projet-Dave` ;
2. arrête le serveur (censé créer un backup `shutdown`) ;
3. corrompt `novacore.json` ;
4. redémarre : `load()` met le fichier en quarantaine et choisit la **première sauvegarde valide** ;
5. se reconnecte → **401** car le compte n'est pas dans la sauvegarde restaurée.

**Pourquoi :**

- `save()` crée la sauvegarde **avant** d'écrire le nouvel état (`backupNow('auto')` puis `rename`). La sauvegarde la plus récente contient donc l'état **précédent**.
- Sur **Windows**, `SIGTERM` ne déclenche pas le handler `shutdown()` (Node termine le process) → **aucun backup `shutdown`** n'est créé pendant le test.
- Résultat : la seule sauvegarde disponible est celle créée au **tout premier `save()`**, avant l'insertion de `dave` → base restaurée **vide** → login 401.

**Ce n'est donc pas le test qui est faux : c'est la stratégie de sauvegarde qui est fragile.** Le test doit rester strict.

## 8.3 Risques de persistance

| # | Risque | Gravité |
|---|---|---|
| PERS-1 | La sauvegarde la plus récente peut être **antérieure** à la dernière écriture valide | 🔴 |
| PERS-2 | Pas de backup sur arrêt sous Windows | 🔴 |
| PERS-3 | Restauration sans vérification d'intégrité métier (un JSON valide mais vide est accepté) | 🔴 |
| PERS-4 | Mono-fichier : une écriture interrompue reste possible malgré le `rename` (pas de journal) | 🟠 |
| PERS-5 | Pas de test de restauration **réel** en dehors de la suite (le seul test échoue) | 🔴 |
| PERS-6 | Pas de sauvegarde chiffrée ni externalisée | 🟠 |
| PERS-7 | Pas de migrations versionnées | 🟠 |

---

# Livrable 9 — Fonctionnalités fictives ou inachevées

**Règle :** est « fictive » toute fonctionnalité dont l'interface promet une action qui ne se produit pas réellement.

| # | Fonctionnalité | Ce que l'interface promet | Réalité | Sévérité |
|---|---|---|---|---|
| F-1 | **Données de démonstration** | 3 projets, 3 tâches, 1 note, 4 jalons, 1 automatisation présentés comme des données | Injectés par `defaultState()` pour **tous** les comptes, y compris neufs | 🔴 P0 |
| F-2 | **Calendrier** | Planning de la semaine avec dates | Les dates sont **calculées** (`Date.now()+i*86 500 000`) et les tâches réparties arbitrairement lundi/mercredi ; mention « placement visuel » en bas de page | 🟠 P1 |
| F-3 | **Automatisations** | Déclencheurs « Au démarrage (simulation) », « Fin de session (simulation) » | Seules les actions manuelles « ajouter une note » / « exporter » agissent ; les déclencheurs ne se déclenchent jamais | 🟠 P1 |
| F-4 | **Feature Lab (50 modules)** | « Active les modules » | 50 interrupteurs ; ~10 ouvrent une page existante, les autres affichent un simple toast. Le texte précise « concepts d'interface » mais les libellés restent ambigus | 🟠 P1 |
| F-5 | **NovaCloud Sync** | Synchronisation de l'espace | **Manuelle** (boutons push/pull) ; aucun pull automatique à la connexion | 🔴 P0 |
| F-6 | **NovaSeries Studio** | Production de série complète | Données 100 % locales, aucun backend, aucun rendu | 🟡 P2 (assumé) |
| F-7 | **NovaStore** | Place de marché | Prototype, paiements désactivés — **honnêtement annoncé** | 🟢 assumé |
| F-8 | **RetroEdge** | Plateforme pour consoles | Concept, compatibilité non validée — **honnêtement annoncé** | 🟢 assumé |
| F-9 | **Nova Engine** | Moteur 3D | Graphe de scène + transforms C++ uniquement ; **pas de renderer** — annoncé comme tel | 🟢 assumé |
| F-10 | **Learn Lab** | Entraînement de modèles | Dépend d'Ollama, ne réentraîne rien (le prompt le dit) | 🟡 P2 |
| F-11 | **IA hybride** | Bascule locale/cloud | Réelle si un fournisseur est configuré ; sinon 503/502 explicites | 🟡 P1 (dégradation) |
| F-12 | **Version affichée** | Pied de page 2.20.0 | `package.json` = 2.20.1 ; cache SW figé `...-6300` | 🟠 P1 |

**Bilan :** 5 fonctionnalités sont réellement fictives ou trompeuses (F-1 à F-5), 4 sont partielles (F-10 à F-12), 4 sont des prototypes **honnêtement étiquetés** (F-7 à F-9) qu'il ne faut pas compter comme des mensonges.

---

# Livrable 10 — Rapport final et corrections prioritaires

## 10.1 Bloquants P0 — à corriger avant toute nouvelle fonctionnalité

| # | Correction | Fichier(s) | Critère d'acceptation |
|---|---|---|---|
| **P0-1** | Générer un `JWT_SECRET` aléatoire fort (48 octets) et le conserver dans `.env` | `.env`, `server/security.js` | Deux redémarrages successifs → le même jeton reste valide |
| **P0-2** | Rattacher le workspace au compte : clé `novaWorkspace:<id>`, migration unique de l'ancien workspace anonyme, nettoyage à la déconnexion | `public/app.js` | Le scénario `leak-marker` ne reproduit plus la fuite |
| **P0-3** | Restaurer automatiquement le workspace serveur à la connexion et au démarrage, avec sauvegarde locale de sécurité | `public/app.js`, `server/index.js` | Créer un projet → déconnexion → reconnexion → projet présent |
| **P0-4** | Supprimer les fausses données pour les comptes réels ; état vide + appel à l'action | `public/app.js` | Compte neuf → 0 projet, 0 tâche, 0 note |
| **P0-5** | Fiabiliser les sauvegardes : sauvegarde **après** écriture valide, arrêt géré sous Windows, exclusion des backups vides/périmés, vérification d'intégrité | `server/db.js`, `server/index.js` | `npm test` → **14/14**, test de corruption vert |

## 10.2 Priorités P1 — vérité de l'interface

| # | Correction | Fichier(s) |
|---|---|---|
| P1-1 | Calendrier : vrai champ date ou « Non planifié », sans jour inventé | `public/app.js` |
| P1-2 | Automatisations : implémenter les déclencheurs ou les renommer « action manuelle » | `public/app.js` |
| P1-3 | Feature Lab : badge « Concept — non actif » sur chaque interrupteur non implémenté | `public/app.js` |
| P1-4 | Version unique exposée par `GET /api/version`, utilisée dans le footer et le cache SW | `server/index.js`, `index.html`, `sw.js` |
| P1-5 | Dégrader proprement l'absence d'Ollama (statut « local non détecté », pas de 503 console) | `server/index.js`, `public/app.js` |
| P1-6 | Remplacer les 146 `onclick=` par de la délégation, puis retirer `'unsafe-inline'` | `public/app.js`, `server/security.js` |
| P1-7 | Restaurer `.env.example` | racine |
| P1-8 | Corriger l'accessibilité Lighthouse (noms de boutons, contraste, `robots.txt`) | `public/app.js`, `styles.css`, `public/robots.txt` |

## 10.3 Priorités P2 — dette technique

| # | Correction |
|---|---|
| P2-1 | Découper `app.js` (174 Ko) par vue ou chargement à la demande |
| P2-2 | Découper `styles.css` (124 Ko) / `polish.css` (23 Ko) |
| P2-3 | Optimiser les images (WebP, lazy loading) — objectif < 500 Ko au premier écran |
| P2-4 | Supprimer `chart()` et le code mort |
| P2-5 | Migrer vers SQLite (Phase 2) avec migrations versionnées |
| P2-6 | Tests frontend (rendu des 25 vues, fuite inter-comptes, restauration) |
| P2-7 | Tests C++ de cas limites (parent orphelin, rotation) |
| P2-8 | Rate limiter partagé (Redis) pour multi-instance |

## 10.4 Sprint 2.21 « Foundation » proposé

**Objectif :** rendre vraies les promesses de base, sans changer le stockage (Phase 2 = 2.22).

### Lot A — Intégrité des données (obligatoire)

- **A1.** `JWT_SECRET` aléatoire fort + contrôle de démarrage explicite hors production.
- **A2.** Workspace local par utilisateur (`novaWorkspace:<id>`) + migration + nettoyage à la déconnexion.
- **A3.** Suppression des fausses données pour les comptes réels ; démo réservée au mode invité, badgée « Démonstration ».
- **A4.** Restauration automatique du workspace serveur à la connexion et au démarrage.
- **A5.** Sauvegardes fiables (après écriture, arrêt Windows, exclusion des backups vides, intégrité).

### Lot B — Vérité de l'interface

- **B1.** Calendrier sans date inventée.
- **B2.** Automatisations honnêtes.
- **B3.** Badge « Concept — non actif » sur le Feature Lab.
- **B4.** Version unique via `/api/version` (footer + SW).
- **B5.** Dégradation propre sans Ollama.

### Lot C — Sécurité et performance (démarré en 2.21, terminé en 2.22)

- **C1.** Délégation d'événements + suppression de `'unsafe-inline'`.
- **C2.** Images WebP + lazy loading.
- **C3.** Découpage de `app.js`.
- **C4.** `.env.example`.
- **C5.** Suppression du code mort.
- **C6.** Accessibilité Lighthouse (boutons, contraste, `robots.txt`).

**Definition of Done 2.21 :** `npm test` **14/14** · aucun faux contenu pour un compte réel · session stable après redémarrage · restauration vérifiée · calendrier sans date inventée · version cohérente partout · 0 erreur console.

## 10.5 Phase 2 (2.22) — cadrage seulement

Le stockage JSON mono-fichier reste acceptable pour 2.21 mais **incompatible** avec les exigences « base réelle, isolation par utilisateur, migrations versionnées, sauvegardes automatiques » :

- SQLite via `better-sqlite3` (ou PostgreSQL si multi-instance) ;
- schéma `users`, `sessions`, `workspaces`, `migrations` ;
- migrations versionnées + transaction + sauvegarde avant migration ;
- sauvegardes planifiées, vérifiées et restaurables ;
- reprise de l'export JSON 2.20.1 → 2.22 sans perte.

## 10.6 Fichiers concernés par les correctifs 2.21

| Fichier | Correctifs |
|---|---|
| `.env` | A1 |
| `server/security.js` | A1, C1 (CSP) |
| `server/db.js` | A5 |
| `server/index.js` | A4, B4, B5 |
| `public/app.js` | A2, A3, A4, B1, B2, B3, C1, C3, C5, C6 |
| `public/index.html` | B4, C6 |
| `public/sw.js` | B4 |
| `public/styles.css` / `polish.css` | C6 |
| `test/api.test.js` | A5 (doit rester identique sur le fond, et devenir vert) |

---

## Annexe A — Commandes reproductibles

```bash
# Tests API (13/14 attendu avant correction)
npm test

# Syntaxe
npm run check

# Workbench
npm run check --prefix nova-engine-workbench
npm run test:scene-api --prefix nova-engine-workbench

# C++ (exemple)
cmake -S nova-engine-workbench/engine -B build
cmake --build build --config Release
ctest --test-dir build -C Release --output-on-failure
```

Sonde API et parcours navigateur : serveur isolé `NOVACORE_DATA_DIR=<temp> PORT=6301 node server/index.js`, puis 48 contrôles HTTP et clic sur les 25 vues.

## Annexe B — Limites de l'audit

- Audit **en lecture seule** : aucune correction n'a été appliquée aux fichiers du projet.
- Le test de restauration n'a **pas** été affaibli pour le faire passer.
- Le parcours navigateur a été fait sur un serveur isolé (port 6301), pas sur les données réelles (port 6300).
- Les captures d'écran ne sont pas analysables par l'agent ; les constats visuels reposent sur le DOM, la console et Lighthouse.
- L'IA n'a pas pu être testée avec un fournisseur réellement joignable (Ollama arrêté) ; le comportement 502/503 a été vérifié à la place.
- Le C++ a été compilé avec MSVC 19.51 (VS 2026 Insiders) ; les résultats peuvent varier avec un autre compilateur.

---

*Rapport généré en lecture seule. Aucune correction n'a été appliquée. En attente de validation explicite pour le sprint 2.21 (lots A + B + C partiel) et le nettoyage des comptes de test.*
