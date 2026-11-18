# Press kit NovaCore

> À publier sur le site (`/press`) et à joindre aux demandes presse/partenaires.
> Chaque chiffre de ce document est vérifié dans le dépôt. Ne jamais publier un chiffre non vérifié.

## Identité

- **Nom** : NovaCore (écosystème Nova Industries)
- **Produit mis en avant** : Nova Engine Workbench
- **Site** : https://novaindustries.vercel.app/
- **Contact** : novaindustriesteam@gmail.com
- **Statut** : phase pilote, noyau privé, workbench et documentation publics

## Versions (vérifiées)

| Composant | Version |
|---|---|
| NovaCore | 3.8.0 |
| Nova Engine Workbench | 1.9.1 |
| Noyau moteur | 0.8.0 |
| API C++ | 6 |
| Schéma de scène | 4 (lit 1 à 3) |

## Description 50 mots

```
NovaCore est un workbench local-first autour d'un noyau C++20 : édition de scène,
aperçu 3D temps réel dans le navigateur, rastériseur logiciel déterministe produisant
des PNG identiques, et backend Direct3D 12. Chaque fonction annoncée est couverte par
un test reproductible.
```

## Description 100 mots

```
NovaCore est un workbench local-first construit autour d'un noyau C++20. L'éditeur de
scène s'utilise dans le navigateur avec un aperçu 3D temps réel (WebGL2) ; le rendu de
référence est produit par un rastériseur logiciel déterministe, qui garantit un PNG
identique pour une même scène et un même binaire. Un backend Direct3D 12 assure le
chemin rapide sous Windows, avec ombres portées PCF, textures PNG/JPEG, HDR linéaire,
bloom et tone mapping ACES. Les scènes sont validées par le binaire réel du moteur.
Preuves : 54/54 tests Node et 5/5 suites CTest.
```

## Description 250 mots

```
NovaCore est un atelier de création 3D local-first, construit autour d'un noyau C++20
et d'un principe simple : une fonctionnalité n'est annoncée que si elle est mesurable.

L'édition se fait dans un workbench navigateur : ajout et transformation d'entités,
lumières multiples, sélection par picking, sauvegarde automatique avec sauvegardes
roulantes. L'aperçu 3D temps réel est un rendu WebGL2, volontairement séparé du rendu
de référence.

Le rendu de référence est produit par un rastériseur logiciel déterministe : ordre de
dessin fixe, boucle de rastérisation mono-thread, comparaison de profondeur quantifiée.
Une même scène et un même binaire donnent un PNG identique, octet pour octet, ce qui
permet de traiter une régression visuelle comme un test qui échoue.

Sous Windows, un backend Direct3D 12 (rendu hors écran et fenêtre native Win32 avec
swapchain flip-model) partage les mêmes pipelines : ombres portées directionnelle et
spot avec PCF, textures PNG/JPEG via stb_image, HDR linéaire, bloom demi-résolution et
tone mapping ACES/sRGB, huit primitives et des blocs de gameplay simples.

Le format de scène est en version 4, rétrocompatible avec les versions 1 à 3. Les
scènes sont validées par le binaire C++ lui-même, pas par une réimplémentation
JavaScript.

Preuves publiées : 54/54 tests Node, 5/5 suites CTest (noyau, rendu, caméra, GPU,
fenêtre), rendu GPU validé sur NVIDIA GeForce GTX 1660 SUPER.

Le noyau reste privé pendant la phase pilote. Vulkan, Metal et le ray tracing ne sont
pas implémentés ; la fenêtre native est Windows uniquement.
```

## Faits vérifiables (à citer tels quels)

- `npm test` → **54/54**
- `ctest -C Debug` → **5/5** (CoreTests, RenderTests, CameraTests, GpuTests, WindowTests)
- Workbench `npm run check` → OK ; `npm run test:viewport` → **107 vérifications**
- Correction viewport mesurée : cube **840 px fragmentés → 1 764 px pleins (42×42)**, taux de remplissage 0,94–1,00 après orbite/zoom
- Feature Lab : **50 modules actionnables**
- Rendu GPU : 3 meshes, 1 022 triangles, 6 draw calls, 1 shadow map, 886 couleurs, PNG 230 663 octets
- Données utilisateur : `data/scene.json` non modifié par les correctifs

## Limites (à publier, pas à cacher)

- Vulkan, Metal, ray tracing : non implémentés.
- Fenêtre native et backend GPU : Windows uniquement.
- Ombres portées limitées aux lumières directionnelle et spot (2 shadow maps maximum).
- Aperçu navigateur sans ombres portées, non garanti pixel-identique au rastériseur logiciel.
- Noyau privé pendant la phase pilote ; CSP avec `'unsafe-inline'` ; déploiement mono-instance.
- RetroEdge : concept en développement, aucune certification matérielle.

## Assets à produire

| Asset | Format | Contenu |
|---|---|---|
| Logo | SVG + PNG 512 | marque « N » |
| Capture viewport | PNG 1920×1080 | scène de démarrage, cube + sphère + sol |
| Démo | GIF/MP4 15 s | orbite + zoom + zoom arrière |
| Comparatif | PNG côte à côte | logiciel / D3D12, mention « non identiques par conception » |
| Feature Lab | PNG 1920×1080 | 50 modules |
| Preuves | PNG terminal | 54/54, 5/5, hash du PNG de référence |
| Image OG | PNG 1200×630 | logo + titre + URL |

## Citations utilisables

```
« Une fonctionnalité n'est annoncée que si elle est mesurable. »
```

```
« Le rastériseur logiciel n'est pas là pour être plus beau : il est là pour être
reproductible. C'est lui qui transforme une régression visuelle en test qui échoue. »
```

## Contact presse

```
novaindustriesteam@gmail.com
Objet suggéré : [Presse] NovaCore — demande d'information
Réponse sous 48 h ouvrées.
```
