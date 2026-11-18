// Tests du modèle NovaSeries 3.1 : normalisation, diagnostic, exports et édition.
const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../public/series-model.js');

const project = () => ({
  title: 'Les Veilleurs de Nova',
  format: 'Série animée 3D',
  genre: 'Science-fiction',
  logline: 'Une équipe répare les failles du ciel.',
  episodes: [{ title: 'Pilote', synopsis: 'Le premier signal.', duration: 24, status: 'En écriture' }],
  characters: [{ name: 'Ari', role: 'Pilote', visual: 'Veste cyan', motivation: 'Retrouver sa sœur' }],
  shots: [{ name: 'SH-001', camera: 'Travelling avant', duration: 6.5, note: 'Ouverture' }],
  boards: [{ title: 'Le signal', camera: 'Plan large', note: 'Ciel fissuré' }],
  assets: [{ name: 'Ari_Model', kind: '3D', status: 'En cours', owner: 'Studio', note: 'Rig en cours' }],
  productionTasks: [{ title: 'Bible & univers', done: true }],
  script: 'INT. — ATELIER — NUIT',
  productionStatus: 'Préproduction',
  targetDate: '2026-12-20',
  budget: 42000,
  version: '0.4.0',
  targetAudience: '10+',
  styleGuide: 'Palette cyan et ambre, lignes nettes.',
  structuredScript: {
    schemaVersion: 1,
    characters: [{ id: 'char-ari', name: 'Ari', role: 'Pilote', notes: '' }],
    scenes: [{
      id: 'scene-1',
      heading: 'SCÈNE 1',
      location: 'Atelier',
      timeOfDay: 'NUIT',
      summary: 'Ari découvre le signal.',
      blocks: [{ id: 'block-1', kind: 'dialogue', characterId: 'char-ari', text: 'On a une faille.' }]
    }],
    activeSceneId: 'scene-1'
  }
});

test('NovaSeries : normalisation v2 préserve les valeurs et les identifiants', () => {
  const normalized = Model.normalizeSeriesProject(project());
  assert.equal(normalized.projectFormat, 'NovaSeriesProject');
  assert.equal(normalized.title, 'Les Veilleurs de Nova');
  assert.equal(normalized.episodes[0].duration, 24);
  assert.equal(normalized.characters[0].visual, 'Veste cyan');
  assert.equal(normalized.shots[0].duration, 6.5);
  assert.equal(normalized.structuredScript.activeSceneId, 'scene-1');
  assert.equal(normalized.structuredScript.scenes[0].id, 'scene-1');
  assert.equal(normalized.structuredScript.scenes[0].blocks[0].id, 'block-1');
  assert.equal(normalized.structuredScript.characters[0].id, 'char-ari');
  assert.equal(normalized.targetDate, '2026-12-20');
});

test('NovaSeries : import tolère l’ancien export plat et le nouvel enveloppement', () => {
  const flat = Model.normalizeSeriesProject({ ...project(), format: 'Série animée 3D' });
  const wrapped = Model.normalizeSeriesProject({ projectFormat: 'NovaSeriesProject', project: project() });
  assert.equal(flat.title, project().title);
  assert.equal(wrapped.title, project().title);
  assert.equal(wrapped.format, 'Série animée 3D');
  assert.throws(() => Model.normalizeSeriesProject({ projectFormat: 'AutreFormat', project: project() }), /format inconnu/);
  assert.throws(() => Model.normalizeSeriesProject({ format: 'Format inventé' }), /format inconnu/);
  assert.throws(() => Model.normalizeSeriesProject(null), /Projet illisible/);
});

test('NovaSeries : export puis réimport conserve toutes les valeurs', () => {
  const payload = Model.exportPayload(Model.normalizeSeriesProject(project()), { now: new Date('2026-11-10T12:00:00Z') });
  assert.equal(payload.projectFormat, 'NovaSeriesProject');
  assert.equal(payload.exportedAt, '2026-11-10T12:00:00.000Z');
  const roundtrip = Model.normalizeSeriesProject(JSON.parse(JSON.stringify(payload)));
  assert.deepEqual(roundtrip.episodes, Model.normalizeSeriesProject(project()).episodes);
  assert.deepEqual(roundtrip.assets, Model.normalizeSeriesProject(project()).assets);
  assert.deepEqual(roundtrip.structuredScript, Model.normalizeSeriesProject(project()).structuredScript);
});

test('NovaSeries : projet vide, slug et valeurs par défaut', () => {
  const fresh = Model.createSeriesProject();
  assert.equal(fresh.title, 'Nouvelle série');
  assert.equal(fresh.format, 'Série animée 3D');
  assert.equal(fresh.episodes.length, 0);
  assert.equal(fresh.structuredScript.activeSceneId, null);
  assert.equal(Model.slug('Les Veilleurs de Nova — Épisode 1'), 'les-veilleurs-de-nova-episode-1');
  assert.equal(Model.slug(''), 'nova-series');
  assert.equal(Model.slug('Été 2026'), 'ete-2026');
});

