# NovaCore — Roadmap de fiabilisation et de lancement public

> Document de passation pour toute IA, équipe ou personne qui reprendra le développement.  
> Règle absolue : ne jamais annoncer une fonction comme terminée sans preuve reproductible. Ne jamais sacrifier les données utilisateur pour une refonte visuelle.

## 0. État réel de cette livraison (3.10.0)

- **Lot 18 — sortie P0 données : sauvegardes chiffrées, rétention et restauration testée** : les sauvegardes locales sont écrites en **AES-256-GCM** (`server/backup-crypto.js`, format `NCBK1`, IV 12 octets, tag 16), avec clé `NOVACORE_BACKUP_KEY` prioritaire ou clé locale `backup-key` en `0600`. Une clé déclarée invalide **bloque les sauvegardes** au lieu d’écrire en clair, et un `backup-key` existant mais illisible **n’est jamais écrasé**. Rétention par nombre (`NOVACORE_BACKUP_KEEP`, 14) **et par âge** (`NOVACORE_BACKUP_MAX_AGE_DAYS`, 30 j, `0` désactive) ; un `.enc` que la clé courante n’ouvre pas n’est jamais supprimé **et ne consomme pas de place dans le quota**. `server/db.js` restaure indifféremment `.json.enc` et anciens `.json`, persiste `restore_pending` pour retenter une restauration impossible et `recovery_notice` pour survivre au redémarrage, conserve l’extension dans l’archive de restauration et expose `backup.*` (codes d’erreur normalisés) dans `GET /api/ready`. Seules les erreurs SQLite **structurelles** déclenchent la quarantaine. Correctif lot 17 : log d’origine refusée sur l’URL réelle et origine déclarée prioritaire sur `Host` dans `security.txt`. Onze défauts d’une revue indépendante (D1–D11, dont deux critiques) ont été corrigés. NovaCore **3.10.0** ; moteur, API C++, schéma et Workbench inchangés. Preuves : `npm test` **75/75** (dont `test/backup-encryption.test.js` **13/13** et `test/security-hardening.test.js` **8/8**), `npm run check` code 0 (11 fichiers), CTest **5/5**.

- **Lot 17 — sortie P0 sécurité : bordure HTTP et réponse aux incidents** : contrôle d’origine strict sur les écritures (`originGuard` monté sur `/api` et `/nova-engine`, **403 `ORIGIN_REJECTED`**, origines déclarées via `NOVACORE_ALLOWED_ORIGINS` / `PUBLIC_BASE_URL` / `NOVACORE_URL`, `Origin: null` et `Sec-Fetch-Site: cross-site` refusés, préflight `204`, `Vary: Origin`), **`/.well-known/security.txt`** (RFC 9116, `Expires` à 180 jours jamais périmé) avec redirection `/security.txt` et politique servie sur `/security-policy`, **`SECURITY.md`** et **`docs/INCIDENT-RESPONSE.md`** (confinement, rotation de `JWT_SECRET`, révocation, restauration, notification, post-mortem), **`limiters.write`** (60 actions / 15 min par compte) sur `PATCH /api/plugins/:id` et `POST /api/focus/sessions`, **avertissements de démarrage en production** (TRUST_PROXY, PUBLIC_BASE_URL, origines, contact, SMTP) et **`npm run check` étendu** à `server/security.js`, `server/auth.js`, `server/db.js` et `public/sw.js`. NovaCore **3.9.0** ; moteur, API C++, schéma et Workbench inchangés. Preuves : `npm test` **61/61**, `test/security-hardening.test.js` **7/7**, `npm run check` code 0, CTest **5/5**.

- **Lot 16 — fiabilité professionnelle du Workbench** : gestion de session NovaID **explicite** (bannière connexion/retry au lieu d’une scène vide), classification 401/403/5xx/réseau, sonde `/api/ping`, retour `?next=` après connexion, **secret JWT de développement persistant** (`$NOVACORE_DATA_DIR/jwt-secret`, mode `0600`, `JWT_SECRET` prioritaire, production toujours stricte), **autosave** après 1,4 s avec `Ctrl`/`Cmd+S`, **sauvegardes roulantes** (12 max) dans `data/backups`, **scène de démarrage complète** (caméra, Key Light, Rim Spot, Ground, Starter Cube, Starter Sphere) et **viewport responsive**. Workbench **1.9.0**, NovaCore **3.8.0**, moteur **0.8.0**, API **6**, schéma **4** inchangés. Preuves : `npm test` **54/54**, `test/security.test.js` **3/3**, `test-session.mjs` OK (session/template/autosave), `test:scene-api` OK.

