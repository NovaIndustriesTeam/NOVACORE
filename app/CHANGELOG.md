# NovaCore 3.10.0 — Lot 18 : sauvegardes chiffrées, rétention et restauration testée

## Mise à niveau 2026 — dépendances, sécurité et conformité (17 novembre 2026)

La version applicative reste **3.10.0**. Évolution sans changement de format de données ; sources
officielles consultées directement (`websearch` indisponible, HTTP 402) : Electron Security et
Breaking Changes, W3C WCAG 2.2, Node.js Releases, web.dev Web Vitals.

- **Audit initial prouvé** : runtime Node embarqué `v24.15.0` (LTS, Node 20 EOL depuis le
  24/03/2026) ; Electron `34.5.8`, builder `25.1.8`, nodemailer `6.10.1`. `npm audit --omit=dev`
  signalait **1 faille `high`** (nodemailer `<=10.1.3`, 23 avis cumulés) ; l’audit complet signalait
  **18 failles** (4 moderate, 13 high, 1 critical) dont Electron `<=42.11.15` et builder `<=26.14.0`.
- **Corrections appliquées** (sauvegardes `%TEMP%\nova-backups\pre-nodemailer-10-…` et
  `pre-electron45-builder26-…`) :
  - `nodemailer@10.6.0` (`--save-exact`) — API `createTransport`/`sendMail`/`verify` inchangée.
    `npm audit --omit=dev` → **0 faille de production**.
  - `electron@45.3.4` et `electron-builder@26.18.0` (`--save-exact`, versions latest officielles).
    Audit complet résiduel : **11 failles** (5 moderate, 6 high), toutes dans l’**outillage de
    build** (`electron-builder` et dépendances transitives), **aucune dans l’app livrée** ; le
    « fix » suggéré par npm est un faux positif (downgrade vers `25.1.0`, déjà vulnérable) et n’est
    donc pas appliqué.
- **Compatibilité vérifiée** : lecture locale de `electron/docs/breaking-changes.md` (v35→v47) —
  `desktop/main.cjs` (processus principal, pas de preload, `contextIsolation`/`sandbox` actifs,
  spawn du runtime Node externe) n’utilise **aucune** API affectée (shims preload, `safeStorage`
  sync, clipboard renderer, ia32 retiré). Test de lancement réel Electron 45 via CDP (profil
  séparé, `--remote-debugging-port`) : page NovaOS + service worker chargés, `/api/version` 3.10.0,
  `hackerGame` absent, boutons `novaTour`/`languageBtn` présents, **0 animation infinie calculée**
  (8 éléments animés finis sur 490).
- **Conformité WCAG 2.2** (Recommandation W3C du 12/12/2024) : audit statique des nouveaux
  critères — `:focus-visible` défini (contour 2 px + halo), `skip-link` présent, cibles d’action
  généralement ≥ 24 px (`icon-btn` 36–40 px), champs avec `autocomplete` (`name`, `email`,
  `current-password`/`new-password`) et libellés associés, `prefers-reduced-motion` et
  `prefers-reduced-transparency` gérés. Aucun correctif hasardeux appliqué sans preuve.
- **Core Web Vitals** (CDP, seuils LCP < 2,5 s / INP < 200 ms / CLS < 0,1) : LCP **568 ms**
  (utilisateur revenant, intro ignorée) à **2,71 s** (premier chargement avec intro), FCP
  **2,49 s**. CLS mesuré **~0,24** : l’analyse des `layout-shift` montre un décalage de 0,192
  sur `<body>` quand le contenu est injecté sous l’overlay d’intro plein écran — non perceptible
  par l’utilisateur. Hypothèse `scrollbar-gutter: stable` testée puis **annulée** (CLS inchangé à
  0,244), conformément à la règle « aucun changement sans preuve ».
- **Validation après bumps** : `npm run check` code 0 (22 fichiers), `npm test` **83/83** (59,4 s).
- **Installateurs finaux rebuildés** (`npm run dist`, code 0, builder `26.18.0`, Electron `45.3.4`,
  17 novembre 2026) :
  - `NovaCore-Setup-3.10.0-x64.exe` — **150 742 268 o**, SHA-256
    `6D154BCF319953DF8F6D8CE25B86C8EADCC5FC839186ED1F3B00B09B34A71CD6`.
  - `NovaCore-Portable-3.10.0-x64.exe` — **137 365 778 o**, SHA-256
    `C04687D93E21CBAD27075973F211CCB908EB0659C2D5690E2E8B3908E34BDA0F`.
  - `win-unpacked/NovaCore.exe` — **249 907 712 o**, `ProductVersion 3.10.0` (tailles en hausse
    vs Electron 34 : moteur Chromium/Node plus récent).
  - Anciens artefacts (Electron 34) sauvegardés dans
    `%TEMP%\nova-backups\dist-before-electron45-2026-11-17-2139` ; `asar:false`, `npmRebuild:false`,
    NSIS one-click sans élévation et portable conservés.
- **App installée remplacée** (choix utilisateur) : ancienne installation sauvegardée dans
  `%TEMP%\nova-backups\installed-before-electron45-2026-11-17-2202` (370 Mo), build `win-unpacked`
  recopié dans `%LOCALAPPDATA%\Programs\novacore-total` en préservant `Uninstall NovaCore.exe`.
  Vérification CDP (port 9228) : page NovaOS + service worker chargés, `/api/version` 3.10.0,
  nodemailer **10.6.0**, `hackerGame` absent, boutons tutoriel/langue présents, **0 animation
  infinie calculée** (14 éléments animés finis), `dxcompiler.dll`/`electron_wer.dll` présents.
- Limite : 11 failles de build restantes non corrigeables sans casser l’outillage (correctif amont
  attendu) ; artefacts Windows toujours **non signés** (SmartScreen « éditeur inconnu »).

## Correctif performance — freeze gris de l’app installée (17 novembre 2026)

Symptôme rapporté : « l’app est lente et buguée avec des freeze gris toutes les 2 secondes »,
apparu après l’installation du nouveau setup (couche visuelle Milenium 4.4). La version
applicative reste **3.10.0**.

- **Cause prouvée** : `public/milenium.css` contient **39 animations `infinite`** qui saturent le
  compositeur sur un écran 120/165 Hz. Mesures CDP reproductibles sur 4 s : tout actif renderer
  **2,19 s** / GPU **2,27 s** ; `animation-iteration-count: 1` **0,69 s** / **0,42 s** ;
  `animation: none` **0,33 s** / **0,38 s** ; retour baseline **3,02 s** / **2,11 s**. Le flou
  (`backdrop-filter`) et la 3D seuls n’expliquaient pas le gain du mode `perf-lite`. Le volet
  d’intro masqué (`visibility:hidden`) continuait à animer `dotBlink` et `reSpotlight`.
- **Correctif** (`public/nova-perf.css`, 3 812 o) : `animation-iteration-count: 1 !important`
  sur tout élément, sauf `.loading-dot`, `.spin` et `[class*="spin"]` (indicateurs de chargement) ;
  `animation: none !important` sur `.nova-intro.is-hidden` et descendants. 3D, dégradés, flou et
  chargement conservés — seule la boucle change.
- **Diffusion** : `sw.js` → `CACHE_REVISION='2026-11-17-animation-loops-fix-1'`. Correctif appliqué
  immédiatement à l’app installée (`%LOCALAPPDATA%\Programs\novacore-total\resources\app\public\`)
  avec sauvegarde `%TEMP%\nova-backups\pre-animation-loops-fix-2026-11-17`, sans réinstallation.
- **Vérification finale** (app installée, 3D active, `perf-lite` OFF, premier plan) : CPU renderer
  **0,53 s/6 s (9 %)**, GPU **0,70 s/6 s (12 %)** ; **661 images/4 s**, écart max **103 ms**,
  aucun gap > 200 ms ; **0 animation infinie**. Même contrôle rejoué sur le portable rebuildé
  (port 9225) : correctif chargé, 0 animation infinie, `/api/version` → 3.10.0.
- **Tests** : `npm run check` code 0 (22 fichiers), `npm test` **83/83** (60,8 s),
  `ctest -C Debug` **5/5** (7,63 s) dans `nova-engine-workbench/engine/build`.
- **Installateurs finaux reconstruits** (`npm run dist`, code 0, 17 novembre 2026) :
  `NovaCore-Setup-3.10.0-x64.exe` (**150 742 268 o**, SHA-256
  `6D154BCF319953DF8F6D8CE25B86C8EADCC5FC839186ED1F3B00B09B34A71CD6`) et
  `NovaCore-Portable-3.10.0-x64.exe` (**137 365 778 o**, SHA-256
  `C04687D93E21CBAD27075973F211CCB908EB0659C2D5690E2E8B3908E34BDA0F`) ;
  `win-unpacked/NovaCore.exe` **249 907 712 o**, `ProductVersion 3.10.0`. Les artefacts à ~57 Mo
  d’un build précédent (disque saturé à 0,15 Go) ont été **rejetés** : exécutable tronqué
  (11,8 Mo, `%1 n’est pas une application Win32 valide`) puis partiel (124 Mo, version vide).
  Le build final a été relancé après libération de 3,8 Go. Artefacts toujours **non signés**.
- Limite : le flash gris lui-même n’a pas été capturé par échantillonnage de pixels ; la surcharge
  CPU est prouvée et corrigée, la confirmation visuelle utilisateur reste à recueillir.

Version publiée le 14 novembre 2026. `package.json`, `package-lock.json`, le footer, `/api/version` et le cache PWA affichent `3.10.0`. Nova Engine reste au noyau **0.8.0**, l’API C++ à **6**, le schéma de scène à **4** et le Workbench à **1.9.1**. Aucun format de données utilisateur ne change ; les anciennes sauvegardes `.json` restent lisibles.

## Interface Milenium 4.4 (couche visuelle)

La version applicative reste **3.10.0** ; « Milenium 4.4 » est la couche d’affichage la plus
récente, livrée par-dessus la couche 4.1 « Design Final » sans changer la logique métier.

- `public/milenium.css` (416 548 o) remplace `design-4.css` : 1 675 sélecteurs, dont les
  1 451 de la 4.1 ; polices Inter/Space Grotesk toujours en `data:` ; aucun `@import` ni `url()`
  réseau.
- Nouveaux scripts locaux : `studio-3d.js` (14 790 o, page `anim3d`, API `window.NovaAnim`,
  stockage `novacore.anim.v1`) et `nova-scene.js` (22 155 o, scène `#nova3d` GPU, cadence
  adaptative, pause hors onglet). La galaxie quitte `nova-space.js` (16 003 o) pour
  `nova-scene.js`, conformément à l’architecture 4.4.
- `loading-genesis.js` (10 469 o), `motion.js` (19 250 o) et `design-shell.js` (17 652 o)
  passent en 4.4 ; `motion.js` met sa boucle en pause sous `body.ns-on`, `design-shell.js`
  réveille la scène après un changement d’option.
- `public/index.html` : feuille `/milenium.css`, bouton `◇ Studio 3D`, ordre
  `three.min.js` → `loading-genesis.js` → `nova-space.js` → `studio-3d.js` → `nova-scene.js` →
  `design-shell.js`.
- `public/app.js` : trois retouches seulement (`NAV_PAGES`, libellé, rendu `anim3d`).
- `public/sw.js` : `CACHE_REVISION='2026-11-16-milenium-4-4-studio-3d'`, `SHELL` avec
  `milenium.css`, `studio-3d.js` et `nova-scene.js`.
- `package.json` : `npm run check` couvre 18 fichiers (5 serveur, 12 publics, 1 bureau).

Garde-fous conservés : `body.ns-on` n’est posé qu’avec WebGL, sans `prefers-reduced-motion` ni
`body.no-animations` ; sinon barre latérale classique, sans dock ni canvas. La touche `O` reste
bloquée sous un panneau ouvert. Le script de démarrage du fichier de design (faux jeton
`novaToken`, acceptation automatique des conditions) **n’a pas été repris**.

Preuves du 16 novembre 2026 : `npm run check` code 0 (18 fichiers), `npm test` **75/75**,
`ctest -C Debug` **5/5** ; chargement avec `ns-on`, dock, anneau et `#nova3d` actifs, aucune
erreur console, aucune requête externe ; anneau `O` → 26 tuiles, `Échap` ferme ; Studio 3D
écrit `novacore.anim.v1` et la scène applique `saturn` ; `no-animations` masque `#nova3d` ;
interface classique et retour 3D fonctionnels ; Lighthouse accessibilité **1.0**, bonnes
pratiques **1.0**, SEO **1.0**. Artefacts reconstruits : `NovaCore-Setup-3.10.0-x64.exe`
(110 950 545 o, SHA-256 `026602A458FEB871EB612E206C77EFEBF27F24439A45D03EA72CFDB2BAF64ADD`) et
`NovaCore-Portable-3.10.0-x64.exe` (110 770 582 o, SHA-256
`EE33AE95FE9A644BCE4496D6C68684472CD494317087928C3706BF08C13ED921`), tous deux sans signature
Authenticode. Ces deux empreintes sont **remplacées** par la reconstruction du 17 novembre
(voir la section suivante).

## Interface 3.10.0 — accueil, langue, performances et actions NOVAI (17 novembre 2026)

Compléments livrés sans bump de version, sans nouvelle dépendance et sans requête externe. Ils
remplacent les valeurs du 16 novembre pour `sw.js`, `package.json` et les tailles de fichiers.

- **Tutoriel d’accueil** : `public/nova-tour.js` (10 054 o), 8 étapes, Précédent / Suivant /
  Passer / Terminer, flèches, `Échap`, focus piégé et restauré, case « Ne plus afficher au
  démarrage ». État dans `state.preferences.tourVersion`, rejouable depuis Compte & sécurité.
- **Langue FR/EN** : `public/i18n.js` (51 268 o). Dictionnaire de la coque, des pages, du
  contrat, du tutoriel et de NOVAI ; traduction des nœuds texte et des attributs `placeholder`,
  `title`, `aria-label`, `alt` ; contenus utilisateur ignorés ; persistance `novaLang` ;
  réapplication par `MutationObserver`. Bouton `#languageBtn` dans la barre supérieure.
