# NovaCore 3.10.0 — sauvegardes chiffrées, couche Milenium 4.4, accueil et actions NOVAI

NovaCore 3.10.0 réunit trois ensembles livrés sous la même version applicative : le lot **P0
données** (sauvegardes locales chiffrées en **AES-256-GCM**, rétention par nombre **et par
âge**, restauration automatique capable de les déchiffrer) ; la **couche visuelle Milenium
4.4** (feuille `milenium.css`, Studio 3D, scène `nova-scene.js`) ; puis les compléments
d’**accueil** — tutoriel en 8 étapes, interface **FR/EN**, mode **performance** et **actions
NOVAI** whitelistées avec confirmation. Le port reste **6300** ; le moteur reste **0.8.0**,
l’API C++ **6** et le schéma de scène **4**.

### Ce qui change (lot P0 données)

- **Chiffrement AES-256-GCM** (`server/backup-crypto.js`, nouveau) : fichiers
  `backups/novacore-*.json.enc` avec en-tête `NCBK1`, version 1, IV aléatoire de 12 octets et
  tag d’authentification de 16 octets. Une sauvegarde altérée ou tronquée est **refusée**, pas
  restaurée partiellement.
- **Gestion de la clé** : `NOVACORE_BACKUP_KEY` (64 hexadécimaux ou 32 octets base64) est
  prioritaire ; sinon une clé locale `backup-key` est créée en `0600` dans le dossier de
  données. Une variable déclarée mais **invalide** ne retombe jamais sur une clé locale, et un
  fichier `backup-key` existant mais illisible n’est **jamais écrasé** : la sauvegarde échoue
  explicitement et `GET /api/ready` expose des **codes normalisés** (`backup.keyError`,
  `backup.lastError`), jamais un chemin système. **Aucune sauvegarde en clair n’est écrite.**
- **Rétention réelle** : `NOVACORE_BACKUP_KEEP` (14 par défaut) plafonne le nombre ;
  `NOVACORE_BACKUP_MAX_AGE_DAYS` (30 jours par défaut, `0` désactive) supprime les fichiers
  trop anciens. Une sauvegarde chiffrée que la clé courante n’ouvre pas n’est **jamais**
  supprimée automatiquement et **ne consomme pas de place dans le quota** : un retour à la
  bonne clé conserve donc les sauvegardes lisibles. Elle est signalée dans
  `backup.unreadable`.
- **Restauration rétrocompatible et reprenable** : `server/db.js` lit indifféremment les
  `.json.enc` et les anciens `.json` en clair. Après corruption, la base est mise en
  quarantaine puis reconstruite depuis la sauvegarde la plus récente contenant des comptes ; la
  copie d’archive (`novacore.restored-*`) conserve l’extension chiffrée. Si aucune source n’est
  lisible (mauvaise clé), un marqueur `restore_pending` est persisté et la restauration est
  **retentée au démarrage suivant**, sans jamais écraser des comptes créés entre-temps.
- **Quarantaine prudente** : seuls un échec d’`integrity_check` ou une erreur structurelle
  SQLite (`SQLITE_CORRUPT`, `SQLITE_NOTADB`, « file is not a database ») déclenchent une mise
  en quarantaine. Un verrou, un disque plein ou un refus de droits font échouer le démarrage
  explicitement, sans déplacer une base saine.
- **Observabilité** : `GET /api/ready` expose `backup` (`enabled`, `algorithm`, `keySource`,
  `keyFilePresent`, `keep`, `maxAgeDays`, `total`, `encryptedCount`, `plaintextCount`,
  `unreadable`, `lastBackupAt`, `lastBackupName`, `lastError`) et
  `storage.encryptedBackups`. Le dernier incident de récupération (`recovery`) est persisté en
  base et réaffiché après redémarrage.
- **`test/backup-encryption.test.js`** (nouveau, 13 tests) : format et authentification
  AES-GCM, absence d’e-mail/hash en clair, clé locale `0600`, clé locale invalide jamais
  écrasée, restauration depuis un `.enc` après corruption, rétrocompatibilité d’une sauvegarde
  `.json` en clair, mauvaise clé sans suppression, retour à la bonne clé sans perte des
  sauvegardes lisibles, reprise de restauration après corruption + mauvaise clé, rétention par
  nombre et par âge, clé invalide sans repli en clair.
- **Correctif lot 17** : le journal d’une origine refusée utilise l’URL réellement demandée
  (`/api/auth/login`) au lieu du chemin relatif au point de montage (`/auth/login`), sans
  chaîne de requête.
- **`npm run check`** couvre désormais `server/backup-crypto.js`.
- **Documentation** : `SECURITY.md` § 5.1 (ce que le chiffrement protège et ne protège pas),
  `docs/INCIDENT-RESPONSE.md` § 4.4 (rotation de clé) et § 8 (exercice avec mauvaise clé),
  `.env.example` (`NOVACORE_BACKUP_KEY`, `NOVACORE_BACKUP_MAX_AGE_DAYS`).

### Application de bureau Windows (installateur et portable)

NovaCore 3.10.0 est aussi livré comme **application Windows autonome** : plus besoin de Node.js
ni de ligne de commande. Deux artefacts sont produits dans `dist/` :

- `NovaCore-Setup-3.10.0-x64.exe` — **installateur one-click** (NSIS) : double-clic, aucune
  élévation, installation par utilisateur dans `%LOCALAPPDATA%\Programs\novacore-total`,
  raccourcis Bureau et Menu Démarrer, lancement automatique en fin d'installation.
- `NovaCore-Portable-3.10.0-x64.exe` — version **portable** : un seul fichier, aucune
  installation, données dans le profil utilisateur.

Fonctionnement :

- `desktop/main.cjs` démarre le serveur avec un **runtime Node.js 24.15.0 embarqué**
  (`resources/runtime/node.exe`), séparé du moteur Electron : la couche Electron (`45.3.4`, Node
  interne 24.22.3) reste ainsi indépendante du serveur et de ses données. Le moteur C++ est compilé
  en **Release** et livré avec les DLL
  redistribuables (`msvcp140.dll`, `vcruntime140.dll`, `vcruntime140_1.dll`).
- Le serveur écoute uniquement sur `127.0.0.1` ; l'application choisit un port libre si 6300 est
  occupé, puis affiche l'interface dans une fenêtre Electron (écran de démarrage pendant
  l'attente de `/api/ready`). À la fermeture, tout l'arbre de processus est arrêté.
- **Données utilisateur hors du dossier d'installation** : base principale
  `%USERPROFILE%\.novacore\data`, Workbench `%LOCALAPPDATA%\NovaCore\workbench`, journaux
  `%LOCALAPPDATA%\NovaCore\logs\novacore.log`. Une mise à jour ou une désinstallation ne les
  supprime pas.
- **Raccourcis** : `CreateShortCut` de NSIS s'est révélé inopérant dans cet installateur
  (échec silencieux constaté par trace, même vers `cmd.exe`). La création passe donc par
  `WScript.Shell` (PowerShell) dans `desktop/build/installer.nsh`, et l'application répare ses
  raccourcis au premier démarrage (`ensureShortcuts`, une seule tentative par profil). Le
  désinstalleur supprime explicitement les deux raccourcis, la clé de désinstallation et le
  dossier d'installation.

Limites à connaître :

- **Aucune signature Authenticode** : SmartScreen affichera « éditeur inconnu » au premier
  lancement ; c'est une limite de distribution, pas un défaut de l'application.
- L'installation prend environ une minute (extraction d'environ 110 Mo, 364 Mo installés).
- `asar` est volontairement désactivé : le serveur est exécuté par un Node externe, qui doit
  lire les fichiers réels.

### Interface Milenium 4.4 (couche visuelle)

La version applicative reste **3.10.0** ; « Milenium 4.4 » désigne la **couche
visuelle** la plus récente. Elle remplace la couche 4.1 « Design Final » et la contient
intégralement : les 1 451 sélecteurs de `design-4.css` sont présents dans la nouvelle feuille,
qui en compte 1 675. La coque HTML garde ses 56 identifiants ; la logique métier reste
`public/app.js`, avec trois retouches seulement (page `anim3d`). Le pied de page continue
d’afficher **3.10.0** : c’est la version de l’application, pas celle du thème.

Le fichier de design fourni contient un script de démarrage qui écrivait un faux jeton
(`localStorage.setItem('novaToken', …)`) et acceptait les conditions à la place de
l’utilisateur. Ce script **n’a pas été repris** : `boot.js` continue d’afficher le contrat
d’utilisation tant que l’utilisateur ne l’a pas validé. Le reste du fichier est utilisé comme
couche d’affichage.

Fichiers (tous servis localement, CSP inchangée, aucune requête externe) :

- `public/milenium.css` (412 882 o) : feuille unique. Elle contient `styles.css`, `polish.css`,
  `design-3.css` et `design-4.css`, puis la couche **MILENIUM**. Les polices Inter et Space
  Grotesk restent embarquées en `data:` (`fontSrc 'self' data:`). Les anciennes feuilles
  (`styles.css`, `polish.css`, `design-3.css`, `design-4.css`) restent sur disque pour un retour
  arrière, mais ne sont plus référencées. Les styles du mini-jeu hacker ont été retirés de
  `milenium.css` en 3.10.0 (0 occurrence « hacker », accolades équilibrées) tout en conservant
  `@keyframes starFloat`, utilisé par les orbes de NovaSeries et NovaStore.
- `public/three.min.js` (669 753 o) : three.js **r160**, build UMD, licence MIT conservée. Rendu
  décoratif uniquement : ni Vulkan, ni Metal, ni ray tracing.
- `public/loading-genesis.js` (10 558 o) : écran **GENÈSE** (vortex, étoile, supernova) ; se coupe
  seul ou sur « Passer ».
- `public/motion.js` (19 445 o) : boucle d’étoiles du fond ; elle se met en pause quand
  `body.ns-on` est actif, pour ne pas doubler la scène 3D.
- `public/nova-space.js` (16 043 o) : **dock** 3D, **anneau de navigation** (`O`), cartes en
  relief et transitions. La galaxie a été extraite vers `nova-scene.js`, conformément à
  l’architecture 4.4.
- `public/studio-3d.js` (14 790 o) : page **Studio 3D** (`data-page="anim3d"`), API
  `window.NovaAnim`. Choix de forme, couleurs, vitesse, densité, taille, réactivité à la souris,
  tourbillon et halo, par page ou pour toutes ; presets ; export/import ; stockage local
  `novacore.anim.v1`. Aucune donnée n’est envoyée au serveur.
- `public/nova-scene.js` (23 445 o) : scène 3D de fond `#nova3d`, morphing calculé sur le GPU,
  cadence plafonnée (60 i/s en interaction, 30 au repos, 15 après 20 s), pause si la fenêtre est
  masquée ou non focalisée, dégradation automatique et `setQuality()` piloté par `NovaAnim`.
- `public/design-shell.js` (18 013 o) : raccourcis `G` + lettre, options rapides (`,`), aide,
  barre d’application, accents et bannières par page (`window.NovaGO`).

Retouches minimales justifiées :

- `public/index.html` : `<link rel="stylesheet" href="/milenium.css">` puis `nova-perf.css` et
  `nova-ui.css` ; bouton `◇ Studio 3D` après Nova Feature Lab ; scripts dans l’ordre
  `boot.js` → `feature-lab-model.js` → `series-model.js` → `i18n.js` → `app.js` →
  `nova-commands.js` → `nova-tour.js` → `motion.js` → `three.min.js` → `loading-genesis.js` →
  `nova-space.js` → `studio-3d.js` → `nova-scene.js` → `design-shell.js` (`NovaAnim` doit
  précéder `nova-scene.js`).