- **Lancement public 3.0** : navigation par URL, identité et accès, design unifié, NovaOS et NOVAI enrichis, palette de commandes.
- **Vérification e-mail facultative** pour l’usage général, **obligatoire** pour NovaOS, Nova Engine, Nova Series, Nova IA (dont Learn Lab) et RetroEdge.
- **Aucune donnée de démonstration** : chaque compte retrouve son propre espace, synchronisé localement et côté serveur.
- **Stockage SQLite transactionnel (lot 7)** : import JSON unique et vérifié, schéma versionné, transactions WAL, sauvegardes JSON portables, quarantaine et restauration automatique. Données réelles migrées à l’identique.
- **Nova Engine (lots 8, 11, 12, 13, 14, 15 et 16)** : noyau C++ **0.8.0**, API C++ **6**, format de scène `schemaVersion 4` (1 à 3 toujours acceptés), CLI de validation/export, Workbench **1.9.0**, validation des scènes par le vrai binaire (`/api/engine/validate`), **rastériseur logiciel déterministe** (z-buffer, caméra, grille, gizmos, PNG), **lumières multiples** (directionnelle, point, spot — 16 validées, 8 évaluées), **shadow maps directionnelle et spot avec PCF** (résolution 128 à 2048), **textures PNG/JPEG** via `stb_image` et cache moteur, **HDR linéaire avec bloom half-res et tone mapping ACES/sRGB**, **primitives** cube/sphère/plan/cylindre/cône/tore/capsule/pyramide, **gameplay** (rigidbody, controller, spinner, collectible) simulé dans `Runtime::play`, **backend GPU Direct3D 12 hors écran** et **fenêtre native Win32 avec swapchain flip-model 3 buffers** partageant les mêmes pipelines, caméra libre clavier/souris et **capture PNG par readback du swapchain**. Rendu PNG protégé par NovaID vérifié (`/api/engine/render`). CTest **5/5** sous Windows, `npm run test:scene-api`, `npm run test:render` et `npm run test:gpu` OK, ce dernier couvrant les ombres, textures et bloom GPU, l’ouverture/arrêt HTTP de la fenêtre runtime et une capture 320×180. Le lot 16 ajoute session explicite, autosave/backups, template de démarrage et viewport responsive.
- **NovaSeries (lot 9)** : atelier complet (édition en place, duplication, réorganisation, suppression), exports JSON de projet, Markdown, CSV et impression/PDF, import legacy et enveloppé, diagnostic **12 contrôles**. Réimport complet et persistance vérifiés dans le navigateur.
- **Nova Feature Lab (lot 10)** : **50 modules réellement actionnables**, 8 catégories, héros de complétion, recherche et filtres, interrupteurs reliés à de vraies préférences, actions branchées sur l’application (pages, effets, Focus, notes, prompts, santé, cloud, exports). **Zéro « Concept — non actif »**, migration des anciens drapeaux indexés.
- **Preuves reproductibles** : `npm test` **75/75** (dont 8 tests de bordure HTTP au lot 17 et 13 tests de chiffrement/restauration au lot 18), `npm run check`, CTest **5/5** côté moteur (Windows), `npm run test:scene-api`, `npm run test:render` et `npm run test:gpu` du Workbench, viewport WebGL2 et rendu PNG validés dans un navigateur réel. Schéma 4 validé (tore, texture, spot, spinner, route assets) ; ombres et bloom vérifiés actifs en logiciel et GPU, leur désactivation modifiant réellement le PNG. Rendu GPU validé sur NVIDIA GeForce GTX 1660 SUPER (3 meshes, 1 022 triangles, 6 draw calls, 1 shadow map, 886 couleurs, PNG 230 663 octets) ; runtime natif validé à 1280×720 et capture HTTP 320×180.
- RetroEdge reste un **concept en développement** présenté comme tel : sa présence dans la navigation ne constitue pas une certification de compatibilité matérielle.
- Limites assumées : CSP avec `'unsafe-inline'`, déploiement mono-instance (PostgreSQL requis pour le multi-instance), fenêtre native/swapchain **Windows uniquement**, ombres portées limitées aux lumières directionnelle et spot (les points n’en projettent pas, maximum 2 shadow maps), viewport navigateur sans ombres portées, Metal/Vulkan non implémentés, ray tracing/VPS/NSR non commencés.

