# Liens trackés (UTM)

> Un lien par canal. Ne jamais mettre plusieurs UTM sur le même lien : le premier
> paramètre gagne et vous perdez la lisibilité des statistiques.
> Base : `https://novaindustries.vercel.app/`

| Canal | `utm_source` | `utm_medium` | `utm_campaign` | Lien |
|---|---|---|---|---|
| Show HN | `hackernews` | `social` | `launch-showhn` | https://novaindustries.vercel.app/?utm_source=hackernews&utm_medium=social&utm_campaign=launch-showhn |
| r/GraphicsProgramming | `reddit` | `social` | `launch-graphicsprog` | https://novaindustries.vercel.app/?utm_source=reddit&utm_medium=social&utm_campaign=launch-graphicsprog |
| r/gamedev | `reddit` | `social` | `launch-gamedev` | https://novaindustries.vercel.app/?utm_source=reddit&utm_medium=social&utm_campaign=launch-gamedev |
| Product Hunt | `producthunt` | `referral` | `launch-ph` | https://novaindustries.vercel.app/?utm_source=producthunt&utm_medium=referral&utm_campaign=launch-ph |
| LinkedIn | `linkedin` | `social` | `launch-fr` | https://novaindustries.vercel.app/?utm_source=linkedin&utm_medium=social&utm_campaign=launch-fr |
| X | `x` | `social` | `launch-thread` | https://novaindustries.vercel.app/?utm_source=x&utm_medium=social&utm_campaign=launch-thread |
| Bluesky | `bluesky` | `social` | `launch-thread` | https://novaindustries.vercel.app/?utm_source=bluesky&utm_medium=social&utm_campaign=launch-thread |
| Mastodon | `mastodon` | `social` | `launch-thread` | https://novaindustries.vercel.app/?utm_source=mastodon&utm_medium=social&utm_campaign=launch-thread |
| dev.to | `devto` | `referral` | `article-depth-mask` | https://novaindustries.vercel.app/?utm_source=devto&utm_medium=referral&utm_campaign=article-depth-mask |
| Hashnode | `hashnode` | `referral` | `article-depth-mask` | https://novaindustries.vercel.app/?utm_source=hashnode&utm_medium=referral&utm_campaign=article-depth-mask |
| Handmade Network | `handmadenetwork` | `social` | `launch-hmn` | https://novaindustries.vercel.app/?utm_source=handmadenetwork&utm_medium=social&utm_campaign=launch-hmn |
| Discord | `discord` | `social` | `launch-communities` | https://novaindustries.vercel.app/?utm_source=discord&utm_medium=social&utm_campaign=launch-communities |
| E-mail pilote | `email` | `email` | `pilot-outreach` | https://novaindustries.vercel.app/?utm_source=email&utm_medium=email&utm_campaign=pilot-outreach |

## Ce qu'il faut mesurer

1. **Visiteurs par canal** : c'est la seule métrique comparable d'une plateforme à l'autre.
2. **Taux de clic vers « Rejoindre l'équipe » / « Entreprise pilote »** : l'objectif réel n'est pas la visite, c'est le contact.
3. **Profondeur de lecture** (scroll 50 %) : si le trafic Reddit bounce à 90 % en 5 s, le message ne correspond pas à l'audience.

## Réalité sur les UTM

- Le site est une *single page* Vercel : les UTM sont lisibles côté client, pas dans les logs serveur. Il faut un outil d'analytique (Vercel Analytics, Plausible ou Umami) pour les exploiter.
- Sans outil d'analytique, les UTM ne servent **à rien**. Si vous ne voulez pas installer d'analytique (choix défendable pour la vie privée), utilisez un lien court différent par canal et comparez les clics chez le raccourcisseur.
- Ne pas ajouter de paramètres UTM aux liens internes du site : cela casse la navigation et crée des doublons d'URL.

## Mise en place minimale (si vous activez Vercel Analytics)

1. Activer Analytics dans le projet Vercel (aucun cookie, conforme RGPD).
2. Vérifier que les paramètres `utm_*` sont bien conservés après navigation (SPA : utiliser `history.replaceState` plutôt qu'un rechargement).
3. Attendre 48 h avant de comparer deux canaux : les petits volumes sont bruités.
