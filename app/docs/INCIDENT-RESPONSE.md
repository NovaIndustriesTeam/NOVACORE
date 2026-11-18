# Réponse aux incidents — NovaCore

Procédure opérationnelle. Elle décrit ce qui est **réellement disponible** dans le code
(`server/`, `data/`) et ce qui reste manuel. Aucune étape ne suppose un outil qui n’existe pas.

Dernière révision : 14 novembre 2026 — NovaCore 3.10.0.

---

## 0. Cinq minutes, dans l’ordre

1. **Ne répare rien tout de suite.** Une réparation destructive détruit les preuves.
2. **Isoler** : retirer l’exposition Internet (pare-feu, reverse proxy, arrêt du conteneur).
   Garder la machine allumée et le disque intact.
3. **Copier** le dossier de données (`NOVACORE_DATA_DIR`, par défaut
   `%USERPROFILE%\.novacore\data` ou `~/.novacore/data`) et les journaux du serveur.
4. **Révoquer** tous les jetons : nouveau `JWT_SECRET` (voir § 4.1).
5. **Décider** s’il s’agit d’un incident de données personnelles (voir § 6).

---

## 1. Qualifier

| Gravité | Critère | Délai de réaction visé |
|---|---|---|
| **Critique** | accès ou modification des données d’un autre compte, exécution de code, secret exposé publiquement | immédiat |
| **Haute** | contournement d’authentification probable, fuite de secrets limitée, corruption de données | < 4 h |
| **Moyenne** | défaut nécessitant un compte valide et des conditions difficiles | < 1 jour ouvré |
| **Basse** | durcissement, en-tête manquant, information divulguée sans impact direct | prochaine livraison |

Un doute entre deux niveaux se tranche **vers le haut**.

---

## 2. Sources de détection réellement disponibles

| Source | Ce qu’elle contient | Où |
|---|---|---|
| Journaux HTTP (morgan) | identifiant de requête, méthode, chemin **sans query string**, statut, durée | sortie standard du processus |
| `events` (SQLite) | création de compte, connexion, révocation, imports, plugins, messages IA | table `events`, via `GET /api/analytics` (compte concerné) |
| `GET /api/ready` | état du stockage, compteurs, résultat de migration, avis de récupération | HTTP |
| `GET /api/diagnostics` | version, mémoire, plateforme (authentifié en production) | HTTP |
| `data/backups/*.json.enc` | sauvegardes chiffrées AES-256-GCM, rotation par nombre (`NOVACORE_BACKUP_KEEP`, 14) et par âge (`NOVACORE_BACKUP_MAX_AGE_DAYS`, 30 j) ; les fichiers qu’une clé erreur n’ouvre pas sont conservés et hors quota | dossier de données |
| `<NOVACORE_DATA_DIR>/backup-key` | clé locale des sauvegardes (0600) si `NOVACORE_BACKUP_KEY` n’est pas fournie ; jamais écrasée si invalide | dossier de données |
| Base corrompue | mise en quarantaine `novacore.sqlite.corrupt-<horodatage>` et restauration automatique ; seules les erreurs structurelles (`SQLITE_CORRUPT`, `SQLITE_NOTADB`, `integrity_check`) la déclenchent | dossier de données |
| `meta.restore_pending` / `meta.recovery_notice` | restauration impossible à retenter au démarrage suivant et dernier incident de récupération persistant | table `meta` (SQLite) |

Ce qui **n’existe pas** : alerting automatique, SIEM, trace d’audit signée, journal immuable.
Si l’incident exige ces éléments, ils sont à mettre en place après coup, pas pendant.

---

## 3. Confinement

1. Couper l’accès public (reverse proxy / pare-feu). Ne pas laisser l’instance accessible
   « pour observer ».
2. Si le Workbench n’est pas nécessaire, ne pas le relancer : il est exposé via `/nova-engine`
   et exige un NovaID vérifié, mais réduit la surface.
3. Désactiver le mode développeur : `NOVACORE_DEV_MODE` absent ou `0`.
4. En production, vérifier que `NOVACORE_ALLOW_DEV_MODE` n’est pas `1` et que
   `NOVACORE_DEV_CODE` n’est pas la valeur de repli.
5. Conserver une copie **en lecture seule** des éléments du § 0.3 avant toute manipulation.

---

## 4. Révocation des secrets et des sessions

### 4.1 `JWT_SECRET` — invalide tous les jetons