## 1. P0 — Sécurité et protection des comptes (bloquant avant exposition Internet)

1. Remplacer le secret JWT temporaire par un secret obligatoire, long, aléatoire et persistant. Refuser le démarrage de production si le secret est absent/faible. *(Lot 16 : fait en développement — `$NOVACORE_DATA_DIR/jwt-secret` persistant en `0600` ; la production continue de refuser tout secret de développement.)*
2. Séparer explicitement les modes `development` et `production`. Aucun lien de vérification d’e-mail ne doit être exposé dans les réponses ou les logs en production.
3. Mettre en place limitation de débit sur inscription, connexion, vérification e-mail, réinitialisation et API sensibles.
4. Ajouter politique de mot de passe, protection contre l’énumération des comptes, révocation/rotation des sessions et durée de vie documentée.
5. Vérifier les contrôles d’autorisation sur CHAQUE route : un utilisateur ne peut lire/modifier que ses propres données.
6. Configurer HTTPS derrière un reverse proxy documenté, cookies/sessions sécurisés si utilisés, CORS strict, Helmet/CSP adaptée et validation de toutes les entrées. *(Lot 17 : contrôle d’origine strict sur toutes les écritures, avertissements `TRUST_PROXY`/`PUBLIC_BASE_URL` en production, `security.txt` et politique de divulgation. HTTPS reste à la charge du reverse proxy.)*
7. Ne jamais stocker secrets SMTP/IA en clair dans des données accessibles au navigateur. Prévoir un gestionnaire de secrets ou variables d’environnement côté serveur.
8. Ajouter sauvegardes chiffrées, rétention, restauration testée et plan de réponse aux incidents. *(Lot 17 : plan de réponse aux incidents livré — `docs/INCIDENT-RESPONSE.md`, rotation de `JWT_SECRET` testée. Lot 18 : sauvegardes **chiffrées AES-256-GCM**, rétention par nombre **et par âge**, restauration automatique depuis `.json.enc` testée, clé `NOVACORE_BACKUP_KEY` ou `backup-key` (`0600`). Reste ouvert : copie hors site et rotation de clé outillée.)*

**Critère de sortie P0 :** revue de sécurité documentée, tests d’accès croisés entre deux comptes, tests d’abus de connexion, aucune vulnérabilité critique/haute non traitée.

## 2. P0 — Persistance et intégrité des données (bloquant avant public)

1. ✅ **Livré en 3.0.1** : stockage SQLite transactionnel via `node:sqlite` (mono-instance), import JSON unique, schéma versionné (`PRAGMA user_version` + `meta`).
2. ✅ **Livré en 3.0.1** : compteurs vérifiés avant validation de la transaction, JSON source archivé (`novacore.json.migrated-*`), restauration automatique depuis `backups/`, test d’import partiel refusé.
3. Vérifier isolation stricte par `user_id` sur projets, tâches, notes, préférences, fichiers, données NovaSeries et réglages.
4. Ajouter autosauvegarde, export complet et restauration par utilisateur.
5. Tester interruption du processus pendant écriture, disque plein, données corrompues et restauration de sauvegarde. *(Lot 18 : correction d’intégrité SQLite et restauration automatique depuis `.json.enc` couvertes par `test/backup-encryption.test.js` ; disque plein et coupure brutale restent à instrumenter.)*
6. Documenter précisément ce qui est local au navigateur, stocké sur le serveur et synchronisé.

**Critère de sortie :** tests automatisés de migration, restauration et isolation utilisateur réussis sur base de test.

## 3. P1 — Qualité produit et expérience

