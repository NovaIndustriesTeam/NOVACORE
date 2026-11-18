# Politique de sécurité — NovaCore

**Version 1.1 — 14 novembre 2026**
Politique applicable à l’application NovaCore, à son API (`/api`), au Workbench Nova Engine
(`/nova-engine`) et aux services associés lorsque tu les héberges toi-même.

Ce document décrit **comment signaler une vulnérabilité** et **ce que nous nous engageons à faire**.
Il ne prétend pas que NovaCore est audité, certifié ou exempt de défauts. Les limites connues sont
documentées séparément.

---

## 1. Signaler une vulnérabilité

**Contact : novaindustriesteam@gmail.com**
Objet conseillé : `[SECURITY] <description courte>`

Merci d’inclure, si possible :

- la version concernée (`GET /api/version`), le système d’exploitation et le navigateur ;
- une description du défaut et de son impact réel (lecture de données d’un autre compte,
  contournement d’authentification, exécution de code, etc.) ;
- les étapes de reproduction minimales, avec des **données de test**, jamais les données
  d’un tiers ;
- une preuve si elle tient en quelques lignes (requête HTTP, extrait de journal).

**Ne transmets jamais de secret réel** (mot de passe, `JWT_SECRET`, clé SMTP ou clé d’IA) dans
un rapport. Si une clé a pu fuiter, dis-le sans la recopier : elle sera révoquée.

Aucune clé PGP n’est publiée à ce jour. Si ton rapport contient des éléments sensibles,
demande une clé dans le premier message : elle sera fournie avant tout envoi de détail.

---

## 2. Périmètre

### Dans le périmètre

| Élément | Exemples de défauts recherchés |
|---|---|
| Authentification NovaID | contournement de connexion, vol ou rejeu de jeton, énumération de comptes |
| Isolation des comptes | lecture ou écriture des données d’un autre utilisateur |
| API REST (`/api`) | autorisation manquante, injection, validation insuffisante |
| Bordure HTTP | contournement du contrôle d’origine, en-têtes manquants, cache de réponses privées |
| Workbench (`/nova-engine`) | accès sans compte vérifié, traversée de chemin, injection dans le moteur |
| Stockage local | lecture de fichiers hors du dossier de données, corruption volontaire |
| Sauvegardes locales | sauvegarde lisible sans la clé, suppression d’une sauvegarde non chiffrée, clé divulguée |
| Limiteurs de débit | contournement trivial permettant un bourrage d’identifiants |

### Hors périmètre

- **Ingénierie sociale**, hameçonnage, appels ou messages aux personnes du projet.
- **Déni de service** (volumétrie, saturation, épuisement de ressources) : ne le teste pas.
- **Scan automatisé à grande échelle**, fuzzing massif, tests sur des instances qui ne
  t’appartiennent pas.
- **Dépendances tierces** : signale le défaut au projet amont ; un avis de sécurité ici suffit
  si NovaCore doit changer de version.
- **Configuration propre à ton hébergement** (proxy, DNS, TLS, pare-feu) : ce n’est pas le code.
- **Absence de fonctions non annoncées** (Vulkan, Metal, ray tracing, multi-instance) :
  ce sont des limites documentées, pas des vulnérabilités.
- **Version d’évaluation ou instance de démonstration** sans données réelles significatives.

---

## 3. Ce à quoi nous nous engageons

| Étape | Délai visé (jours ouvrés) |
|---|---|
| Accusé de réception | 3 jours |
| Évaluation initiale et gravité proposée | 7 jours |
| Correctif pour une vulnérabilité critique ou haute | 30 jours (objectif), ou plan daté si le correctif dépend d’un tiers |
| Information sur la publication du correctif | à chaque étape significative |

Ces délais sont des **objectifs**, pas des garanties contractuelles. NovaCore est un projet en
phase pilote : il n’existe ni astreinte 24/7 ni équipe de sécurité dédiée. Si tu as besoin d’un
engagement formel, dis-le avant de commencer tes tests.

**Il n’y a pas de programme de prime (bug bounty) et aucune récompense financière n’est promise.**
La reconnaissance se fait par mention, si tu le souhaites, dans la section 6.

---

## 4. Règles de test (sauf autorisation écrite)

Tu peux tester **ta propre instance** et les comptes que tu as créés. Tu ne dois pas :

1. accéder aux données d’un autre utilisateur, ni les modifier, ni les exfiltrer ;
2. interrompre le service, saturer les limiteurs d’un tiers ou lancer un déni de service ;
3. utiliser un compte ou une adresse e-mail qui ne t’appartient pas ;
4. tester sur l’instance publique d’autrui sans accord préalable ;
5. publier un défaut avant qu’un correctif ou un délai de 90 jours ne soit écoulé,
   selon ce qui arrive en premier.

Un test qui respecte ces règles, réalisé de bonne foi, ne fera pas l’objet de poursuites de
notre part. Cette phrase n’engage que Nova Industries : elle ne protège pas d’une action
d’un tiers (hébergeur, fournisseur de messagerie, autorité).

---

## 5. Traitement d’un incident

La procédure interne (confinement, rotation des secrets, restauration, notification,
post-mortem) est décrite dans [`docs/INCIDENT-RESPONSE.md`](docs/INCIDENT-RESPONSE.md).
Elle est écrite pour être suivie sous pression, pas pour être belle.

Résumé des actions immédiates en cas de compromission suspectée :

1. isoler l’instance (couper l’exposition Internet, garder la machine allumée) ;
2. **préserver les preuves** : copier le dossier de données et les journaux avant toute
   réparation ;
