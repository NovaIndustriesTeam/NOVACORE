# Nova Engine Workbench 1.9.1

Workbench local pour composer une scène, la valider avec le noyau C++ 0.8.0, l’afficher en 3D temps réel avec **lumières multiples, textures PNG/JPEG, HDR et bloom**, jouer la scène en mode **Play** et produire un rendu PNG de référence soit par **rastérisation logicielle déterministe**, soit par le **backend GPU Direct3D 12** (Windows). Le tout s’appuie sur le **schéma de scène 4** (les schémas 1 à 3 restent lisibles). La version 1.9.0 ajoute une **gestion de session explicite**, l’**autosave avec sauvegardes roulantes**, une **scène de démarrage complète** et un viewport **responsive**. La version **1.9.1** corrige les artefacts du viewport 3D qui faisaient disparaître la scène au déplacement de la caméra.

## Pré-requis

- Node.js 20+
- CMake 3.24+
- Un compilateur C++20 : MSVC (Visual Studio avec la charge de travail **Développement Desktop en C++**), Clang ou GCC
- Windows SDK 10+ pour le backend Direct3D 12 (optionnel : le logiciel fonctionne sans)

## Démarrer

Windows : double-cliquer sur `START-WORKBENCH.bat`, ou depuis PowerShell :

```powershell
npm start
```

Ouvrir `http://127.0.0.1:5201`. Le serveur est volontairement limité à `127.0.0.1`. Dans NovaCore, le Workbench est servi via `http://127.0.0.1:6300/nova-engine/` : c’est cette URL qu’il faut utiliser, car les assets et l’API passent par le proxy authentifié de NovaCore.

## Session NovaID, autosave et fiabilité (1.9.0)

- **Session explicite** : toutes les routes `/nova-engine/api/*` du proxy NovaCore exigent un NovaID vérifié. Sans jeton, le Workbench n’affiche plus une scène vide : une bannière « Session NovaID requise » propose la connexion (`/?next=%2Fnova-engine%2F`) et un bouton **Réessayer**. Les erreurs sont classées dans `public/session.js` : `expired` (401), `unverified` (403 `EMAIL_NOT_VERIFIED`), `forbidden`, `server` (5xx), `offline`.
- **Sonde légère** : `/api/ping` est appelé avant les requêtes lourdes, ce qui évite une avalanche de 401 et distingue l’accès direct à `5201` du proxy authentifié.
- **Autosave** : la scène est écrite après **1,4 s** d’inactivité, avec `Ctrl`/`Cmd+S` ou le bouton Enregistrer. Chaque écrasement de `data/scene.json` crée une **sauvegarde roulante** (12 maximum) dans `data/backups`.
- **Scène de démarrage** : `/api/scene/template` renvoie le template complet (Main Camera, Key Light, Rim Spot, Ground, Starter Cube, Starter Sphere) ; « Nouvelle scène » le charge au lieu d’une scène vide.
- **Données isolables** : `NOVA_WORKBENCH_DATA_DIR` déplace le dossier de données (utilisé par les tests pour ne jamais toucher `data/scene.json`).
- **Viewport responsive** : redimensionnement sur `window.resize`, `ResizeObserver` et changement de densité de pixels, avec nettoyage à la destruction.

Vérifications : `npm run check`, `npm run test:session`, `npm run test:scene-api`, `npm run test:viewport`.

## Correctif viewport 1.9.1 — la scène ne disparaît plus

Trois défauts distincts, tous reproduits puis mesurés sur une copie isolée de `data/scene.json` (instance `NOVA_WORKBENCH_DATA_DIR` sur un autre port, aucune écriture sur les données utilisateur) :