```powershell
# Générer un secret fort et le placer dans l'environnement du service
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Puis redémarrer le service avec la nouvelle valeur. Effets :

- tous les jetons NovaID déjà émis renvoient `401` : chaque personne doit se reconnecter ;
- en développement, le secret persistant se trouve dans `<NOVACORE_DATA_DIR>/jwt-secret` ;
  le remplacer produit le même effet ;
- ne jamais réutiliser l’ancien secret, même « le temps de la transition ».

### 4.2 Sessions d’un compte précis

`POST /api/auth/logout-all` (authentifié) incrémente `token_version` et révoque immédiatement
tous les jetons de ce compte. À faire depuis un jeton encore valide, ou en base si le compte
est suspect :

```sql
-- à exécuter sur une copie, jamais directement pendant l'analyse
UPDATE users SET token_version = token_version + 1 WHERE email = 'adresse@exemple.tld';
```

### 4.3 Autres secrets

| Secret | Action |
|---|---|
| `SMTP_PASS` | révoquer côté fournisseur, régénérer, redémarrer |
| `AI_CLOUD_API_KEY` | révoquer côté fournisseur, régénérer, redémarrer |
| `NOVACORE_DEV_CODE` | remplacer par une valeur longue et unique |
| `NOVACORE_BACKUP_KEY` | si la clé a pu fuiter : lire § 4.4 avant toute rotation |

Les secrets vivent uniquement dans l’environnement du serveur. S’ils ont été collés dans un
fichier, un ticket ou une conversation, considère-les comme publics.

### 4.4 Clé de sauvegarde — rotation prudente

1. **Ne supprime rien avant d’avoir vérifié une sauvegarde lisible.** Copie `backups/` et la
   clé actuelle hors de la machine, puis déchiffre un fichier pour prouver qu’il est exploitable.
2. Génère une nouvelle clé : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
   place-la dans `NOVACORE_BACKUP_KEY`, redémarre.
3. Déclenche une écriture réelle (ou une action qui sauvegarde) et vérifie dans
   `GET /api/ready` : `backup.enabled: true`, `backup.keySource: "environment"`,
   `backup.encryptedCount` en hausse, `backup.unreadable` vide.
4. Seulement ensuite, déplace les anciens `.json.enc` vers une archive hors ligne. L’application
   ne les supprime pas d’elle-même tant qu’ils sont illisibles. Si la clé a fuité, ne les garde
   pas : ils sont lisibles par le tiers.
5. `NOVACORE_BACKUP_KEY` invalide = **aucune sauvegarde** (pas de repli en clair). `GET /api/ready`
   n’expose que des **codes normalisés** (`BACKUP_KEY_ENV_INVALID`, `BACKUP_KEY_FILE_UNREADABLE`,
   `BACKUP_KEY_FILE_INVALID`, `BACKUP_WRITE_FAILED`) — jamais un chemin système. Corrige la
   cause avant de continuer. Un fichier `backup-key` présent mais invalide n’est **jamais**
   écrasé : son contenu reste intact pour une récupération hors ligne.

---

## 5. Analyse et restauration

1. Copier la base et les sauvegardes, puis travailler **sur la copie**.
2. Vérifier l’intégrité : `GET /api/ready` doit répondre `ready: true` et exposer
   `migration` / `recovery` sans erreur.
3. Comparer les journaux HTTP aux événements `events` du compte suspect (même fenêtre horaire).
4. Si les données sont corrompues : arrêter le service, conserver
   `novacore.sqlite.corrupt-*`, puis restaurer une sauvegarde vérifiée. Le mécanisme
   `db.js` restaure automatiquement depuis `data/backups` au démarrage, en déchiffrant les
   `.json.enc` avec la clé courante (ou en lisant les anciens `.json` en clair). Une
   restauration manuelle consiste à copier la sauvegarde choisie en `novacore.json` **avant**
   le démarrage (une sauvegarde chiffrée doit d’abord être déchiffrée avec sa clé, jamais avec
   une autre) et à laisser l’import unique s’exécuter.
5. Si aucune sauvegarde chiffrée n’est lisible : vérifier `GET /api/ready` →
   `backup.keyError`, `backup.unreadable`, puis la provenance de la clé
   (`NOVACORE_BACKUP_KEY` ou `backup-key`). Une clé perdue ne se reconstitue pas ; les
   fichiers restent conservés pour une récupération hors ligne. Une base vide créée faute de
   source lisible porte `recovery.pending: true` et `restore_pending` en `meta` : la
   restauration est **retentée au démarrage suivant** dès que la bonne clé est disponible,
   sans écraser des comptes créés entre-temps (l’avis est alors marqué `skipped`).
6. Après restauration : contrôle des comptes, des `token_version`, des `plugin_prefs` et des
   derniers événements. Consigner ce qui a été vérifié et ce qui ne l’a pas été.

**Ne jamais restaurer une sauvegarde non vérifiée par-dessus une base encore lisible sans en
avoir gardé une copie.**

---

## 6. Notification

Si des **données personnelles** (adresse e-mail, nom affiché, contenu du workspace) ont pu
être exposées :

- informer les personnes concernées de façon factuelle : quoi, quand, quelles données,
  ce qui a été fait, ce qu’elles doivent faire (changer le mot de passe, se déconnecter
  partout) ;
- en France / Union européenne, un responsable de traitement peut avoir une obligation de
  notification à la CNIL sous 72 h. **Cette décision relève du responsable de traitement,
  pas de l’agent qui corrige le code.** En cas de doute, consulter un juriste ;
- ne pas minimiser publiquement un incident non confirmé, ne pas annoncer un correctif
  qui n’est pas déployé.

---

## 7. Post-mortem (à remplir dans les 5 jours ouvrés)

```markdown
## Incident — AAAA-MM-JJ

