'use strict';
/* NovaCore 3.10.0 — protocole d'actions NOVAI.
   Le modèle ne reçoit aucun accès direct : il peut seulement proposer une liste
   d'actions JSON, validée ici contre une liste blanche stricte, puis exécutée
   côté navigateur par `public/nova-commands.js` (qui revalide chaque type).
   Aucune action destructive n'est exécutée sans confirmation utilisateur. */

const MAX_ACTIONS = 3;

const PAGES = ['overview', 'projects', 'tasks', 'notes', 'calendar', 'focus', 'knowledge', 'studio',
  'novaengine', 'novaseries', 'novastore', 'retroedge', 'ai', 'learnlab', 'cloud', 'plugins', 'api',
  'automation', 'analytics', 'account', 'roadmap', 'search', 'system', 'developer', 'featurelab', 'anim3d'];

const PRIORITIES = ['Haute', 'Moyenne', 'Basse'];
const TRIGGERS = ['manual', 'startup', 'focus'];
const THEMES = ['dark', 'light', 'midnight', 'emerald', 'sunset'];
const ACCENTS = ['purple', 'cyan', 'green', 'pink', 'orange'];
const FONT_SCALES = ['normal', 'large', 'xlarge'];
const BOOLEAN_SETTINGS = ['animations', 'glow', 'compact', 'performanceMode'];
const COLLECTIONS = ['projects', 'tasks', 'notes', 'knowledge', 'automations', 'roadmap'];

const text = (value, max) => String(value === null || value === undefined ? '' : value)
  .replace(/\s+/g, ' ').trim().slice(0, max);

/* Chaque validateur renvoie une action normalisée (champs whitelistés uniquement)
   ou `null` si l'action est invalide. Aucune propriété inconnue ne traverse. */
const VALIDATORS = {
  navigate(raw) {
    const page = String(raw.page || '').trim();
    return PAGES.includes(page) ? { type: 'navigate', page } : null;
  },
  create_project(raw) {
    const name = text(raw.name, 120);
    return name ? { type: 'create_project', name, description: text(raw.description, 600) } : null;
  },
  create_task(raw) {
    const title = text(raw.title, 160);
    if (!title) return null;
    const priority = PRIORITIES.includes(raw.priority) ? raw.priority : 'Moyenne';
    const due = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.due || '')) ? String(raw.due) : '';
    return { type: 'create_task', title, project: text(raw.project, 120), priority, due };
  },
  create_note(raw) {
    const title = text(raw.title, 160);
    return title ? { type: 'create_note', title, content: String(raw.content || '').slice(0, 4000) } : null;
  },
  create_knowledge(raw) {
    const title = text(raw.title, 160);
    if (!title) return null;
    const tags = Array.isArray(raw.tags) ? raw.tags.map(tag => text(tag, 30)).filter(Boolean).slice(0, 8) : [];
    return { type: 'create_knowledge', title, content: String(raw.content || '').slice(0, 4000), tags };
  },
  create_roadmap(raw) {
    const title = text(raw.title, 120);
    if (!title) return null;
    return {
      type: 'create_roadmap', title, detail: text(raw.detail, 500),
      area: text(raw.area, 60) || 'NovaCore', status: text(raw.status, 40) || 'À planifier',
      priority: PRIORITIES.includes(raw.priority) ? raw.priority : 'Moyenne'
    };
  },
  create_automation(raw) {
    const name = text(raw.name, 120);
    if (!name) return null;
    const trigger = TRIGGERS.includes(String(raw.trigger || '').toLowerCase()) ? String(raw.trigger).toLowerCase() : 'manual';
    return { type: 'create_automation', name, description: text(raw.description, 400), trigger };
  },
  search(raw) {
    const query = text(raw.query, 120);
    return query ? { type: 'search', query } : null;
  },
  set_setting(raw) {
    const key = String(raw.key || '').trim();
    if (key === 'theme') { const value = String(raw.value || ''); return THEMES.includes(value) ? { type: 'set_setting', key, value } : null; }
    if (key === 'accent') { const value = String(raw.value || ''); return ACCENTS.includes(value) ? { type: 'set_setting', key, value } : null; }
    if (key === 'fontScale') { const value = String(raw.value || ''); return FONT_SCALES.includes(value) ? { type: 'set_setting', key, value } : null; }
    if (key === 'language') { const value = String(raw.value || '').toLowerCase(); return ['fr', 'en'].includes(value) ? { type: 'set_setting', key, value } : null; }
    if (BOOLEAN_SETTINGS.includes(key)) {
      const value = raw.value === true || raw.value === 'true' || raw.value === 1;
      return { type: 'set_setting', key, value };
    }
    return null;
  },
  delete_item(raw) {
    const collection = String(raw.collection || '').trim();
    const id = text(raw.id, 80);
    return COLLECTIONS.includes(collection) && id ? { type: 'delete_item', collection, id } : null;
  }
};