1. Établir une bibliothèque de composants partagés (boutons, champs, dialogues, notifications, cartes, tableaux, états vides).
2. Définir les tokens de design : couleurs, espacements, rayons, typographie, ombres, états de focus et densité.
3. Tester chaque page à 360 px, 768 px, 1024 px, 1366 px et 1920 px ; vérifier débordements, modales, tableaux et navigation mobile.
4. Ajouter tests clavier, lecteur d’écran, contrastes WCAG 2.2 AA, réduction des animations et messages d’erreur compréhensibles.
5. Corriger les erreurs de console, promesses non gérées, états de chargement infinis et pages qui échouent silencieusement.
6. Ajouter tests end-to-end des parcours essentiels : inscription, vérification, connexion, création/édition/suppression de projet, notes, tâches, export et déconnexion.
7. Ajouter journalisation structurée avec identifiant de requête, sans mot de passe, token ni donnée privée.

**Critère de sortie :** aucune erreur bloquante dans les parcours critiques et aucun défaut responsive P1 ouvert.

## 4. P1 — Performance, disponibilité et maintenance

1. Mesurer temps de démarrage, poids JS/CSS, mémoire, temps de réponse API et performances sur machine modeste.
2. Mettre en place health checks, arrêt gracieux, gestion des erreurs, rotation des logs et surveillance de disponibilité.
3. Ajouter vérification automatisée des dépendances, mises à jour contrôlées et inventaire logiciel (SBOM).
4. Mettre en place CI : lint, syntaxe, tests unitaires, tests API, tests end-to-end et création d’artefacts reproductibles.
5. Tester installation propre sur Windows, Linux et macOS ; documenter Node requis et procédure de mise à jour.
6. Versionner les API et les schémas de données ; documenter les changements incompatibles.

## 5. P2 — RetroEdge (projet distinct, non livré comme OS fonctionnel)

1. Écrire un cahier des charges produit et identifier précisément les appareils cibles (modèle, SoC, RAM, GPU, écran, contrôleurs, OS).
2. Séparer les éditions Android et Linux. Ne jamais présumer qu’une console Linux peut exécuter Android.
3. Faire un prototype d’interface avant de développer un système complet.
4. Définir le modèle de lancement des émulateurs, la gestion des métadonnées et les chemins de bibliothèques.
5. Vérifier les licences de chaque composant et ne distribuer aucun jeu, BIOS, ROM ou firmware propriétaire sans autorisation.
6. Créer un banc de test par appareil : démarrage, contrôles, audio, vidéo, veille/reprise, autonomie, température et stabilité.
7. Publier une matrice de compatibilité avec états `non étudié`, `en cours`, `testé`, `supporté`, et date de dernière validation.

**Critère de sortie :** aucun modèle ne reçoit le statut « supporté » sans test matériel reproductible et documentation publique.

## 6. P2 — Préparation du lancement public

- Nom de domaine, HTTPS, mentions légales, politique de confidentialité, conditions d’utilisation et politique de conservation des données.
- Support utilisateur, canal de signalement de sécurité et procédure de réponse aux incidents.
- Documentation d’installation, guide de mise à jour, FAQ et notes de version.
- Programme bêta fermé, collecte de retours consentie, puis déploiement progressif.
- Plan de retour arrière prêt et testé avant chaque publication.
- Communication honnête : distinguer prototype, bêta, stable et compatibilité vérifiée.

## 7. Règles de travail pour la prochaine IA

1. Lire ce document, `README.md`, `CHANGELOG.md`, le code serveur, les routes et les tests avant toute modification.
2. Faire une sauvegarde et travailler sur une branche/cop ie distincte.
3. Préserver les données utilisateur et ajouter une migration si le schéma change.
4. Ne pas remplacer des fichiers entiers si un correctif ciblé suffit.
5. Ajouter un test qui échoue avant le correctif et réussit après.
6. Exécuter réellement les tests disponibles ; noter ceux qui n’ont pas pu être exécutés.
7. Ne jamais inventer des résultats de tests, des fonctions ou un niveau de sécurité.
8. Mettre à jour version, changelog, documentation, service worker et scripts de lancement ensemble.
9. Vérifier l’archive finale et effectuer une installation propre.
10. Ne pas annoncer le lancement grand public tant que tous les critères P0 ne sont pas validés.

## Ordre recommandé

**P0 sécurité → P0 données → P1 parcours essentiels et tests → P1 responsive/accessibilité → P1 CI/observabilité → P2 bêta fermée → lancement progressif.**

Le rendu visuel seul ne constitue jamais une preuve de préparation à la production.