- `public/app.js` : `'anim3d'` ajouté à `NAV_PAGES`, libellé `Studio 3D · Animations`, et une
  ligne de rendu `window.NovaAnim.render()` avec repli si le studio est indisponible.
- `public/sw.js` : `CACHE_REVISION='2026-11-17-animation-loops-fix-1'` ; le `SHELL` ajoute
  `nova-perf.css`, `nova-ui.css`, `i18n.js`, `nova-commands.js` et `nova-tour.js`.
- `package.json` : `npm run check` couvre aussi `i18n.js`, `nova-commands.js`, `nova-tour.js` et
  `server/ai-actions.js` (**22 fichiers** : 6 serveur, 15 publics, 1 bureau).
- `public/manifest.webmanifest` : nom et description neutres, couleurs `#04050d` (inchangé).

Comportement et garde-fous :

- `body.ns-on` n’est posé que si **WebGL est disponible**, si `prefers-reduced-motion: reduce`
  n’est pas actif et si `body.no-animations` est absent. Sinon la barre latérale est conservée,
  aucun dock ni canvas n’est créé, et l’application reste utilisable.
- `prefers-reduced-motion` et l’option « Réduire les animations » masquent `#nova3d`, n’exécutent
  pas GENÈSE et laissent l’intro texte. Réactiver l’option réveille la scène
  (`NovaScene.refresh()` + `NovaScene.wake()`).
- La touche `O` n’ouvre pas l’anneau pendant la saisie ni sous un panneau ouvert : palette de
  commandes, portail d’authentification, contrat d’utilisation, modale, jeu, aide, options,
  séquence `G`, retour 3D.
- Mode « interface classique » (`novacore.ui === 'classic'`) : pas de `ns-on`, pas de dock, pas
  de canvas ; un bouton `#nfBack3d` et la touche `U` permettent de revenir. Testé dans les deux
  sens, sans erreur console.
- Aucun identifiant n’est transmis à l’agent ; le studio 3D reste local et n’appelle aucune API.

Preuves mesurées le 16 novembre 2026 (serveur 6300, navigateur intégré) :

- `npm run check` → code 0 sur **18 fichiers** ; `npm test` → **75/75** ;
  `ctest -C Debug` → **5/5** (Core, Render, Camera, Gpu, Window).
- Chargement : `body.ns-on`, `#nsDock`, `#nsOrbit`, `#nova3d` présents, `NovaScene.ready`
  vrai, 26 entrées de navigation (25 pages + Studio 3D), aucune erreur console.
- Une seule feuille CSS et **11 scripts**, tous locaux ; aucune requête externe
  (`connectSrc 'self'`).
- Anneau `O` : **26 tuiles**, `Échap` ferme, focus rendu au titre. Le contrat d’utilisation
  bloque bien `O` et `U` tant qu’il n’est pas accepté.
- Studio 3D : page rendue, changement de forme (Planète et anneaux) écrit dans
  `novacore.anim.v1`, `NovaAnim.eff('overview')` renvoie `saturn`, scène prête ; la clé de test
  a ensuite été supprimée.
- `body.no-animations` → `#nova3d` masqué à l’image suivante ; le retrait via les options
  réveille la scène.
- Interface classique : `ns-on` absent, ni dock ni canvas, `#nfBack3d` présent ; retour à
  l’interface 3D correct (dock et scène de nouveau actifs).
- Lighthouse sur la racine : accessibilité **1.0**, bonnes pratiques **1.0**, SEO **1.0**,
  aucun échec.
- Service worker actif ; le cache a depuis été renommé
  `novacore-shell-v3.10.0-2026-11-17-animation-loops-fix-1` (voir la section suivante).
- Artefacts reconstruits le **17 novembre 2026** après l’ajout du tutoriel, de l’i18n, des
  actions NOVAI et du correctif des boucles d’animations (voir « Performance ») :
  `dist/NovaCore-Setup-3.10.0-x64.exe` (**150 742 268 o**, SHA-256
  `6D154BCF319953DF8F6D8CE25B86C8EADCC5FC839186ED1F3B00B09B34A71CD6`) et
  `dist/NovaCore-Portable-3.10.0-x64.exe` (**137 365 778 o**, SHA-256
  `C04687D93E21CBAD27075973F211CCB908EB0659C2D5690E2E8B3908E34BDA0F`).
  `dist/win-unpacked/NovaCore.exe` : **249 907 712 octets**, `ProductVersion 3.10.0`.
  Le portable a été lancé avec un profil isolé et `--remote-debugging-port=9225` : CDP actif,
  titre « NovaOS · Centre de contrôle · NovaCore », service worker sur `127.0.0.1:6300`,
  `/api/version` → `3.10.0`, **0 animation infinie**, `#hackerGame` absent, boutons
  `#novaTour` et `#languageBtn` présents. Les artefacts intermédiaires à ~57 Mo produits
  lors d’un build avec disque saturé (0,15 Go libre) ont été **rejetés** : `NovaCore.exe`
  tronqué (11,8 Mo, `%1 n’est pas une application Win32 valide`) puis partiel (124 Mo,
  version vide). Le build final a été relancé après libération de 3,8 Go.

Limites :

- Le contrat d’utilisation reste à accepter manuellement : c’est volontaire, l’acceptation
  automatique du fichier de design n’a pas été reprise.
- Le rendu mobile réel n’a pas été testé sur appareil : les media queries `max-width: 700px` et
  `760px` existent dans `milenium.css`, mais l’outil de test ne permet pas d’émuler un viewport.
- Les artefacts Windows restent **non signés** : SmartScreen affiche « éditeur inconnu ».

### Accueil, langue, performances et actions NOVAI (3.10.0)

Quatre ajouts, sans changement de version, sans nouvelle dépendance et sans requête externe :

- `public/nova-tour.js` (10 054 o) : tutoriel d’accueil en **8 étapes** (navigation, création,
  modules de production, NOVAI, apprentissage, personnalisation, données). Boutons
  Précédent / Suivant / Passer / Terminer, flèches gauche-droite, `Échap` pour passer, focus
  piégé dans la carte puis restauré, case « Ne plus afficher au démarrage ». L’état est persisté
  dans `state.preferences.tourVersion` ; « Passer » sans cocher la case ne marque pas le
  tutoriel comme vu, et il reste rejouable depuis Compte & sécurité.
- `public/i18n.js` (51 268 o) : dictionnaire **FR/EN** de la coque, des titres de pages, des
  actions courantes, du contrat, du tutoriel et de NOVAI. Les nœuds texte et les attributs
  `placeholder`, `title`, `aria-label` et `alt` sont traduits ; les contenus saisis par
  l’utilisateur (notes, projets, messages) sont ignorés. Le choix est conservé dans
  `localStorage.novaLang`, appliqué sans rechargement et réappliqué après chaque rendu via un
  `MutationObserver`.
- `public/nova-commands.js` (14 167 o) et `server/ai-actions.js` (9 214 o) : bus d’actions
  **whitelisté** pour NOVAI. Le serveur ajoute au prompt un protocole `nova-actions`
  uniquement si la préférence `novaiActions` est active, puis valide la liste : **10 types**
  (`navigate`, `create_project`, `create_task`, `create_note`, `create_knowledge`,
  `create_roadmap`, `create_automation`, `search`, `set_setting`, `delete_item`), **3 actions
  maximum**, champs inconnus supprimés, pages, thèmes, accents, priorités et collections
  contrôlés. Le bloc de protocole est retiré du texte affiché.
- Côté navigateur, `NovaCommands.run()` revalide chaque type, n’expose **ni `eval`, ni accès
  fichiers, ni réseau**, et exige `confirmed: true` pour `delete_item` : la confirmation est un
  bouton explicite dans le chat. Les suppressions ne sont donc jamais exécutées sur la seule
  parole du modèle.
- `public/nova-perf.css` (**3 812 o**) et préférence `performanceMode` : désactive la scène 3D, les
  flous, les reflets et les animations décoratives (`body.perf-lite`, `NovaFX.q='off'`,
  `NovaScene.setQuality('off')`), suspend les animations quand l’onglet est masqué
  (`html.nf-hidden`) et respecte `prefers-reduced-transparency`. Le réglage est réversible et
  persisté. Depuis le 17 novembre, il contient aussi le **correctif des boucles infinies**
  décrit dans la section « Performance » ci-dessous (limitation à une itération + arrêt réel des
  animations de l’intro masquée).
- **Mini-jeu hacker supprimé** : bouton `#hackerToggle`, overlay `#hackerGame`, fonctions
  `toggleHackerMode` / `openHackerGame` / `startHackerGame`, déclencheurs clavier « nova » et
  5 clics sur le logo, clé `novaStyleHacker` et CSS associé. Le bouton de la barre supérieure
  devient `#languageBtn` (FR/EN). Aucune fonctionnalité métier n’a été retirée.

Preuves mesurées le 17 novembre 2026 (serveur 6300, navigateur intégré) :

- `npm run check` → code 0 sur **22 fichiers** ; `npm test` → **83/83** (55,0 s), dont
  `test/ai-actions.test.js` → **8/8** ; `ctest -C Debug` → **5/5** (6,75 s).
- Chargement de `http://127.0.0.1:6300/` : **3 feuilles CSS** (`milenium`, `nova-perf`,
  `nova-ui`), **14 scripts**, `NovaI18n`, `NovaCommands` et `NovaTour` présents, **aucune erreur
  console**, aucun `#hackerToggle` ni `#hackerGame`.
- Langue : clic sur `#languageBtn` → `html.lang` passe de `fr` à `en`, le titre du document passe
  de « NovaOS · Centre de contrôle » à « NovaOS · Control Center », le bouton affiche `EN` ;
  retour en français identique. Les quatre rangées de réglages et le tutoriel sont traduits.
- Tutoriel : 8 étapes, progression, flèches, focus piégé (dernier → premier et premier →
  dernier), `Échap` ferme, focus rendu à la page ; « Étape 2 sur 8 » devient « Step 2 of 8 » en
  anglais.
- Actions : `navigate` vers `projects` → ok ; page inconnue → « Page inconnue. » ;
  `run_shell` → « Action non autorisée. » ; `delete_item` sans confirmation →
  `requiresConfirmation: true` ; avec `confirmed: true` → suppression réelle ; le nombre de
  notes de test revient à 0. Catalogue exposé : 10 types.
- Mode performance : activation → `body.perf-lite` et `NovaFX.q='off'` ; désactivation →
  classe retirée et `NovaFX.q='normal'`.
- Trace de rechargement : 3 206 événements, **2 longues tâches** (71 ms cumulées), aucun
  `FireAnimationFrame` dans les événements dominants — la régression mesurée avant correctif
  était de 876 images d’animation en 5,3 s au repos.
- `POST /api/ai/chat` (test HTTP avec faux fournisseur) : actions valides renvoyées, page
  inconnue écartée, instructions absentes et `actions: []` quand `novaiActions: false`.
- « Réinitialiser l’apparence » ne réinitialise plus que l’apparence : `resetPreferences()`
  repart de `DEFAULT_PREFERENCES` en conservant `performanceMode`, `tourVersion` et
  `novaiActions`. Vérifié après rechargement : thème et accent reviennent aux valeurs par
  défaut, les trois préférences ajoutées gardent leur valeur et les 18 clés restent présentes.
