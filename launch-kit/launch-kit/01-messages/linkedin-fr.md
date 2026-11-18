# LinkedIn (français)

> Cible : entreprises pilotes, développeurs moteur, écoles. Ton factuel, pas de superlatifs.
> Poster en semaine entre 8h et 10h (heure de Paris). Répondre dans la journée.

## Post

```
On ne promet pas un moteur 3D : on le mesure.

NovaCore 3.10.0 est un workbench local-first construit autour d'un noyau C++20 :
— un éditeur de scène avec aperçu 3D temps réel dans le navigateur (WebGL2) ;
— un rastériseur logiciel déterministe : même scène, même binaire, PNG identique ;
— un backend Direct3D 12 (hors écran et fenêtre native Win32) ;
— ombres portées directionnelle et spot (PCF), textures PNG/JPEG, HDR linéaire,
  bloom demi-résolution et tone mapping ACES ;
— un format de scène v4 qui reste lisible en v1 à v3.

Le principe qui structure tout le reste : chaque fonction annoncée a un test
reproductible. Aujourd'hui, 83/83 tests Node et 5/5 suites CTest (noyau, rendu,
caméra, GPU, fenêtre).

Exemple concret de cette semaine. Un utilisateur signale que la 3D disparaît quand il
déplace la caméra. Trois défauts se cumulaient, dont un piège classique :
gl.clear(DEPTH_BUFFER_BIT) respecte DEPTH_WRITEMASK, et les passes de post-traitement
laissent le masque à false. Le depth buffer n'était donc jamais vidé : il conservait
la frame précédente et ses profondeurs périmées rejetaient des morceaux du maillage.
Mesure au même angle : 840 pixels fragmentés avant, 1 764 pixels pleins après.
107 vérifications automatiques protègent désormais ces invariants.

Ce qui n'est pas fait, et que je préfère écrire noir sur blanc : Vulkan, Metal et le
ray tracing ne sont pas implémentés. La fenêtre native est Windows uniquement. Le
noyau reste privé pendant la phase pilote.

Nous cherchons deux profils de partenaires :
— des développeurs moteur ou sécurité qui veulent tester en profondeur ;
— des entreprises pilotes qui ont besoin d'un pipeline d'images reproductible pour
  leurs revues.

Le workbench, la documentation et la roadmap sont publics :
https://novaindustries.vercel.app/

#moteur3D #Cplusplus #rendering #devtools #gamedev #France
```

## Version courte (si le format long est mal reçu)

```
Un moteur 3D dont on peut prouver le rendu, pas seulement le montrer.

NovaCore : éditeur de scène, aperçu WebGL2 temps réel, rastériseur logiciel
déterministe (même scène = PNG identique), backend Direct3D 12, ombres PCF, HDR,
bloom et tone mapping ACES. 83/83 tests Node, 5/5 CTest.

Ce qui n'est pas fait : Vulkan, Metal, ray tracing. Le noyau reste privé pendant la
phase pilote.

Workbench et roadmap : https://novaindustries.vercel.app/

#Cplusplus #rendering #devtools
```

## Commentaires à préparer

- « Est-ce open source ? » → « Le workbench, la doc et la roadmap sont publics. Le noyau est privé pendant la phase pilote ; l'ouverture est prévue après validation des entreprises pilotes. »
- « Pourquoi pas Vulkan ? » → « Ce n'est pas implémenté. D3D12 d'abord parce que le développement est sous Windows ; Vulkan/Metal supposerait une couche d'abstraction que je ne veux pas annoncer avant de l'avoir testée. »
- « Ça tourne sur Mac ? » → « Le workbench, oui (navigateur + Node). La fenêtre native et le backend GPU, non : Windows uniquement aujourd'hui. »

## À faire avant de poster

- Ajouter **une** image ou un GIF de 15 s (LinkedIn pénalise les posts sans média).
- Vérifier que le lien n'est pas cassé et que la page charge en moins de 2 s sur mobile.