test('NovaSeries : diagnostic déterministe et enrichi', () => {
  const readiness = Model.seriesReadiness(Model.normalizeSeriesProject(project()));
  assert.equal(readiness.total, 12);
  assert.equal(readiness.checks.length, 12);
  assert.equal(readiness.done, 12);
  assert.equal(readiness.percent, 100);
  const empty = Model.seriesReadiness({});
  assert.equal(empty.done, 0);
  assert.equal(empty.checks.find(check => check.key === 'assets-unblocked').ok, false, 'aucun asset ne valide pas le contrôle');
  const blocked = Model.seriesReadiness({ assets: [{ status: 'Bloqué' }] });
  assert.equal(blocked.checks.find(check => check.key === 'assets-unblocked').ok, false);
});

test('NovaSeries : duplication et réorganisation immuables', () => {
  const source = ['a', 'b', 'c'];
  const moved = Model.moveItem(source, 0, 1);
  assert.deepEqual(moved.items, ['b', 'a', 'c']);
  assert.equal(moved.moved, true);
  assert.deepEqual(source, ['a', 'b', 'c'], 'la liste source ne doit pas être mutée');
  assert.equal(Model.moveItem(source, 0, -1).moved, false);
  assert.equal(Model.moveItem(source, 2, 1).moved, false);

  const characters = project().characters;
  const duplicated = Model.duplicateItem(characters, 0, 'name');
  assert.equal(duplicated.items.length, 2);
  assert.equal(duplicated.items[1].name, 'Ari (copie)');
  assert.equal(duplicated.copied.name, 'Ari (copie)');
  assert.equal(characters.length, 1, 'la liste source ne doit pas être mutée');

  const scenes = Model.duplicateItem(project().structuredScript.scenes, 0, 'heading');
  assert.equal(scenes.items[1].heading, 'SCÈNE 1 (copie)');
  assert.notEqual(scenes.items[0].id, scenes.items[1].id);
});

test('NovaSeries : dossier Markdown complet et déterministe', () => {
  const markdown = Model.dossierMarkdown(Model.normalizeSeriesProject(project()), { now: new Date('2026-11-10T12:00:00Z') });
  assert.match(markdown, /^# Les Veilleurs de Nova/m);
  assert.match(markdown, /Dossier de production NovaSeries — généré le 2026-11-10T12:00:00\.000Z/);
  assert.match(markdown, /\| Format \| Série animée 3D \|/);
  assert.match(markdown, /\| Ari \| Pilote \| Veste cyan \|/);
  assert.match(markdown, /## Shot list/);
  assert.match(markdown, /\| SH-001 \| Travelling avant \| 6\.5 \| Ouverture \|/);
  assert.match(markdown, /## NovaScript/);
  assert.match(markdown, /Ari\nOn a une faille\./);
  assert.match(markdown, /Préparation \| 12\/12 · 100%/);
});

test('NovaSeries : CSV de shot list échappe les guillemets', () => {
  const csv = Model.shotsCsv({ shots: [{ name: 'SH-1', camera: 'Fixe', duration: 5, note: 'Il dit "stop"' }] });
  assert.ok(csv.startsWith('"Plan","Caméra","Durée (s)","Notes"'));
  assert.match(csv, /"Il dit ""stop"""/);
  assert.equal(csv.split('\r\n').length, 2);
});

test('NovaSeries : script structuré texte et normalisation tolérante', () => {
  const script = Model.normalizeStructuredScript(project().structuredScript);
  const text = Model.structuredScriptText(script);
  assert.match(text, /^1\. SCÈNE 1 — Atelier — NUIT/);
  assert.match(text, /Ari\nOn a une faille\./);
  assert.throws(() => Model.normalizeStructuredScript({ characters: [] }), /Structure de script invalide/);

  const generated = Model.normalizeStructuredScript({
    characters: [{ name: 'Sans identifiant' }],
    scenes: [{ heading: 'SCÈNE', blocks: [{ kind: 'dialogue', text: 'Bonjour' }] }]
  });
  assert.equal(typeof generated.characters[0].id, 'string');
  assert.equal(typeof generated.scenes[0].id, 'string');
  assert.equal(typeof generated.scenes[0].blocks[0].id, 'string');
  assert.equal(generated.activeSceneId, generated.scenes[0].id);
});

test('NovaSeries : limites et champs inconnus neutralisés', () => {
  const normalized = Model.normalizeSeriesProject({
    title: 'x'.repeat(400),
    budget: -12,
    targetDate: '2026-13-99',
    episodes: [{ title: '', duration: 9999 }],
    shots: [{ name: '', duration: 0 }],
    productionTasks: [{ title: 'Tâche', done: 'oui' }]
  });
  assert.equal(normalized.title.length, 120);
  assert.equal(normalized.budget, 0);
  assert.equal(normalized.targetDate, '');
  assert.equal(normalized.episodes[0].duration, 180);
  assert.equal(normalized.shots[0].duration, 0.1);
  assert.equal(normalized.productionTasks[0].done, false);
});