- Installateurs reconstruits (`npm run dist`, code 0, 17 novembre 2026) : contenu vérifié dans
  `dist/win-unpacked/resources/app` (`nova-tour.js`, `nova-commands.js`, `i18n.js`,
  `nova-perf.css`, `nova-ui.css`, `server/ai-actions.js`, `sw.js` en révision
  `…-actions-2`, correctif `resetPreferences` inclus) ; `NovaCore.exe` porte
  `ProductVersion 3.10.0`.

Limites :

- Le rendu mobile réel n’a pas été testé sur appareil : l’outil navigateur n’émule pas de
  viewport. Les media queries du tutoriel (`max-width: 560px`) restent à valider sur matériel.
- La capture d’écran du navigateur intégré n’était pas disponible (fenêtre non visible) : les
  vérifications visuelles ci-dessus reposent sur le DOM, les styles calculés et les traces.
- Les actions NOVAI dépendent du fournisseur IA configuré ; sans fournisseur, le chat renvoie
  l’erreur existante `AI_NOT_CONFIGURED`. NOVAI exige toujours un NovaID vérifié.
- L’installation silencieuse des artefacts du 17 novembre n’a pas été rejouée : le contenu
  embarqué est vérifié dans `dist/win-unpacked` et les essais d’installation/désinstallation du
  15 novembre restent la référence pour le comportement NSIS.

### Performance — correctif des « freeze gris » (17 novembre 2026)

Symptôme rapporté sur l’application **installée** : « l’app est lente et buguée avec des freeze
gris toutes les 2 secondes », apparu après l’installation du nouveau setup (couche visuelle
Milenium 4.4 ). Version applicative conservée à **3.10.0**.

Diagnostic live sur l’app installée (CDP port 9223, mesures reproductibles sur 4 s) :

| Scénario | Renderer | GPU |
|---|---|---|
| Tout actif (baseline) | 2,19 s | 2,27 s |
| `animation-iteration-count: 1` (3D et flou conservés) | **0,69 s** | **0,42 s** |
| `animation: none` (référence) | 0,33 s | 0,38 s |
| Retour baseline (contrôle) | 3,02 s | 2,11 s |

Cause : **`milenium.css` contient 39 animations `infinite`** (ambientDrift, novaPulse,
supernovaSpin, introFloat, mascotDrift, nebulaRotate, reSpotlight, nfSpinZ, enSpin…). Sur un écran
120/165 Hz elles saturent le compositeur. Le mode `perf-lite` ne faisait que masquer le problème
en coupant la 3D et les flous — or isoler la 3D seule ne réduisait pas le CPU, et neutraliser le
seul `backdrop-filter` non plus. Le volet d’introduction masqué par `visibility:hidden`
continuait également à animer `dotBlink` et `reSpotlight` en arrière-plan.