- **Actions NOVAI** : `server/ai-actions.js` (9 214 o) et `public/nova-commands.js` (14 167 o).
  10 types whitelistés, 3 actions maximum, champs inconnus supprimés, pages / thèmes / accents /
  priorités / collections contrôlés. `delete_item` exige `confirmed: true` ; aucune exécution de
  shell, aucun `eval`, aucun accès fichiers ou réseau. Les instructions ne sont ajoutées au
  prompt que si `novaiActions !== false`.
- **Mode performance** : `public/nova-perf.css` (3 812 o depuis le correctif des boucles ci-dessus) + préférence `performanceMode` ;
  `body.perf-lite` coupe 3D, flous et animations décoratives, pause sous onglet masqué, respect
  de `prefers-reduced-transparency`. Réversible.
- **Mini-jeu hacker retiré** : bouton, overlay, fonctions, déclencheurs clavier et 5 clics,
  clé `novaStyleHacker`, CSS associé. Aucune fonction métier supprimée.
- **Scène 3D** : `public/nova-scene.js` (23 445 o) plafonne à **60 i/s** en interaction,
  **30 i/s** au repos et **15 i/s** après 20 s, avec epsilon de comparaison (`1e-3`), pause si
  `!document.hasFocus()` ou page masquée, et `setQuality()`.
- **Coque** : `index.html` charge `milenium.css`, `nova-perf.css`, `nova-ui.css` et 14 scripts
  locaux (`i18n.js` avant `app.js` ; `nova-commands.js` et `nova-tour.js` après).
- **Préférences** : « Réinitialiser l’apparence » repart de `DEFAULT_PREFERENCES` en conservant
  `performanceMode`, `tourVersion` et `novaiActions` ; auparavant, la réinitialisation
  supprimait ces trois clés (18 clés conservées, thème et accent remis par défaut).
- **Cache** : `CACHE_REVISION='2026-11-17-animation-loops-fix-1'` (révision incrémentée après le
  correctif des boucles, le service worker servant le cache en priorité ; remplace
  `…-i18n-tour-novai-actions-2`) ; le
  `SHELL` ajoute `nova-perf.css`, `nova-ui.css`, `i18n.js`, `nova-commands.js` et
  `nova-tour.js`.
- **Vérifications** : `npm run check` code 0 sur **22 fichiers** ; `npm test` **83/83** (dont
  `test/ai-actions.test.js` **8/8**) ; `ctest -C Debug` **5/5**. Navigateur : aucune erreur
  console, FR↔EN immédiat (titre du document inclus), tutoriel 8 étapes avec focus piégé,
  `run_shell` et page inconnue refusés, suppression confirmée, `perf-lite` réversible, cache
  rechargé en `…-animation-loops-fix-1`. Trace de rechargement : 2 longues tâches (71 ms), aucun
  flux `FireAnimationFrame` au repos.
- **Installateurs** : ceux de cette section ont été remplacés par les **installateurs finaux**
  décrits en tête de fichier (correctif des boucles inclus) : `NovaCore-Setup-3.10.0-x64.exe`
  (**150 742 268 o**, SHA-256
  `6D154BCF319953DF8F6D8CE25B86C8EADCC5FC839186ED1F3B00B09B34A71CD6`) et
  `NovaCore-Portable-3.10.0-x64.exe` (**137 365 778 o**, SHA-256
  `C04687D93E21CBAD27075973F211CCB908EB0659C2D5690E2E8B3908E34BDA0F`). Contenu vérifié :
  cinq nouveaux fichiers d’interface, `server/ai-actions.js`, `sw.js` en
  `…-animation-loops-fix-1`, correctifs `resetPreferences` et boucles, `ProductVersion 3.10.0`.
- Limites : viewport mobile non émulé par l’outil navigateur ; capture d’écran indisponible
  (fenêtre non visible), validation par DOM et styles calculés ; actions NOVAI dépendantes du
  fournisseur IA configuré ; artefacts Windows toujours non signés.
- Les artefacts du 17 novembre n’ont pas été réinstallés : le contenu embarqué est vérifié dans
  `dist/win-unpacked` ; les essais NSIS du 15 novembre restent la référence.

## Application de bureau Windows (nouveau)

- Empaquetage **Electron 34.5.8** + **electron-builder 25.1.8** : deux artefacts dans `dist/` —
  `NovaCore-Setup-3.10.0-x64.exe` (installateur **one-click**, NSIS, par utilisateur, sans
  élévation) et `NovaCore-Portable-3.10.0-x64.exe` (portable, un seul fichier).
- `desktop/main.cjs` (nouveau) : lance le serveur, attend `/api/ready`, affiche l’interface dans
  une fenêtre Electron, choisit un port libre si 6300 est occupé, instance unique, écran de
  démarrage (`desktop/splash.html`), arrêt de tout l’arbre de processus à la fermeture.
- **Runtime Node.js 24.15.0 embarqué** (`runtime/node.exe`, licence MIT incluse) : le Node
  interne d’Electron 34 (v20) ne fournit pas `node:sqlite`. Repli sur `node` du `PATH` en
  développement.
- Moteur livré en **Release** (`NovaEngine.exe`, 391 168 o) avec `msvcp140.dll`,
  `vcruntime140.dll`, `vcruntime140_1.dll` ; `nova-engine-workbench/server.mjs` résout
  `executablePath()` en Release puis Debug puis racine.
- Données hors du dossier d’installation : `%USERPROFILE%\.novacore\data` (base),
  `%LOCALAPPDATA%\NovaCore\workbench` (scènes/rendus), `%LOCALAPPDATA%\NovaCore\logs\novacore.log`.
- `asar: false` volontaire : le serveur tourne sous un Node externe et doit lire les fichiers
  réels. `.env`, `nova-engine-workbench/data` et `engine/build/Debug` sont exclus du paquet.
- **Raccourcis** : `CreateShortCut` de NSIS échoue silencieusement dans cet installateur (trace :
  échec systématique, même vers `cmd.exe`, en contexte utilisateur ou tous-utilisateurs, quelle
  que soit la vue registre). Création via `WScript.Shell` (PowerShell) dans
  `desktop/build/installer.nsh`, plus auto-réparation au premier démarrage
  (`ensureShortcuts`, marqueur `%LOCALAPPDATA%\NovaCore\.shortcuts-created`). Le désinstalleur
  supprime explicitement les deux raccourcis, le marqueur et le dossier d’installation
  (`SetOutPath "$TEMP"` puis `RMDir`, sinon le dossier vide subsiste).
- Un appel `System::Call` vers `SetEnvironmentVariable` provoquait une violation d’accès
  (`0xC0000005` dans `System.dll`) : les chemins sont désormais passés en arguments au script
  PowerShell, sans `System::Call`.
- Icône générée de façon reproductible par `tools/build/make-icon.ps1`.
- Limite de distribution : **aucune signature Authenticode**, donc SmartScreen affiche
  « éditeur inconnu » au premier lancement.

Preuves du 15 novembre 2026 : build code 0 ; installation silencieuse code 0 en ~70 s (364 Mo) ;
raccourcis Bureau + Menu Démarrer corrects ; application installée → `/api/ready` `ready:true`,
Workbench 1.9.1 avec Node 24.15.0 et moteur Release, validation `ok:true`, rendu logiciel
960×540 (3 meshes, 1 022 triangles, backend Software, PNG 2 074 363 o) ; fermeture libérant les
ports en moins de 5 s ; portable opérationnel en ~10 s ; désinstallation code 0 avec raccourcis,
registre et dossier supprimés, base utilisateur préservée.

## Diagnostic (avant modification)

- `db.js` écrivait chaque sauvegarde (`backups/novacore-*.json`) **en clair**, y compris les adresses e-mail, les empreintes bcrypt et le contenu des espaces de travail. Une copie du seul dossier `backups/` suffisait à lire toutes les données.
- La rétention ne portait que sur un **nombre** de fichiers (`NOVACORE_BACKUP_KEEP`) : aucune limite d’âge, donc une sauvegarde sensible pouvait rester indéfiniment.
- La restauration lisait les sauvegardes avec `JSON.parse(fs.readFileSync(...))` : aucun déchiffrement, aucune authentification d’intégrité.
- `archiveJsonSource` renommait toute sauvegarde restaurée en `.json`, ce qui aurait **rejoué une sauvegarde chiffrée en clair** dans le dossier de données.
- `GET /api/ready` n’exposait ni l’état du chiffrement, ni les sauvegardes illisibles.

## Correctifs

- `server/backup-crypto.js` (nouveau) :
  - format `NCBK1` : magie (5 octets), version (1), IV (12), tag GCM (16), texte chiffré ;
  - `decodeKey` (64 hexadécimaux ou 32 octets base64), `resolveKey` → `environment` | `file` | `created` | `regenerated` ;
  - une `NOVACORE_BACKUP_KEY` déclarée mais invalide **lève une erreur** (`BACKUP_KEY_ENV_INVALID`) au lieu de retomber sur une clé locale ;
  - un fichier `backup-key` présent mais illisible ou invalide **n’est jamais écrasé** (`BACKUP_KEY_FILE_UNREADABLE` / `BACKUP_KEY_FILE_INVALID`) : l’ancienne clé reste intacte pour une récupération hors ligne ;
  - `encrypt` / `decrypt` AES-256-GCM via `node:crypto`, aucune dépendance.
- `server/db.js` :
  - `readJsonState` lit indifféremment `.json.enc` (déchiffrement authentifié) et `.json` (hérité) ; une clé absente produit une erreur explicite ;
  - `backupNow` écrit atomiquement des `.json.enc` en `0600` ; si la clé est indisponible, il **échoue** (`STORAGE_WRITE_FAILED`) au lieu d’écrire en clair ;
  - `rotateBackups` combine plafond par nombre et par âge (`NOVACORE_BACKUP_MAX_AGE_DAYS`, 30 j par défaut, `0` pour désactiver) ; un `.enc` illisible n’est jamais supprimé **et ne consomme pas de place dans le quota** (cache de lisibilité borné à 64 entrées) ;
  - une résolution de clé en échec n’est plus mémorisée définitivement : nouvelle tentative possible après 5 s ;
  - `archiveJsonSource` conserve l’extension `.json.enc` pour la copie de restauration ;
  - `listBackups` / `restoreCandidates` couvrent les deux formats, triés par mtime ;
  - `restore_pending` en `meta` : après une corruption sans sauvegarde lisible, la restauration est **retentée au démarrage suivant** ; les tables remplies par la base vide sont purgées avant l’import, et aucune donnée créée entre-temps n’est écrasée ;
  - `recovery_notice` en `meta` : le dernier incident de quarantaine/restauration survit au redémarrage ;
  - `backupStatus()` exposé par `GET /api/ready` (`backup.*`) et `stats().encryptedBackups` ; rotation et résolution de clé appliquées au démarrage.
- `server/index.js` : `/api/ready` expose `backup` et `storage.encryptedBackups`.
- `server/security.js` : le log d’origine refusée journalise `req.originalUrl` sans query string (correctif lot 17) ; `security.txt` préfère une origine déclarée (`PUBLIC_BASE_URL`, `NOVACORE_URL`, `NOVACORE_ALLOWED_ORIGINS`) à l’en-tête `Host`.
- `test/backup-encryption.test.js` (nouveau) : **13 tests** sur serveur réel et sur `backup-crypto`.
- `.env.example` : `NOVACORE_BACKUP_KEY`, `NOVACORE_BACKUP_MAX_AGE_DAYS` (la variable morte `NOVACORE_BACKUP_INTERVAL_MS` est retirée).
- `SECURITY.md` § 5.1 et § 7, `docs/INCIDENT-RESPONSE.md` § 2, § 4.4, § 5 et § 8.
- `package.json` : `check` inclut `server/backup-crypto.js`.
- Versions : `package.json`, `package-lock.json`, `public/index.html`, `public/sw.js` (`FALLBACK_VERSION`, nouvelle `CACHE_REVISION`).

## Corrections après revue indépendante

Onze défauts ont été relevés en lecture seule sur la première version du lot 18. Les deux critiques sont corrigés et couverts par de nouveaux tests :

- **D1 (critique)** : les `.enc` illisibles ne comptent plus dans le quota de rotation ; un retour à la bonne clé conserve les sauvegardes lisibles au lieu de les voir supprimées.
- **D2 (critique)** : une base vide créée faute de clé lisible persiste `restore_pending` et retente la restauration au démarrage suivant ; test « corruption + mauvaise clé puis bonne clé ».
- **D3 (haute)** : un `backup-key` présent mais invalide n’est jamais remplacé ; test unitaire et test serveur vérifient que son contenu reste identique.
- **D4** : `/api/ready` n’expose plus que des codes normalisés (`BACKUP_KEY_ENV_INVALID`, `BACKUP_KEY_FILE_INVALID`, `BACKUP_WRITE_FAILED`, …), jamais un chemin absolu, un PID ou un message système.
- **D5** : seule une erreur structurelle (`integrity_check`, `SQLITE_CORRUPT`, `SQLITE_NOTADB`) déclenche la quarantaine ; une erreur transitoire ferme la connexion et fait échouer le démarrage explicitement.
- **D6** : un échec transitoire de résolution de clé n’est plus mémorisé pour tout le processus.
- **D7** : `recovery_notice` est persisté en `meta` et réaffiché après redémarrage.
- **D8** : les archives de migration/restauration issues d’anciens `.json` restent en clair et hors rotation ; c’est documenté explicitement (voir Limites).
- **D9** : `NOVACORE_BACKUP_INTERVAL_MS` (code mort) est retiré du code et de `.env.example`.
- **D10** : le cache de lisibilité est borné à 64 entrées.
- **D11** : `security.txt` préfère une origine déclarée à un en-tête `Host` forgé ; test dédié.

## Preuves

