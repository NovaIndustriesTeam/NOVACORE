# Site officiel — à corriger avant toute promotion

Analyse de https://novaindustries.vercel.app/ (vérifiée le 13 novembre 2026).
Ces corrections sont **bloquantes** : un développeur qui voit un chiffre faux cesse de lire le reste.

## 1. Chiffres périmés (bloquant)

| Sur le site | Réalité vérifiée | Où |
|---|---|---|
| NovaCore **3.4.0** | **3.8.0** | section Preuves |
| **50/50** tests automatisés | **54/54** (`npm test`) **+ 5/5** (CTest) | section Preuves |
| « journal des versions » | doit mentionner le lot 16 et le Workbench **1.9.1** | liens / Preuves |

Texte de remplacement proposé pour le bloc de preuves :

```
54/54  tests automatisés réussis (Node) · 5/5 suites CTest (noyau, rendu, caméra, GPU, fenêtre)
50     modules actionnables dans le Feature Lab
D3D12  backend GPU, avec un rastériseur logiciel déterministe comme référence
SQLite stockage transactionnel avec sauvegarde et restauration automatiques
```

Et sous le titre de section :

```
Dernière vérification : 13 novembre 2026 — NovaCore 3.8.0, Workbench 1.9.1, noyau 0.8.0.
```

## 2. Version du moteur (bloquant si affichée)

Si le site affiche encore « NovaCore 3.4.0 » ailleurs (footer, meta description, balise OG), aligner sur **3.8.0**. La balise `<title>` et la description OG sont visibles dans tous les partages : elles doivent être justes.

## 3. Absence de démonstration visuelle (bloquant pour un lancement)

Aucune vidéo/GIF du produit sur la page d'accueil. C'est l'asset qui convertit le plus.
À ajouter en haut de page, sous le titre :

- GIF ou MP4 **muet, 15 s, boucle**, montrant : orbite dans le viewport → zoom → zoom arrière → sélection d'une entité.
- Poids < 3 Mo (sinon mobile décroche), poster image en PNG pour le premier rendu.
- Alt-text descriptif.

## 4. CTA ambigu (important)

Deux formulaires coexistent (« Rejoindre l'équipe », « Entreprise pilote ») sans hiérarchie claire.
Proposition : un CTA primaire unique **« Essayer le workbench »** (ouvre la démo ou la doc) et un CTA secondaire **« Devenir entreprise pilote »**. Le formulaire recrutement reste accessible depuis le footer.

## 5. Crédibilité du contact (important)

`novaindustriesteam@gmail.com` sur un site qui parle d'entreprise : c'est le premier détail qui fait douter.
Deux options, par ordre de préférence :

1. Domaine dédié (`contact@novaindustries.dev` ou équivalent) avec redirection vers la boîte existante.
2. À défaut, afficher clairement « adresse temporaire pendant la phase pilote » — l'honnêteté coûte moins cher que le doute.

## 6. Mentions obligatoires (bloquant juridique en France)

- [ ] Mentions légales (éditeur, hébergeur — Vercel).
- [ ] Politique de confidentialité (formulaires : quelles données, quelle durée, quel droit d'accès).
- [ ] Si les formulaires envoient des données hors UE : le mentionner.

## 7. Cohérence des promesses (bloquant)

Vérifier qu'aucune page ne laisse entendre :

- Vulkan ou Metal comme « à venir » sans le mot « non implémenté » ;
- un noyau « open source » ;
- une compatibilité macOS/Linux du backend GPU ou de la fenêtre native.

## 8. Détails qui changent la perception (facultatif mais rentable)

- **Temps de chargement** : viser < 2 s sur mobile 4G. Vérifier le poids des polices et des images.
- **`<html lang="fr">`** et une version anglaise de l'accueil si vous visez HN/Reddit : un visiteur anglophone qui tombe sur une page 100 % française repart.
- **Meta OG** : image 1200×630, titre, description. Sans ça, les partages sur X/LinkedIn/HN affichent un lien nu.
- **Preuve en un coup d'œil** : afficher le hash du PNG de référence ou une capture terminal `54/54` quelque part sur la page. C'est ce qui distingue une page de promesses d'une page de mesures.
- **Date de dernière mise à jour** visible : « dernière vérification : 13/11/2026 ».

## Ordre d'exécution

1. Chiffres (30 min).
2. Meta OG + titre/description (30 min).
3. GIF de démo (2 h).
4. Mentions légales / confidentialité (1 h).
5. CTA et contact (1 h).
6. Page `/press` (30 min, contenu prêt dans `02-press-kit.md`).

Total réaliste : une demi-journée. Sans les points 1 à 3, un lancement coûte plus qu'il ne rapporte.