Correctif appliqué dans `public/nova-perf.css` (puis dans l’app installée
`%LOCALAPPDATA%\Programs\novacore-total\resources\app\public\`, sauvegarde
`%TEMP%\nova-backups\pre-animation-loops-fix-2026-11-17`) :

- `*, *::before, *::after { animation-iteration-count: 1 !important; }` — les boucles
  décoratives jouent une fois puis s’arrêtent ;
- exemptions fonctionnelles `.loading-dot`, `.spin`, `[class*="spin"]` (indicateurs de
  chargement) ;
- `.nova-intro.is-hidden` et descendants : `animation: none !important` (arrêt réel).

La 3D, les dégradés, le flou et les indicateurs de chargement sont **conservés** ; seul le
comportement de boucle change. `sw.js` passe en révision `2026-11-17-animation-loops-fix-1`
pour invalider l’ancien cache cache-first.

Vérification finale sur l’app installée, **3D réellement active** (`NovaFX.q='normal'`),
`perf-lite` OFF, fenêtre au premier plan :

- CPU renderer **0,53 s / 6 s (9 %)**, GPU **0,70 s / 6 s (12 %)** — contre ~45-60 % avant ;
- **661 images en 4 s**, écart maximal entre trames **103 ms**, **aucun gap > 200 ms** ;
- `document.getAnimations()` : **0 animation infinie**, `#nova3d` visible, `ns-on` vrai.

Le même contrôle a été rejoué sur le portable rebuildé (profil isolé, port 9225) : correctif CSS
chargé, 0 animation infinie, `/api/version` → 3.10.0. Le correctif a été appliqué à l’app
installée **sans réinstallation** ; les installateurs ci-dessus l’embarquent pour les machines
non encore patchées.

Limite : le flash gris lui-même n’a pas été capturé par échantillonnage de pixels ; la surcharge
CPU qui le provoquait est, elle, prouvée et corrigée. La confirmation visuelle par l’utilisateur
reste à recueillir.

### Versions

- NovaCore **3.10.0**
- Nova Engine (noyau C++) **0.8.0** (inchangé)
- Nova Engine Workbench **1.9.1** (inchangé)
- Schéma de scène **4** (1 à 4 acceptés), API C++ **6** (1 à 6 acceptées)
- Base **3.10.0**

### Vérifications reproductibles

```powershell
npm test                               # 83/83
npm run check                          # 22 fichiers (6 serveur, 15 publics, 1 bureau)
cd nova-engine-workbench
npm run check
npm run test:viewport                  # 107 vérifications
npm run test:session
npm run test:scene-api
npm run test:render
npm run test:gpu
cd engine/build
ctest -C Debug --output-on-failure     # 5/5
```

Preuves du lot données, mesurées le 14 novembre 2026 (les preuves actuelles de la version
3.10.0 — **83/83**, **22 fichiers**, artefacts du 17 novembre 2026 — figurent dans les sections
« Interface » et « Accueil, langue, performances et actions NOVAI ») :

- `npm test` → **75/75** (58,4 s), dont `test/backup-encryption.test.js` → **13/13** et
  `test/security-hardening.test.js` → **8/8**.
- `npm run check` → code 0 sur **16 fichiers** (5 serveur, 10 publics, 1 bureau, dont `server/backup-crypto.js` et les quatre nouveaux scripts d’interface).
- `ctest -C Debug` → **100 % tests passed, 0 tests failed out of 5** (6,59 s).
- Comportements vérifiés par test : octets `NCBK1` et déchiffrement correct ; e-mail, mot de
  passe et `password_hash` absents du fichier `.enc` ; altération d’un octet → déchiffrement
  refusé ; `backup-key` en `0600` hors du dossier `backups` ; `backup-key` invalide conservée
  telle quelle et aucune écriture en clair ; base corrompue → quarantaine,
  `recovery.restoredFrom` en `.json.enc`, connexion et espace de travail restaurés ; clé B sur
  des sauvegardes de clé A → base intacte, fichiers conservés malgré `NOVACORE_BACKUP_KEEP=1`,
  `backup.unreadable` non vide ; retour de la clé A avec `NOVACORE_BACKUP_KEEP=1` → au moins
  une sauvegarde A lisible subsiste ; corruption + clé B → base vide avec
  `recovery.pending: true`, puis clé A → restauration différée réussie ; rétention par nombre
  (≤ 3) et par âge (10 jours > limite de 7 → 0 sauvegarde, nouvelles conservées) ;
  restauration d’une ancienne sauvegarde `.json` en clair ; clé invalide → serveur
  fonctionnel, compte créé, **aucun** fichier dans `backups/` ; `security.txt` avec une origine
  déclarée ignore un en-tête `Host` forgé.

Application de bureau (preuves du 15 novembre 2026 ; les artefacts courants sont ceux du
17 novembre, listés plus haut) :

- `npx electron-builder --win` → code 0, `NovaCore-Setup-3.10.0-x64.exe` (110 561 979 o) et
  `NovaCore-Portable-3.10.0-x64.exe` (110 381 935 o).
- Installation silencieuse `/S` → code 0 en ~70 s ; 364 Mo installés ; raccourcis Bureau et
  Menu Démarrer présents et pointant vers `NovaCore.exe` ; clé de désinstallation créée.
- Application installée lancée (port 6396, données temporaires) → `/api/ready` `ready:true`,
  Workbench **1.9.1** avec Node **24.15.0** et moteur `Release/NovaEngine.exe` détecté ;
  validation de scène `ok:true` ; rendu logiciel **960×540**, **3 meshes**, **1 022 triangles**,
  backend **Software**, PNG de **2 074 363 o** en ~0,6 s.
- Fermeture → application, serveur et ports 6396/5296 libérés en moins de 5 s, aucun
  processus résiduel.
- Version portable → `/api/ready` en ~10 s, version **3.10.0**, Workbench 1.9.1, fermeture
  propre.
- Désinstallation `/S` → code 0, raccourcis supprimés, clé de registre supprimée, dossier
  d'installation supprimé ; base `%USERPROFILE%\.novacore\data\novacore.sqlite` intacte.

### Limites connues, formulées sans ambiguïté

- La clé par défaut (`backup-key`) vit dans le **même dossier** que les sauvegardes : le
  chiffrement protège contre la copie ou l’exfiltration du seul dossier `backups/`, **pas**
  contre une compromission complète de la machine. Pour séparer les deux, utilise
  `NOVACORE_BACKUP_KEY` et conserve la clé ailleurs.
- **Une clé perdue rend les `.json.enc` illisibles.** Ces fichiers ne sont pas supprimés
  automatiquement, mais aucune récupération n’est possible sans la clé d’origine.
- **Les archives de migration/restauration issues d’anciens `.json` restent en clair.**
  `novacore.imported-*.json`, `novacore.restored-*.json` et `novacore.legacy-import-*.json`
  sont des copies de traçabilité : elles ne sont ni chiffrées ni couvertes par la rotation de
  `backups/`. Après avoir vérifié que la base et les nouvelles sauvegardes sont exploitables,
  supprime-les manuellement si tu ne veux conserver aucune donnée en clair hors du dossier de
  sauvegardes.
- La base SQLite elle-même (`novacore.sqlite`) n’est **pas** chiffrée ; elle reste protégée par
  les droits du système d’exploitation et, le cas échéant, par le chiffrement du disque.
- La rotation est locale et mono-instance : aucune copie hors site n’est créée par
  l’application.
- Aucun audit de sécurité indépendant n’a été réalisé ; rien dans ce lot ne prétend le contraire.

# NovaCore 3.9.0 — Lot 17 : bordure HTTP, divulgation responsable et réponse aux incidents

NovaCore 3.9.0 est un lot de **sécurité P0**, sans changement de fonctionnalité visible pour l’utilisateur. Il ferme trois trous identifiés pendant la reconnaissance : aucune vérification d’`Origin` sur les écritures, aucune politique de divulgation servie par l’application, et deux routes d’écriture qui ne dépendaient que du limiteur global `/api` (600/min). Le port reste **6300** ; le moteur reste **0.8.0**, l’API C++ **6** et le schéma de scène **4**.

### Ce qui change

- **Contrôle d’origine strict** (`originGuard` dans `server/security.js`, monté sur `/api` et `/nova-engine`) : une méthode d’écriture (`POST`, `PUT`, `PATCH`, `DELETE`) venue d’une origine inconnue reçoit **403 `ORIGIN_REJECTED`**. Sont acceptées : la même origine que celle servie, `NOVACORE_ALLOWED_ORIGINS`, `PUBLIC_BASE_URL` et `NOVACORE_URL`. `Origin: null` et `Sec-Fetch-Site: cross-site` sans `Origin` sont refusés. Les lectures ne sont pas bloquées, mais aucune origine tierce ne reçoit d’en-tête CORS ; les préflights d’une origine déclarée reçoivent `204` avec les méthodes autorisées.
- **`/.well-known/security.txt`** (RFC 9116) généré à chaque requête : `Contact`, `Expires` (180 jours par défaut, jamais périmé), `Preferred-Languages`, `Canonical`, `Policy`. `/security.txt` redirige en 301 ; `/security-policy` sert `SECURITY.md` en `text/plain` avec `nosniff`.
- **Documentation de sécurité** : `SECURITY.md` (périmètre, délais, règles de test, reconnaissance, ce qui n’est pas revendiqué) et `docs/INCIDENT-RESPONSE.md` (confinement, rotation de `JWT_SECRET`, révocation des sessions, restauration, notification, post-mortem, exercice de répétition).
- **Limiteur d’écriture dédié** : `limiters.write` (60 actions / 15 min par compte) sur `PATCH /api/plugins/:id` et `POST /api/focus/sessions`.
- **Avertissements de démarrage en production** : `TRUST_PROXY`, `PUBLIC_BASE_URL`, origines déclarées, contact de sécurité et SMTP manquants sont journalisés avant l’écoute. Ils ne bloquent pas le démarrage.
- **`npm run check` étendu** : `server/security.js`, `server/auth.js`, `server/db.js` et `public/sw.js` sont désormais vérifiés en plus des modules publics.

### Versions

- NovaCore **3.9.0**
- Nova Engine (noyau C++) **0.8.0** (inchangé)
- Nova Engine Workbench **1.9.1** (inchangé)
- Schéma de scène **4** (1 à 4 acceptés), API C++ **6** (1 à 6 acceptées)
- Base **3.9.0**

### Vérifications reproductibles

```powershell
npm test                               # 61/61
npm run check                          # serveur (index, security, auth, db) + modules publics + sw.js
cd nova-engine-workbench
npm run check
npm run test:viewport                  # 107 vérifications
npm run test:session
npm run test:scene-api
npm run test:render
npm run test:gpu
cd engine/build
ctest -C Debug --output-on-failure     # 5/5
```

Preuves mesurées le 13 novembre 2026 :

- `npm test` → **61/61** (27,1 s), dont le nouveau `test/security-hardening.test.js` → **7/7** : origine tierce refusée en écriture, origine déclarée acceptée avec `Access-Control-Allow-Origin`, préflight `204`, `Origin: null` et `Sec-Fetch-Site: cross-site` refusés, `security.txt` conforme et non périmé, `429` avec `limiter: "write"` après 60 `PATCH`, jeton refusé après rotation de `JWT_SECRET`, avertissements de production.
- `npm run check` → code 0 sur les 9 fichiers (4 serveur, 5 publics).
- `ctest -C Debug` → **100 % tests passed, 0 tests failed out of 5** (6,91 s).
- `npm test` reste **61/61** ; les 54 tests précédents n’ont pas été modifiés.

### Limites connues, formulées sans ambiguïté

- Le contrôle d’origine **n’est pas une authentification**. Il empêche un site tiers de déclencher une écriture depuis un navigateur ; l’autorisation reste portée par le jeton Bearer et les contrôles `user_id`.
- L’origine « même site » est dérivée de l’en-tête `Host`. Derrière un reverse proxy, `TRUST_PROXY` et `PUBLIC_BASE_URL` doivent être configurés ; sinon un avertissement est émis au démarrage et le protocole vu par le serveur peut être `http`.
- Les sauvegardes locales n’étaient **pas chiffrées** dans ce lot (lot P0 données distinct,
  livré en **3.10.0**). `SECURITY.md` le disait explicitement à l’époque.
- Aucun audit de sécurité indépendant n’a été réalisé ; rien dans ce lot ne prétend le contraire.
- La CSP contient toujours `'unsafe-inline'` pour les scripts.

# NovaCore 3.8.0 — Lot 16 : fiabilité du Workbench, session explicite et autosave

NovaCore 3.8.0 est un lot de **fiabilité professionnelle** centré sur Nova Engine. Il corrige la cause réelle de la « scène vide » du Workbench (session NovaID absente ou expirée silencieusement ignorée), rend le secret JWT de développement **persistant**, ajoute une **sauvegarde automatique avec sauvegardes roulantes**, une **scène de démarrage complète** et un viewport réellement **responsive**. Le port par défaut reste **6300** ; le moteur reste **0.8.0**, l’API C++ **6** et le schéma de scène **4**.

### Ce qui change pour l’utilisateur

- **Session NovaID explicite** : au lieu d’une scène vide, le Workbench affiche une bannière « Session NovaID requise » avec un lien de connexion (`/?next=%2Fnova-engine%2F`) et un bouton **Réessayer**. Les erreurs 401 (session absente/expirée/révoquée), 403 `EMAIL_NOT_VERIFIED` et 5xx sont classées et présentées avec un message distinct. L’accès direct à `5201` sans authentification continue de fonctionner.
- **Retour à la page demandée** : après connexion, NovaCore respecte `?next=` (même origine uniquement) et renvoie vers le Workbench.
- **Secret JWT de développement persistant** : sans `JWT_SECRET`, le serveur lit/crée `$NOVACORE_DATA_DIR/jwt-secret` (défaut `~/.novacore/data/jwt-secret`, mode `0600`). Les jetons survivent donc à un redémarrage. La variable d’environnement reste prioritaire ; la production refuse toujours de démarrer sans secret fort.
- **Autosave fiable** : après 1,4 s d’inactivité, `Ctrl`/`Cmd+S` ou le bouton Enregistrer, la scène est écrite et chaque écrasement crée une **sauvegarde roulante** (12 maximum) dans `data/backups`. Un indicateur affiche « Modifié · autosave… », « Autosave · HH:MM:SS » ou « Scène indisponible ».
- **Scène de démarrage complète** : caméra, Key Light directionnelle, Rim Spot, sol, Starter Cube et Starter Sphere. « Nouvelle scène » charge ce template au lieu d’une scène vide.
- **Viewport responsive** : recalcul de la taille au redimensionnement de la fenêtre et au changement de densité de pixels, avec nettoyage des écouteurs à la destruction.
- **Viewport 3D fiable (correctif 1.9.1)** : la 3D ne disparaît plus quand on orbite. L’orbite verticale est clampeée au-dessus du plan de grille (`public/viewport-math.js`), la grille est dessinée sans écrire la profondeur, et le depth buffer est réellement vidé à chaque frame (`gl.clear` respecte `DEPTH_WRITEMASK`, que les passes bloom/composite laissaient à `false`). Mesuré au même angle : cube utilisateur **840 px fragmentés → 1 764 px pleins**.

### Versions

- NovaCore **3.8.0**
- Nova Engine (noyau C++) **0.8.0** (inchangé)
- Nova Engine Workbench **1.9.1** (correctif viewport)
- Schéma de scène **4** (1 à 4 acceptés), API C++ **6** (1 à 6 acceptées)
- Base **3.8.0**

### Vérifications reproductibles

```powershell
npm test                               # 54/54
npm run check                          # syntaxe serveur + modules publics
node --check public/sw.js
cd nova-engine-workbench
npm run check                          # server.mjs + session.js + viewport-math.js + viewport-3d.js + app.js
npm run test:viewport                  # 107 vérifications orbite / grille / profondeur
npm run test:session                   # session 401/403, template, autosave + backups
npm run test:scene-api                 # schéma 4, primitives, lumières, textures, gameplay
npm run test:render                    # rendu logiciel, ombres, textures, bloom/ACES
npm run test:gpu                       # D3D12, ombres, textures, bloom, capture runtime, fenêtre
cd engine/build
ctest -C Debug --output-on-failure     # 5/5 (noyau + rendu + caméra + GPU + fenêtre)
```

Preuves mesurées le 13 novembre 2026 :

- `npm test` → **54/54** (20,3 s), dont `test/security.test.js` → **3/3** sur la persistance du secret JWT (persistance entre deux démarrages, priorité de `JWT_SECRET`, refus en production) et `test/navigation.test.js` → `?next=` accepté seulement pour la même origine (`/nova-engine/`, `https://evil.example`, `//evil.example`).
- `node --test test/security.test.js` → 3/3 ; deux démarrages successifs sans `JWT_SECRET` produisent le même secret persistant.
- Workbench `node test-session.mjs` → classification 401/403, jeton expiré, `/api/ping`, template complet (6 entités), scène par défaut avec sol/caméra, autosave et sauvegarde roulante, UI 1.9.1.
- `npm run test:scene-api` → schéma 4, tore, texture, spot, spinner et route assets validés.
- Serveurs redémarrés : `/api/version` → **3.8.0** ; Workbench direct 5201 → **1.9.1 / engine 0.8.0 / schema 4**, template à 6 entités.
- Navigateur (6300, sans jeton) : bannière « Session NovaID requise », texte explicite, lien `/?next=%2Fnova-engine%2F`, backend « Scène non chargée · session NovaID requise », état de sauvegarde « Scène indisponible », **un seul 401** (`/api/ping`), aucune scène vide silencieuse.
- Navigateur (6300, jeton NovaID valide) : bannière masquée, scène utilisateur chargée (3 entités, schéma 2, « Chargée · 21:27:58 »), viewport **WebGL2 · 12 triangles · 1 maillage · 1 lumière · HDR · bloom**, `capture()` 960×540 avec `lit=518400`, **0 erreur console**.
- Redirection `/?next=%2Fnova-engine%2F` avec session valide → URL finale `/nova-engine/`, jeton conservé, Workbench 1.9 et 3 entités chargées.
- Instance Workbench isolée (port 5310, `NOVA_WORKBENCH_DATA_DIR` temporaire) : édition du nom → « Modifié · autosave… » → « Autosave · HH:MM:SS », `scene.json` écrit (schéma 4, 6 entités), puis seconde écriture → **1 sauvegarde roulante** contenant la version précédente ; instance arrêtée et dossier temporaire supprimé.
- Correctif viewport (instances isolées 5311/5312, copie de `data/scene.json` hash `3AE8CFBB…6078`, 1 280 octets — fichier utilisateur jamais modifié) : avant, l’œil descendait sous la grille (`eye.y` 2 → 1,52 → 1,03 → 0,54 → 0,04 → −0,45 → −1,92) et le cube tombait à **0 px** ; après, `eye.y` reste à **0,08** et le cube reste **1 764 à 2 246 px** sur glissement haut 100 px, bas 120 px, zoom avant/arrière, avec un taux de remplissage **0,94–1,00**.
- Cause profonde mesurée : `gl.clear(DEPTH_BUFFER_BIT)` était appelé avec `DEPTH_WRITEMASK = false` (hérité des passes bloom/composite), donc la profondeur de la frame précédente persistait. Au même angle, forcer `gl.depthMask(true)` avant le clear fait passer le cube de **840 px fragmentés à 1 764 px pleins** ; la capture « cube en morceaux » correspond exactement à la zone du cube plein (x 744–790, y 411–442).
- `npm run test:viewport` → **107 vérifications** ; navigateur : `pick` → `starter-cube`, **0 erreur console**, `WORKBENCH 1.9.1`.

### Limites connues, formulées sans ambiguïté

- La scène utilisateur `data/scene.json` (schéma 2, 3 entités) n’est **pas migrée automatiquement** : elle reste lisible telle quelle et sera normalisée à la prochaine sauvegarde explicite. Pendant la validation, d’anciens onglets Workbench (JS 1.4/1.8) ont réécrit ce fichier ; il a été restauré à l’identique depuis une sauvegarde roulante et ces onglets ont été fermés. Le Workbench 1.9 ne réécrit pas une scène non modifiée au chargement (vérifié sur l’instance isolée : aucun `scene.json` créé avant la première modification).
- Les sauvegardes roulantes conservent **12 fichiers** ; ce n’est pas une politique d’archivage longue durée.
- Le viewport navigateur n’affiche toujours **pas les ombres portées**, et le rendu GPU n’est **pas garanti pixel-identique** au logiciel, qui reste la référence déterministe.

# NovaCore 3.7.0 — Nova Engine : éclairage multi-sources, ombres, textures et HDR

NovaCore 3.7.0 fait passer **Nova Engine** à un rendu plus complet : lumières directionnelles, ponctuelles et spots, **shadow maps** avec PCF, textures **PNG/JPEG**, post-traitement **HDR + bloom + ACES/sRGB** et composants de **gameplay** (rigidbody, controller, spinner, collectible). Le rastériseur logiciel, le backend Direct3D 12, la fenêtre Win32 et le viewport WebGL2 du Workbench partagent ces fonctionnalités. Le port par défaut reste **6300**.

### Ce qui change pour l’utilisateur

- **Lumières multiples** : jusqu’à 16 lumières validées par scène (8 évaluées par le moteur), type directionnel, point ou spot, couleur sRGB, intensité, portée et angle de cône. Les anciennes scènes sans entité `Light` conservent le duo directionnel chaud/froid historique.
- **Ombres portées** : shadow maps directionnelle et spot (maximum 2), filtrage PCF, résolution réglable de 128 à 2048. Les lumières ponctuelles ne projettent pas d’ombre (limite explicite).
- **Textures PNG/JPEG** : `Material::texture` accepte un chemin relatif validé vers le dossier `assets` ; cache de textures dans le moteur et route `/api/assets/…` dans le Workbench. Le motif procédural reste le repli.
- **HDR, bloom et ACES** : rendu interne en flottants linéaires, bright pass et flou séparable half-res, exposition, courbe ACES puis conversion sRGB, sur le logiciel, D3D12 et WebGL2.
- **Primitives** : cube, sphère, plan, cylindre, cône, tore, capsule et pyramide, avec UV générées et inférence historique conservée pour les schémas 1 à 3.
- **Gameplay dans le Workbench** : bouton **Play**, contrôle première personne WASD/ZQSD + souris + saut, gravité, spinners, collectibles et HUD de score. La scène est restaurée à l’arrêt.
- **Inspecteur étendu** : primitive, texture, lumière explicite et composants gameplay, avec validation des bornes et annulation/rétablissement.
- **Schéma de scène 4** : `schemaVersion: 4` accepte lumières, textures, primitives et gameplay ; les schémas 1 à 3 restent lisibles et le Workbench normalise à l’enregistrement.

### Versions

- NovaCore **3.7.0**
- Nova Engine (noyau C++) **0.8.0**
- Nova Engine Workbench **1.8.0**
- Schéma de scène **4** (1 à 4 acceptés), API C++ **6** (1 à 6 acceptées)

### Vérifications reproductibles

```powershell
npm test                               # 50/50
npm run check                          # syntaxe serveur + modules publics
node --check public/sw.js
cd nova-engine-workbench
npm run check                          # server.mjs + app.js + viewport-3d.js
npm run test:scene-api                 # schéma 4, primitives, lumières, textures, gameplay
npm run test:render                    # rendu logiciel, ombres, textures, bloom/ACES
npm run test:gpu                       # D3D12, ombres, textures, bloom, capture runtime, fenêtre
cd engine/build
ctest -C Debug --output-on-failure     # 5/5 (noyau + rendu + caméra + GPU + fenêtre)
```

Preuves mesurées le 12 novembre 2026 :

- `ctest -C Debug --output-on-failure` → **5/5** (Core, Render, Camera, Gpu, Window) en 35,43 s.
- CLI logiciel 320×180 → `shadowMaps:1`, `textures:1`, `bloom:true` ; avec `--no-bloom --no-shadows` → `shadowMaps:0`, `bloom:false`.
- CLI GPU D3D12 → `drawCalls:6`, `shadowMaps:1`, `textures:1`, `bloom:true` ; sans ombres → **5 draw calls**.
- `npm run test:render` → 12 triangles, **921 pixels**, PNG **57 758 octets**, **364 couleurs**, statistiques shadow map + bloom ; checker/grid/none/texture **distincts et déterministes** ; tore > 12 triangles.
- `npm run test:gpu` → D3D12 sur **NVIDIA GeForce GTX 1660 SUPER**, 3 meshes, **1 022 triangles**, **6 draw calls**, 1 shadow map, **886 couleurs**, PNG **230 663 octets** ; ombres désactivées → capture différente et **5 draw calls** ; bloom désactivé → capture différente ; capture runtime **320×180 / 230 663 octets / 886 couleurs** ; fenêtre ouverte puis arrêtée.
- `npm run test:scene-api` → schéma 4, tore, texture, spot, spinner et route assets validés ; cas invalides rejetés.

### Limites connues, formulées sans ambiguïté

- Les ombres portées concernent la lumière directionnelle et le spot ; les lumières ponctuelles n’en projettent pas. Maximum 2 shadow maps par scène.
- Le viewport navigateur affiche les lumières multiples, les textures, le HDR et le bloom, mais **pas les ombres portées**.
- La fenêtre native et le swapchain sont **Windows uniquement**. macOS et Linux gardent le rastériseur logiciel ; Metal et Vulkan sont déclarés mais **non implémentés**.
- Pas de MSAA ni de ray tracing ; le ciel est analytique. Le rendu GPU n’est **pas garanti pixel-identique** au logiciel, qui reste la référence déterministe testée.
- Le VPS, le NSR, le path tracing et l’éditeur avancé restent des étapes non commencées.

# NovaCore 3.6.0 — Nova Engine : matériaux PBR et textures procédurales

NovaCore 3.6.0 ajoute des **matériaux PBR par entité** au moteur : albedo sRGB, metallic, roughness, tiling, émissif et motifs procéduraux **checker** et **grid** calculés sur de vraies coordonnées UV. Le même matériau est rendu par le rastériseur logiciel déterministe, le backend Direct3D 12, la fenêtre Win32 et le viewport WebGL2 du Workbench, avec des formules identiques. Le port par défaut reste **6300**.

### Ce qui change pour l’utilisateur

- **Matériau PBR par entité** : chaque mesh ou prefab peut porter un `Material` (`albedo`, `metallic`, `roughness`, `tiling`, `pattern`, `emissive`). Sans matériau explicite, la palette historique par type/identifiant reste utilisée, donc les anciennes scènes s’affichent à l’identique.
- **Textures procédurales UV** : motifs `none`, `checker` et `grid`, évalués dans le fragment shader à partir des UV. Les UV sont générées par le moteur (projection planaire sur l’axe dominant de la normale, sphère/cylindre/cône explicites) et transmises au GPU avec le matériau dans un sommet de 64 octets.
- **Trois rendus cohérents** : `shadeFragment` (logiciel), `PSScene` (HLSL) et le shader WebGL2 appliquent les mêmes formules checker/grid et la même réponse metallic/roughness.
- **Éditeur Scene Lab** : section « Matériau PBR » dans l’inspecteur (couleur sRGB, metallic, roughness, tiling, motif, émissif), avec validation des bornes et annulation/rétablissement.
- **Schéma de scène 3** : `schemaVersion: 3` accepte les matériaux ; le moteur continue de lire les schémas 1 et 2, et le Workbench normalise à l’enregistrement.
- **Tests** : matériaux et motifs vérifiés en C++ (aller-retour JSON, rejets, rendu déterministe) et côté Workbench (checker, grid et none distincts et reproductibles, en logiciel et sur GPU).

### Versions

- NovaCore **3.6.0**
- Nova Engine (noyau C++) **0.7.0**
- Nova Engine Workbench **1.7.0**
- Schéma de scène **3** (1 et 2 toujours acceptés), API C++ **5** (1 à 5 acceptées)

### Vérifications reproductibles

```powershell
npm test                               # 50/50
npm run check                          # syntaxe serveur + modules publics
node --check public/sw.js
cd nova-engine-workbench
npm run check                          # server.mjs + app.js + viewport-3d.js
npm run test:scene-api                 # bibliothèque de scènes + matériaux + validation C++
npm run test:render                    # rendu logiciel, checker/grid/none déterministes
npm run test:gpu                       # D3D12, matériaux GPU, capture runtime, fenêtre
cd engine/build
ctest -C Debug --output-on-failure     # 5/5 (noyau + rendu + caméra + GPU + fenêtre)
```

Preuves mesurées le 12 novembre 2026 :

- `NovaEngine.CoreTests` → API 5, schéma 3 accepté, schémas 1 et 2 compatibles, aller-retour matériau checker, rejet de `metallic` hors bornes et d’un motif inconnu.
- `NovaRenderTests` → **12 triangles**, **1 892 pixels ombrés**, PNG **129 808 octets** ; checker, grid et métallique produisent des frames différentes et reproductibles octet pour octet.
- `NovaGpuTests` → D3D12 sur **NVIDIA GeForce GTX 1660 SUPER**, 12 triangles, **230 400 octets RGBA**, **148 couleurs** échantillonnées, **473,943 ms**, PNG **230 663 octets**, filaire différent du solide de **3 642 pixels** ; les données `uv`/`material` atteignent bien le sommet GPU.
- `NovaEngine.WindowTests` → fenêtre cachée **320×240**, 12 triangles, **7 277 pixels modifiés** entre deux poses caméra, deux PNG valides de **307 528 octets** chacun.
- `npm run test:render` → 12 triangles, **921 pixels**, PNG **57 758 octets**, **275 couleurs**, motifs checker, grid et none **distincts et déterministes**, matériau invalide rejeté en HTTP 400.
- `npm run test:gpu` → D3D12 sur GTX 1660 SUPER, 12 triangles, 2 draw calls, **93 couleurs**, PNG **230 663 octets**, checker/grid **distincts et déterministes**, capture runtime **320×180 / 230 663 octets / 93 couleurs**, fenêtre runtime ouverte puis arrêtée via HTTP.

### Limites connues, formulées sans ambiguïté

- Les textures sont **procédurales** (`checker`, `grid`) : pas encore d’import PNG, JPEG, glTF ou de normal maps.
- La fenêtre native et le swapchain sont **Windows uniquement**. macOS et Linux gardent le rastériseur logiciel ; Metal et Vulkan sont déclarés mais **non implémentés**.
- Pas encore de MSAA, d’ombres temps réel ni de ray tracing ; le ciel est analytique et l’éclairage direct est directionnel ou ponctuel.
- Le rendu GPU n’est **pas garanti pixel-identique** au logiciel (ordre des passes et shaders différents) ; le logiciel reste la référence déterministe testée octet pour octet.
- Le VPS, le NSR, le path tracing et l’éditeur avancé restent des étapes non commencées.

# NovaCore 3.3.0 — Nova Engine : moteur 3D réel et vérifiable

NovaCore 3.3.0 transforme **Nova Engine** en véritable moteur de rendu 3D. Le binaire C++ ne se contente plus de valider du JSON : il rastérise la scène avec un **z-buffer logiciel déterministe**, une caméra, des lumières, des ombres de contact, une grille, des gizmos et son propre encodeur PNG. Le Workbench 1.4.0 gagne un **viewport WebGL2 temps réel** et un panneau de **rendu moteur C++** téléchargeable. Le port par défaut reste **6300**.

### Ce qui change pour l’utilisateur

- **Viewport 3D temps réel** dans Scene Lab : meshes cube/sphère/plan/cylindre/cône, lumières directionnelles et ponctuelles, ciel, grille analytique, ombres de contact, orbite au glisser, panoramique avec Maj, zoom à la molette, double-clic pour cadrer.
- **Sélection réelle par picking** rayon-AABB : cliquer un objet le sélectionne, l’entité correspondante est surlignée dans la hiérarchie, l’inspecteur et le viewport.
- **Gizmos** caméra, lumière et entité sélectionnée, avec surbrillance de la sélection.
- **Rendu de référence C++** : bouton « Rendu moteur C++ » avec résolution 640×360, 960×540 ou 1280×720, anticrénelage 1× à 3×, grille, ombres et mode filaire ; image PNG affichée dans le Workbench et téléchargeable.
- **API de rendu protégée** : `POST /nova-engine/api/engine/render`, `GET /nova-engine/api/engine/render/<id>.png` et `GET /nova-engine/api/engine/renders`, réservées à un NovaID vérifié, avec nettoyage automatique des 24 derniers rendus.
- **Deux couches assumées** : le viewport WebGL2 est un aperçu temps réel du navigateur ; le PNG C++ est la référence déterministe produite sans GPU.
- **Aucune régression de données** : stockage SQLite transactionnel, workspace utilisateur, import/export et restauration inchangés. La vérification e-mail reste facultative pour l’usage général et obligatoire pour les cinq outils avancés.

### Versions

- NovaCore **3.3.0**
- Nova Engine (noyau C++) **0.4.0**
- Nova Engine Workbench **1.4.0**
- Schéma de scène **2** (inchangé), API C++ **3** (inchangée)

### Vérifications reproductibles

```powershell
npm test                      # 50/50
npm run check                 # syntaxe serveur + modules publics
node --check public/sw.js
cd nova-engine-workbench
npm run check                 # server.mjs + app.js + viewport-3d.js
npm run test:scene-api        # bibliothèque de scènes + validation C++
npm run test:render           # API de rendu + décodage PNG + déterminisme
cd engine/build
ctest -C Debug --output-on-failure   # 2/2 (noyau + rendu) — -C Debug requis avec un générateur multi-config MSVC
```

Preuves mesurées le 11 novembre 2026 :

- C++ : `NovaEngine.exe --scene data/scene.json --render … --stats-json` → 960×540, SS2, **12 triangles**, **20 266 pixels mesh**, ~2,46 s ; PNG de 2 074 363 octets, SHA-256 `4E4917AB0B061BB744CBE5C45A4CEA477726C617457BC4C0EB246C659D7BCAF1`, décodage indépendant valide.
- `npm run test:render` : 12 triangles, 921 pixels de mesh, PNG de 57 758 octets, 275 couleurs, **deux rendus identiques octet pour octet**, traversée de chemin rejetée (400), scène invalide rejetée (400).
- Navigateur (6300, WebGL2 réel) : `WebGL2 · 12 triangles · 1 maillage(s) · 1 lumière(s)`, pixel central du mesh `[86, 208, 182, 255]`, secours Canvas 2D fonctionnel après échec WebGL.
- Parcours authentifié : rendu refusé sans session (401 sur `POST` et sur le PNG), accepté avec un NovaID vérifié, PNG de 57 758 octets via le proxy, compte de test supprimé ensuite.
- Interface : « Rendu moteur C++ » → 640×360, 12 triangles, 1 maillage, 1 lumière, 243 ms, image 640×360 et téléchargement `nova-engine-render-….png`.

### Limites connues, formulées sans ambiguïté

- Le rastériseur C++ est **logiciel** : pas de GPU, pas de Vulkan, pas de fenêtre native. Le rendu 960×540 en 2× en build Debug prend environ 2,5 s.
- Le viewport WebGL2 est un **aperçu navigateur distinct** : il ne prétend pas être pixel-identique au PNG C++.
- Pas encore d’import de modèles externes (glTF/OBJ), de matériaux à textures, de skeletal animation ni d’éditeur de matériaux.
- La CSP conserve `'unsafe-inline'` (handlers `onclick=` encore nombreux) : sprint C1 prévu.
- Stockage SQLite **mono-instance** : un déploiement multi-instance exigera PostgreSQL.
- Sans SMTP, le lien de vérification n’est pas envoyé et les outils avancés restent verrouillés. La production exige un `JWT_SECRET` fort.
- RetroEdge reste un concept en développement, sans certification de compatibilité matérielle.

# NovaCore 3.2.0 — Nova Feature Lab 100 % opérationnel

NovaCore 3.2.0 termine le **Nova Feature Lab** : les 50 modules annoncés sont désormais réellement fonctionnels, visibles et actionnables. Il ne reste plus aucun module « Concept — non actif ». Le port par défaut reste **6300**.

### Ce qui change pour l’utilisateur

- **50 modules, 0 concept** : chaque carte possède un interrupteur, un état Actif/Inactif et un bouton qui exécute une vraie action.
- **8 catégories** : Apparence, Accessibilité, Productivité, Intelligence, Sécurité, Développement, Analyse, Cloud — avec recherche instantanée et filtres par catégorie.
- **Héros de complétion** : anneau animé, barre de progression et compteurs réels (modules actifs, actions réelles, catégories, concepts = 0).
- **Actions réelles** : ouverture des pages, effets visuels (liquid glass, supernova, contraste, mouvement réduit, compact, fond étoilé), cycle d’accent, son de test, rediffusion de l’introduction, palette `Ctrl+K`.
- **Productivité** : note rapide, tâche express, journal du jour, Focus Pomodoro de 25 minutes réellement lancé, raccourcis clavier.
- **Intelligence** : prompts favoris persistants, résumé local de notes, générateur d’idées contextuel, préremplissage NOVAI, détection des modèles Ollama.
- **Sécurité et données** : mode privé local (suspend la synchronisation cloud sans supprimer aucune donnée), import de sauvegarde, export JSON et export de snippet.
- **Analyse** : santé du serveur, compteurs de tâches, projets, notes et sessions Focus.
- **Cloud** : envoi et récupération NovaCloud depuis les modules dédiés.
- **Migration douce** : les anciens réglages indexés sont convertis vers les identifiants texte ; aucune préférence utilisateur n’est perdue.

### Vérifications reproductibles

```powershell
npm test          # 50/50 (dont 9 tests Feature Lab)
npm run check     # syntaxe serveur + app.js + feature-lab-model.js + series-model.js + motion.js + boot.js
node --check public/sw.js
```

Navigateur réel (6300) : 50 cartes, 0 « Concept — non actif », filtre « focus » → 3 résultats, Apparence → 8 modules, tout désactiver → 0/50 puis tout activer → 50/50, Focus 25 min lancé, modales santé/stats/prompts/mode privé fonctionnelles, palette ouverte, **0 erreur console**. L’état local invité a été sauvegardé puis restauré : aucun environnement utilisateur modifié.

### Limites connues

- Stockage SQLite **mono-instance** : un déploiement multi-instance exigera PostgreSQL.
- La CSP conserve `'unsafe-inline'` (handlers `onclick=` encore nombreux) : sprint C1 prévu.
- Sans SMTP, le lien de vérification n’est pas envoyé et les outils avancés restent verrouillés. La production exige un `JWT_SECRET` fort.
- RetroEdge reste un concept en développement, sans certification de compatibilité matérielle.

# NovaCore 3.1.0 — Nova Engine & NovaSeries complets

NovaCore 3.1.0 termine les deux outils de production du lancement 3.0 : le noyau **Nova Engine** valide désormais les scènes avec le vrai binaire C++, et **NovaSeries** devient un atelier de préproduction complet (édition, duplication, réorganisation, imports/exports et dossier imprimable). Le port par défaut reste **6300**.

### Nova Engine 0.3.0 — noyau C++ et Workbench 1.3.0

- **Format de scène partagé `schemaVersion 2`** : identifiants texte, composants, hiérarchie, parseur et sérialiseur JSON, validation complète des références et des cycles.
- **CLI réelle** : `--scene`, `--validate`, `--json`, `--export`, `--help` ; tests CTest **1/1**.
- **Workbench 1.3.0** : `/api/version`, bibliothèque de scènes, export, import, renommage, suppression, `/api/validate` et `/api/engine/validate` — ce dernier fait valider la scène par le **binaire C++** et pas seulement par JavaScript. Charge utile limitée à 2 Mo.
- **Interface v1.3** : annuler/rétablir, bibliothèque, import, validation C++ et jeton NovaID transmis aux appels directs.
- **Proxy `/nova-engine`** : le corps JSON consommé par `express.json()` est réinjecté vers le Workbench, ce qui corrige les validations et les imports.

### NovaSeries 3.1 — atelier de production complet

- **Modèle pur partagé** `public/series-model.js` : normalisation, diagnostic, duplication, réorganisation, exports et rendu du script, chargé avant `app.js` et testé directement par Node.
- **Édition en place** des personnages, épisodes, assets, vignettes de storyboard et plans ; **duplication**, **réorganisation ↑/↓** et suppression.
- **Nouveau projet**, **dossier Markdown**, **impression / PDF**, **export JSON de projet** (`projectFormat: "NovaSeriesProject"`, `projectVersion: 2`) et **shot list CSV**.
- **Import robuste** : les anciens exports plats et le nouvel enveloppement sont acceptés ; la validation stricte du format est réservée à l’import, pour ne jamais bloquer un projet hérité à l’export.
- **Diagnostic de production en 12 contrôles** : titre, logline, épisodes, synopsis, design personnages, assets suivis et non bloqués, storyboard, shot list, échéance, guide de style et script.
- **Réimport vérifié** : l’export JSON restaure l’intégralité du projet, y compris le script structuré, et l’état survit au rechargement.

### Vérifications reproductibles

```powershell
npm test          # 41/41 (dont 10 tests NovaSeries)
npm run check     # syntaxe serveur + frontend + series-model.js
node --check public/sw.js
npm run check --prefix nova-engine-workbench
npm run test:scene-api --prefix nova-engine-workbench
```

Build C++ : configuration CMake, compilation, puis `ctest -C Debug` → **1/1**.

Navigateur isolé (6311) : création, édition, duplication, réorganisation et suppression ; diagnostic **12/12 · 100 %** ; exports JSON, Markdown et CSV ; impression ; réimport complet ; persistance après rechargement ; **0 erreur console**.

### Limites connues

- Stockage SQLite **mono-instance** : un déploiement multi-instance exigera PostgreSQL.
- La CSP conserve `'unsafe-inline'` (handlers `onclick=` encore nombreux) : sprint C1 prévu.
- Sans SMTP, le lien de vérification n’est pas envoyé et les outils avancés restent verrouillés. La production exige un `JWT_SECRET` fort.
- RetroEdge reste un concept en développement, sans certification de compatibilité matérielle.

# NovaCore 3.0.1 — Stockage SQLite transactionnel

NovaCore 3.0.1 remplace le fichier JSON unique par une base **SQLite transactionnelle** (`node:sqlite`, intégré à Node.js, sans compilation native). Les données existantes sont importées automatiquement au premier démarrage, vérifiées ligne par ligne, puis le JSON d'origine est archivé — jamais supprimé.

### Ce qui change pour l'utilisateur

- **Aucune perte de données** : comptes, espaces de travail, extensions, préférences et historique sont repris à l'identique (migration testée sur une copie des données réelles).
- **Écritures atomiques** : chaque modification est validée par une transaction (`BEGIN IMMEDIATE` / `COMMIT`), avec `journal_mode=WAL` et `synchronous=FULL`.
- **Sauvegardes portables conservées** : instantanés JSON après chaque écriture critique, rotation sur 14 fichiers, export/import inchangés.
- **Restauration automatique** : une base corrompue est mise en quarantaine (jamais supprimée) et la dernière sauvegarde valide est réimportée ; `/api/ready` expose l'état réel.
- **Schéma versionné** : `PRAGMA user_version` + table `meta`, prêt pour les migrations suivantes.

### Migration et retour arrière

- Au premier démarrage, `novacore.json` est importé dans `novacore.sqlite`, contrôlé (comptes, espaces, événements, extensions), puis renommé `novacore.json.migrated-<horodatage>`.
- Le fichier archivé reste lisible et peut être réimporté via `POST /api/import` (format `novacore-export`) ou en repartant d'une sauvegarde de `backups/`.
- Une source invalide n'est jamais importée partiellement : la transaction est annulée et le fichier est laissé intact pour analyse.

### Vérifications reproductibles

```powershell
npm test          # 30/30 (dont 3 tests SQLite)
npm run check
node --check public/sw.js
```

### Limites connues

- Mono-instance : SQLite convient à un serveur unique ; un déploiement multi-instance exigera PostgreSQL.
- La CSP conserve `'unsafe-inline'` (handlers `onclick=` encore nombreux) : sprint C1 prévu.
- Sans SMTP, le lien de vérification n'est pas envoyé et les outils avancés restent verrouillés. La production exige un `JWT_SECRET` fort.

# NovaCore 3.0.0 — Lancement public

NovaCore 3.0 prépare le lancement public : navigation réelle, identité et accès maîtrisés, design unifié, NovaOS et NOVAI enrichis, Nova Engine et NovaSeries vérifiables. Le port par défaut reste **6300**.

### Ce qui change pour l'utilisateur

- **Navigation fiable** : URL profondes `?page=…`, boutons retour/avance du navigateur, lien d'évitement clavier et titre de page synchronisé.
- **Vérification e-mail facultative** pour l'usage général, **obligatoire** pour les cinq outils avancés (NovaOS, Nova Engine, Nova Series, Nova IA dont Learn Lab, RetroEdge) avec renvoi du lien et actualisation immédiate.
- **Design 3.0** : couche additive `design-3.css` (tokens, barre latérale, en-tête, cartes, héros produit, thème clair, responsive) sans réécriture de l'existant.
- **NovaOS 3.0** : brief du jour **100 % déterministe** (retards, échéances, priorités, projets actifs, focus), widgets personnalisables.
- **NOVAI 3.0** : conversation persistée (24 messages), suggestions contextuelles, contexte factuel du workspace envoyé au modèle sans l'adresse e-mail.
- **Palette de commandes** : `Ctrl+K` / `Cmd+K`, 27 commandes, navigation clavier complète et focus rendu au déclencheur.
- **Nova Engine** : état réel du Workbench (toolchain, build, processus, dernière action), checklist de release isolée par compte, export de brief enrichi.
- **NovaSeries** : diagnostic de production en 10 contrôles et import de projet JSON validé, avec conservation de l'état en cas de refus.

### Vérifications reproductibles

```powershell
npm test          # 27/27
npm run check     # syntaxe serveur + frontend
node --check public/sw.js
npm run check --prefix nova-engine-workbench
npm run test:scene-api --prefix nova-engine-workbench
```

### Limites connues

- La CSP conserve `'unsafe-inline'` (handlers `onclick=` encore nombreux) : sprint C1 prévu.
- Le stockage JSON mono-instance a été remplacé en 3.0.1 par SQLite transactionnel (voir la section 3.0.1).
- Sans SMTP, le lien de vérification n'est pas envoyé et les outils avancés restent verrouillés. La production exige un `JWT_SECRET` fort.

# NovaCore 2.21.0 — Foundation

Cette révision est le sprint **Foundation** issu de l'audit : elle corrige les défauts P0 de persistance et d'isolation, supprime toutes les données de démonstration et rend réelles plusieurs fonctions qui n'étaient qu'affichées. Le port par défaut reste **6300**.

### Ce qui change pour l'utilisateur

- Chaque compte retrouve désormais **son propre espace** après connexion, redémarrage du navigateur ou du serveur ; le mode invité dispose d'un espace séparé.
- Les modifications sont **synchronisées automatiquement** (debounce 1,5 s) avec le serveur, en plus des boutons manuels.
- Un premier chargement sur un **nouvel appareil** ne peut plus écraser l'espace serveur avec un état vide : la restauration passe avant toute écriture, et des modifications locales plus récentes restent prioritaires.
- **Plus aucune fausse donnée** : projets, tâches, notes, série et roadmap de démonstration ont été retirés. Les données déjà présentes sont conservées.
- Le **calendrier** s'appuie sur de vraies échéances, avec un champ « Échéance » et un compteur de retard.
- Les **automations** ont de vrais déclencheurs (manuel, démarrage, fin de Focus) et un historique d'exécution.
- Les modules **Feature Lab** non implémentés sont marqués « Concept — non actif ».
- La version affichée dans le footer et le cache PWA provient de `GET /api/version`.
- Sans Ollama, `GET /api/ai/models` répond proprement `200` avec `reachable:false`.

### Vérifications reproductibles

```powershell
npm test          # 14/14
npm run check     # syntaxe serveur + frontend
npm run check --prefix nova-engine-workbench
npm run test:scene-api --prefix nova-engine-workbench
```

Build C++ : configuration CMake, build Release, puis `ctest -C Release` → **1/1**.

### Limites connues

- La CSP conserve `'unsafe-inline'` (handlers `onclick=` encore nombreux) : sprint C1 prévu.
- Le stockage reste un fichier JSON local mono-instance ; la migration SQLite est prévue en 2.22.
- La vérification e-mail est facultative ; sans SMTP, le lien n'est pas envoyé et les outils avancés restent verrouillés. La production exige un `JWT_SECRET` fort.

# NovaCore 2.20.1

Cette révision améliore la recherche (local + données du compte, accents, snippets, brouillons et jalons), remplace le visuel RetroEdge à fond noir par un emblème détouré transparent et ajoute des animations de présentation. Le port par défaut reste 6300. Les fonctions de prototype restent identifiées comme telles : cette version ne constitue pas une validation grand public ni une certification de compatibilité RetroEdge.

# NovaCore 2.20 — Hardened core & immersive motion

## Nouveautés 2.20

- **Sécurité / données** : limitation de débit, mots de passe contrôlés, sessions révocables, export/import, sauvegardes rotatives, récupération automatique d'un fichier corrompu, refus de démarrer en production avec un `JWT_SECRET` faible. Détails dans `CHANGELOG.md`.
- **Design / mouvement** : couche `public/polish.css` + `public/motion.js` (entrées en cascade, indicateur de navigation, halo, parallaxe, ciel étoilé, modales animées). Les animations respectent `prefers-reduced-motion` et le réglage « animations » de l'app.
- **Tests** : `npm test` (14 tests d'API) et `npm run check`.
- **Production** : `NODE_ENV=production`, `JWT_SECRET` ≥ 32 caractères, HTTPS via reverse proxy (`TRUST_PROXY=1`). Voir `.env.example`.

Limites connues : la CSP garde `'unsafe-inline'` pour les scripts (≈170 `onclick=` générés par `app.js`) ; le stockage reste un fichier JSON local (pas encore SQLite) ; le limiteur de débit est en mémoire (une seule instance).

## Nouveautés 2.19
- RetroEdge passe en première position de la navigation et bénéficie d’un bandeau de mise en avant sur NovaOS.
- Page RetroEdge retravaillée : emblème RE isolé, direction artistique noir/argent, animations discrètes, sections révélées au défilement, compatibilité présentée comme cible à valider.
- Roadmap produit et critères de lancement ajoutés.
- Guide de passation et de fiabilisation : `PUBLIC_LAUNCH_ROADMAP.md`.
- Port principal : **6300**.

## Important — statut de lancement
Cette archive est une version de développement enrichie visuellement, pas une version certifiée pour une ouverture au grand public. Le guide `PUBLIC_LAUNCH_ROADMAP.md` liste les blocages sécurité, persistance, tests, exploitation et support à traiter avant une exposition publique. RetroEdge reste un concept : aucune compatibilité matérielle n’est certifiée.

# NovaCore 2.12 — Noxa Companion

## Nouveautés Noxa
- Compagnon flottant interactif accessible dans les différentes pages de NovaCore.
- Bulles de dialogue contextuelles et relance du tutoriel depuis « Me guider ».
- Tutoriel dynamique : la carte se repositionne selon l'espace présenté et Noxa se déplace vers les sections guidées.
- Sons d'interface générés localement par Web Audio, activables/désactivables depuis la bulle de Noxa (désactivés par défaut). Aucun fichier audio externe requis.
- Respect de la préférence système de réduction des animations.

# NovaCore 2.11 — Production Tools & UI fixes

## Outils de production
- **NovaScript** conserve le brouillon libre existant et ajoute un document structuré de scènes, personnages, actions et dialogues. Les données sont sauvegardées dans le navigateur ; exporte régulièrement le JSON et réimporte-le pour restaurer un script.
- **Scene Lab** permet de créer, sélectionner, dupliquer, supprimer et transformer des entités. Les snapshots nommés sont conservés dans `nova-engine-workbench/data/scenes/`; la scène active historique continue d’être conservée dans `nova-engine-workbench/data/scene.json`.
- Le noyau C++ inclut désormais un graphe de scène parent-enfant et des transformations monde testées. Ce n’est pas un renderer : aucune fenêtre 3D, commande GPU, matériau, physique ou import de modèle n’est encore fourni.

## NovaCore 2.11 — correctifs d’interface
- Port par défaut : 6300.
- Navigation NovaID ajoutée sans agrandir la fenêtre.
- Les options de vérification disposent d’un défilement adapté aux écrans courts.
- Le tutoriel ne floute plus l’arrière-plan et nettoie ses éléments visuels à la fermeture.

## Vérification locale
- `npm run check --prefix nova-engine-workbench` vérifie la syntaxe du Workbench.
- `npm run test:scene-api --prefix nova-engine-workbench` vérifie la sauvegarde, la liste et le chargement d’un snapshot de scène.
- Les tests C++ se lancent avec CMake et CTest après configuration du projet.

# NovaCore 2.8 — Secure Launch & Production Workbenches

## NovaCore 2.8 — démarrage sécurisé

1. Installe Node.js 20 ou supérieur.
2. Dans le dossier du projet, exécute `npm install` puis `npm start`.
3. Le port par défaut est **6300**. Si ton fichier `.env` contient encore `PORT=6000` ou `PORT=6100`, remplace cette ligne par `PORT=6300`.
4. Ouvre `http://localhost:6300`.
5. Lis et accepte la notice d'utilisation, puis crée un NovaID. La vérification e-mail est facultative pour utiliser projets, tâches, notes, calendrier et Nova Focus ; elle devient obligatoire pour Nova Engine, NovaOS, Nova Series, Nova IA et RetroEdge. En mode de développement sans SMTP, NovaCore affiche le lien de vérification dans la console et sur l'écran d'inscription. Ce mode de test n'est pas une méthode de vérification adaptée à une production publique.

### Envoi réel des e-mails

Copie `.env.example` vers `.env` ou ajoute ses paramètres sans écraser tes clés AI existantes. Pour l'envoi réel, renseigne `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` et `SMTP_FROM`. Configure `PUBLIC_BASE_URL` sur une adresse réellement accessible aux utilisateurs. En `NODE_ENV=production`, les inscriptions restent possibles sans SMTP, mais les outils avancés demeurent verrouillés jusqu'à la vérification de l'adresse.

### Sécurité

NovaID ouvre une session sans exiger la vérification de l'adresse. Les outils avancés (Nova Engine, NovaOS, Nova Series, Nova IA, RetroEdge) et leurs API privées exigent en revanche une adresse vérifiée. Cette version reste un projet local/prototype, pas une plateforme hébergée/auditée prête à recevoir des clients sans configuration et revue de sécurité supplémentaires.


NovaCore 2.0 est une plateforme locale de workspace et de développement : projets, tâches, notes, calendrier de base, Focus, base de connaissances, snippets de code, assistant IA hybride local/cloud, NovaID, synchronisation explicite, plugins déclaratifs, analytics, API REST, roadmap, recherche globale, centre système, thèmes et shell PWA.

## Prérequis
- Node.js 20+ recommandé (Node.js 22 LTS conseillé).
- Option IA locale : Ollama installé et un modèle téléchargé.
- Option IA cloud : clé et modèle auprès d'un fournisseur compatible avec Chat Completions.

## Démarrage Windows (PowerShell)
1. Décompresse cette archive dans un nouveau dossier.
2. Ouvre PowerShell dans ce dossier.
3. Lance `Copy-Item .env.example .env` (si `.env` n'existe pas déjà).
4. Remplace `JWT_SECRET` par une chaîne aléatoire longue. Configure les champs `AI_LOCAL_*` et/ou `AI_CLOUD_*` si tu veux utiliser Nova AI.
5. Exécute `npm install`, puis `npm start`.
6. Ouvre http://localhost:6300.

## IA locale (Ollama)
Par défaut l'application attend `http://localhost:11434/v1/chat/completions`. Installe Ollama, puis télécharge un modèle de code avec `ollama pull qwen2.5-coder:7b`. Vérifie le nom réel avec `ollama list` et adapte `AI_LOCAL_MODEL`.

## IA cloud
Dans `.env`, configure `AI_CLOUD_API_URL`, `AI_CLOUD_API_KEY` et `AI_CLOUD_MODEL`. La clé reste côté serveur. Une API cloud peut être payante. Ne partage jamais ton `.env`.

## API
- `GET /api/health` — santé du serveur.
- `GET /api/docs` — liste des routes.
- `GET /api/diagnostics` — diagnostic technique sans secrets.
- `GET /api/ai/status` — statut de configuration IA.
- `GET /api/ai/models` — modèles Ollama disponibles si Ollama répond.
- `POST /api/auth/register` et `POST /api/auth/login` — NovaID.
- `GET/PUT /api/sync` — synchronisation explicite (JWT).
- `POST /api/ai/chat` — conversation IA (JWT).

## Modules et limites honnêtes
- La recherche globale interroge le workspace local et, si connecté, ajoute les résultats de recherche du serveur.
- Roadmap, tâches, notes, snippets et préférences sont stockés localement dans le navigateur jusqu'à une synchronisation explicite.
- Le backend utilise un adaptateur JSON local (`data/novacore.json`) adapté au développement mono-instance. Ce n'est pas une base de données multi-instance/production.
- NovaPlugins gère un catalogue déclaratif; il n'exécute pas du code de plugins tiers.
- Le calendrier actuel est une vue simple; les tâches n'ont pas encore de moteur de calendrier complet avec rappels.
- Le shell PWA peut mettre en cache les ressources statiques, pas les réponses privées de l'API.
- L'éditeur de snippets ne lance pas de code. Aucun terminal arbitraire n'est fourni.
- La disponibilité réelle des fournisseurs IA dépend de ta configuration et de ton matériel.

## Port dédié
Cette version utilise le port **6300**. Pour le modifier, change `PORT` dans `.env`; l'application de bureau utilise `NOVACORE_URL` dans son environnement.

## Sécurité
Cette version est destinée au développement local. Avant une exposition sur Internet, ajoute une base de données robuste, limitation de débit persistante, HTTPS, politique CSP stricte, gestion de secrets adaptée, tests de sécurité et déploiement durci.


## NovaCore 2.1 — Nova Industries
- Identité visuelle inspirée du poster Nova Industries fourni, palette bleu glacier et reflets liquid glass.
- Écran de démarrage cinématique avec pourcentages et anecdotes aléatoires; il s’affiche une fois par onglet.
- Étoile supernova orbitale animée en arrière-plan, avec respect de `prefers-reduced-motion`.
- Nova Feature Lab : 50 cartes de modules, recherche, filtres, activation locale et raccourcis vers les outils existants. Certains modules sont des raccourcis ou concepts d’interface, pas des services autonomes.


## NovaCore 2.1.1 — correctifs Nova Industries
- L’écran d’accueil utilise le poster avec fond blanc rendu transparent.
- L’introduction dure environ 12 secondes et les anecdotes changent toutes les 3,2 secondes.
- L’animation de supernova NASA est intégrée en arrière-plan via streaming web (connexion Internet requise). L’animation est doucement mise en rotation visuelle pour créer une ambiance spatiale.
- Correction de la route Nova Feature Lab dans les libellés de navigation ; activation des modules met à jour le compteur et la jauge.
- Crédit visuel : NASA / Goddard Space Flight Center, https://svs.gsfc.nasa.gov/20413/


### NOVAI Studio (2.2)
NOVAI offers Assistant, Developer, Creative and Learn Lab modes. Learn Lab can reuse user-entered project notes as context in AI requests; this is persistent prompt/context memory, not fine-tuning or automatic model training. Its sandbox stores and exports text/code prototypes locally and does not execute code. Use a configured local Ollama model or cloud-compatible provider.

Projects include one-click templates for NovaSeries, NovaTechnologie, NovaEngine and NovaStore. Comfort options include larger text and reduced transparency.


## NovaCore 2.3 — Learn Lab AI Studio & réseau local

- Port par défaut : **6300** (`PORT=6300`).
- Le serveur écoute sur `0.0.0.0` pour être accessible aux appareils du même réseau Wi-Fi. Au démarrage, la console affiche les adresses LAN détectées (par exemple `http://192.168.1.25:6300`). L’adresse exacte dépend du réseau.
- Sur les autres appareils, ouvrez l’adresse LAN affichée sur le PC qui exécute NovaCore. Le PC doit rester allumé et connecté au Wi-Fi.
- Si Windows demande une autorisation pare-feu, autorisez Node.js uniquement sur les **réseaux privés**. Ne créez pas de redirection de port sur le routeur et n’exposez pas le serveur à Internet.
- Définissez une valeur unique et longue pour `JWT_SECRET` dans `.env` avant toute utilisation sur le réseau. N’utilisez pas le compte partagé pour des données sensibles.
- Les données en `localStorage` sont propres à chaque navigateur/appareil. Pour retrouver le même workspace partout, connectez-vous à NovaID et utilisez NovaCloud Sync ; la base SQLite intégrée est prévue pour un serveur mono-instance, un déploiement multi-instance nécessitera PostgreSQL.

### Learn Lab Studio

Le nouvel espace propose des jeux de données avec versions, exécutions d’évaluation reproductibles sur règles simples, comparaison des scores, inventaire des modèles Ollama accessibles depuis le serveur et une sandbox de prototypes **sans exécution de code**. Les évaluations sont des métriques heuristiques locales, pas une validation scientifique de modèle. Les jeux de données et expériences sont conservés dans le navigateur utilisé et peuvent être exportés en JSON.


### Correctif 2.4.0 — compatibilité réseau local

Le navigateur peut désactiver `crypto.randomUUID()` sur une adresse HTTP locale (par exemple `http://192.168.x.x:6300`). L'application utilise désormais un générateur d'identifiants de secours compatible avec les navigateurs sur le réseau local. Le cache du service worker est également renouvelé et l'écran d'introduction dispose d'un délai de sécurité pour éviter qu'il reste bloqué.


## Nova Engine Workbench intégré

Depuis la barre latérale, ouvrez **Nova Engine**. NovaCore démarre automatiquement le Workbench C++ local sur le port loopback 5201 et le sert via `/nova-engine/` sur le port principal de NovaCore. Il n'est donc pas nécessaire d'ouvrir un autre port dans le navigateur. Prérequis de compilation : Node.js 20+, CMake 3.24+ et un compilateur C++23. Les actions sont limitées aux commandes CMake/CTest prévues par le Workbench.

Le Workbench 1.4.0 affiche la scène en WebGL2 et produit un rendu PNG de référence avec le rastériseur logiciel C++ 0.4.0. Les routes `/nova-engine/api/engine/render*` exigent un NovaID vérifié et le PNG est servi par le proxy NovaCore ; aucun port supplémentaire n'est exposé.


## NovaCore 2.5 — Supernova Creator Suite

Nouveautés : tutoriel guidé par la mascotte Nova, mode STYLE HACKER avec easter egg jouable, NovaSeries Studio pour préparer une série animée (bible, personnages, épisodes, storyboard, plans et export JSON), et NovaStore en développement pour créer des fiches de produits privées exportables. Les contenus sont stockés dans le workspace local du navigateur. NovaStore ne prend pas de paiement et NovaSeries ne génère pas encore de vidéo/3D automatiquement.

Pour le mode STYLE HACKER : clique sur le bouton `⌁` en haut de l’application, ou tape `nova` au clavier. Le mini-jeu SUPERNOVA BREACH est un easter egg local et ne lance aucun code système.


## Correctif 2.8.1 — Port 6300
- Port principal par défaut déplacé vers `6300` pour éviter le blocage navigateur rencontré sur certains ports.
- Configuration `.env.example`, commande cURL, URL de vérification, enveloppe desktop et mode développeur alignés sur le port 6300.
- Cache PWA renouvelé pour charger les fichiers corrigés.
- Le port interne Nova Engine Workbench reste `5201`.


## NovaCore 2.9.0 — NovaOS Control Center
- Page d’accueil transformée en centre de contrôle NovaOS avec indicateurs issus du workspace local.
- Accès directs à Nova AI, NovaEngine, NovaSeries, NovaCloud, projets et calendrier.
- Recherche globale depuis le tableau de bord, avec transmission au moteur de recherche existant.
- Historique local des actions principales, centre de notifications pour les tâches prioritaires et paramètres de personnalisation.
- Widgets déplaçables par glisser-déposer et visibilité configurable ; préférences sauvegardées localement.
- Port principal conservé sur **6300**.

Les données d’activité et les préférences du tableau de bord sont conservées dans le stockage local du navigateur. Elles ne constituent pas une télémétrie cloud.

## NovaCore 2.16 — persistance des données et Noxa

- Le compagnon Noxa ne se déplace plus automatiquement. Il reste ancré dans le coin inférieur droit ; un clic ouvre/ferme son aide. Le tutoriel guidé reste la seule expérience qui peut déplacer explicitement les éléments de guide.
- Les données serveur sont stockées hors du dossier d'installation, dans `%USERPROFILE%\.novacore\data\novacore.json` sous Windows (ou `~/.novacore/data/novacore.json` sous macOS/Linux). Remplacer ou extraire une nouvelle version du programme ne remplace donc plus ce fichier.
- Les données de l'espace de travail restent associées à l'identifiant NovaID (`user_id`). Un compte distinct conserve ses propres données.
- Migration : au premier démarrage, si le nouveau fichier persistant n'existe pas et que l'ancien `data/novacore.json` existe dans le dossier de l'application, il est copié automatiquement. Ne supprimez pas votre ancienne installation avant d'avoir confirmé que vos données ont été migrées.
- Pour choisir un emplacement de stockage (par exemple un disque avec plus d'espace), définir `NOVACORE_DATA_DIR` dans l'environnement avant de lancer le serveur. Sauvegardez régulièrement ce dossier ; il contient les données de vos comptes.

### RetroEdge

NovaCore 2.18 adds a dedicated RetroEdge concept page in the sidebar. It presents the metallic visual identity, project vision, planned feature set, device-family notes, and a roadmap. Device support is not yet certified; Android and Linux targets are treated separately. The main NovaCore port remains 6300.