const ACTION_CATALOG = [
  { type: 'navigate', description: 'Ouvrir une page de NovaCore.', parameters: { page: PAGES } },
  { type: 'create_project', description: 'Créer un projet.', parameters: { name: 'texte', description: 'texte' } },
  { type: 'create_task', description: 'Créer une tâche.', parameters: { title: 'texte', project: 'texte', priority: PRIORITIES, due: 'AAAA-MM-JJ' } },
  { type: 'create_note', description: 'Créer une note.', parameters: { title: 'texte', content: 'texte' } },
  { type: 'create_knowledge', description: 'Ajouter une ressource à la Knowledge Base.', parameters: { title: 'texte', content: 'texte', tags: 'liste' } },
  { type: 'create_roadmap', description: 'Ajouter un jalon à la roadmap.', parameters: { title: 'texte', detail: 'texte', area: 'texte', status: 'texte', priority: PRIORITIES } },
  { type: 'create_automation', description: 'Créer une automatisation manuelle.', parameters: { name: 'texte', description: 'texte', trigger: TRIGGERS } },
  { type: 'search', description: 'Lancer une recherche globale.', parameters: { query: 'texte' } },
  { type: 'set_setting', description: 'Modifier un réglage visuel ou le mode performance.', parameters: { key: ['theme', 'accent', 'fontScale', 'language', ...BOOLEAN_SETTINGS], value: 'selon la clé' } },
  { type: 'delete_item', description: 'Supprimer un élément après confirmation explicite.', parameters: { collection: COLLECTIONS, id: 'identifiant existant' }, destructive: true }
];

/* Instructions ajoutées au prompt système uniquement si l'utilisateur a laissé
   les actions NOVAI activées (`novaiActions !== false`). */
function buildActionInstructions() {
  return [
    '',
    'ACTIONS APPLICATION (facultatif) :',
    '- Tu peux proposer jusqu’à 3 actions concrètes, uniquement si l’utilisateur le demande explicitement (créer, ouvrir, chercher, modifier un réglage, supprimer).',
    '- N’invente jamais d’identifiant : pour delete_item, utilise un id présent dans le contexte du workspace fourni ci-dessus.',
    '- Place ces actions dans un unique bloc délimité, à la fin de ta réponse, au format exact :',
    '```nova-actions',
    '[{"type":"create_task","title":"Préparer la démo","priority":"Haute","due":"2026-12-01"}]',
    '```',
    '- Types autorisés et champs attendus : ' + ACTION_CATALOG.map(item => `${item.type}(${Object.keys(item.parameters).join(', ')})`).join(' ; ') + '.',
    '- Champs texte courts, sans balise HTML, sans URL, sans secret. Aucune autre clé que celles listées.',
    '- Les suppressions ne sont jamais exécutées automatiquement : NovaCore demande une confirmation explicite à l’utilisateur.',
    '- Si aucune action n’est utile, n’écris pas de bloc `nova-actions`.',
    '- Le texte destiné à l’utilisateur reste normal, hors du bloc ; ne mentionne pas ce protocole.'
  ].join('\n');
}

function normalizeAction(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const type = String(raw.type || '').trim();
  if (!Object.prototype.hasOwnProperty.call(VALIDATORS, type)) return null;
  try { return VALIDATORS[type](raw); } catch { return null; }
}

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  const actions = [];
  for (const raw of list) {
    const action = normalizeAction(raw);
    if (action) actions.push(action);
    if (actions.length >= MAX_ACTIONS) break;
  }
  return actions;
}

function extractJson(candidate) {
  try {
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.actions)) return parsed.actions;
  } catch { /* bloc invalide */ }
  return null;
}

/* Retire le ou les blocs de protocole du texte affiché, puis normalise les actions. */
function parseActions(rawReply) {
  const raw = typeof rawReply === 'string' ? rawReply : '';
  const fence = /```nova-actions\s*([\s\S]*?)```/gi;
  const found = [];
  let match;
  while ((match = fence.exec(raw)) !== null) found.push(match[1]);
  let actions = [];
  let reply = raw;
  if (found.length) {
    for (const block of found) {
      const list = extractJson(block.trim());
      if (list) actions = actions.concat(list);
    }
    reply = raw.replace(fence, '');
  } else {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const list = extractJson(trimmed);
      if (list) { actions = list; reply = ''; }
    }
  }
  reply = reply.replace(/\n{3,}/g, '\n\n').trim();
  return { reply, actions: normalizeList(actions).slice(0, MAX_ACTIONS) };
}

module.exports = { buildActionInstructions, parseActions, normalizeAction, ACTION_CATALOG, PAGES, COLLECTIONS, MAX_ACTIONS };