- `npm test` → **75/75** (58,4 s), dont `test/backup-encryption.test.js` → **13/13** et `test/security-hardening.test.js` → **8/8**.
- `npm run check` → code 0 sur **11 fichiers**.
- `ctest -C Debug` (depuis `nova-engine-workbench/engine/build`) → **5/5**, 6,59 s.
- Comportements vérifiés par test : en-tête `NCBK1`, e-mail/mot de passe/`password_hash` absents du `.enc`, déchiffrement avec la clé déclarée ; altération d’un octet et mauvaise clé refusées ; `backup-key` en `0600` ; clé locale invalide conservée ; corruption SQLite → quarantaine + restauration depuis `.json.enc` avec espace de travail intact ; ancienne sauvegarde `.json` en clair toujours restaurable ; clé B sur sauvegardes de clé A → base intacte, fichiers conservés avec `NOVACORE_BACKUP_KEEP=1`, `backup.unreadable` non vide ; retour à la clé A avec `NOVACORE_BACKUP_KEEP=1` → sauvegarde lisible conservée ; corruption + clé B → `recovery.pending`, puis clé A → restauration différée ; rétention par nombre (≤ 3) et par âge (fichiers de 10 jours supprimés avec limite de 7) ; clé invalide → serveur fonctionnel, compte créé, dossier `backups/` vide ; `security.txt` insensible à un `Host` forgé.

## Limites

- La clé locale `backup-key` est stockée à côté des sauvegardes : elle protège contre la copie du seul dossier `backups/`, pas contre une compromission complète de la machine. `NOVACORE_BACKUP_KEY` permet de séparer la clé.
- Une clé perdue rend les `.json.enc` illisibles ; ces fichiers sont conservés (jamais supprimés automatiquement) mais non récupérables sans la clé d’origine.
- Les archives `novacore.imported-*.json`, `novacore.restored-*.json` et `novacore.legacy-import-*.json` provenant d’anciens fichiers en clair ne sont **ni chiffrées ni purgées** par la rotation : elles doivent être supprimées manuellement après vérification.
- La base SQLite elle-même n’est pas chiffrée ; aucune copie hors site n’est créée par l’application.
- Aucun audit externe n’a été réalisé.
- Sauvegarde avant modification : `%TEMP%\nova-backups\novacore-3.8.0-pre-lot17.tgz` (5 158 168 octets, 151 entrées) pour le lot 17 ; le lot 18 ne modifie aucun fichier `data/` utilisateur.

# NovaCore 3.9.0 — Lot 17 : bordure HTTP, divulgation responsable et réponse aux incidents

Version publiée le 13 novembre 2026. `package.json`, `package-lock.json`, le footer, `/api/version` et le cache PWA affichent `3.9.0`. Nova Engine reste au noyau **0.8.0**, l’API C++ à **6**, le schéma de scène à **4** et le Workbench à **1.9.1**. Aucune donnée utilisateur n’est réécrite, aucun format ne change.

## Diagnostic (avant modification)

- `server/index.js` ne vérifiait **jamais** l’en-tête `Origin` : une page tierce pouvait déclencher `POST /api/auth/register` ou `/api/auth/login` (limitérés, mais sans contrôle d’origine).
- Aucun `/.well-known/security.txt`, aucun `SECURITY.md`, aucune procédure d’incident : la roadmap P0 § 6 et § 8 n’était pas satisfaite.
- `PATCH /api/plugins/:id` et `POST /api/focus/sessions` n’étaient couverts que par `limiters.api` (600/min), sans plafond propre à l’écriture.
- `npm run check` ne vérifiait que `server/index.js` : une faute de syntaxe dans `security.js`, `auth.js` ou `db.js` passait.
- En production, l’absence de `TRUST_PROXY`, `PUBLIC_BASE_URL` ou d’origines déclarées dégradait silencieusement les limiteurs, les liens de vérification et le contrôle d’origine.

## Correctifs

- `server/security.js` :
  - `normalizeOrigin`, `configuredOrigins`, `requestOrigin`, `isAllowedOrigin`, `originGuard` ;
  - `originGuard` refuse en **403 `ORIGIN_REJECTED`** toute écriture d’une origine inconnue, refuse `Origin: null` et `Sec-Fetch-Site: cross-site` sans `Origin`, émet `Vary: Origin` et `Access-Control-Allow-Origin` pour une origine déclarée, et répond `204` aux préflights autorisés ; les lectures passent mais ne reçoivent aucun CORS ;
  - `limiters.write` : 60 actions / 15 min par compte (`req.user.sub` ou IP) ;
  - `securityTxt`, `securityContact`, `securityTxtExpiry` (expiration à 180 jours, jamais périmée) ;
  - `startupWarnings` : cinq configurations de production signalées, jamais bloquantes.
- `server/index.js` : montage `app.use(['/api', '/nova-engine'], security.originGuard)` avant `express.json`, routes `/.well-known/security.txt`, `/security.txt` (301) et `/security-policy` (`SECURITY.md` en `text/plain`), `limiters.write` sur les deux routes d’écriture, avertissements journalisés après `ensureConfig()`.
- `SECURITY.md` (nouveau) : périmètre, hors-périmètre, contact, délais visés, règles de test, reconnaissance, limites (pas d’audit, sauvegardes non chiffrées, mono-instance).
- `docs/INCIDENT-RESPONSE.md` (nouveau) : qualification, sources de détection réellement disponibles, confinement, rotation de `JWT_SECRET`, révocation, restauration, notification (dont CNIL 72 h, décision du responsable de traitement), post-mortem, exercice de répétition.
- `test/security-hardening.test.js` (nouveau) : **7 tests** sur un vrai serveur.
- `package.json` : `check` couvre `server/security.js`, `server/auth.js`, `server/db.js` et `public/sw.js`.
- `.env.example` : `TRUST_PROXY`, `NOVACORE_ALLOWED_ORIGINS`, `NOVACORE_SECURITY_CONTACT`, `NOVACORE_SECURITY_EXPIRES`.
- Versions : `package.json`, `package-lock.json`, `public/index.html`, `public/sw.js` (`FALLBACK_VERSION`, nouvelle `CACHE_REVISION`).

## Preuves

- `npm test` → **61/61** (27,1 s), dont `test/security-hardening.test.js` → **7/7**.
- `npm run check` → code 0 sur 9 fichiers.
- `ctest -C Debug` (depuis `nova-engine-workbench/engine/build`) → **5/5**, 6,91 s.
- Comportements vérifiés par test : `POST` avec `Origin: https://attaquant.example` → 403 ; même origine → la route répond (401 pour un compte inconnu) avec `Access-Control-Allow-Origin` ; origine déclarée acceptée, autre refusée ; préflight déclaré → 204 ; `security.txt` → `Contact`, `Expires` futur à moins d’un an, `Canonical`, `Policy` ; 60 `PATCH` puis `429` `limiter: "write"` avec `Retry-After` ; jeton refusé après changement de `JWT_SECRET`.

## Limites

- Le contrôle d’origine ne remplace pas l’authentification : le jeton Bearer et l’isolation `user_id` restent les contrôles réels.
- Derrière un reverse proxy, `TRUST_PROXY` et `PUBLIC_BASE_URL` restent nécessaires pour que `req.protocol`, `req.ip` et les liens soient justes.
- Les sauvegardes ne sont pas chiffrées (lot P0 données à venir) ; `SECURITY.md` et `docs/INCIDENT-RESPONSE.md` le disent.
- Aucun audit externe n’a été réalisé.
- Sauvegarde avant modification : `%TEMP%\nova-backups\novacore-3.8.0-pre-lot17.tgz` (5 158 168 octets, 151 entrées).

# Workbench 1.9.1 — correctif viewport : orbite, grille et profondeur

Correctif publié le 13 novembre 2026. NovaCore reste **3.8.0**, Nova Engine **0.8.0**, l’API C++ **6** et le schéma de scène **4** ; seul le Workbench passe de 1.9.0 à **1.9.1**. Aucun changement d’API, aucun changement de format de scène, aucune donnée utilisateur réécrite.

## Diagnostic

- Défaut signalé : au déplacement de la caméra, des artefacts faisaient disparaître tout le 3D (le cube n’apparaissait plus que par morceaux).
- Défaut **non détecté avant cette session** : il a été reproduit sur deux instances isolées (ports 5311 et 5312, `NOVA_WORKBENCH_DATA_DIR` temporaire) avec le template (6 entités) et une **copie** de `data/scene.json` (hash `3AE8CFBB…6078`, 1 280 octets). Le fichier utilisateur n’a jamais été touché.
- Trois causes distinctes, prouvées par mesure et non par supposition :
  1. **Orbite sous le plan de grille** : après ~40 px de glissement vertical, `eye.y` valait 2 → 1,52 → 1,03 → 0,54 → 0,04 → −0,45 → −1,92. Le quad de grille (±200, `y = 0`) remplissait alors tout le viewport.
  2. **Grille occludante** : ce quad écrivait la profondeur ; une fois la caméra rase, il masquait la scène (cube 0 px).
  3. **Profondeur jamais vidée** : `gl.clear(DEPTH_BUFFER_BIT)` respecte `DEPTH_WRITEMASK`, mais les passes bloom/composite/overlays laissent `depthMask(false)`. Le depth buffer conservait donc la frame précédente et ses valeurs périmées rejetaient des fragments de mesh. Au même angle : **840 px fragmentés → 1 764 px pleins** en restaurant `gl.depthMask(true)` avant le clear — exactement la capture « cube en morceaux ».

## Correctifs

- `public/viewport-math.js` (nouveau, sans dépendance) : `GRID_PLANE_Y`, `CAMERA_FLOOR_MARGIN` (0,08), `orbitEye`, `minOrbitPitch`, `clampOrbitPitch`. Le pitch orbital est clampé pour garder l’œil au-dessus du plan ; un pivot volontairement sous la grille laisse l’orbite libre. Exporté en `window.NovaViewportMath` et `module.exports` pour le test.
- `public/viewport-3d.js` :
  - `updateMatrices()` applique `clampOrbitPitch` et calcule l’œil via `orbitEye` ;
  - la grille est dessinée avec `gl.depthMask(false)`, puis `gl.depthMask(true)` avant les meshes : elle reste une référence visuelle, jamais un obstacle ;
  - `GRID_FRAGMENT` atténue les lignes mineures/majeures en incidence rasante (`minorFade`, `majorFade`) au lieu de produire une nappe de moiré ;
  - `draw()` restaure `gl.depthMask(true)` **avant** `gl.clear(COLOR|DEPTH)` de la cible de scène, sinon la profondeur de la frame précédente persiste.
- `public/index.html` : `viewport-math.js` chargé avant `viewport-3d.js`, assets en `?v=1.9.1`, marque et footer 1.9.1.
- Versions : `server.mjs` (`WORKBENCH_VERSION`), `package.json`, `test-session.mjs`, `test-scenes.mjs`, `test-render.mjs`, `test-gpu.mjs` → **1.9.1**.
- `test-viewport.mjs` (nouveau) : **107 vérifications** exécutées sur le code réellement servi (`node:vm` charge `viewport-math.js`), dont 400 px de glissement simulés, invariants `depthMask`/ordre du clear, anti-moiré et ordre des scripts.
- `package.json` : script `test:viewport` ; `check` inclut `viewport-math.js`.

## Preuves

- `npm run test:viewport` → **107/107**.
- Navigateur (instance 5312, scène utilisateur en copie) : au glissement haut 100 px, `eye.y` reste à **0,08** (jamais négatif) ; le cube utilisateur reste **1 764 px** (42×42) à cet angle, **2 246 px** après glissement bas 120 px, **6 048 px** en zoom avant, **80 px** en zoom arrière maximal, avec un taux de remplissage **0,94–1,00** ; `pick` au centre → `starter-cube` ; **0 erreur console**.
- Capture d’écran comparée à la capture utilisateur : même zone (x 744–790, y 411–442), cube plein au lieu des fragments.
- `data/scene.json` vérifié intact : **1 280 octets**, schéma 2, 3 entités, mtime `2026-11-10 21:27:58`, SHA-256 `3AE8CFBB…6078`.

## Limites

- Le viewport reste un aperçu WebGL2 : il n’affiche pas les ombres portées et n’est pas garanti pixel-identique au rastériseur logiciel, qui reste la référence déterministe.
- La grille est volontairement non occludante : un mesh situé sous le plan de grille reste visible à travers elle. C’est le comportement attendu d’un éditeur, pas un masquage.
- Sauvegarde avant correctif : `%TEMP%\nova-backups\nova-engine-workbench-1.9.0-pre-viewport-fix.zip` (78 746 octets).

# NovaCore 3.8.0 — Lot 16 : session explicite, secret JWT persistant et autosave

Version publiée le 13 novembre 2026. `package.json`, `package-lock.json`, le footer, `/api/version` et le cache PWA affichent `3.8.0`. Nova Engine reste au noyau **0.8.0**, l’API C++ à **6** et le schéma de scène à **4** ; le Workbench passe à **1.9.0**.

## Lot 16 — Fiabilité professionnelle du Workbench

### Diagnostic

- La « scène vide » venait d’une session NovaID absente : sans `novaToken`, le proxy NovaCore renvoie **401** sur `/nova-engine/api/status`, `/logs`, `/scene` et `/scenes`. Le Workbench ignorait ces erreurs et affichait une scène vide sans explication.
- Le secret JWT de développement était éphémère lorsque `JWT_SECRET` manquait : chaque redémarrage invalidait tous les jetons, provoquant des 401 « fantômes ».

### Correctifs

- `server/security.js` : secret de développement **persistant** dans `$NOVACORE_DATA_DIR/jwt-secret` (défaut `~/.novacore/data/jwt-secret`), écriture atomique en mode `0600`, lecture si le fichier existe, repli éphémère seulement si le dossier n’est pas inscriptible. `JWT_SECRET` reste prioritaire ; la production refuse toujours un secret absent ou faible. Export `devSecretFile`.
- `public/session.js` (Workbench) : `classifyApiFailure(status, body)` distingue `expired` (401), `unverified` (403 `EMAIL_NOT_VERIFIED`), `forbidden`, `server` (5xx), `offline` (réseau) et `error` ; `readToken`, `bannerFor`, `tokenInfo`.
- `public/app.js` (Workbench) : couche `api()` typée (`kind`, `status`, `code`), bannière de session, chip NovaID, sonde légère `/api/ping` avant les appels lourds, gestion silencieuse des 401/403, bouton **Réessayer**, réactions `storage` et `focus`, autosave (debounce 1,4 s), `Ctrl`/`Cmd+S`, « Nouvelle scène » via `/api/scene/template`, redimensionnement du viewport à l’ouverture de Scene Lab.
- `public/viewport-3d.js` : méthode `resize()` exposée, écouteur `window.resize` et `ResizeObserver`, nettoyage à `dispose`.
- `server.mjs` (Workbench) : `NOVA_WORKBENCH_DATA_DIR` pour isoler les données de test, `/api/ping`, `/api/scene/template`, sauvegarde roulante `backupCurrentScene` (12 fichiers dans `data/backups`), réponse `backup` sur `PUT /api/scene`.
- `public/index.html` / `styles.css` (Workbench 1.9) : bannière `#session-banner`, chip NovaID, état `#scene-save-state`, badge AUTOSAVE, versions `?v=1.9.0`.
- `public/app.js` (NovaCore) : `safeNextPath` / `followNextPath` respectent `?next=` à la connexion et au démarrage avec session valide (même origine uniquement).
- `public/sw.js` : `FALLBACK_VERSION='3.8.0'`, `CACHE_REVISION='2026-11-13-nova-3-lot16-session-autosave'`.

