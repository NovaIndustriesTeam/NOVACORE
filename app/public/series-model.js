/* NovaSeries 3.1 — modèle de production pur, partagé entre le navigateur et les tests Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NovaSeriesModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SERIES_FORMATS = ['Série animée 3D', 'Série animée 2D', 'Série hybride', 'Mini-série', 'Long métrage'];
  const PROJECT_FORMAT = 'NovaSeriesProject';
  const PROJECT_VERSION = 2;
  const SCENE_TIMES = ['JOUR', 'NUIT', 'AUBE', 'CRÉPUSCULE', 'CONTINU'];
  const EPISODE_STATUSES = ['À écrire', 'En écriture', 'À relire', 'Réécriture', 'Validé', 'Prêt', 'En production', 'Terminé', 'En pause'];
  const ASSET_STATUSES = ['À faire', 'En cours', 'À valider', 'Validé', 'Terminé', 'Bloqué'];
  const ASSET_KINDS = ['Concept art', '3D', 'Texture', 'Rig', 'Audio', 'VFX', 'Montage', 'Autre'];

  let sequence = 0;
  function uid(prefix) {
    sequence += 1;
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix || 'nova'}-${Date.now().toString(36)}-${sequence.toString(36)}-${random}`;
  }

  function text(value, max) {
    return String(value === null || value === undefined ? '' : value).slice(0, max);
  }

  function list(value, max) {
    return Array.isArray(value) ? value.slice(0, max) : [];
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function slug(value) {
    const result = String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return result || 'nova-series';
  }

  function validDate(value) {
    const raw = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
    const parsed = new Date(`${raw}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : '';
  }

  function duration(value, min, max, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.max(min, Math.min(max, parsed)) : fallback;
  }

  function isKnownFormat(value) {
    return SERIES_FORMATS.includes(String(value || ''));
  }

  function normalizeStructuredScript(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.characters) || !Array.isArray(data.scenes)) {
      throw new Error('Structure de script invalide.');
    }
    const characters = data.characters.slice(0, 200).map(character => ({
      id: typeof character?.id === 'string' && character.id ? character.id : uid('character'),
      name: text(character?.name, 100) || 'Sans nom',
      role: text(character?.role, 120) || 'Personnage',
      notes: text(character?.notes, 1000)
    }));
    const scenes = data.scenes.slice(0, 500).map(scene => ({
      id: typeof scene?.id === 'string' && scene.id ? scene.id : uid('scene'),
      heading: text(scene?.heading, 160) || 'SCÈNE',
      location: text(scene?.location, 160),
      timeOfDay: SCENE_TIMES.includes(scene?.timeOfDay) ? scene.timeOfDay : (text(scene?.timeOfDay, 40) || 'JOUR'),
      summary: text(scene?.summary, 1600),
      blocks: Array.isArray(scene?.blocks) ? scene.blocks.slice(0, 1000).map(block => ({
        id: typeof block?.id === 'string' && block.id ? block.id : uid('block'),
        kind: block?.kind === 'dialogue' ? 'dialogue' : 'action',
        characterId: text(block?.characterId, 120),
        text: text(block?.text, 5000)
      })) : []
    }));
    const requested = typeof data.activeSceneId === 'string' ? data.activeSceneId : null;
    const activeSceneId = scenes.some(scene => scene.id === requested) ? requested : (scenes[0]?.id || null);
    return { schemaVersion: 1, characters, scenes, activeSceneId };
  }

  function defaultStructuredScript() {
    return { schemaVersion: 1, characters: [], scenes: [], activeSceneId: null };
  }

  function normalizeSeriesProject(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Projet illisible.');
    const source = data.project && typeof data.project === 'object' && !Array.isArray(data.project) ? data.project : data;
    if (data.projectFormat && data.projectFormat !== PROJECT_FORMAT) throw new Error('format inconnu.');
    if (source.projectFormat && source.projectFormat !== PROJECT_FORMAT) throw new Error('format inconnu.');
    const rawFormat = text(source.seriesFormat || source.format, 40).trim();
    if (rawFormat && rawFormat !== PROJECT_FORMAT && !isKnownFormat(rawFormat) && source.format !== PROJECT_FORMAT) {
      throw new Error('format inconnu.');
    }
    const seriesFormat = isKnownFormat(source.seriesFormat)
      ? source.seriesFormat
      : (isKnownFormat(rawFormat) ? rawFormat : SERIES_FORMATS[0]);
    let structuredScript = defaultStructuredScript();
    try { structuredScript = normalizeStructuredScript(source.structuredScript); } catch { /* conserve un script vide */ }
    const targetDate = validDate(source.targetDate);
    return {
      projectFormat: PROJECT_FORMAT,
      projectVersion: PROJECT_VERSION,
      title: text(source.title, 120).trim(),
      format: seriesFormat,
      genre: text(source.genre, 60),
      logline: text(source.logline, 1600),
      episodes: list(source.episodes, 500).map(episode => ({
        title: text(episode?.title, 140).trim() || 'Épisode sans titre',
        synopsis: text(episode?.synopsis, 4000),
        duration: duration(episode?.duration, 1, 180, 22),
        status: text(episode?.status, 30) || 'À écrire'
      })),
      characters: list(source.characters, 200).map(character => ({
        name: text(character?.name, 100).trim() || 'Sans nom',
        role: text(character?.role, 100),
        visual: text(character?.visual, 180),
        motivation: text(character?.motivation, 2000)
      })),
      shots: list(source.shots, 2000).map(shot => ({
        name: text(shot?.name, 80).trim() || 'SH',
        camera: text(shot?.camera, 80),
        duration: duration(shot?.duration, 0.1, 3600, 5),
        note: text(shot?.note, 1800)
      })),
      boards: list(source.boards, 500).map(board => ({
        title: text(board?.title, 140).trim() || 'Vignette',
        camera: text(board?.camera, 80),
        note: text(board?.note, 1800)
      })),
      assets: list(source.assets, 1000).map(asset => ({
        name: text(asset?.name, 150).trim() || 'Asset',
        kind: text(asset?.kind, 40) || 'Autre',
        status: text(asset?.status, 40) || 'À faire',
        owner: text(asset?.owner, 100),
        note: text(asset?.note, 2000)
      })),
      productionTasks: list(source.productionTasks, 100)
        .filter(task => task && typeof task.title === 'string')
        .map(task => ({ title: text(task.title, 80), done: task.done === true })),
      script: text(source.script, 50000),
      productionStatus: text(source.productionStatus, 40) || 'Développement',
      targetDate,
      budget: Math.max(0, Math.min(100000000, Number(source.budget) || 0)),
      version: text(source.version, 30) || '0.1.0',
      targetAudience: text(source.targetAudience, 40) || 'À définir',
      styleGuide: text(source.styleGuide, 4000),
      structuredScript
    };
  }

  function createSeriesProject(overrides) {
    const base = {
      title: 'Nouvelle série',
      format: SERIES_FORMATS[0],
      genre: 'Science-fiction',
      logline: '',
      episodes: [],
      characters: [],
      shots: [],
      boards: [],
      script: '',
      productionStatus: 'Développement',
      targetDate: '',
      budget: 0,
      assets: [],
      productionTasks: [],
      version: '0.1.0',
      targetAudience: 'Tout public',
      styleGuide: '',
      structuredScript: defaultStructuredScript()
    };
    return normalizeSeriesProject({ ...base, ...(overrides || {}) });
  }

  function seriesReadiness(project) {
    const source = project && typeof project === 'object' ? project : {};
    const episodes = safeArray(source.episodes);
    const characters = safeArray(source.characters);
    const assets = safeArray(source.assets);
    const boards = safeArray(source.boards);
    const shots = safeArray(source.shots);
    const structured = source.structuredScript && typeof source.structuredScript === 'object' ? source.structuredScript : {};
    const scenes = safeArray(structured.scenes);
    const checks = [
      { key: 'title', ok: !!String(source.title || '').trim(), label: 'Titre de série', detail: 'Bible identifiée' },
      { key: 'logline', ok: !!String(source.logline || '').trim(), label: 'Logline', detail: 'Promesse éditoriale' },
      { key: 'episodes', ok: episodes.length > 0, label: 'Épisodes', detail: `${episodes.length} épisode(s)` },
      { key: 'synopsis', ok: episodes.length > 0 && episodes.every(episode => String(episode.synopsis || '').trim()), label: 'Synopsis', detail: `${episodes.filter(episode => !String(episode.synopsis || '').trim()).length} à compléter` },
      { key: 'characters', ok: characters.some(character => String(character.visual || '').trim() && character.visual !== 'À définir'), label: 'Design personnages', detail: `${characters.length} fiche(s)` },
      { key: 'assets', ok: assets.length > 0, label: 'Assets suivis', detail: `${assets.length} élément(s)` },
      { key: 'assets-unblocked', ok: assets.length > 0 && assets.every(asset => asset.status !== 'Bloqué'), label: 'Assets non bloqués', detail: `${assets.filter(asset => asset.status === 'Bloqué').length} bloqué(s)` },
      { key: 'boards', ok: boards.length > 0, label: 'Storyboard', detail: `${boards.length} vignette(s)` },
      { key: 'shots', ok: shots.length > 0, label: 'Shot list', detail: `${shots.length} plan(s)` },
      { key: 'target', ok: !!source.targetDate, label: 'Échéance cible', detail: source.targetDate || 'non définie' },
      { key: 'style', ok: String(source.styleGuide || '').trim().length >= 12, label: 'Guide de style', detail: source.styleGuide ? 'continuité documentée' : 'à documenter' },
      { key: 'script', ok: scenes.length > 0 || String(source.script || '').trim().length > 0, label: 'Script', detail: scenes.length ? `${scenes.length} scène(s) structurée(s)` : (source.script ? 'jet texte présent' : 'à écrire') }
    ];
    const done = checks.filter(check => check.ok).length;
    return { checks, done, total: checks.length, percent: Math.round((done / checks.length) * 100) };
  }

  function moveItem(items, index, delta) {
    const copy = safeArray(items).slice();
    const target = index + delta;
    if (index < 0 || index >= copy.length || target < 0 || target >= copy.length) {
      return { items: copy, moved: false, index };
    }
    const [item] = copy.splice(index, 1);
    copy.splice(target, 0, item);
    return { items: copy, moved: true, index: target };
  }

  function duplicateItem(items, index, labelKey) {
    const copy = safeArray(items).slice();
    if (index < 0 || index >= copy.length) return { items: copy, copied: null, index: -1 };
    let duplicate;
    try { duplicate = JSON.parse(JSON.stringify(copy[index])); } catch { duplicate = { ...copy[index] }; }
    if (duplicate && typeof duplicate === 'object') {
      if (typeof duplicate.id === 'string' && duplicate.id) duplicate.id = uid('copy');
      const key = labelKey || 'name';
      if (typeof duplicate[key] === 'string' && duplicate[key].trim()) duplicate[key] = `${duplicate[key]} (copie)`.slice(0, 200);
    }
    copy.splice(index + 1, 0, duplicate);
    return { items: copy, copied: duplicate, index: index + 1 };
  }

  function markdownCell(value) {
    return String(value === null || value === undefined ? '' : value).replace(/\r?\n+/g, ' ').trim().replace(/\|/g, '\\|');
  }

  function markdownTable(headers, rows) {
    if (!rows.length) return '_Aucune entrée._';
    const head = `| ${headers.join(' | ')} |`;
    const rule = `| ${headers.map(() => '---').join(' | ')} |`;
    return [head, rule, ...rows.map(row => `| ${row.map(markdownCell).join(' | ')} |`)].join('\n');
  }

  function dossierMarkdown(project, options) {
    const p = project && typeof project === 'object' ? project : {};
    const opts = options && typeof options === 'object' ? options : {};
    const generated = opts.now instanceof Date ? opts.now : (opts.now ? new Date(opts.now) : new Date());
    const generatedLabel = Number.isNaN(generated.getTime()) ? new Date().toISOString() : generated.toISOString();
    const readiness = seriesReadiness(p);
    const structured = p.structuredScript && typeof p.structuredScript === 'object' ? p.structuredScript : {};
    const structuredScenes = safeArray(structured.scenes);
    const structuredCharacters = safeArray(structured.characters);
    const script = structuredScriptText(structured);
    const lines = [];
    lines.push(`# ${p.title || 'Série sans titre'}`);
    lines.push('');
    lines.push(`> Dossier de production NovaSeries — généré le ${generatedLabel}`);
    lines.push('');
    lines.push('## Identité du projet');
    lines.push('');
    lines.push(markdownTable(['Champ', 'Valeur'], [
      ['Format', p.format || ''],
      ['Genre', p.genre || ''],
      ['Étape de production', p.productionStatus || ''],
      ['Version', p.version || ''],
      ['Public cible', p.targetAudience || ''],
      ['Échéance cible', p.targetDate || 'Non définie'],
      ['Budget indicatif', `${Number(p.budget) || 0} €`],
      ['Préparation', `${readiness.done}/${readiness.total} · ${readiness.percent}%`]
    ]));
    lines.push('');
    lines.push('## Logline');
    lines.push('');
    lines.push(p.logline || '_Non renseignée._');
    lines.push('');
    lines.push('## Guide de style et continuité');
    lines.push('');
    lines.push(p.styleGuide || '_Non renseigné._');
    lines.push('');
    lines.push('## Diagnostic de production');
    lines.push('');
    lines.push(markdownTable(['Contrôle', 'État', 'Détail'], readiness.checks.map(check => [check.label, check.ok ? 'OK' : 'À faire', check.detail])));
    lines.push('');
    lines.push('## Personnages');
    lines.push('');
    lines.push(markdownTable(['Nom', 'Rôle', 'Design visuel', 'Motivation'], safeArray(p.characters).map(character => [character.name, character.role, character.visual, character.motivation])));
    lines.push('');
    lines.push('## Épisodes');
    lines.push('');
    lines.push(markdownTable(['#', 'Titre', 'Durée', 'Statut', 'Synopsis'], safeArray(p.episodes).map((episode, index) => [index + 1, episode.title, `${episode.duration} min`, episode.status, episode.synopsis])));
    lines.push('');
    lines.push('## Assets de production');
    lines.push('');
    lines.push(markdownTable(['Nom', 'Type', 'Statut', 'Responsable', 'Notes'], safeArray(p.assets).map(asset => [asset.name, asset.kind, asset.status, asset.owner || '—', asset.note])));
    lines.push('');
    lines.push('## Storyboard');
    lines.push('');
    lines.push(markdownTable(['#', 'Vignette', 'Caméra', 'Action'], safeArray(p.boards).map((board, index) => [index + 1, board.title, board.camera, board.note])));
    lines.push('');
    lines.push('## Shot list');
    lines.push('');
    lines.push(markdownTable(['Plan', 'Caméra', 'Durée (s)', 'Notes'], safeArray(p.shots).map(shot => [shot.name, shot.camera, shot.duration, shot.note])));
    lines.push('');
    lines.push('## Checklist de production');
    lines.push('');
    lines.push(markdownTable(['Tâche', 'État'], safeArray(p.productionTasks).map(task => [task.title, task.done ? 'Terminée' : 'À faire'])));
    lines.push('');
    lines.push('## NovaScript');
    lines.push('');
    lines.push(`Personnages structurés : ${structuredCharacters.length} · Scènes : ${structuredScenes.length}`);
    lines.push('');
    lines.push(script || '_Aucun script structuré._');
    lines.push('');
    return lines.join('\n');
  }

  function shotsCsv(project) {
    const rows = [['Plan', 'Caméra', 'Durée (s)', 'Notes']];
    safeArray(project && project.shots).forEach(shot => rows.push([shot.name, shot.camera, shot.duration, shot.note]));
    return rows
      .map(row => row.map(value => `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
  }

  function structuredScriptText(script) {
    const model = script && typeof script === 'object' ? script : defaultStructuredScript();
    const characters = safeArray(model.characters);
    const scenes = safeArray(model.scenes);
    const names = Object.fromEntries(characters.map(character => [character.id, character.name]));
    return scenes.map((scene, index) => {
      const header = `${index + 1}. ${scene.heading}${scene.location ? ` — ${scene.location}` : ''}${scene.timeOfDay ? ` — ${scene.timeOfDay}` : ''}`;
      const body = safeArray(scene.blocks).map(block => (block.kind === 'dialogue' ? `${names[block.characterId] || 'PERSONNAGE'}\n${block.text}` : block.text)).join('\n\n');
      return `${header}\n${scene.summary || ''}\n\n${body}`.trimEnd();
    }).join('\n\n');
  }

  function exportPayload(project, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const generated = opts.now instanceof Date ? opts.now : (opts.now ? new Date(opts.now) : new Date());
    return {
      ...(project && typeof project === 'object' ? project : {}),
      projectFormat: PROJECT_FORMAT,
      projectVersion: PROJECT_VERSION,
      exportedAt: generated.toISOString()
    };
  }

  return {
    PROJECT_FORMAT,
    PROJECT_VERSION,
    SERIES_FORMATS,
    EPISODE_STATUSES,
    ASSET_STATUSES,
    ASSET_KINDS,
    SCENE_TIMES,
    uid,
    slug,
    isKnownFormat,
    normalizeStructuredScript,
    normalizeSeriesProject,
    createSeriesProject,
    seriesReadiness,
    moveItem,
    duplicateItem,
    dossierMarkdown,
    shotsCsv,
    structuredScriptText,
    exportPayload
  };
});