- Détecté le / par :
- Gravité retenue :
- Chronologie (heures, fuseau) :
- Cause racine :
- Impact réel vérifié (comptes, données, durée) :
- Ce qui a fonctionné :
- Ce qui a manqué (outil, procédure, test) :
- Correctif livré + test qui échouait avant :
- Actions de prévention (responsable, date) :
- Communication effectuée (canal, date) :
```

Règle : un post-mortem sans **test de non-régression** ajouté au dépôt est incomplet.

---

## 8. Exercice de répétition (à faire avant toute exposition publique)

1. Sur une base de test, simuler une corruption : renommer `novacore.sqlite` puis démarrer.
2. Vérifier que la restauration automatique se produit et que `/api/ready` l’indique
   (`recovery.restoredFrom` doit pointer un `.json.enc`).
3. Redémarrer avec une **autre** `NOVACORE_BACKUP_KEY` : la base doit rester lisible, les
   anciennes sauvegardes doivent apparaître dans `backup.unreadable` et **ne pas** être supprimées.
   Corrompre à nouveau la base dans cet état : `/api/ready` doit exposer `recovery.pending: true`
   (restauration impossible). Redémarrer avec la **bonne** clé : la restauration différée doit
   s’exécuter et `recovery.retried` valoir `true`.
4. Changer `JWT_SECRET`, redémarrer, vérifier qu’un jeton émis avant renvoie `401`.
5. Vérifier que `POST /api/auth/logout-all` invalide une session existante.
6. Vérifier qu’un `Host` forgé ne modifie pas `Canonical`/`Policy` de
   `/.well-known/security.txt` lorsque `NOVACORE_ALLOWED_ORIGINS` (ou `PUBLIC_BASE_URL`) est déclaré.
7. Inventorier les archives en clair `novacore.imported-*.json`, `novacore.restored-*.json` et
   `novacore.legacy-import-*.json` dans le dossier de données, vérifier la base et les
   sauvegardes chiffrées, puis les supprimer si aucune donnée en clair ne doit subsister.
8. Chronométrer l’ensemble. Si l’exercice dépasse 30 minutes, la procédure doit être simplifiée.

Ces points sont couverts par la suite automatisée : `test/api.test.js` exécute la mise en quarantaine
puis la restauration automatique (« données corrompues ») et la révocation d’un jeton par
« déconnecter tous les appareils » ; `test/backup-encryption.test.js` (**13 tests**) couvre le
chiffrement, la restauration depuis un `.json.enc`, le refus d’une mauvaise clé sans suppression,
le retour à la bonne clé après passage par une clé erronée (quota non consommé par les fichiers
illisibles), la reprise d’une restauration impossible, la conservation d’un `backup-key`
invalide, et la rétention par nombre et par âge ; `test/security-hardening.test.js` (**8 tests**)
vérifie qu’un jeton émis avant un changement de `JWT_SECRET` est refusé, qu’un nouveau jeton
fonctionne et qu’une origine déclarée prime sur un `Host` forgé ;
`test/security.test.js` couvre la persistance du secret de développement. Ces tests ne
remplacent pas une répétition sur une copie de données réelles : aucune mesure de durée n’est
fournie ici, c’est justement l’objet de l’exercice.
