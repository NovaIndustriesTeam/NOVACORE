# Objections et réponses

> À relire avant chaque post. La règle : répondre factuellement, une fois, sans défendre
> le produit. Une réponse honnête sur une limite vaut mieux que dix arguments.

## « Encore un moteur 3D ? »

> Oui, et c'est une question légitime. La différence n'est pas le nombre de fonctionnalités : c'est que le rendu de référence est déterministe, donc une régression visuelle casse un test au lieu d'attendre qu'on la remarque. Si ce n'est pas utile pour vous, c'est probablement le bon moment pour ne pas l'essayer.

## « Pourquoi pas Vulkan / Metal ? »

> Parce que ce n'est pas implémenté, et je ne vais pas prétendre le contraire. J'ai commencé par D3D12 parce que je développe sous Windows. Vulkan demanderait une couche d'abstraction que je ne veux pas annoncer avant de l'avoir testée. Metal suppose une machine Apple que je n'ai pas.

## « Ça tourne sur macOS / Linux ? »

> Le workbench : oui, c'est du navigateur + Node. Le backend GPU et la fenêtre native : non, Windows uniquement aujourd'hui. Le rastériseur logiciel est portable par construction, mais je ne l'ai pas validé sur ces plateformes, donc je ne l'affirme pas.

## « C'est open source ? »

> Le workbench, la documentation et la roadmap sont publics. Le noyau est privé pendant la phase pilote ; l'ouverture est prévue après validation avec les entreprises pilotes. Je préfère le dire clairement plutôt que de laisser entendre une licence qui n'existe pas encore.

## « Un rastériseur logiciel, c'est lent. Quel intérêt ? »

> Aucun intérêt en production temps réel, et ce n'est pas son rôle. Il sert d'oracle : même scène, même binaire, PNG identique. C'est ce qui permet de détecter une régression de rendu automatiquement. Le chemin rapide, c'est D3D12.

## « Les deux rendus ne sont pas identiques, donc votre test ne sert à rien. »

> Exact, et je ne prétends pas qu'ils soient identiques. Le test de non-régression porte sur le rastériseur logiciel. Le backend GPU est validé par des tests distincts (géométrie, nombre de draw calls, ombres, bloom, couleurs) et par comparaison qualitative. Confondre les deux serait une erreur, effectivement.

## « Vous n'avez pas d'utilisateurs, pourquoi je vous ferais confiance ? »

> Vous n'avez aucune raison de me faire confiance sur parole : c'est pour ça que tout ce qui est annoncé est accompagné d'une commande reproductible et d'un résultat mesuré. Le reste — la roadmap, les limites — est écrit noir sur blanc.

## « L'adresse e-mail est un Gmail, c'est louche. »

> Juste, et c'est prévu : le passage à un domaine dédié fait partie de la mise en place de la phase pilote. En attendant, le Gmail est le canal de contact réel et il est surveillé.

## « Combien ça coûte ? »

> Le workbench et la documentation sont accessibles sans frais pendant la phase pilote. Il n'y a pas de grille tarifaire publique à ce stade, et je ne veux pas en annoncer une avant d'avoir les retours des pilotes.

## « Vous utilisez de l'IA ? »

> Le projet est développé avec assistance d'IA, et cela n'est pas caché. La règle appliquée est la même dans les deux cas : aucune fonctionnalité n'est annoncée sans test reproductible. Un chiffre faux reste faux, qu'il soit écrit par un humain ou par une IA.

## « Vos 107 tests sont des assertions sur du texte, pas du rendu. »

> C'est exact pour une partie d'entre eux : la vérification de l'ordre `depthMask`/`clear` lit le code réellement servi. C'est plus faible qu'un test de rendu, et c'est complémentaire : ça empêche qu'une passe ajoutée plus tard casse silencieusement le clear. Les tests de rendu existent séparément (`test:render`, `test:gpu`, CTest).

## Ton à garder

- Reconnaître ce qui est faux ou absent **avant** de défendre le reste.
- Ne jamais dire « je vais le faire » sans date réaliste.
- Une réponse argumentée une fois ; ensuite, ne plus alimenter.
- Ne jamais se moquer d'un concurrent ou d'un commentateur.