### Tests

- `test/security.test.js` (nouveau) : **3/3** — persistance entre deux démarrages, priorité de `JWT_SECRET`, refus de secret de développement en production.
- `nova-engine-workbench/test-session.mjs` (nouveau) : classification 401/403/réseau, jeton expiré, `/api/ping`, template complet (caméra, Key Light, Rim Spot, Ground, Starter Cube, Starter Sphere), scène par défaut avec sol et caméra, autosave produisant une sauvegarde roulante, HTML 1.9.0.
- `test-scenes.mjs` : assertion de version passée à `1.9.0`.
- `test/navigation.test.js` : nouveau cas `?next=` — accepte `/nova-engine/` et conserve query/hash, refuse une origine différente et `//evil.example`, et vérifie que le retour est suivi après connexion.
- `npm test` → **54/54** ; Workbench `npm run check`, `test:session`, `test:scene-api`, `test:render`, `test:gpu` OK.

### Preuves

- `node --test test/security.test.js` → 3/3.
- `node test-session.mjs` → OK (session, template, autosave/backup, UI 1.9.0).
- `/api/version` NovaCore → **3.8.0** ; Workbench direct 5201 → **1.9.0 / engine 0.8.0 / schema 4**.
- Navigateur 6300 sans jeton : bannière explicite, aucun chargement silencieux d’une scène vide, un seul 401 (`/api/ping`).
- Navigateur 6300 avec jeton : bannière masquée, scène utilisateur (3 entités, schéma 2) chargée, viewport **WebGL2 · 12 triangles · 1 maillage · 1 lumière · HDR · bloom**, capture 960×540 `lit=518400`, 0 erreur console.
- `?next=%2Fnova-engine%2F` avec session valide → `/nova-engine/` (jeton conservé, Workbench 1.9).
- Instance isolée 5310 : « Modifié · autosave… » → « Autosave · HH:MM:SS », `scene.json` écrit, seconde écriture → sauvegarde roulante de la version précédente ; instance et dossier temporaire supprimés.

### Limites

- `data/scene.json` utilisateur (schéma 2) n’est pas migré automatiquement ; il reste lisible et sera normalisé à la prochaine sauvegarde. Pendant la validation, d’anciens onglets Workbench (JS 1.4/1.8) ont réécrit ce fichier ; il a été restauré depuis une sauvegarde roulante et ces onglets fermés. Le Workbench 1.9 ne réécrit pas une scène non modifiée au chargement (vérifié sur l’instance isolée).
- Sauvegardes roulantes limitées à 12 fichiers, sans archivage long terme.

# NovaCore 3.7.0 — Nova Engine : éclairage multi-sources, ombres, textures et HDR

Version publiée le 12 novembre 2026. `package.json`, `package-lock.json`, le footer, `/api/version` et le cache PWA affichent `3.7.0`. Nova Engine passe au noyau **0.8.0**, le Workbench à **1.8.0**, l’API C++ à **6** et le schéma de scène à **4** (les schémas 1 à 3 restent acceptés).

## Lot 15 — Lumières multiples, shadow maps, textures PNG/JPEG, HDR et gameplay

### Noyau (`engine/include/nova/nova_core.hpp`, `engine/src/nova_core.cpp`)

- `Primitive` (`Cube`, `Sphere`, `Plane`, `Cylinder`, `Cone`, `Torus`, `Capsule`, `Pyramid`), `primitiveFor`, `parsePrimitive`, `primitiveName`. Une primitive explicite est prioritaire ; sans elle, l’inférence historique par nom/composant reste active pour les schémas 1 à 3.
- `LightType` (`Directional`, `Point`, `Spot`) et `Light` : type, couleur sRGB, intensité [0,32], portée [0,1,200], angle de spot [1,89], `castShadow`. `Entity::light` optionnel, jusqu’à 16 lumières validées, évaluation moteur des 8 premières.
- `Material::texture` : chemin relatif PNG/JPEG validé (pas de chemin absolu ni `..`, extensions `png`/`jpg`/`jpeg`) ; le motif procédural reste le repli.
- Gameplay dans `Entity` : `Rigidbody`, `Controller`, `Spinner`, `Collectible`, sérialisés en schéma 4 et validés.
- `Runtime::startPlay/play/stopPlay` : simulation déterministe, pas plafonné à 0,1 s découpé en 1 à 5 sous-pas de 0,02 s, gravité, saut, collisions boîtes, spinners et collectibles.
- Schéma 4 émis, schémas 1 à 4 acceptés ; `novaVersion` 0.8.0, API 6.

### Rastériseur logiciel (`engine/src/nova_render.cpp`, `engine/src/nova_image.cpp`)

- Rendu interne en **HDR linéaire float**, puis downsample, exposition, bright pass, flou séparable half-res, bloom et courbe **ACES** + conversion sRGB.
- Boucle multi-lumières (directionnelle, point, spot) avec atténuation, cône de spot et couleur sRGB convertie une fois.
- Shadow maps directionnelle et spot (maximum 2), filtrage PCF, `RenderOptions::shadowResolution` 128 à 2048 ; les lumières ponctuelles ne projettent pas d’ombre (documenté).
- Cache de textures PNG/JPEG via `stb_image` et `nova_image` ; UV multipliées par le tiling, repli procédural si texture absente ou invalide.
- Statistiques `shadowMaps`, `textures`, `bloom` exposées par le CLI `--stats-json`.

### Direct3D 12 (`engine/src/nova_d3d12_common.{hpp,cpp}`, `nova_d3d12.cpp`, `nova_d3d12_window.cpp`)

- `FrameConstants` multi-lumières, `GpuVertex` 68 octets (`textureIndex`), `GpuLight`, `GpuShadowMap`, `GpuTexture`, `GpuScene` et `GpuRenderStats` partagés entre le chemin hors écran et la fenêtre.
- Pipelines depth-only pour les ombres, PCF dans le shader de scène, textures sRGB, cible **R16G16B16A16_FLOAT**, bright/blur half-res et composite **ACES/sRGB**.
- `d3d12::FrameResources` et `recordFrame` communs ; `--no-shadows` supprime les passes d’ombre et `--no-bloom` désactive le bloom dans le composite.

### Workbench 1.8.0 et viewport WebGL2

- `server.mjs` : versions 1.8.0 / 0.8.0, schéma 4, constantes `PRIMITIVES`, `LIGHT_TYPES`, `ASSETS_DIR`, validation/normalisation primitive, texture, lumière et gameplay, limite de 16 lumières, route `/api/assets/…` pour PNG/JPEG, options `bloom`, `bloomIntensity`, `shadows`, `shadowResolution`, `exposure` transmises aux rendus logiciel, GPU et runtime.
- Inspecteur Scene Lab : primitives, texture PNG/JPEG, lumière explicite (type, couleur, intensité, portée, angle, ombre) et composants gameplay (rigidbody, controller, spinner, collectible).
- Viewport WebGL2 : lumières multiples en GLSL, textures sRGB via cache, FBO `RGBA16F` (repli `RGBA8`), bloom half-res et composite ACES/sRGB, mode **Play** avec snapshot/restauration de la scène, WASD/ZQSD, souris, saut, sprint et HUD de score.
- Options de rendu du Workbench : bloom, intensité, résolution de shadow map et exposition ; les statuts affichent ombres, textures et bloom.

### Preuves

- `ctest -C Debug --output-on-failure` : **5/5** (Core, Render, Camera, Gpu, Window), 35,43 s.
- CLI logiciel : 320×180, `shadowMaps:1`, `textures:1`, `bloom:true` ; `--no-bloom --no-shadows` donne `shadowMaps:0`, `bloom:false`.
- CLI GPU D3D12 : `drawCalls:6`, `shadowMaps:1`, `textures:1`, `bloom:true` ; sans ombres, 5 draw calls.
- `test-scenes.mjs` : schéma 4, torus, texture, spot, spinner et route assets validés ; cas invalides rejetés.
- `test-render.mjs` : 12 triangles, 921 pixels, PNG 57 758 octets, 364 couleurs, statistiques shadow map et bloom ; checker/grid/none/texture déterministes et distincts ; torus > 12 triangles.
- `test-gpu.mjs` : D3D12 GTX 1660 SUPER, 3 meshes, 1 022 triangles, **6 draw calls**, 1 shadow map, 886 couleurs, PNG 230 663 octets ; ombres désactivées → capture différente et 5 draw calls ; bloom désactivé → capture différente ; capture runtime 320×180 ; fenêtre ouverte puis arrêtée.

### Limites

- Ombres portées uniquement pour la directionnelle et le spot ; les lumières ponctuelles n’en projettent pas. Maximum 2 shadow maps par scène.
- Le viewport navigateur ne rend pas les ombres portées ; il affiche les lumières, textures, HDR et bloom.
- Le rendu GPU n’est pas garanti pixel-identique au logiciel ; Metal, Vulkan et le ray tracing restent non implémentés.

# NovaCore 3.6.0 — Nova Engine : matériaux PBR et textures procédurales

Version publiée le 12 novembre 2026. `package.json`, `package-lock.json`, le footer, `/api/version` et le cache PWA affichent `3.6.0`. Nova Engine passe au noyau **0.7.0**, le Workbench à **1.7.0**, l’API C++ à **5** et le schéma de scène à **3** (les schémas 1 et 2 restent acceptés).

## Lot 14 — Matériaux PBR par entité et textures procédurales

### Noyau (`engine/include/nova/nova_core.hpp`, `engine/src/nova_core.cpp`)

- `SurfacePattern` (`None`, `Checker`, `Grid`), `surfacePatternName`, `parseSurfacePattern`.
- `Material` : `albedo` sRGB, `metallic` [0,1], `roughness` [0,04,1], `tiling` [1,64], `pattern`, `emissive`.
- `Entity::material` est un `std::optional<Material>` : une entité sans matériau conserve la palette historique via `defaultMaterialFor()`.
- `isValidMaterial()` et validation JSON : bornes vérifiées, motifs inconnus rejetés, `schemaVersion` 3 émis et 1 à 3 acceptés.
- Parsing et sérialisation du matériau, helpers `readNumberField`, `entityMentions`, `idHash`.

### Rastériseur logiciel (`engine/src/nova_render.cpp`)

- `Vertex::uv`, `planarUv` (projection sur l’axe dominant de la normale), UV sphère/cylindre/cône, `addQuad` avec UV.
- `Triangle` transporte `uv`, `roughness`, `metallic`, `tiling`, `pattern`, `emissive` ; interpolation perspective-correcte des UV au clipping et à la rasterisation.
- `shadeFragment` : lobe spéculaire metallic/roughness, teinte spéculaire par l’albedo, perte de diffuse sur les métaux, motifs `checker` (damier ×0,45) et `grid` (lignes claires ×1,35 + 0,06).
- `entityMaterial()` convertit l’albedo sRGB en linéaire une seule fois pour les deux renderers.

### Direct3D 12 (`engine/include/nova/nova_gpu.hpp`, `engine/src/nova_d3d12_common.{hpp,cpp}`)

- `GpuVertex` passe à **64 octets** : `position`, `normal`, `color`, `uv[2]`, `material[4]` (roughness, metallic, pattern id, tiling), `selected`.
- Layout d’entrée à 6 éléments (`POSITION`, `NORMAL`, `COLOR`, `TEXCOORD0`, `TEXCOORD1`, `TEXCOORD2`), `static_assert(sizeof(GpuVertex) == 64)` et `_countof(inputLayout)`.
- `PSScene` évalue `applySurfacePattern` avec les mêmes formules que le logiciel, puis applique GGX/Smith/Fresnel avec `roughness`/`metallic` par sommet.

### Workbench 1.7.0 et viewport WebGL2

- `server.mjs` : versions 1.7.0 / 0.7.0, schéma 3, scène par défaut avec cube checker, validation/normalisation des matériaux, `/api/version` expose le schéma 3, statut projet `materials: 'pbr'`, `patterns`, `proceduralTextures: true`.
- Inspecteur Scene Lab : section « Matériau PBR » (couleur sRGB, metallic, roughness, tiling, motif, émissif), helpers `entityMaterial`, `renderMaterialInspector`, `applyMaterialEdit`, bornes et historique.
- Viewport WebGL2 : UV générées (`attachUvs`), attribut `location 2`, uniforms `uMetallic`, `uRoughness`, `uPattern`, `uTiling`, shader PBR + motifs identiques.
- Tests Workbench : `test-scenes.mjs` (matériau grid, rejet d’un motif invalide), `test-render.mjs` (checker, grid et none distincts et déterministes), `test-gpu.mjs` (matériaux GPU, capture runtime, fenêtre).

### Preuves

- `ctest -C Debug --output-on-failure` : **5/5**.
- `NovaEngine.CoreTests` : API 5, schéma 3, aller-retour matériau, rejets metallic hors bornes et motif inconnu.
- `NovaRenderTests` : 12 triangles, **1 892 pixels ombrés**, PNG **129 808 octets**, checker/grid/métallique déterministes et distincts.
- `NovaGpuTests` : D3D12 GTX 1660 SUPER, 12 triangles, 230 400 octets RGBA, **148 couleurs**, **473,943 ms**, PNG **230 663 octets**, filaire différent de **3 642 pixels**.
- `NovaEngine.WindowTests` : 320×240, 12 triangles, **7 277 pixels modifiés**, PNG A/B de **307 528 octets**.
- `npm run test:render` : 12 triangles, 921 pixels, PNG **57 758 octets**, 275 couleurs, motifs distincts et déterministes.
- `npm run test:gpu` : D3D12, 12 triangles, 2 draw calls, 93 couleurs, PNG **230 663 octets**, checker/grid distincts et déterministes, capture runtime **320×180 / 230 663 octets / 93 couleurs**, fenêtre ouverte puis arrêtée.

