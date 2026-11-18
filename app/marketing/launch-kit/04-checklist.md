# Checklist de lancement

> Cocher dans l'ordre. Ne pas passer à l'étape suivante si une case « bloquant » est vide.

## J-7 — Préparation (bloquant)

- [ ] **Corriger les chiffres du site** : 3.4.0 → 3.8.0, 50/50 → 54/54 (+ 5/5 CTest, Workbench 1.9.1). Voir `06-site-a-corriger.md`.
- [ ] **Démo animée de 15 s** : orbite + zoom + zoom arrière dans le viewport, sans curseur visible.
- [ ] **Image OG 1200×630** : logo, titre, URL lisible en petit.
- [ ] **Page `/press`** en ligne avec `02-press-kit.md`.
- [ ] **Tester le site sur mobile** (360 px) : le CTA « Rejoindre » doit être atteignable sans zoom.
- [ ] **Vérifier qu'aucune page ne promet** Vulkan, Metal, ray tracing, ou « open source » pour le noyau.
- [ ] **Formulaire de contact testé** : envoyer un message réel et vérifier la réception.

## J-1 — Handmade Network

- [ ] Créer le compte (ou vérifier l'ancienneté du compte : un compte neuf qui poste un lien est filtré).
- [ ] Lire les règles du forum.
- [ ] Publier un post **technique** (le contenu de `show-hn.md` adapté), lien à la fin uniquement.
- [ ] Répondre à chaque réponse pendant 48 h.

## J0 — r/GraphicsProgramming

- [ ] Vérifier le compte : karma suffisant, pas de shadowban (tester avec un commentaire anodin la veille).
- [ ] Lire les règles du sub le jour J.
- [ ] Publier `01-messages/reddit-graphicsprogramming.md` avec les images avant/après.
- [ ] Ne pas reposter si le post est retiré : contacter les modérateurs une fois, poliment.

## J+2 — r/gamedev

- [ ] Choisir le flair autorisé (Tools / Discussion, sinon *Feedback Friday*).
- [ ] Publier `01-messages/reddit-gamedev.md`.
- [ ] Répondre aux commentaires pendant 3 h.

## J+4 — Show HN

- [ ] Titre exact : `Show HN: NovaCore – ...` (le préfixe est obligatoire).
- [ ] Poster entre 14h et 16h UTC, mardi à jeudi.
- [ ] Poster le premier commentaire immédiatement après.
- [ ] Rester disponible 3 h. Ne pas solliciter d'upvotes (détection + pénalité).
- [ ] Si le post échoue : ne pas le reposter. Réessayer est un motif de bannissement du domaine.

## J+7 — Product Hunt

- [ ] Compte actif (un compte neuf est peu visible).
- [ ] 5 images + le GIF, dans l'ordre défini.
- [ ] Premier commentaire prêt à coller.
- [ ] Répondre à **tous** les commentaires le jour J.
- [ ] Ne pas organiser de vote interne : c'est contraire aux règles et détecté.

## J+9 — dev.to

- [ ] Publier `01-messages/devto-article.md` (corps de l'article, pas les métadonnées).
- [ ] Ajouter les images avant/après.
- [ ] Republier sur Hashnode avec `canonical_url` vers dev.to.

## J+10 — LinkedIn + X/Bluesky

- [ ] LinkedIn : image ou GIF obligatoire, lien en fin de post.
- [ ] X/Bluesky : fil de 5 posts, GIF sur le premier, lien sur le dernier.
- [ ] Alt-text sur chaque image.

## En continu

- [ ] Discord Graphics Programming / Handmade / gamedev FR : **participer d'abord**, lien ensuite (jamais en premier message).
- [ ] Répondre aux e-mails de pilotes sous 48 h.
- [ ] Noter chaque retour dans un fichier unique (pas dans un tableur éparpillé).

## Après le lancement (J+14)

- [ ] Bilan par canal : visiteurs, contacts, qualité des retours.
- [ ] Désactiver les UTM des canaux sans trafic (évite de polluer l'analytique).
- [ ] Mettre à jour le CHANGELOG avec les correctifs issus des retours.
- [ ] **Ne pas relancer la même campagne** : un second lancement se prépare avec du nouveau contenu (version majeure, fonctionnalité attendue).

## Signaux d'alerte (arrêter immédiatement)

- Deux posts supprimés sur la même plateforme.
- Un modérateur signale du spam.
- Le domaine commence à être filtré (posts qui n'apparaissent pas en navigation privée).
- Dans ces cas : arrêter la campagne, répondre une fois, attendre plusieurs semaines.