1. **Caméra sous le plan de grille** : l’orbite verticale descendait l’œil sous `y = 0` après ~40 px de glissement (`eye.y` : 2 → 1,52 → 1,03 → 0,54 → 0,04 → −0,45 → −1,92). Le plan de grille (±200, `y = 0`) remplissait alors tout l’écran. `public/viewport-math.js` (nouveau, sans dépendance) clampe le pitch orbital pour garder l’œil à `GRID_PLANE_Y + CAMERA_FLOOR_MARGIN` (0,08) tant que le pivot est au-dessus du plan ; un pivot volontairement sous la grille laisse l’orbite libre.
2. **Grille occludante** : le quad de grille écrivait la profondeur. Il est désormais dessiné avec `gl.depthMask(false)` puis `gl.depthMask(true)` avant les meshes : c’est une référence, jamais un obstacle. Ses lignes s’atténuent aussi en incidence rasante (`minorFade` / `majorFade`) au lieu de produire une nappe de moiré.
3. **Profondeur jamais vidée** : `gl.clear(DEPTH_BUFFER_BIT)` respecte `DEPTH_WRITEMASK`, et les passes bloom/composite/overlays laissent `depthMask(false)`. Le depth buffer conservait donc la frame précédente et ses valeurs périmées rejetaient des morceaux de mesh. Mesure : au même angle, le cube utilisateur passait de **840 px fragmentés à 1 764 px pleins** avec un `gl.depthMask(true)` avant le clear ; c’est ce qui produisait la capture « cube en morceaux ». `draw()` restaure maintenant l’écriture de profondeur avant de vider la cible de scène.

Preuves reproductibles : `npm run test:viewport` → **107 vérifications** (orbite clampée sur 400 px simulés, œil toujours ≥ marge, invariants `depthMask`, ordre clear/profondeur, anti-moiré, ordre des scripts) ; navigateur, glissement haut/bas 100–120 px, zoom molette et pick : cube **1 764 à 2 246 px**, taux de remplissage **0,94–1,00**, `pick` → `starter-cube`, **0 erreur console**.

## Workflow recommandé

1. **Configurer le projet** — exécute CMake configure.
2. **Compiler Nova Engine** — construit les cibles `NovaCore`, `NovaEngine`, `NovaEngineTests`, `NovaRenderTests` et `NovaGpuTests`.
3. **Lancer les tests** — exécute CTest (`5/5` sous Windows : noyau, rendu logiciel, caméra, GPU, fenêtre native).
4. **Démarrer le moteur** — ouvre la fenêtre Win32/D3D12 depuis la vue Runtime.
5. **Scene Lab** — compose la scène, observe le viewport WebGL2, choisis le backend, puis lance un **Rendu moteur C++**.

Le journal affiche les sorties stdout/stderr. Le bouton Arrêter tente de terminer le processus lancé par le Workbench.

## Scene Lab : trois couches de rendu assumées

- **Viewport WebGL2 (aperçu temps réel)** : meshes cube/sphère/plan/cylindre/cône/tore/capsule/pyramide, lumières directionnelles/points/spots calculées en GLSL (16 maximum), textures PNG/JPEG via cache, ciel et grille linéaires, orbite au glisser, panoramique avec Maj, zoom à la molette, cadrage au double-clic, sélection par picking rayon-AABB et gizmos caméra/lumière/sélection. Le rendu interne est **HDR** (`RGBA16F`, repli `RGBA8`) avec bright pass, flou half-res, bloom et composite **ACES/sRGB**. Le mode **Play** simule le gameplay (WASD/ZQSD, souris, espace) et restaure la scène à l’arrêt. Si WebGL2 est indisponible, un secours Canvas 2D prend le relais sans faire planter la page.
- **Lumières, ombres et textures** : jusqu’à 16 lumières validées (8 évaluées par le moteur), type `directional|point|spot`, couleur sRGB, intensité, portée, angle et `castShadow`. Le rendu logiciel et D3D12 projettent les ombres de la directionnelle et du spot (maximum 2 shadow maps, PCF, résolution 128 à 2048) ; les points n’en projettent pas. `Material::texture` accepte un chemin relatif PNG/JPEG servi par `/api/assets/…`, avec repli procédural.
- **Matériaux PBR** : l’inspecteur expose albedo sRGB, metallic, roughness, tiling, motif `none|checker|grid`, émissif et texture. Les UV sont générées par le moteur, les motifs sont évalués par la même formule dans le logiciel, le HLSL et le WebGL2. Une entité sans matériau conserve la palette historique.
- **Rendu logiciel (référence déterministe)** : le binaire `NovaEngine.exe` rastérise la scène sans GPU (z-buffer, clipping, caméra de la scène ou caméra automatique, lumières multiples, shadow maps, grille, gizmos, textures, HDR/bloom/ACES, encodeur PNG autonome). Deux rendus identiques produisent des PNG **octet pour octet identiques**.
- **Rendu GPU Direct3D 12 (Windows)** : device matériel, root signature, pipelines ciel + scène + profondeur d’ombre, shader PBR multi-lumières avec textures et PCF, cible **R16G16B16A16_FLOAT**, bright/blur half-res et composite ACES/sRGB, readback GPU et PNG. Le même code de pipeline alimente le rendu hors écran **et** la fenêtre native.
- **Gameplay** : les entités peuvent porter `rigidbody`, `controller`, `spinner` et `collectible`, sérialisés en schéma 4 et simulés de façon déterministe dans `Runtime::play` (pas plafonné à 0,1 s découpé en sous-pas de 0,02 s).