### Limites

- Textures **procédurales** uniquement (`checker`, `grid`) : pas d’import PNG/JPEG/glTF ni de normal maps.
- Fenêtre native et swapchain **Windows uniquement** ; Metal et Vulkan restent déclarés mais non implémentés.
- Pas de MSAA, d’ombres temps réel ni de ray tracing ; le rendu GPU n’est pas garanti pixel-identique au logiciel.

# NovaCore 3.5.0 — Nova Engine : fenêtre native Win32 et swapchain Direct3D 12

Version publiée le 12 novembre 2026. `package.json`, `package-lock.json`, le footer, `/api/version` et le cache PWA affichent `3.5.0`. Nova Engine passe au noyau **0.6.0**, le Workbench à **1.6.0** et l’API C++ à **4** ; le schéma de scène reste **2**.

## Lot 13 — Runtime natif : fenêtre Win32, swapchain et caméra libre

### API caméra (`engine/include/nova/nova_camera.hpp`, `engine/src/nova_camera.cpp`)

- `CameraPose` (position, yaw, pitch, roll, FOV, near/far), `CameraInput` et `FreeCamera`.
- Matrices row-major et profondeur clip `[0,1]`, identiques au rastériseur logiciel et à D3D12.
- Déplacement `W/Z`, `S`, `A/Q`, `D`, `E`, `C`, sprint `Maj`, normalisation des diagonales, pitch borné à **±89°**, sensibilité souris **0,12°/px**, delta plafonné à **0,1 s**, vitesse de base **4 m/s**, sprint **×3**.
- `cameraPoseFromTransform()` extrait la pose initiale de l’entité `Camera` de la scène.

### Pipelines partagés (`engine/src/nova_d3d12_common.{hpp,cpp}`)

- Device/adaptateur, root signature, shaders HLSL, pipelines ciel + PBR solide + PBR filaire, buffers, textures, transitions et `FrameConstants` extraits du backend hors écran.
- `nova_d3d12.cpp` et `nova_d3d12_window.cpp` consomment le même code : aucun doublon de shader ou de PSO.
- Le filaire utilise une topologie `D3D_PRIMITIVE_TOPOLOGY_LINELIST` car `D3D12_FILL_MODE_WIREFRAME` est sans effet sur le pilote validé.

### Fenêtre native (`engine/include/nova/nova_window.hpp`, `engine/src/nova_d3d12_window.cpp`)

- Contrat `NativeWindow` : `open/close/pump/takeInput/render/capture/adapter`.
- `CreateWindowEx` Win32, swapchain **flip-model 3 buffers**, RTV/DSV, fence, resize (`WM_SIZE`), clavier/souris, clic droit capturé, `F1` filaire, `Échap` fermeture.
- Présentation vsync en mode visible, vsync désactivée pour les captures cachées.
- Capture PNG par **readback du swapchain** de la dernière frame présentée.
- `nova_window_null.cpp` refuse explicitement la fenêtre native hors Windows, sans prétendre l’implémenter.

### CLI, versions et tests

- `--run`, `--window-hidden`, `--frames <n>`, `--capture <png>`, `--stats-json` ; caméra initiale depuis l’entité `Camera`.
- Versions : moteur **0.6.0**, API C++ **4** (`isSupportedApiVersion` accepte 1 à 4), Workbench **1.6.0**, NovaCore **3.5.0**, schéma de scène **2**.
- `NovaEngine.WindowTests` : fenêtre cachée 320×240, 12 triangles, **7 277 pixels modifiés** entre deux poses caméra, deux PNG de **307 528 octets** avec signature PNG, fermeture propre.
- Tests existants réalignés sans modifier le comportement du moteur (version, pas de déplacement caméra, clamp du delta).

### Workbench 1.6.0

- Vue Runtime : ouverture/arrêt de la fenêtre, PID, scène, résolution, état filaire, capture et aperçu du PNG.
- `GET /api/runtime/status`, `POST /api/runtime/window`, `POST /api/runtime/window/stop`, `POST /api/engine/runtime/capture`.
- État runtime séparé des builds ; mode `hidden` + `frames` réservé aux tests automatisés.
- `npm run test:gpu` vérifie en plus la capture runtime 320×180 et l’ouverture/arrêt HTTP de la fenêtre native.

### Preuves

- `ctest -C Debug --output-on-failure` : **5/5** (noyau, rendu, caméra, GPU, fenêtre) en ~2,6 s.
- `NovaEngine --run --window-hidden --frames 3 --capture … --stats-json` : D3D12 GTX 1660 SUPER, **1280×720**, 3 frames, 12 triangles, 2 draw calls, 18,22 ms/frame, PNG **3 687 468 octets**, signature `89 50 4E 47 0D 0A 1A 0A`.
- Capture analysée : 84 couleurs distinctes, ciel dégradé, pixel le plus lumineux `184,127,56` sur le cube.
- `npm run test:gpu` : capture runtime **320×180 / 230 663 octets / 89 couleurs**, fenêtre PID ouvert puis arrêté.

### Limites

- Fenêtre native et swapchain **Windows uniquement** ; Metal et Vulkan restent déclarés mais non implémentés.
- Pas de MSAA, textures, normal maps, ombres temps réel ni ray tracing.
- Le rendu GPU n’est pas garanti pixel-identique au logiciel ; le logiciel reste la référence déterministe.

# NovaCore 3.4.0 — Nova Engine : premier backend GPU Direct3D 12

Version publiée le 11 novembre 2026. `package.json`, `package-lock.json`, le footer, `/api/version` et le cache PWA affichent `3.4.0`. Nova Engine passe au noyau **0.5.0** et le Workbench à **1.5.0** ; le schéma de scène reste **2** et l’API C++ reste **3**.

## Lot 12 — RHI et backend Direct3D 12 hors écran

### RHI (`engine/include/nova/nova_gpu.hpp`)

- `GpuBackend { Auto, D3D12, Metal, Vulkan, Software }`, `gpuBackendName`, `parseGpuBackend`.
- `GpuAdapterInfo` / `GpuInfo` et `queryGpuInfo()` : énumération DXGI, mémoire dédiée, vendor/device, indicateur matériel, déduplication des alias DXGI.
- `GpuVertex`, `GpuScene`, `GpuRenderStats`, `renderSceneGpu()`.
- `buildGpuScene()` extrait la scène GPU depuis le document existant : mêmes primitives, hiérarchie, caméra, lumières et albédo que le rastériseur logiciel.

### Backend Direct3D 12 (`engine/src/nova_d3d12.cpp`)

- Device matériel (sélection du plus gros adaptateur non logiciel, secours WARP), file de commandes, allocateur, liste de commandes, fence et attente bornée à 15 s.
- Root signature CBV unique et compilation HLSL à l’exécution (`VSScene`, `PSScene`, `VSSky`, `PSSky`).
- Shader de scène : normales, albédo linéaire, GGX + Smith + Fresnel, lumière directionnelle, ambiante hémisphérique, surbrillance de sélection, ACES puis sRGB.
- Deux pipelines : ciel plein écran sans profondeur et scène avec z-buffer `D32_FLOAT` ; **2 draw calls**.
- Buffers upload pour sommets/index/constantes, cible `R8G8B8A8_UNORM`, readback avec pitch aligné et copie ligne par ligne.
- Mode filaire rendu par **liste de lignes explicite** (indépendant du support optionnel du fill mode wireframe par le pilote), vérifié différent du solide.
- Correctifs de mise au point : état initial `COPY_DEST` obligatoire pour un buffer READBACK, fermeture de la liste avant `Reset` de l’allocateur, ordre de multiplication `mul(uViewProjection, world)` pour les matrices row-major du CPU.

### CLI et tests

- `--render-gpu <png>`, `--gpu-info`, `--gpu-json`, `--backend auto|d3d12|vulkan|metal|software` ; Metal/Vulkan refusés explicitement, `--render-gpu --backend software` refusé avec renvoi vers `--render`.
- `NovaEngine.GpuTests` : 24 sommets, 36 indices, 12 triangles, pixel central ≠ ciel, ≥32 couleurs, filaire ≠ solide, PNG valide ; CTest **3/3**.
- Build aligné sur **C++20** (CMake) ; aucune utilisation C++23 détectée dans les sources.

### Workbench 1.5.0

- Sélecteur de backend dans le panneau de rendu ; option GPU désactivée hors Windows via `/api/status`.
- `POST /api/engine/render` accepte `options.backend = "gpu"` et transmet `--render-gpu --backend d3d12` ; les options propres au logiciel (supersampling, grille, ombres) ne sont pas transmises.
- Statistiques GPU affichées : backend, adaptateur, draw calls, durée.
- `npm run test:gpu` : vérifie le backend D3D12 via l’API, le PNG, les dimensions, 12 triangles, 2 draw calls, et un filaire distinct du rendu solide.
- Assets versionnés `?v=1.5.0`.

### Preuves

- `ctest -C Debug --output-on-failure` : **3/3** (noyau, rendu logiciel, GPU).
- `NovaEngine.GpuTests` : D3D12 sur NVIDIA GeForce GTX 1660 SUPER, 12 triangles, 230 400 octets RGBA, 148 couleurs, PNG 230 663 octets, filaire différent sur 3 642 pixels.
- `--render-gpu` 960×540 : `backend D3D12`, adaptateur GTX 1660 SUPER, 12 triangles, 2 draw calls, PNG 230 663 octets, ~0,51 s (device + shaders inclus).
- Rendu GPU : silhouette 80×91 px centrée à x=479,5, 95 couleurs distinctes.
- `npm run test:render` : déterminisme logiciel conservé (PNG identiques octet pour octet).
- `npm run test:gpu` : D3D12, 12 triangles, 2 draw calls, PNG valide, filaire distinct.

### Limites

- Pas de swapchain ni de fenêtre native : rendu hors écran uniquement.
- Pas de MSAA, textures, normal maps, ombres GPU, lumières ponctuelles GPU, ray tracing, path tracing, VPS ni NSR.
- Metal et Vulkan déclarés dans le RHI mais non implémentés.
- Le rendu GPU n’est pas garanti pixel-identique au logiciel.

# NovaCore 3.3.0 — Nova Engine 3D : rastériseur logiciel et viewport WebGL2

Version publiée le 11 novembre 2026. `package.json`, `package-lock.json`, le footer, `/api/version` et le cache PWA affichent `3.3.0`. Nova Engine passe au noyau **0.4.0** et le Workbench à **1.4.0** ; le schéma de scène reste **2** et l’API C++ reste **3**.

## Lot 11 — Nova Engine : moteur 3D réellement vérifiable

### Rastériseur logiciel C++ (`engine/src/nova_render.cpp`)

- Pipeline complet sans GPU ni dépendance externe : maths vectorielles/matrices, chargement de la scène, hiérarchie des transforms, primitives cube/sphère/plan/cylindre/cône, caméra perspective, clipping, **z-buffer**, éclairage directionnel et ponctuel, ombres de contact, grille, gizmos caméra/lumière, surbrillance de sélection.
- **Encodeur PNG autonome** (RGBA8, zlib via code interne) : aucun lien avec une bibliothèque d’image.
- API publique `nova/render.hpp` : `RenderOptions`, `RenderStats`, `renderScene`, `encodePngRgba`, `writePngFile`.
- CLI étendue : `--render`, `--width`, `--height`, `--supersample`, `--camera`, `--selected`, `--no-grid`, `--no-shadows`, `--wireframe`, `--exposure`, `--stats-json`.
- Déterminisme : deux rendus identiques produisent des PNG **octet pour octet identiques**.
- Tests C++ `engine/tests/render_tests.cpp` : **29 assertions** sur les maths, la caméra, l’occlusion, la sélection et l’encodage PNG ; CTest **2/2**.

### Workbench 1.4.0 — viewport temps réel et rendu de référence

- Nouveau module `public/viewport-3d.js` (sans dépendance) : WebGL2, maths mat4, shaders ciel/grille/mesh/lignes, picking rayon-AABB, gizmos, orbite, panoramique, zoom, cadrage, surbrillance de sélection.
- **Correctif GLSL** : le mot réservé `half` empêchait la compilation du fragment shader ; renommé `halfway`. Le viewport affiche désormais réellement la scène (`WebGL2 · 12 triangles · 1 maillage(s) · 1 lumière(s)`).
- **Secours robuste** : si la création WebGL2 échoue après avoir lié un contexte au canvas, le canvas est remplacé par un clone vierge avant le dessin 2D, au lieu de planter sur `getContext('2d') === null`.
- Panneau « Rendu moteur C++ » : résolution, anticrénelage 1–3×, grille, ombres, filaire, affichage PNG, statistiques et téléchargement.
- Routes protégées : `POST /api/engine/render`, `GET /api/engine/render/<id>.png`, `GET /api/engine/renders`, avec validation de scène, limite de 24 rendus et rejet de la traversée de chemin.
- Assets versionnés (`?v=1.4.0`) pour éviter qu’un ancien `app.js` reste en cache après mise à jour.

### Preuves

- `npm run test:render` : 12 triangles, 921 pixels de mesh, PNG 57 758 octets, 275 couleurs, déterminisme vérifié, 400 sur traversée et scène invalide.
- `npm run test:scene-api` : bibliothèque, export, renommage, suppression et validation C++ OK.
- Rendu réel 960×540 SS2 : 12 triangles, 20 266 pixels mesh, 2 074 363 octets, SHA-256 `4E4917AB0B061BB744CBE5C45A4CEA477726C617457BC4C0EB246C659D7BCAF1`.
- Navigateur : viewport WebGL2 opérationnel, secours Canvas 2D vérifié, rendu UI 640×360 en 243 ms, PNG 640×360 et téléchargement disponibles.
- Proxy authentifié : 401 sans session, 200 avec un NovaID vérifié, PNG servi sous `/nova-engine/api/engine/render/…`.

### Limites assumées

