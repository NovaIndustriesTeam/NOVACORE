/* NovaCore 3.10.0 — bus de commandes local pour NOVAI.
   NOVAI ne reçoit jamais d'accès direct aux fichiers, au réseau ou à `eval` :
   le serveur renvoie une liste d'actions JSON, ce module valide chaque type
   contre une liste blanche puis exécute l'action avec les fonctions locales
   de NovaCore. Toute suppression exige `confirmed: true` (confirmation UI).
   API : window.NovaCommands = { run, label, catalog, pages, collections }. */
(() => {
  'use strict';

  const PAGES = ['overview', 'projects', 'tasks', 'notes', 'calendar', 'focus', 'knowledge', 'studio',
    'novaengine', 'novaseries', 'novastore', 'retroedge', 'ai', 'learnlab', 'cloud', 'plugins', 'api',
    'automation', 'analytics', 'account', 'roadmap', 'search', 'system', 'developer', 'featurelab', 'anim3d'];

  const PAGE_LABELS = {
    overview: 'NovaOS', projects: 'Projets', tasks: 'Tâches', notes: 'Notes', calendar: 'Calendrier',
    focus: 'Nova Focus', knowledge: 'Knowledge Base', studio: 'Code Studio', novaengine: 'Nova Engine',
    novaseries: 'NovaSeries Studio', novastore: 'NovaStore', retroedge: 'RetroEdge', ai: 'NOVAI',
    learnlab: 'Learn Lab', cloud: 'NovaCloud', plugins: 'NovaPlugins', api: 'API Explorer',
    automation: 'Automations', analytics: 'Analytics', account: 'Compte & sécurité', roadmap: 'Roadmap',
    search: 'Recherche globale', system: 'Centre système', developer: 'Mode développeur',
    featurelab: 'Nova Feature Lab', anim3d: 'Studio 3D'
  };

  const PRIORITIES = ['Haute', 'Moyenne', 'Basse'];
  const TRIGGERS = { manual: 'manual', manuel: 'manual', startup: 'startup', 'démarrage': 'startup', focus: 'focus', session: 'focus' };
  const THEMES = ['dark', 'light', 'midnight', 'emerald', 'sunset'];
  const ACCENTS = ['purple', 'cyan', 'green', 'pink', 'orange'];
  const FONT_SCALES = ['normal', 'large', 'xlarge'];
  const BOOLEAN_SETTINGS = ['animations', 'glow', 'compact', 'performanceMode'];
  const COLLECTIONS = { projects: 'Projets', tasks: 'Tâches', notes: 'Notes', knowledge: 'Ressources', automations: 'Automatisations', roadmap: 'Roadmap' };

  const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  const dailyKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fail = message => ({ ok: false, message });
  const ready = () => typeof state !== 'undefined' && typeof saveLocal === 'function' && typeof render === 'function';
  const commit = detail => { try { if (typeof logDashboardActivity === 'function') logDashboardActivity(detail.title, detail.type, detail.text); } catch { /* journal facultatif */ } saveLocal(); render(); };

  function findItem(collection, id) {
    if (!COLLECTIONS[collection] || !Array.isArray(state[collection])) return null;
    return state[collection].find(item => item && String(item.id) === String(id)) || null;
  }

  function itemTitle(collection, item) {
    return clean(item && (item.title || item.name || item.label), 80) || 'élément';
  }

  function label(action) {
    const type = String(action && action.type || '');
    switch (type) {
      case 'navigate': return `Ouvrir ${PAGE_LABELS[String(action.page || '')] || clean(action.page, 40) || 'une page'}`;
      case 'create_project': return `Créer le projet « ${clean(action.name, 70) || 'sans titre'} »`;
      case 'create_task': return `Créer la tâche « ${clean(action.title, 70) || 'sans titre'} »`;
      case 'create_note': return `Créer la note « ${clean(action.title, 70) || 'sans titre'} »`;
      case 'create_knowledge': return `Ajouter la ressource « ${clean(action.title, 70) || 'sans titre'} »`;
      case 'create_roadmap': return `Ajouter à la roadmap « ${clean(action.title, 70) || 'sans titre'} »`;
      case 'create_automation': return `Créer l’automatisation « ${clean(action.name, 70) || 'sans titre'} »`;
      case 'search': return `Rechercher « ${clean(action.query, 60)} »`;
      case 'set_setting': return `Régler ${clean(action.key, 30)} sur ${clean(action.value, 30)}`;
      case 'delete_item': {
        const item = findItem(String(action.collection || ''), action.id);
        return `Supprimer ${COLLECTIONS[String(action.collection || '')] || 'un élément'} · ${item ? itemTitle(String(action.collection), item) : clean(action.id, 40)}`;
      }
      default: return clean(type, 40) || 'Action';
    }
  }

  const HANDLERS = {
    navigate(action) {
      const page = clean(action.page, 40);
      if (!PAGES.includes(page)) return fail('Page inconnue.');
      if (typeof setPage !== 'function') return fail('Navigation indisponible.');
      setPage(page, { history: 'push' });
      return { ok: true, message: `Page ouverte : ${PAGE_LABELS[page]}.` };
    },
    create_project(action) {
      const name = clean(action.name, 120);
      if (!name) return fail('Le nom du projet est vide.');
      state.projects = Array.isArray(state.projects) ? state.projects : [];
      state.projects.unshift({ id: uid(), name, description: clean(action.description, 600), progress: 0 });
      commit({ title: 'Projet créé : ' + name, type: 'project', text: 'Action NOVAI' });
      return { ok: true, message: `Projet créé : ${name}.` };
    },
    create_task(action) {
      const title = clean(action.title, 160);
      if (!title) return fail('Le titre de la tâche est vide.');
      const priority = PRIORITIES.includes(action.priority) ? action.priority : 'Moyenne';
      const due = isDate(action.due) ? String(action.due) : '';
      state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
      state.tasks.unshift({ id: uid(), title, project: clean(action.project, 120), priority, due, done: false });
      commit({ title: 'Tâche créée : ' + title, type: 'task', text: 'Priorité ' + priority });
      return { ok: true, message: `Tâche créée : ${title}.` };
    },
    create_note(action) {
      const title = clean(action.title, 160);
      if (!title) return fail('Le titre de la note est vide.');
      state.notes = Array.isArray(state.notes) ? state.notes : [];
      state.notes.unshift({ id: uid(), title, content: String(action.content || '').slice(0, 4000), date: new Date().toISOString() });
      commit({ title: 'Note créée : ' + title, type: 'note', text: 'Action NOVAI' });
      return { ok: true, message: `Note créée : ${title}.` };
    },
    create_knowledge(action) {
      const title = clean(action.title, 160);
      if (!title) return fail('Le titre de la ressource est vide.');
      const tags = Array.isArray(action.tags) ? action.tags.map(tag => clean(tag, 30)).filter(Boolean).slice(0, 8) : [];
      state.knowledge = Array.isArray(state.knowledge) ? state.knowledge : [];
      state.knowledge.unshift({ id: uid(), title, content: String(action.content || '').slice(0, 4000), tags, date: new Date().toISOString() });
      commit({ title: 'Ressource créée : ' + title, type: 'knowledge', text: 'Action NOVAI' });
      return { ok: true, message: `Ressource créée : ${title}.` };
    },
    create_roadmap(action) {
      const title = clean(action.title, 120);
      if (!title) return fail('Le titre du jalon est vide.');
      state.roadmap = Array.isArray(state.roadmap) ? state.roadmap : [];
      state.roadmap.unshift({
        id: uid(), title, detail: clean(action.detail, 500), area: clean(action.area, 60) || 'NovaCore',
        status: clean(action.status, 40) || 'À planifier',
        priority: PRIORITIES.includes(action.priority) ? action.priority : 'Moyenne'
      });
      commit({ title: 'Jalon ajouté : ' + title, type: 'roadmap', text: 'Action NOVAI' });
      return { ok: true, message: `Jalon ajouté : ${title}.` };
    },
    create_automation(action) {
      const name = clean(action.name, 120);
      if (!name) return fail('Le nom de l’automatisation est vide.');
      state.automations = Array.isArray(state.automations) ? state.automations : [];
      state.automations.unshift({
        id: uid(), name, description: clean(action.description, 400),
        trigger: TRIGGERS[String(action.trigger || '').toLowerCase()] || 'manual',
        enabled: true, lastRunAt: null, runCount: 0
      });
      commit({ title: 'Automatisation créée : ' + name, type: 'automation', text: 'Action NOVAI' });
      return { ok: true, message: `Automatisation créée : ${name}.` };
    },
    search(action) {
      const query = clean(action.query, 120);
      if (!query) return fail('La recherche est vide.');
      if (typeof setPage !== 'function') return fail('Recherche indisponible.');
      setPage('search', { history: 'push' });
      setTimeout(() => {
        const input = document.getElementById('globalSearchInput');
        if (input) { input.value = query; }
        if (typeof runGlobalSearch === 'function') runGlobalSearch();
      }, 0);
      return { ok: true, message: `Recherche lancée : ${query}.` };
    },
    set_setting(action) {
      const key = clean(action.key, 30);
      if (key === 'theme') {
        const value = clean(action.value, 20);
        if (!THEMES.includes(value)) return fail('Thème non autorisé.');
        setTheme(value);
        return { ok: true, message: `Thème appliqué : ${value}.` };
      }
      if (key === 'accent') {
        const value = clean(action.value, 20);
        if (!ACCENTS.includes(value)) return fail('Couleur non autorisée.');
        setAccent(value);
        return { ok: true, message: `Accent appliqué : ${value}.` };
      }
      if (key === 'fontScale') {
        const value = clean(action.value, 20);
        if (!FONT_SCALES.includes(value)) return fail('Taille de texte non autorisée.');
        setFontScale(value);
        return { ok: true, message: `Taille du texte : ${value}.` };
      }
      if (key === 'language') {
        const value = clean(action.value, 5).toLowerCase();
        if (!['fr', 'en'].includes(value)) return fail('Langue non autorisée.');
        if (typeof window.setLanguage === 'function') window.setLanguage(value);
        return { ok: true, message: `Langue : ${value}.` };
      }
      if (BOOLEAN_SETTINGS.includes(key)) {
        const value = action.value === true || action.value === 'true' || action.value === 1;
        if (key === 'performanceMode') {
          if (typeof window.setPerformanceMode !== 'function') return fail('Mode performance indisponible.');
          window.setPerformanceMode(value, { silent: true });
          return { ok: true, message: `Mode performance ${value ? 'activé' : 'désactivé'}.` };
        }
        if (typeof setVisualOption !== 'function') return fail('Réglage indisponible.');
        setVisualOption(key, value);
        return { ok: true, message: `Réglage ${key} ${value ? 'activé' : 'désactivé'}.` };
      }
      return fail('Réglage non autorisé.');
    },
    delete_item(action) {
      const collection = String(action.collection || '');
      if (!COLLECTIONS[collection]) return fail('Collection non autorisée.');
      const item = findItem(collection, action.id);
      if (!item) return fail('Élément introuvable ou déjà supprimé.');
      if (action.confirmed !== true) return { ok: false, requiresConfirmation: true, message: 'Confirmation requise avant suppression.' };
      state[collection] = state[collection].filter(entry => entry && String(entry.id) !== String(action.id));
      commit({ title: `Suppression ${collection} : ${itemTitle(collection, item)}`, type: 'delete', text: 'Confirmée par l’utilisateur' });
      return { ok: true, message: `Supprimé : ${itemTitle(collection, item)}.` };
    }
  };

  const CATALOG = [
    { type: 'navigate', description: 'Ouvrir une page de NovaCore.', parameters: { page: PAGES } },
    { type: 'create_project', description: 'Créer un projet.', parameters: { name: 'texte', description: 'texte' } },
    { type: 'create_task', description: 'Créer une tâche.', parameters: { title: 'texte', project: 'texte', priority: PRIORITIES, due: 'AAAA-MM-JJ' } },
    { type: 'create_note', description: 'Créer une note.', parameters: { title: 'texte', content: 'texte' } },
    { type: 'create_knowledge', description: 'Ajouter une ressource à la Knowledge Base.', parameters: { title: 'texte', content: 'texte', tags: 'liste' } },
    { type: 'create_roadmap', description: 'Ajouter un jalon à la roadmap.', parameters: { title: 'texte', detail: 'texte', area: 'texte', status: 'texte', priority: PRIORITIES } },
    { type: 'create_automation', description: 'Créer une automatisation manuelle.', parameters: { name: 'texte', description: 'texte', trigger: Object.keys(TRIGGERS) } },
    { type: 'search', description: 'Lancer une recherche globale.', parameters: { query: 'texte' } },
    { type: 'set_setting', description: 'Modifier un réglage visuel ou le mode performance.', parameters: { key: ['theme', 'accent', 'fontScale', 'language', 'animations', 'glow', 'compact', 'performanceMode'], value: 'selon la clé' } },
    { type: 'delete_item', description: 'Supprimer un élément après confirmation explicite.', parameters: { collection: Object.keys(COLLECTIONS), id: 'identifiant' }, destructive: true }
  ];

  function run(action) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) return fail('Action invalide.');
    const type = String(action.type || '');
    const handler = HANDLERS[type];
    if (!handler) return fail('Action non autorisée.');
    if (!ready()) return fail('Espace de travail indisponible.');
    try {
      return handler(action) || fail('Action sans résultat.');
    } catch (error) {
      console.warn('[NovaCommands]', type, error && error.message);
      return fail('L’action a échoué : ' + (error && error.message ? error.message : 'erreur inconnue'));
    }
  }

  window.NovaCommands = { run, label, catalog: () => CATALOG.map(item => ({ ...item })), pages: () => PAGES.slice(), collections: () => Object.keys(COLLECTIONS), version: 1 };
  window.NovaCommands.today = dailyKey;
})();