Le viewport navigateur, le PNG logiciel et le PNG GPU ne sont pas garantis pixel-identiques : ce sont trois implémentations distinctes, annoncées comme telles.

## Runtime natif Win32 / Direct3D 12

La vue **Runtime** pilote un vrai processus `NovaEngine` :

- fenêtre Win32 réelle, swapchain flip-model à 3 buffers, RTV/DSV, fence et gestion du redimensionnement ; le rendu utilise les mêmes lumières multiples, textures, shadow maps et HDR/bloom/ACES que le chemin hors écran ;
- caméra libre : `W/Z` avant, `S` arrière, `A/Q` gauche, `D` droite, `E` monter, `C` descendre, `Maj` sprint, clic droit + souris pour regarder, `F1` filaire, `Échap` fermer ;
- capture PNG par **readback du swapchain** après présentation, encodée par l’encodeur PNG du moteur ;
- l’API Workbench ouvre, arrête et capture ce runtime, avec un état de processus séparé des builds.

La fenêtre n’est annoncée comme fonctionnelle que parce que `NovaWindowTests` crée une fenêtre cachée 320×240, rend deux poses caméra, produit une capture filaire et vérifie la signature PNG ; `npm run test:gpu` vérifie en plus l’ouverture/arrêt par HTTP et une capture runtime 320×180.

## API locale (Workbench)

- `GET /api/ping`, `GET /api/version`, `GET /api/status`, `GET /api/scene`, `GET /api/scene/template`, `GET /api/scenes`
- `PUT /api/scene`, `GET /api/scenes/load`, `GET /api/scenes/export`, `PUT /api/scenes/save`, import/renommage/suppression
- `POST /api/engine/validate` — validation par le vrai binaire C++
- `POST /api/engine/render` — rendu PNG (`width`, `height`, `supersample` 1–4, `grid`, `shadows`, `bloom`, `bloomIntensity` 0–2, `shadowResolution` 128–2048, `exposure` 0,1–8, `wireframe`, `selectedId`, `backend: "software" | "gpu"`)
  - `backend: "gpu"` exige Windows + un adaptateur Direct3D 12 ; les ombres, le bloom, l’exposition, les textures et les lumières sont partagés avec le logiciel. Seuls `supersample` et `grid` restent propres au chemin logiciel.
