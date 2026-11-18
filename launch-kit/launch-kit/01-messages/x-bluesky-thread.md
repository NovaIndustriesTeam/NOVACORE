# X / Bluesky / Mastodon — fil de 5 posts

> Poster le fil en une fois (X) ou espacé de 2 minutes (Bluesky). Épingler le post 1.
> Joindre le GIF de 15 s au post 1.

## Post 1

```
Un moteur 3D sans GPU peut-il être plus fiable qu'avec ?

Oui, s'il est déterministe : même scène, même binaire, PNG identique.
C'est ce qui me permet de traiter une régression visuelle comme un test qui échoue.
🧵
```

## Post 2

```
NovaCore, c'est trois choses :

• un éditeur de scène avec aperçu WebGL2 temps réel
• un rastériseur logiciel déterministe = l'oracle
• un backend Direct3D 12 = le chemin rapide

L'aperçu n'a pas besoin d'être identique au rendu de référence.
Et c'est documenté comme tel.
```

## Post 3

```
Cette semaine, un utilisateur signale que la 3D disparaît quand il bouge la caméra.

Cause : gl.clear(DEPTH_BUFFER_BIT) respecte DEPTH_WRITEMASK.
Les passes de post-traitement laissaient le masque à false.
Le depth buffer gardait la frame précédente.

840 px fragmentés → 1 764 px pleins.
```

## Post 4

```
Ce que je ne sais pas faire, je l'écris :

• Vulkan : non implémenté
• Metal : non implémenté
• ray tracing : non commencé
• fenêtre native : Windows uniquement
• noyau : privé pendant la phase pilote

83/83 tests Node, 5/5 CTest.
```

## Post 5

```
Workbench, documentation et roadmap sont publics :
https://novaindustries.vercel.app/

Je cherche des développeurs moteur/sécurité et des entreprises pilotes
qui ont besoin d'un pipeline d'images reproductible.

Réponses ouvertes, y compris les critiques.
```

## Alt-text (obligatoire sur les images)

```
Post 1 : Capture du viewport 3D du Workbench NovaCore. Un cube orange, une sphère
claire et un sol quadrillé sur fond bleu nuit. La grille s'estompe en perspective.
```

```
Post 3 : Comparaison de deux rendus du même cube au même angle de caméra. À gauche,
le cube apparaît en fragments dispersés. À droite, le cube est un bloc plein.
```

## Version anglaise (Bluesky / Mastodon international)

```
1/ Can a GPU-less 3D engine be more reliable than a GPU one? Yes, if it's
deterministic: same scene, same binary, identical PNG. That turns a visual regression
into a failing test. 🧵

2/ NovaCore = scene editor with a WebGL2 realtime preview + a deterministic software
rasterizer (the oracle) + a Direct3D 12 backend (the fast path). The preview is not
claimed to match the reference render, and that's documented.

3/ This week a user reported meshes vanishing while orbiting. Cause:
gl.clear(DEPTH_BUFFER_BIT) honours DEPTH_WRITEMASK, and the post passes left it
false. The depth buffer kept the previous frame. 840 fragmented px -> 1764 solid px.

4/ What I don't have, I say: no Vulkan, no Metal, no ray tracing. Native window is
Windows-only. Core is private during the pilot. 83/83 Node tests, 5/5 CTest.

5/ Workbench, docs and roadmap: https://novaindustries.vercel.app/ Looking for engine
/ security developers and pilot companies that need a reproducible image pipeline.
```

## Règles

- Ne pas dépasser 5 posts : au-delà, la lecture chute.
- Ne pas mettre de lien dans chaque post (les plateformes réduisent la portée) : un seul, à la fin.
- Ne pas taguer de comptes influents pour gagner en visibilité.