3. **révoquer** : nouveau `JWT_SECRET` (invalide tous les jetons émis) et/ou
   `POST /api/auth/logout-all` pour les comptes concernés ;
4. restaurer depuis une sauvegarde vérifiée, puis contrôler l’intégrité ;
5. notifier les personnes concernées si des données personnelles ont été exposées.

### 5.1 Sauvegardes chiffrées (lot 18, NovaCore 3.10.0)

Depuis la version **3.10.0**, les sauvegardes locales sont écrites en **AES-256-GCM**
(`<NOVACORE_DATA_DIR>/backups/*.json.enc`) : chaque fichier porte un IV aléatoire et un tag
d’authentification, donc une altération est détectée au déchiffrement. Les anciennes
sauvegardes `.json` en clair restent lisibles et sont retirées par la rétention.

Ce que cela protège réellement :

- la **copie du seul dossier `backups/`** ou son exfiltration ne suffit plus à lire les
  données (e-mails, empreintes de mots de passe, contenu des espaces de travail) ;
- une sauvegarde modifiée ou tronquée est **refusée**, jamais restaurée partiellement.

Ce que cela **ne protège pas** :

- une **compromission complète de la machine** : par défaut la clé est stockée dans
  `<NOVACORE_DATA_DIR>/backup-key` (mode `0600`), à côté des sauvegardes. Utilise
  `NOVACORE_BACKUP_KEY` avec une clé conservée hors de la machine pour séparer les deux ;
- la **perte de la clé** : sans `NOVACORE_BACKUP_KEY` ni `backup-key`, les `.json.enc`
  sont définitivement illisibles. Une sauvegarde chiffrée illisible n’est **jamais supprimée
  automatiquement** ; elle est signalée dans `GET /api/ready` (`backup.unreadable`) ;
- une clé **exposée** : la rotation ne réécrit pas le passé. Si la clé fuite, considère les
  sauvegardes existantes comme lisibles par un tiers, change la clé, puis supprime
  manuellement les anciens `.json.enc` après avoir vérifié que les nouvelles sauvegardes
  sont exploitables ;
- une clé déclarée mais **invalide** ne retombe jamais sur une clé locale : les sauvegardes
  échouent explicitement plutôt que d’être écrites en clair. `GET /api/ready` expose
  uniquement des **codes normalisés** (`BACKUP_KEY_ENV_INVALID`, `BACKUP_KEY_FILE_UNREADABLE`,
  `BACKUP_KEY_FILE_INVALID`, `BACKUP_WRITE_FAILED`), jamais un chemin absolu, un PID ou un
  message système ;
- un fichier `backup-key` **présent mais illisible ou invalide n’est jamais écrasé** : son
  contenu reste intact pour une récupération hors ligne, et l’exploitant doit corriger la
  cause (droits, disque, sauvegarde de la clé).

La rétention combine un plafond par nombre (`NOVACORE_BACKUP_KEEP`, 14 par défaut) et par
âge (`NOVACORE_BACKUP_MAX_AGE_DAYS`, 30 jours par défaut, `0` pour désactiver). Un `.json.enc`
que la clé courante n’ouvre pas **ne compte pas** dans le quota : un retour à la bonne clé
conserve donc les sauvegardes lisibles au lieu de les voir chassées par les fichiers
indéchiffrables. Après une corruption sans sauvegarde lisible, la restauration est
**retentée au démarrage suivant** (`restore_pending` en `meta`), sans jamais écraser des
comptes créés entre-temps.

---

## 6. Reconnaissance

Les personnes qui signalent un défaut conformément à cette politique sont mentionnées ici
uniquement avec leur accord explicite. Aucun nom n’est publié sans demande de leur part.

---

## 7. Ce que ce document ne prétend pas

- NovaCore **n’a pas fait l’objet d’un audit de sécurité indépendant** à la date de ce document.
- Le déploiement de référence est **mono-instance** (SQLite). Le multi-instance demanderait
  un autre stockage et un autre limiteur de débit ; il n’est pas supporté.
- Les **sauvegardes locales sont chiffrées en AES-256-GCM depuis 3.10.0**, mais la clé par
  défaut (`backup-key`) vit dans le même dossier de données : ce n’est **pas** un chiffrement
  de bout en bout ni une protection contre une compromission complète de la machine. Pour
  séparer la clé des sauvegardes, utilise `NOVACORE_BACKUP_KEY` et conserve-la ailleurs.
  Une clé perdue rend les `.json.enc` illisibles ; aucune sauvegarde n’est alors supprimée
  automatiquement.
- Les **archives de migration/restauration** issues d’anciens fichiers en clair
  (`novacore.imported-*.json`, `novacore.restored-*.json`, `novacore.legacy-import-*.json`)
  ne sont **ni chiffrées ni purgées** par la rotation de `backups/` : après avoir vérifié que
  la base et les nouvelles sauvegardes sont exploitables, supprime-les manuellement si tu ne
  veux conserver aucune donnée en clair hors du dossier de sauvegardes.
- La base SQLite elle-même (`novacore.sqlite`) **n’est pas chiffrée** : elle reste protégée
  par les droits du système d’exploitation et, le cas échéant, par le chiffrement du disque.
- La CSP contient encore `'unsafe-inline'` pour les scripts (interface historique) ; c’est une
  limite connue, pas une affirmation de sécurité.
- Les en-têtes HSTS ne sont émis qu’en production et ne protègent que si le site est servi en
  HTTPS réel.