- `GET /api/engine/render/<id>.png` — PNG produit
- `GET /api/engine/renders` — liste des 24 derniers rendus
- `GET /api/assets/<chemin>.png|jpg|jpeg` — texture du dossier `assets` (validation du chemin, pas de `..` ni d’absolu)
- `GET /api/runtime/status` — état de la fenêtre native (PID, scène, résolution, dernière capture)
- `POST /api/runtime/window` — ouvre la fenêtre native (`width`, `height`, `wireframe`, `cameraId`, `shadows`, `bloom`, `bloomIntensity`, `shadowResolution`, `exposure`; `hidden` et `frames` réservés aux tests)
- `POST /api/runtime/window/stop` — ferme la fenêtre native
- `POST /api/engine/runtime/capture` — rend une frame cachée, lit le swapchain et renvoie `url`, `bytes`, `frames`, `stats` D3D12

Via NovaCore, toutes les routes `/nova-engine/api/*` exigent un **NovaID vérifié** ; le PNG est récupéré avec le jeton `novaToken`. Le proxy retire le préfixe de montage avant de transmettre au Workbench.

## Structure

- `engine/include/nova` — API publique du noyau, du rendu, du RHI (`nova_gpu.hpp`), de la caméra (`nova_camera.hpp`) et de la fenêtre (`nova_window.hpp`)
- `engine/src` — noyau, rastériseur logiciel, backend D3D12 partagé, fenêtre Win32/D3D12, caméra libre et exécutable CLI
- `engine/tests` — tests CTest (noyau, rendu, caméra, GPU, fenêtre native)
- `public` — interface Workbench, `viewport-3d.js`, `app.js`, styles
- `server.mjs` — API locale sans dépendance externe
- `data` — scène courante, snapshots nommés, rendus PNG temporaires

## Tests

```powershell
npm run check            # server.mjs + app.js + viewport-3d.js
npm run test:scene-api   # bibliothèque de scènes et validation C++
npm run test:render      # rendu logiciel, décodage PNG, déterminisme, ombres, textures, bloom/ACES
npm run test:gpu         # Direct3D 12, ombres, textures, bloom, filaire distinct, capture runtime et ouverture/arrêt de la fenêtre
cd engine/build
ctest -C Debug --output-on-failure   # 5/5 sous Windows ; -C Debug requis avec MSVC multi-config
```

## Limites transparentes

Le moteur est réel sur deux backends : logiciel partout, Direct3D 12 sous Windows. La fenêtre Win32, le swapchain flip-model, la caméra libre et la capture par readback sont implémentés et testés sous Windows. Les lumières multiples, les ombres portées directionnelle/spot, les textures PNG/JPEG, le HDR/bloom/ACES, les primitives supplémentaires et le gameplay sont implémentés et testés. Il n’y a **pas encore** de normal maps, de MSAA, d’ombres de lumières ponctuelles (maximum 2 shadow maps), de ray tracing ni d’ombres dans le viewport navigateur. Metal et Vulkan sont déclarés dans le RHI mais non implémentés. Il n’y a pas encore d’import glTF/OBJ ni d’animation squelettique. Un rendu logiciel 960×540 en supersampling 2× prend environ 2,5 s en build Debug ; la première passe GPU inclut la création du device et la compilation des shaders (~0,5 s sur GTX 1660 SUPER). Le rendu GPU n’est pas garanti pixel-identique au logiciel. Le Workbench n’exécute que des actions prédéfinies sur le projet inclus ; il n’offre pas de terminal arbitraire via le navigateur.

## Dépannage

- **CMake introuvable** : installe CMake et rouvre le terminal.
- **Aucun compilateur** : installe Visual Studio avec la charge de travail C++ (Windows) ou GCC/Clang.
- **Le port 5201 est occupé** : lance avec `PORT=5202 npm start` (PowerShell : `$env:PORT=5202; npm start`).
- **Tests introuvables** : lance Configure, puis Build, puis Tests.
- **Backend GPU indisponible** : vérifie Windows, le Windows SDK et un adaptateur Direct3D 12 ; `NovaEngine --gpu-info` liste les adaptateurs détectés.
- **Rendu refusé (401/409/422)** : vérifie la session NovaID vérifiée, puis que le binaire est compilé dans Build & compilation.
