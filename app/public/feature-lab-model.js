/* Nova Feature Lab 3.2 — catalogue pur des 50 modules, partagé entre le navigateur et les tests Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NovaFeatureLabModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CATEGORIES = ['Apparence', 'Accessibilité', 'Productivité', 'Intelligence', 'Sécurité', 'Développement', 'Analyse', 'Cloud'];

  // Chaque module possède une action réelle. `preference` = réglage visuel appliqué en direct.
  const FEATURES = [
    { id: 'liquid-glass', name: 'Palette Liquid Glass', category: 'Apparence', description: 'Interface translucide, floue et profonde', action: 'page:account', verb: 'Voir les réglages', preference: 'liquidGlass', defaultOn: true },
    { id: 'supernova', name: 'Supernova orbitale', category: 'Apparence', description: 'Étoile animée en arrière-plan', action: 'effect:supernova', verb: 'Tester l’effet', preference: 'supernova', defaultOn: true },
    { id: 'high-contrast', name: 'Mode contraste', category: 'Accessibilité', description: 'Renforce la lisibilité des textes et des bordures', action: 'toggle:self', verb: 'Basculer', preference: 'highContrast', defaultOn: false },
    { id: 'reduced-motion', name: 'Animations réduites', category: 'Accessibilité', description: 'Respecte la préférence de mouvement', action: 'toggle:self', verb: 'Basculer', preference: 'reducedMotion', defaultOn: false },
    { id: 'compact', name: 'Interface compacte', category: 'Accessibilité', description: 'Réduit les espacements pour afficher plus d’informations', action: 'toggle:self', verb: 'Basculer', preference: 'compact', defaultOn: false },
    { id: 'dynamic-accent', name: 'Accent dynamique', category: 'Apparence', description: 'Couleur d’accent personnalisable en un clic', action: 'cycle:accent', verb: 'Changer', defaultOn: true },
    { id: 'sound', name: 'Ambiance sonore', category: 'Apparence', description: 'Sons d’interface synthétisés, discrets et coupables', action: 'sound:test', verb: 'Écouter', preference: 'sound', defaultOn: false },
    { id: 'starfield', name: 'Fond étoilé', category: 'Apparence', description: 'Nébuleuse et étoiles en mouvement', action: 'effect:starfield', verb: 'Tester l’effet', preference: 'starfield', defaultOn: true },
    { id: 'intro', name: 'Intro cinématique', category: 'Apparence', description: 'Écran de démarrage animé, rejouable à la demande', action: 'intro:replay', verb: 'Rejouer', preference: 'intro', defaultOn: true },
    { id: 'quick-search', name: 'Recherche rapide', category: 'Productivité', description: 'Ouvrir la palette de commandes avec Ctrl+K', action: 'palette:open', verb: 'Ouvrir', defaultOn: true },
    { id: 'quick-capture', name: 'Capture rapide', category: 'Productivité', description: 'Créer une note en un clic', action: 'note:quick', verb: 'Créer', defaultOn: true },
    { id: 'quick-task', name: 'Tâche express', category: 'Productivité', description: 'Créer une tâche immédiatement', action: 'task:quick', verb: 'Créer', defaultOn: true },
    { id: 'pomodoro', name: 'Focus Pomodoro', category: 'Productivité', description: 'Lancer une session concentrée de 25 minutes', action: 'focus:start', verb: 'Lancer', defaultOn: true },
    { id: 'journal', name: 'Journal quotidien', category: 'Productivité', description: 'Ajouter une note de journal datée du jour', action: 'journal:today', verb: 'Écrire', defaultOn: true },
    { id: 'project-goals', name: 'Objectifs de projet', category: 'Productivité', description: 'Suivre l’avancement réel des projets', action: 'page:projects', verb: 'Ouvrir', defaultOn: true },
    { id: 'reminders', name: 'Rappels visuels', category: 'Productivité', description: 'Mettre en avant les tâches ouvertes et en retard', action: 'modal:reminders', verb: 'Voir', defaultOn: true },
    { id: 'studio-roadmap', name: 'Roadmap studio', category: 'Productivité', description: 'Planifier les prochaines versions', action: 'page:roadmap', verb: 'Ouvrir', defaultOn: true },
    { id: 'focus-history', name: 'Historique Focus', category: 'Productivité', description: 'Consulter les sessions de concentration terminées', action: 'page:focus', verb: 'Consulter', defaultOn: true },
    { id: 'calendar', name: 'Vue calendrier', category: 'Productivité', description: 'Afficher le planning réel de la semaine', action: 'page:calendar', verb: 'Ouvrir', defaultOn: true },
    { id: 'ai-hybrid', name: 'Nova AI hybride', category: 'Intelligence', description: 'Routage local et cloud configurable', action: 'page:ai', verb: 'Ouvrir', defaultOn: true },
    { id: 'code-assistant', name: 'Assistant code', category: 'Intelligence', description: 'Aide au développement via Nova AI', action: 'ai:code', verb: 'Demander', defaultOn: true },
    { id: 'notes-summary', name: 'Résumé de notes', category: 'Intelligence', description: 'Générer une synthèse locale des notes réelles', action: 'modal:notes-summary', verb: 'Générer', defaultOn: true },
    { id: 'idea-generator', name: 'Générateur d’idées', category: 'Intelligence', description: 'Brainstorming contextuel depuis tes projets et notes', action: 'modal:ideas', verb: 'Générer', defaultOn: true },
    { id: 'debug', name: 'Aide au débogage', category: 'Intelligence', description: 'Analyser une erreur avec le prompt NOVAI adapté', action: 'ai:debug', verb: 'Analyser', defaultOn: true },
    { id: 'ollama', name: 'Modèles Ollama', category: 'Intelligence', description: 'Détecter les modèles locaux disponibles', action: 'modal:ollama', verb: 'Détecter', defaultOn: true },
    { id: 'knowledge-search', name: 'Recherche de connaissances', category: 'Intelligence', description: 'Retrouver les ressources enregistrées', action: 'page:knowledge', verb: 'Chercher', defaultOn: true },
    { id: 'prompts', name: 'Prompts favoris', category: 'Intelligence', description: 'Garder et réutiliser tes prompts dans NOVAI', action: 'modal:prompts', verb: 'Gérer', defaultOn: true },
    { id: 'private', name: 'Mode privé local', category: 'Sécurité', description: 'Suspendre la synchronisation cloud et garder les données ici', action: 'modal:private', verb: 'Gérer', preference: 'privateMode', defaultOn: false },
    { id: 'export-backup', name: 'Export de sauvegarde', category: 'Sécurité', description: 'Télécharger toutes les données en JSON', action: 'download:backup', verb: 'Exporter', defaultOn: true },
    { id: 'import-backup', name: 'Import de sauvegarde', category: 'Sécurité', description: 'Restaurer un fichier JSON exporté', action: 'import:backup', verb: 'Importer', defaultOn: true },
    { id: 'novaid', name: 'Centre NovaID', category: 'Sécurité', description: 'Gérer la connexion, la vérification et le compte', action: 'page:account', verb: 'Ouvrir', defaultOn: true },
    { id: 'api-status', name: 'État API', category: 'Développement', description: 'Tester la disponibilité réelle du serveur local', action: 'modal:health', verb: 'Tester', defaultOn: true },
    { id: 'api-explorer', name: 'Explorateur API', category: 'Développement', description: 'Voir les endpoints documentés', action: 'page:api', verb: 'Explorer', defaultOn: true },
    { id: 'snippets', name: 'Éditeur snippets', category: 'Développement', description: 'Sauvegarder du code en local', action: 'page:studio', verb: 'Éditer', defaultOn: true },
    { id: 'export-snippet', name: 'Export de snippet', category: 'Développement', description: 'Télécharger le fichier de code actif', action: 'download:snippet', verb: 'Télécharger', defaultOn: true },
    { id: 'system-log', name: 'Journal système', category: 'Développement', description: 'Voir les diagnostics serveur', action: 'page:system', verb: 'Consulter', defaultOn: true },
    { id: 'releases', name: 'Roadmap releases', category: 'Développement', description: 'Suivre les jalons et versions', action: 'page:roadmap', verb: 'Suivre', defaultOn: true },
    { id: 'plugins', name: 'Catalogue plugins', category: 'Développement', description: 'Gérer les extensions proposées', action: 'page:plugins', verb: 'Gérer', defaultOn: true },
    { id: 'workspace-stats', name: 'Statistiques workspace', category: 'Analyse', description: 'Suivre projets, notes et tâches', action: 'page:analytics', verb: 'Ouvrir', defaultOn: true },
    { id: 'task-count', name: 'Compteur de tâches', category: 'Analyse', description: 'Visualiser le travail restant', action: 'modal:task-stats', verb: 'Voir', defaultOn: true },
    { id: 'project-progress', name: 'Progression projets', category: 'Analyse', description: 'Mesurer l’avancement global', action: 'modal:project-stats', verb: 'Voir', defaultOn: true },
    { id: 'note-count', name: 'Compteur de notes', category: 'Analyse', description: 'Suivre les idées enregistrées', action: 'modal:note-stats', verb: 'Voir', defaultOn: true },
    { id: 'focus-duration', name: 'Durée de concentration', category: 'Analyse', description: 'Mesurer le temps Focus cumulé', action: 'modal:focus-stats', verb: 'Voir', defaultOn: true },
    { id: 'server-health', name: 'Santé du serveur', category: 'Analyse', description: 'Consulter uptime, stockage et mémoire', action: 'modal:health', verb: 'Consulter', defaultOn: true },
    { id: 'cloud-push', name: 'Synchronisation manuelle', category: 'Cloud', description: 'Envoyer les données vers NovaCloud', action: 'cloud:push', verb: 'Synchroniser', defaultOn: true },
    { id: 'cloud-pull', name: 'Récupération cloud', category: 'Cloud', description: 'Restaurer le workspace connecté', action: 'cloud:pull', verb: 'Récupérer', defaultOn: true },
    { id: 'local-space', name: 'Espace local', category: 'Cloud', description: 'Continuer sans compte cloud', action: 'page:overview', verb: 'Ouvrir', defaultOn: true },
    { id: 'shortcuts', name: 'Clavier rapide', category: 'Productivité', description: 'Afficher les raccourcis clavier disponibles', action: 'modal:shortcuts', verb: 'Voir', defaultOn: true },
    { id: 'micro', name: 'Micro-interactions', category: 'Apparence', description: 'Transitions douces sur les cartes et les boutons', action: 'toggle:self', verb: 'Basculer', preference: 'microInteractions', defaultOn: true },
    { id: 'personalization', name: 'Centre de personnalisation', category: 'Apparence', description: 'Régler thème, accent, texte et transparence', action: 'page:account', verb: 'Personnaliser', defaultOn: true }
  ];

  const PREFERENCE_KEYS = FEATURES.filter(feature => feature.preference).map(feature => feature.preference);

  function normalizeFlags(saved) {
    const source = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    const flags = {};
    FEATURES.forEach((feature, index) => {
      if (typeof source[feature.id] === 'boolean') flags[feature.id] = source[feature.id];
      else if (typeof source[index] === 'boolean') flags[feature.id] = source[index];
      else flags[feature.id] = feature.defaultOn !== false;
    });
    return flags;
  }

  function activeCount(flags) {
    const resolved = normalizeFlags(flags);
    return FEATURES.filter(feature => resolved[feature.id]).length;
  }

  function filterFeatures(query, category, features) {
    const list = Array.isArray(features) ? features : FEATURES;
    const needle = String(query || '').trim().toLowerCase();
    const wanted = category && category !== 'all' ? String(category) : '';
    return list.filter(feature => {
      if (wanted && feature.category !== wanted) return false;
      if (!needle) return true;
      return `${feature.name} ${feature.category} ${feature.description}`.toLowerCase().includes(needle);
    });
  }

  function categoryCounts(features) {
    const list = Array.isArray(features) ? features : FEATURES;
    return CATEGORIES.map(category => ({
      category,
      total: list.filter(feature => feature.category === category).length
    }));
  }

  function completion(features) {
    const list = Array.isArray(features) ? features : FEATURES;
    const implemented = list.filter(feature => typeof feature.action === 'string' && feature.action.length > 0).length;
    return {
      total: list.length,
      implemented,
      concepts: list.length - implemented,
      percent: list.length ? Math.round((implemented / list.length) * 100) : 0
    };
  }

  function findFeature(value) {
    if (typeof value === 'number') return FEATURES[value] || null;
    return FEATURES.find(feature => feature.id === value) || null;
  }

  function actionTarget(feature) {
    if (!feature || typeof feature.action !== 'string') return null;
    const separator = feature.action.indexOf(':');
    if (separator === -1) return { kind: feature.action, value: '' };
    return { kind: feature.action.slice(0, separator), value: feature.action.slice(separator + 1) };
  }

  return {
    CATEGORIES,
    FEATURES,
    PREFERENCE_KEYS,
    normalizeFlags,
    activeCount,
    filterFeatures,
    categoryCounts,
    completion,
    findFeature,
    actionTarget
  };
});