- Rendu C++ **logiciel** uniquement : ni Vulkan, ni fenêtre native, ni rastérisation GPU. Un rendu 960×540 SS2 en Debug prend environ 2,5 s.
- Le viewport WebGL2 est un aperçu distinct : il n’est pas garanti pixel-identique au PNG C++.
- Pas d’import glTF/OBJ, de textures, de matériaux avancés ni d’animation squelettique.

# NovaCore 3.2.0 — Nova Feature Lab 100 % opérationnel

Version publiée le 11 novembre 2026. `package.json`, `package-lock.json`, le footer, `/api/version` et le cache PWA affichent `3.2.0`. Le lot 10 supprime définitivement les modules « Concept — non actif » : les **50 modules** du Feature Lab ont désormais une action réelle, un interrupteur et une identité visuelle.

## Lot 10 — Feature Lab : 50 modules réellement actionnables

### Catalogue pur et testable

- Nouveau module `public/feature-lab-model.js`, chargé avant `app.js` : **50 modules**, **8 catégories** (Apparence, Accessibilité, Productivité, Intelligence, Sécurité, Développement, Analyse, Cloud), actions typées et verbes d’action.
- API pure : `normalizeFlags`, `activeCount`, `filterFeatures`, `categoryCounts`, `completion`, `findFeature`, `actionTarget`, `PREFERENCE_KEYS`.
- **Migration des anciens drapeaux indexés** (`0`, `2`, `50`…) vers les identifiants texte : une préférence existante n’est jamais perdue ni décalée.
- **Zéro concept** : `completion()` renvoie `concepts: 0` et `percent: 100`, vérifié par test.

### Actions réelles branchées sur l’application

- **Navigation** : chaque module ouvre sa page réelle (projets, tâches, notes, calendrier, Focus, Knowledge, Studio, API, système…).
- **Effets visuels réels** : `liquidGlass`, `supernova`, `highContrast`, `reducedMotion`, `compact`, `starfield`, `intro`, `sound`, `privateMode`, `microInteractions` pilotent de vraies préférences appliquées immédiatement.
- **Accent** : cycle réel entre les cinq accents et application via `setAccent`.
- **Productivité** : note rapide, tâche express, journal du jour, Focus 25 min réellement lancé, palette `Ctrl+K`, raccourcis listés.
- **Intelligence** : prompts favoris persistés (création, usage vers NOVAI, suppression), résumé local de notes, générateur d’idées contextuel, préremplissage NOVAI (code, débogage), détection Ollama via `/api/ai/models`.
- **Sécurité et données** : mode privé local (suspend la synchronisation cloud **sans supprimer de données**), import de sauvegarde, export JSON, export de snippet.
- **Analyse** : santé serveur (`/api/health`), compteurs réels de tâches, projets, notes et sessions Focus.
- **Cloud** : envoi et récupération NovaCloud branchés sur les fonctions existantes.
- **Tout activer / tout désactiver** met à jour les 50 cartes et ne force jamais le mode privé.

### Interface et design

- Section 16 de `public/design-3.css` : héros avec anneau de complétion animé, barre de progression, statistiques, recherche, puces de catégories, cartes avec interrupteur, état Actif/Inactif et bouton d’action.
- Accent vif via `rgb(var(--accent-rgb))` : le Feature Lab n’hérite plus du gris `--accent` de `styles.css` 2.19.
- Règles dédiées pour le thème clair, le contraste renforcé, le responsive (980 px / 640 px) et le mouvement réduit.

### Accessibilité et confort

- Interrupteurs avec libellé dynamique, `aria-label` sur la recherche, `aria-live` sur le compteur de résultats, groupes de filtres et états focus visibles.
- `startNovaIntro(force)` permet de rejouer l’introduction à la demande depuis le module dédié.
- `toast()` joue un son discret uniquement si `preferences.sound` est actif (Web Audio, aucun fichier externe).

### Correctifs

- Ollama : lorsque la route exige une session, le message affiche « Connexion NovaID requise » au lieu d’un faux « Serveur injoignable ».
- Le chargement de `/feature-lab-model.js` est ajouté au SHELL PWA, avec `CACHE_REVISION` `2026-11-11-nova-3-lot10-feature-lab`.
- `npm run check` vérifie désormais aussi `feature-lab-model.js`.

## Vérifications du lot 10

- `npm test` : **50/50**, dont **9 nouveaux tests** Feature Lab (unicité des 50 modules, 8 catégories, zéro concept, migration des index, compteurs, filtres, recherche, cibles d’action, préférences).
- `npm run check` : serveur, `app.js`, `feature-lab-model.js`, `series-model.js`, `motion.js`, `boot.js` valides.
- Navigateur réel (6300) : **50 cartes**, **0** « Concept — non actif », filtres « focus » → 3 résultats, Apparence → 8 modules, tout désactiver → 0/50 puis tout activer → 50/50, Focus 25 min lancé, modales santé/stats/prompts/mode privé fonctionnelles, palette ouverte, **0 erreur console**.
- État local invité sauvegardé avant les tests puis restauré : aucun environnement utilisateur modifié.
- `/api/health` et `/api/version` renvoient `3.2.0` après redémarrage du serveur.

---

# NovaCore 3.1.0 — Nova Engine & NovaSeries complets

Version publiée le 10 novembre 2026. `package.json`, le footer, `/api/version` et le cache PWA affichent `3.1.0`. Les lots 8 et 9 terminent Nova Engine et NovaSeries sans modifier le stockage ni les données utilisateur.

## Lot 8 — Nova Engine 0.3.0 et Workbench 1.3.0

### Noyau C++

- Format de scène `schemaVersion 2` : identifiants texte, composants, hiérarchie, parseur/sérialiseur JSON et validation des références, doublons et cycles.
- Noyau exposé par `engine/include/nova/nova_core.hpp` / `engine/src/nova_core.cpp`, API 3, moteur **0.3.0**.
- CLI : `--scene`, `--validate`, `--json`, `--export`, `--help`.
- Tests étendus ; `ctest` → **1/1 passed**.

### Workbench

- `server.mjs` passe en **1.3.0** : `/api/version`, bibliothèque `/api/scenes`, export, import, renommage, suppression, `/api/validate` et `/api/engine/validate`.
- `/api/engine/validate` fait valider la scène par le **binaire C++ réel** via le Workbench, au lieu d’une validation JavaScript seule.
- Charge utile portée à 2 Mo ; corps JSON réinjecté après `express.json()` dans le proxy `/nova-engine`.
- Interface v1.3 : annuler/rétablir, bibliothèque, import, validation C++ et jeton NovaID sur les `fetch` directs.

## Lot 9 — NovaSeries 3.1

### Modèle partagé

- Nouveau module pur `public/series-model.js`, chargé avant `app.js` et importé directement par les tests Node.
- Contient `normalizeStructuredScript`, `normalizeSeriesProject`, `createSeriesProject`, `seriesReadiness`, `moveItem`, `duplicateItem`, `dossierMarkdown`, `shotsCsv`, `structuredScriptText`, `exportPayload`, `slug` et la validation de date/durée.
- `app.js` délègue au modèle tout en conservant les fonctions attendues par les tests de navigation.

### Atelier de production

- Édition en place, duplication, réorganisation ↑/↓ et suppression pour personnages, épisodes, assets, storyboard et plans.
- Actions **Nouveau projet**, **Dossier Markdown**, **Imprimer / PDF**, **Exporter JSON** et **shot list CSV**.
- Export de projet tagué `projectFormat: "NovaSeriesProject"` + `projectVersion: 2`, sans écraser le champ `format` qui décrit le type de série.
- Imports legacy plats et enveloppés acceptés ; validation stricte réservée à l’import.
- Diagnostic enrichi à **12 contrôles** (ajout du guide de style et du script structuré).
- Styles d’actions et feuille d’impression ajoutés dans `public/design-3.css`.

### Correctifs issus des tests

- Une date invalide (`2026-13-99`) est désormais rejetée.
- Une durée nulle est ramenée au minimum au lieu de conserver `0`.
- Le contrôle « assets non bloqués » est faux sans asset, au lieu d’être vrai par vacuité.
- Le réimport d’un export NovaSeries restaure désormais tout le projet (l’ancien export plat rendait le réimport impossible).

## Vérifications des lots 8 et 9

- `npm test` : **41/41**, dont 10 nouveaux tests NovaSeries.
- `npm run check` : serveur, `app.js`, `series-model.js`, `motion.js` et `boot.js` valides ; `node --check public/sw.js` OK.
- Workbench : `npm run check` et `npm run test:scene-api` OK ; `/api/version` → `1.3.0`, moteur `0.3.0`, `sceneSchema: 2`.
- Navigateur isolé (6311) : import/édition/duplication/réorganisation, diagnostic **12/12 · 100 %**, création de projet, exports JSON/Markdown/CSV, impression, réimport complet, persistance après rechargement, **0 erreur console**.
- Environnements réels : **6300** en 3.1.0 (3 comptes, 3 espaces, 94 événements), serveur isolé **6311** en 3.1.0, Workbench **5201/5202** en 1.3.0.
- `CACHE_REVISION` passé à `2026-11-10-nova-3-lot9-series` ; `/series-model.js` ajouté au SHELL PWA.

---

# NovaCore 3.0.1 — Stockage SQLite transactionnel

Version publiée le 10 novembre 2026. Les données JSON existantes sont importées automatiquement, vérifiées puis archivées ; `package.json`, le footer, `/api/version` et le cache PWA affichent `3.0.1`.

## Lot 7 — Données P0 : migration JSON → SQLite

### Moteur de stockage

- `server/db.js` utilise désormais `node:sqlite` (`DatabaseSync`, intégré à Node.js 22+) : aucune compilation d'addon natif, aucune dépendance ajoutée.
- Schéma versionné (`PRAGMA user_version` + table `meta`), tables `users`, `user_data`, `plugins`, `events`, index sur `events(user_id, id DESC)` et `users(email)`.
- Transactions explicites (`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`) pour l'import et les écritures ; `journal_mode=WAL`, `synchronous=FULL`, `busy_timeout=5000`.
- API publique conservée (`getUserBy*`, `insertUser`, `updateUser`, `bumpTokenVersion`, `getWorkspaceRaw`, `prepare`, `stats`, `backupNow`) : les routes et `server/auth.js` restent inchangés.
- `plugin_prefs` stocké en JSON texte et relu en objet ; `email_verified` converti en booléen et `token_version` en nombre pour ne pas invalider les sessions.

### Migration et intégrité

- Import unique du `novacore.json` historique dans `novacore.sqlite`, **avec contrôle des compteurs** (comptes, espaces, événements, extensions) avant validation de la transaction.
- Le JSON source est renommé `novacore.json.migrated-<horodatage>` : jamais supprimé, toujours réimportable.
- Une source invalide (doublon, JSON incomplet) est refusée **sans import partiel** ; le fichier reste intact pour analyse.
- Redémarrage : aucune double importation ; la migration est mémorisée dans `meta` et exposée par `/api/ready`.

### Sauvegardes et restauration

- Les sauvegardes restent des instantanés JSON portables dans `backups/` (rotation `NOVACORE_BACKUP_KEEP`, 14 par défaut), prises après les écritures critiques (compte, workspace, import, arrêt).
- Une sauvegarde utilisée pour restaurer est **copiée** (`novacore.restored-*`), pas déplacée : la chaîne de sauvegardes reste intacte.
- Base corrompue ou illisible : mise en quarantaine de `novacore.sqlite` (+ `-wal`/`-shm`), puis réimport de la dernière sauvegarde contenant des comptes. `/api/ready` expose `recovery.restoredFrom`.
- Sous Windows, la connexion SQLite est fermée avant le renommage pour que la quarantaine fonctionne réellement (correctif issu du test).

### Observabilité

- `/api/health` et `/api/version` renvoient `storage: "sqlite"`, `storageVersion` et `journalMode`.
- `/api/ready` renvoie le moteur, le schéma, les compteurs réels, la migration et la restauration éventuelle.
- `/api/diagnostics` annonce `sqlite-transactional` et la version de schéma.

## Vérifications du lot 7

- `npm test` : **30/30**, dont 3 nouveaux tests SQLite (migration complète, refus d'import partiel, installation neuve).
- Migration d'une **copie des données réelles** : 3 comptes, 3 espaces, 94 événements, 3 extensions, 14 sauvegardes → **différence ligne par ligne : aucune** ; JSON archivé identique à l'octet près ; redémarrage stable.
- Test de restauration porté sur SQLite **sans affaiblissement** : base corrompue → quarantaine → restauration du compte et du workspace `Projet-Dave`, `recovery.restoredFrom` renseigné.
- Navigateur isolé (6311, données migrées) : `/api/ready` → `sqlite`/WAL, footer `3.0.1`, synchronisation d'un projet conservée après rechargement, 14 pages sans débordement, **0 erreur console**.
- `CACHE_REVISION` passé à `2026-11-10-nova-3-lot7-sqlite`.

---

# NovaCore 3.0.0 — Lancement public

Version publiée le 10 novembre 2026. Les lots 1 à 6 sont livrés et vérifiés ; `package.json`, le footer, `/api/version` et le cache PWA affichent désormais `3.0.0`.

## Lot 1 — Navigation

- Lien d'évitement corrigé vers `#view` avec `tabindex="-1"`, focus sur le titre et retour en haut à chaque changement de page.
- Historique réel : `pushState` sur la navigation, `popstate` pour retour/avance, URL profonde `?page=<page>` avec repli `overview` et nettoyage des pages inconnues.
- `document.title`, `aria-current="page"` et garde anti-course sur les rendus asynchrones (`renderGeneration`).
- `logout()` réinitialise l'URL et l'historique.

## Lot 2 — Identité et accès

- **Guide Noxa supprimé** : mascotte, bulle, tutoriel, sons et appels associés retirés de l'interface ; le cache PWA ne référence plus l'image.
- **Vérification e-mail facultative** : un compte non vérifié peut se connecter et utiliser projets, tâches, notes, calendrier, Nova Focus, Knowledge Base, Code Studio et les autres espaces de travail.
- **Outils avancés protégés** : Nova Engine, NovaOS, Nova Series, Nova IA (dont Learn Lab) et RetroEdge exigent une adresse vérifiée, avec écran dédié, bouton « Renvoyer le lien » et actualisation immédiate après vérification.
- **API serveur** : `requireAuth` ne bloque plus les comptes non vérifiés ; `requireVerified` protège `/api/ai/*` et `/nova-engine/api/*`. L'état réel est relu depuis la base et non depuis le jeton.
- **Inscriptions** : la production ne bloque plus la création de compte quand SMTP manque ; l'envoi de vérification est facultatif et un échec n'empêche pas l'usage de base.
- **Anti-énumération conservé** : une adresse déjà inscrite renvoie la même réponse qu'une création réussie, sans lien de vérification.
- **Textes** : notice d'utilisation, écran NovaID et README alignés sur la nouvelle règle.

## Vérifications du lot 2

- `npm test` : **20/20** (dont vérification facultative, outils avancés et production sans SMTP).
- `npm run check` : OK.
- Navigateur isolé (6311) : compte non vérifié → 6 pages de base accessibles, 6 écrans de vérification (NovaOS, Nova Engine, Nova Series, Nova IA, Learn Lab, RetroEdge), 0 erreur console ; après vérification → accès aux 5 outils, `/api/ai/status` et `/api/ai/models` en 200.

## Lot 3 — Design 3.0

- Nouvelle couche `public/design-3.css`, chargée après `styles.css` et `polish.css` : elle ne remplace pas l'existant, elle unifie l'identité visuelle.
- **Jetons 3.0** : largeur de barre latérale (272 px), gouttières fluides, rayons, hairline, ombres à deux niveaux, lueur d'accent et palette de texte.
- **Ambiance** : halo d'accent plus profond, trame fine masquée en haut de page, étoiles et nébuleuse atténuées pour la lisibilité.
- **Barre latérale** : groupes plus lisibles, item actif en verre teinté avec rail d'accent, marqueurs d'outils et carte de compte réharmonisés.
- **En-tête** : fil d'Ariane en petites capitales, titre plus grand, actions alignées, barre collante conservée.
- **Contenu** : titres de section avec filet, cartes et widgets à profondeur contrôlée, survol à −2 px, tableaux, listes, états vides et badges unifiés.
- **Héros produit** : NovaOS, Nova Series, NovaStore, Nova IA, Learn Lab, Nova Engine et RetroEdge partagent la même grammaire de surfaces.
- **Portes d'accès** : contrat, NovaID et écran de vérification e-mail alignés sur la nouvelle profondeur.
- **Thème clair** : jeux de jetons dédiés pour que la couche 3.0 suive le thème sans exception.
- **Responsive** : 272 px desktop, 232 px tablette, tiroir 270 px mobile ; grilles 4 → 2 → 1 colonne ; aucune page ne déborde horizontalement.
- `design-3.css` ajouté au `SHELL` du Service Worker.

## Vérifications du lot 3

- `npm test` : **20/20** ; `npm run check` et `node --check public/sw.js` : OK.
- Navigateur isolé (6311) : `design-3.css` chargée (113 règles), **24 pages** rendues, **0 débordement horizontal**, **0 erreur console**.
- Mesures desktop (1296 px) : barre latérale 272 px, marge du contenu 272 px, cartes 19 px, héros 26 px.
- Mesures tablette (900 px) : barre latérale 232 px, statistiques sur 2 colonnes. Mobile (390 px) : tiroir masqué, menu visible, marge 0, aucune page ne déborde.
- Thème clair : fond `#f7faff`, texte `#3e4864`, cartes claires, barre latérale claire, titres `#141a2b`.

## Correctif — Défilement de la barre latérale

- **Cause** : l'indicateur de navigation réécrivait la classe `ready` à chaque passage dans `place()`. Cette mutation relançait son propre `MutationObserver` en boucle (1 935 mutations en 800 ms). Le second observateur réagissait à chaque mutation en appelant `scrollIntoView({ block: 'nearest' })` sur l'entrée active : dès que l'utilisateur faisait défiler la barre, elle était ramenée de force sur l'entrée active.
- **Correction** (`public/motion.js`) : la classe `ready` n'est plus réécrite si elle est déjà présente ; la boucle de placement ignore les mutations de l'indicateur ; le défilement automatique ne se déclenche plus que lorsque l'entrée active change réellement.
- **Diffusion** (`public/sw.js`) : jeton `CACHE_REVISION` ajouté au nom du cache. Le correctif remplace l'ancien cache sans changer la version affichée `2.21.0`.
- **Test de non-régression** ajouté dans `test/navigation.test.js`.

## Vérifications du correctif

- `npm test` : **21/21** ; `npm run check` : OK.
- Navigateur isolé (6311) : après défilement jusqu'en bas, `scrollTop` reste à sa valeur maximale (747 px) après 1,6 s, **0 mutation de classe** contre 1 935 avant ; indicateur toujours aligné sur l'entrée active.
- Validation aux largeurs **360, 390, 768, 900 et 1366 px** (hauteur 760 px) : le défilement reste en bas, la carte de compte est entièrement visible et l'indicateur reste aligné après changement de page.
- Service Worker : nouveau cache `novacore-shell-v2.21.0-2026-11-08-sidebar-scroll`, ancien cache supprimé, `motion.js` corrigé servi depuis le cache, **0 mutation** et **0 erreur console** après rechargement contrôlé.
- **0 erreur console**.

## Lot 4 — Nova 3.0 (assistant + OS)

### NovaOS — Brief du jour

- Nouvel emplacement `brief` en tête de `NOVAOS_WIDGETS`, construit à partir des données réelles du workspace : tâches en retard, échéances du jour, priorités hautes, projets actifs, focus cumulé et onboarding si l'espace est vide.
- Aucune donnée de démonstration ni inférence IA : le brief est **100 % déterministe** et se recalcule à chaque rendu.
- Les dispositions sauvegardées qui ne connaissent pas encore `brief` le reçoivent automatiquement en première position, sans perdre l'ordre personnalisé de l'utilisateur.
- Nouveau style `.novaos-brief*` dans `design-3.css` : deux colonnes puis une colonne sur mobile, tons urgent/warn, thème clair.

### NOVAI 3.0 — conversation persistée et contexte réel

- La conversation est conservée dans `state.novaiChat` (24 messages maximum), synchronisée avec le workspace et restaurée après rechargement ou changement d'appareil.
- Suggestions contextuelles par mode (assistant, développeur, créatif, Learn Lab) ; un clic remplit le champ sans envoyer.
- Le serveur enrichit `/api/ai/chat` avec les projets, tâches ouvertes et en retard, notes, connaissances, roadmap, focus, activité récente du compte et titre Nova Series. L'adresse e-mail n'est jamais transmise au modèle.
- Historique borné : 20 derniers messages envoyés côté client, 30 maximum acceptés côté serveur.
- `clearChat()` vide aussi la conversation persistée ; le changement de mode rafraîchit les suggestions.
- Test dédié avec un faux fournisseur local : le prompt système contient les faits du workspace et l'activité, ne contient pas l'e-mail, et un historique de 31 messages est rejeté.

### Palette de commandes globale

- `Ctrl+K` / `Cmd+K` ouvre la palette depuis n'importe quelle page ; le bouton `⌘` de l'en-tête et le raccourci du héros font de même.
- 27 commandes : 20 pages de navigation et 7 actions (nouveau projet, nouvelle tâche, capture rapide, session Focus, thème, réinitialisation NovaOS, export).
- Recherche insensible aux accents, classée par pertinence : libellé exact, mot-clé exact, description, puis mot-clé partiel.
- Navigation clavier complète : `↑` / `↓`, `Entrée`, `Échap` ; rôles `dialog`, `combobox`, `listbox` et `aria-selected`.
- Focus rendu au déclencheur à la fermeture, overlay sous les portes d'accès, styles responsive et thème clair.

### Correctif technique

- La requête d'activité récente utilise désormais `ORDER BY id DESC LIMIT 30` puis `.slice(0, 10)`, conformément aux requêtes reconnues par le wrapper JSON ; une requête non reconnue bloquait auparavant la réponse HTTP de `/api/ai/chat`.

## Vérifications du lot 4

- `npm test` : **25/25** ; `npm run check` et `node --check public/sw.js` : OK.
- Navigateur isolé (6311), compte vérifié et workspace peuplé : le brief affiche « 3 tâches ouvertes · 2 projets actifs · 25 min de focus aujourd'hui », « 1 tâche en retard », « 1 échéance aujourd'hui » et les deux projets actifs ; **0 débordement horizontal**, **0 erreur console**.
- NOVAI : 3 suggestions par mode, changement de mode met à jour les chips, envoi réel via fournisseur local, conversation restaurée après rechargement (2 messages côté serveur), **0 erreur console**.
- Palette : ouverture par `Ctrl+K`, 27 commandes, focus dans le champ, filtre « note » → Notes / Capture rapide / Recherche globale, `↓` + `Entrée` ouvre **Nouvelle note** avec les champs Titre et Contenu, `Échap` ferme et rend le focus au bouton `⌘`, « projets » navigue vers `?page=projects`. Thème clair vérifié par styles calculés (panneau `#ffffff → #f5f7fc`, texte `#3e4864`) ; règles responsive présentes (palette pleine largeur et hauteur max 82 vh sous 520 px).
- `CACHE_REVISION` passé à `2026-11-09-nova-3-lot4` pour diffuser les nouveaux fichiers sans changer la version affichée.

## Lot 5 — Nova Engine & NovaSeries 3.0

### Nova Engine — état réel du Workbench

- Nouvelle carte « État réel du Workbench » sur la page Nova Engine, alimentée par `/nova-engine/api/status` : version du Workbench, version et langage du projet, disponibilité de CMake et du compilateur, build configuré, exécutable présent, processus actif et dernière action.
- Badge honnête : **En ligne** uniquement si le service répond, **Indisponible** sinon, avec le message d'erreur réel et un bouton d'actualisation.
- L'export `nova-engine-development-brief.json` reprend désormais les valeurs réelles : version `0.3.0`, Workbench `1.2.0`, C++23, CMake/CTest, toolchain réelle, dernière action, checklist et note sur la roadmap de développement.
- **Checklist de release isolée par compte** : clé `novaEngineCheck:<userId|guest>:<clé>`, migration douce depuis l'ancienne clé globale, aucune valeur partagée entre comptes.

### NovaSeries — diagnostic et import de projet

- **Diagnostic de production déterministe** : 10 contrôles calculés depuis la bible, les épisodes, les personnages, les assets, le storyboard, la shot list et l'échéance cible ; barre de progression et détail des points bloquants.
- **Import de projet NovaSeries** : bouton « Importer un projet » (JSON ≤ 2 Mo), validation du format `NovaSeriesProject`, normalisation et bornage de tous les champs (épisodes, personnages, plans, storyboard, assets, script structuré), refus explicite des formats inconnus sans toucher à l'état existant.
- L'import d'un script structuré réutilise la même normalisation que le diagnostic, pour éviter deux formats divergents.
- Nouveaux styles `.engine-live*` et `.series-readiness*` : grille responsive 3 → 2 → 1 colonnes, thème clair.

## Vérifications du lot 5

- `npm test` : **27/27** ; `npm run check` et `node --check public/sw.js` : OK.
- Nova Engine (navigateur isolé 6311, Workbench isolé 5202) : badge « En ligne », Workbench `1.2.0`, Nova Engine `0.3.0 · C++23`, CMake `4.3.2` disponible, compilateur absent, build configuré, exécutable absent, aucun processus, dernière action `Ready · idle` ; **0 débordement**, **0 erreur console**.
- Checklist Engine : `novaEngineCheck:fe7c7800-c49d-4bb5-b51d-df919f97a1bf:build` = `1`, toujours cochée après rechargement, aucune valeur pour un autre compte.
- Export Engine : le fichier capturé contient bien `version: 0.3.0`, `workbenchVersion: 1.2.0`, `language: C++23`, `toolchain.cmake.ok: true` (4.3.2), `toolchain.compiler.ok: false`, `lastAction { name: Ready, status: idle }` et la checklist.
- NovaSeries : diagnostic initial `1/10 · 10 %` ; import d'un projet complet → `10/10 · 100 %`, 2 épisodes, 1 scène structurée, style guide conservé. Le projet est présent dans `localStorage` (`novaWorkspace:<userId>`) **et** sur le serveur (`/api/sync`, même `_novaUpdatedAt`), puis restauré après rechargement. Un format invalide est refusé et l'état existant reste intact ; **0 erreur console**.
- `CACHE_REVISION` passé à `2026-11-09-nova-3-lot5`.

## Lot 6 — Lancement public 3.0.0

### Version publiée

- `package.json` et `package-lock.json` passent en **3.0.0** ; le footer par défaut de `index.html`, `FALLBACK_VERSION` du Service Worker et `GET /api/version` affichent tous `3.0.0`.
- `CACHE_REVISION` passé à `2026-11-10-nova-3-release` : le nouveau cache PWA remplace l'ancien sans dépendre d'une version figée côté client.

### Nettoyage final

- Suppression de **13 990 octets** de CSS Noxa/tutoriel résiduel dans `styles.css` (blocs `noxa-*`, `tutorial-*`, `nova-tutorial`), en conservant les règles partagées `.hacker-game` et `@keyframes starFloat` utilisées par les orbites produit.
- README, CHANGELOG et `PUBLIC_LAUNCH_ROADMAP.md` mis à jour pour l'état réel 3.0.0.

## Vérifications du lot 6

- `npm test` : **27/27** ; `npm run check` et `node --check public/sw.js` : OK.
- Workbench : `npm run check --prefix nova-engine-workbench` OK et `npm run test:scene-api --prefix nova-engine-workbench` → **Named scene API test passed**.
- Navigateur isolé (6311) : `GET /api/version` → `3.0.0`, footer `3.0.0`, cache unique `novacore-shell-v3.0.0-2026-11-10-nova-3-release`.
- Parcours des 14 pages principales avec compte vérifié : aucune porte de vérification inattendue, aucun débordement horizontal, **0 erreur console**.
- Styles : **0 règle** contenant `tutorial` ou `noxa`, `.hacker-game` et `@keyframes starFloat` toujours présents ; page Nova Engine et NovaSeries rendues normalement après nettoyage.
- Sauvegarde préalable à la 3.0 conservée : `NovaCore-2.10-backup-2.21-avant-3.0.zip`.
- Archive de livraison : `C:\Users\amzas\Documents\NovaCore-3.0.0-release.zip` (4,00 Mo, 64 entrées, sans `node_modules`, sans `.env`, sans données utilisateur), `package.json` extrait = `3.0.0`, SHA-256 `084175B5BBA2EE7B47CDC702581AEB6D3286C2A8B8113DD62B049CE711AD60E0`.

---

# NovaCore 2.21.0 — Foundation

Sprint « Foundation » (lots A, B et C partiel) issu de l'audit `AUDIT-PHASE1.md`. Aucun nouveau gros module : l'objectif était de rendre réelles les fonctions existantes et de garantir que chaque utilisateur retrouve son environnement après une mise à jour.

## Données et comptes (lot A)

- **Espace de travail par compte** : clé `novaWorkspace:<userId>`, clé invitée séparée `novaWorkspace:guest`, migration unique de l'ancienne clé globale `novaWorkspace`.
- **Restauration à la connexion et au démarrage** : l'espace serveur est récupéré automatiquement ; en cas de conflit, la version la plus récente est conservée et l'espace local est envoyé au serveur s'il est plus récent.
- **Synchronisation automatique débouncée** (1,5 s) après chaque modification locale, sans synchronisation pendant le rendu ni pendant l'application d'un état distant.
- **Correctif de non-régression** : aucune écriture locale n'est effectuée tant que la session et la restauration ne sont pas résolues, afin qu'un premier chargement vide (nouvel appareil, cache vidé) n'écrase jamais l'espace serveur. Les modifications locales plus récentes restent prioritaires et sont renvoyées au serveur.
- **Déconnexion propre** : le jeton est supprimé, les synchronisations en attente sont annulées et le mode invité reprend son propre espace.
- **Suppression totale des données de démonstration** : `defaultState()` ne contient plus de projets, tâches, notes ni série fictifs ; l'auto-remplissage de la roadmap et les données de démonstration de NovaSeries ont été retirés. Les données existantes des utilisateurs ne sont pas modifiées.
- **Fiabilité du stockage** : sauvegarde écrite **après** l'écriture atomique, sauvegardes forcées sur les comptes et les workspaces, restauration prioritaire des sauvegardes contenant des utilisateurs, gestion de `SIGBREAK` sous Windows.

## Fonctionnalités réelles (lot B)

- **Calendrier** : basé sur de vraies dates d'échéance (`due`), champ « Échéance » à la création d'une tâche, tâches sans échéance listées séparément, compteur « En retard ».
- **Automations** : déclencheurs réels `manual`, `startup` et `focus` ; chaque exécution est journalisée dans les notes, avec `lastRunAt` et `runCount` affichés. Déclenchement au démarrage et à la fin d'une session Focus.
- **Feature Lab** : les modules non implémentés portent le badge « Concept — non actif » et ne redirigent plus vers une page.
- **Version unique** : `GET /api/version` alimente le footer (`#appVersion`) et le cache du Service Worker ; `package.json` est en 2.21.0.
- **IA locale** : `GET /api/ai/models` renvoie toujours 200 avec `reachable:false` si Ollama est absent ou inaccessible.

## Sécurité, accessibilité et finitions (lot C partiel)

- `.env.example` documenté (réseau, sécurité, SMTP, stockage, IA) ; `robots.txt` ajouté.
- Suppression de la fonction morte `chart()`.
- Noms accessibles ajoutés aux cases à cocher des tâches ; `aria-label` incohérent de `.novaos-retroedge-spotlight` retiré ; contraste du footer corrigé (`#9aa2b8`, 10 px).

## Vérifications

- `npm test` : **14/14**.
- `npm run check` : OK (serveur, `app.js`, `motion.js`, `boot.js`).
- Workbench : `npm run check` et `npm run test:scene-api` OK.
- C++ : build CMake + `ctest` **1/1**.
- Serveur isolé : `/api/version`, `/api/ai/models`, `/api/health`, `/robots.txt`, footer et meta vérifiés.

**Limites assumées** : la CSP garde `'unsafe-inline'` (≈169 handlers inline, sprint C1 non commencé) ; le stockage reste un fichier JSON mono-instance, la migration SQLite est prévue en 2.22.

## 2.20.1 — RetroEdge Motion & Search Fixes

- Emblème RetroEdge détouré en PNG transparent pour supprimer le rectangle noir de l’image source.
- Animations de présentation, halo métallique, flottement léger et micro-interactions sur les sections.
- Recherche locale étendue aux snippets, brouillons et jalons, avec normalisation des accents et déclenchement par Entrée.
- Recherche du compte étendue aux mêmes catégories lorsque la session est connectée.
- Cache Service Worker renouvelé.

# NovaCore 2.20.0 — Hardened core & immersive motion

## Sécurité et données (roadmap P0)
- Production : démarrage refusé sans `JWT_SECRET` fort ; routes développeur masquées ; diagnostics protégés ; aucun lien de vérification exposé.
- Limitation de débit (connexion par IP et par compte, inscription, vérification, renvoi, IA, synchronisation, actions sensibles).
- Politique de mot de passe, anti-énumération des comptes (inscription), comparaison à temps constant à la connexion.
- Sessions révocables : `POST /api/auth/logout-all` ; jetons HS256 uniquement.
- **Correctif d'isolation** : l'activation des extensions était globale (un utilisateur modifiait celle des autres) ; elle est désormais par compte.
- CSP, en-têtes de sécurité, identifiant de requête, journaux sans query string (les liens de vérification contiennent un jeton), erreurs JSON propres.
- Données : fichier corrompu mis en quarantaine (jamais écrasé) + restauration automatique depuis la dernière sauvegarde valide ; sauvegardes rotatives ; écriture atomique avec `fsync` ; erreur 507 claire si disque plein.
- Export/import par utilisateur (`GET /api/export`, `POST /api/import`) avec sauvegarde préalable.
- Sondes `GET /api/ready`, arrêt gracieux avec sauvegarde.
- 14 tests automatisés (`npm test`) : isolation entre comptes, rate limiting, révocation, corruption, production.

## Design et mouvement
- Nouvelle couche `polish.css` : jetons de design, navigation épurée, en-tête fixe, boutons/champs/cartes/modales unifiés, thème clair corrigé en contraste.
- Polices Inter et Space Grotesk auto-hébergées (plus de dépendance à Google Fonts, fonctionne hors ligne).
- `motion.js` : entrées en cascade par page (sans rejouer lors d'une simple mise à jour), compteurs et barres animés, indicateur de navigation glissant, halo suivant le pointeur, parallaxe douce, ondulation au clic, barre de progression de défilement, ciel étoilé (30 fps max, pause hors-écran), modales avec sortie animée, titre animé.
- Accessibilité : lien d'évitement, Échap ferme les modales et rend le focus, annonces des notifications, `prefers-reduced-motion` et préférence « animations » respectés.
- Cache PWA renouvelé ; scripts inline déplacés dans `boot.js`.

# NovaCore 2.11.0 — UI fixes & port 6300
- Port principal par défaut déplacé vers 6300 ; configuration, lancement desktop, URLs documentées et cache PWA alignés.
- Navigation compacte ajoutée à la fenêtre NovaID sans augmenter sa taille.
- Correction des débordements et du défilement des options de vérification sur petits écrans.
- Flou du tutoriel désactivé et nettoyage explicite des éléments d’overlay à sa fermeture.

## 2.8.1 — Port 6200
- Port principal par défaut déplacé de 6100 à 6200.
- Configuration `.env.example`, client desktop, commande cURL et mode développeur alignés.
- Cache PWA renouvelé.
- Port interne Nova Engine Workbench conservé à 5201.

# NovaCore 2.10.0 — Production Tools

- NovaSeries : NovaScript ajoute une structure de scènes, personnages, actions et dialogues, avec import/export JSON et export texte sans supprimer les brouillons existants.
- Nova Engine : Scene Lab ajoute des snapshots nommés, chargement de snapshots et parentage d’entités validé côté serveur.
- Noyau C++ : graphe de scène parent-enfant, refus des cycles et calcul de transformations monde testables.
- Port principal maintenu à **6200**. Le renderer GPU/Vulkan et le viewport 3D restent hors périmètre.

# Changelog NovaCore

## 2.8.0 — Secure Launch & Production Workbenches
- Introduction Supernova locale avec animation d'explosion, reveal NOVACORE et transitions de démarrage.
- Contrat d'utilisation/avis de projet avant d'accéder à la connexion.
- Accès de l'application verrouillé tant que l'utilisateur n'a pas ouvert une session NovaID vérifiée.
- Vérification d'adresse e-mail par lien à durée limitée ; SMTP configurable avec fallback de développement explicite.
- Checklist de sécurité, persistance de l'accord contractuel et vérification des comptes côté serveur.
- NovaSeries : tableau de pilotage de production, livrables, suivi de versions et exports renforcés.
- Nova Engine : scène prototype éditable, hiérarchie d'entités, aperçu de viewport et socle runtime C++23 plus testable.
- Port par défaut : 6100.

# NovaCore 2.6.0 — Supernova Production Studio

- Port par défaut déplacé à 6000, écoute LAN conservée.
- NovaSeries Studio enrichi : suivi de production, budget indicatif, échéance, script editor, asset tracker, checklist, export TXT/JSON/CSV.
- Nova Engine Workbench : roadmap technique, checklist de release locale et export du brief de développement.
- Tutoriel guidé : mascotte étoile qui se déplace vers les sections à présenter.
- Cache PWA renouvelé.

# Changelog

## 2.4.0 — Developer Mode
- Port par défaut déplacé vers 5000 ; écoute LAN sur 0.0.0.0.
- Page Mode développeur avec code, limitation des tentatives et redémarrage du serveur après activation.
- Style des icônes et boutons en plaques de verre vert translucide avec relief.
- Outils développeur : liens rapides vers diagnostics, Learn Lab, Code Studio et API Explorer.
- Le mode développeur n’exécute pas de commandes arbitraires.


## 2.3.0 — Learn Lab AI Studio + LAN
- Port par défaut déplacé vers **5000**.
- Serveur lié à `0.0.0.0`, avec affichage des adresses IPv4 du réseau local au démarrage.
- Learn Lab Studio : datasets JSON versionnés, évaluations heuristiques, historique comparatif, inventaire Ollama et prototypes exportables non exécutables.
- Exports JSON pour datasets et expériences.
- Cache PWA versionné et documentation de l'accès Wi-Fi, des limites de stockage et des précautions réseau.

## 2.2.0 — NOVAI Studio
- Quatre modes NOVAI et mémoire de projet.
- Sandbox de prototypage textuelle, sans exécution arbitraire de code.

## 2.1.0 — Liquid Glass Edition
- Identité Nova Industries et améliorations visuelles.
- Écran de démarrage et Nova Feature Lab.

## 2.0.0 — Creator OS
- Roadmap & Releases, recherche globale et centre système.
- Diagnostics techniques et route d’inventaire Ollama.
- Shell PWA et conservation des modules du workspace NovaCore.


## 2.4.1 — Clear Liquid Glass
- Remplacement des plaques vertes par des plaques en verre transparent, avec reflets froids, profondeur et relief.
- Mise à jour du cache PWA pour charger les nouveaux styles.
- Port 5000 et mode développeur conservés.


## 2.5.0 — Supernova Creator Suite
- Refonte artistique plus épurée, transitions fluides et mascotte Nova étoile souriante au démarrage.
- Tutoriel animé de première visite avec navigation guidée vers les sections principales.
- Mode STYLE HACKER avec thème glitch/cyber, animations de code et mini-jeu secret SUPERNOVA BREACH. Activation par le bouton ⌁, ou en tapant `nova`.
- NovaSeries Studio : bible de série, personnages, épisodes, storyboard, liste de plans et export JSON. Outil de préproduction, sans génération vidéo automatique.
- NovaStore en développement : brouillons privés de fiches de création exportables ; aucune vente ni paiement activé.
- Version de cache PWA renouvelée pour charger les nouveaux fichiers.


## 2.9.0 — NovaOS Control Center
- Refonte de la vue d’ensemble en tableau de bord NovaOS.
- Ajout de KPI réels, accès rapides, recherche, actions prioritaires et historique local.
- Widgets réorganisables et masquables avec préférences persistantes.
- Contrôles rapides d’accent et d’animations, mises en page adaptatives et respect du mouvement réduit.
- Port 6200 conservé.


## NovaCore 2.14.0 — Noxa contextual guide
- Reduced the tutorial card footprint and placed it in a screen corner chosen to avoid the active navigation target.
- Made Noxa visit varied screen positions and approach navigation targets from alternating directions instead of repeatedly snapping to the left rail.
- Kept Noxa's speech bubble anchored to her current position.
- Added optional French browser speech when the user explicitly enables Noxa sound.
- Updated the service-worker cache version to prevent stale guide assets.

## 2.15.0 — Noxa Dock & SMTP
- Noxa no longer speaks with browser text-to-speech; replaced by soft synthesized mouth-pop tones and a speaking-mouth animation.
- Noxa remains docked in the bottom-right corner by default and only roams after the user clicks her.
- Added developer-mode SMTP configuration and connection verification endpoints; password is never returned to the browser.
- Main application port remains 6300.

## 2.18.0 — RetroEdge visual identity
- Added a dedicated RetroEdge section to the NovaCore sidebar.
- Added a metallic black-and-silver presentation using the supplied 3D emblem artwork.
- Added project vision, planned features, device-family compatibility notes, and a staged roadmap.
- Compatibility is explicitly marked as unvalidated; Linux handhelds such as R36S are not represented as Android devices.
- Main server port remains 6300.


## 2.19.0 — NovaCore visual refresh & RetroEdge spotlight
- RetroEdge déplacé en première position de la navigation pour rendre le projet immédiatement visible.
- Ajout d’un bandeau RetroEdge sur le tableau de bord NovaOS.
- Refonte de la page RetroEdge : emblème RE isolé du poster, hiérarchie éditoriale, animation d’entrée, sections révélées au défilement, cartes et roadmap responsive.
- Ajout de critères explicites de validation avant toute pré-version publique.
- Harmonisation visuelle générale : contraste, focus clavier, interactions, cartes, navigation et responsive.
- Cache PWA renouvelé et nouvel emblème ajouté au pré-cache.
- Port principal maintenu à 6300.
