// Tests du catalogue Nova Feature Lab 3.2 : 50 modules réellement actionnables.
const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../public/feature-lab-model.js');

test('Feature Lab : 50 modules uniques, 8 catégories, aucune action vide', () => {
  assert.equal(Model.FEATURES.length, 50);
  assert.equal(new Set(Model.FEATURES.map(feature => feature.id)).size, 50, 'les identifiants doivent être uniques');
  assert.equal(new Set(Model.FEATURES.map(feature => feature.name)).size, 50, 'les noms doivent être uniques');
  assert.equal(Model.CATEGORIES.length, 8);
  assert.equal(new Set(Model.FEATURES.map(feature => feature.category)).size, 8);
  Model.FEATURES.forEach(feature => {
    assert.equal(typeof feature.id, 'string');
    assert.ok(feature.id.length > 0);
    assert.equal(typeof feature.name, 'string');
    assert.equal(typeof feature.description, 'string');
    assert.equal(typeof feature.action, 'string');
    assert.ok(feature.action.includes(':'), `${feature.id} doit avoir une action typée`);
    assert.equal(typeof feature.verb, 'string');
    assert.ok(feature.verb.length > 0);
  });
});

test('Feature Lab : complétion à 100 % et zéro concept', () => {
  const completion = Model.completion();
  assert.equal(completion.total, 50);
  assert.equal(completion.implemented, 50);
  assert.equal(completion.concepts, 0);
  assert.equal(completion.percent, 100);
  const serialized = JSON.stringify(Model.FEATURES);
  assert.ok(!/concept/i.test(serialized), 'aucune mention concept dans les modules');
});

test('Feature Lab : répartition par catégorie cohérente', () => {
  const counts = Model.categoryCounts();
  assert.equal(counts.length, 8);
  assert.equal(counts.reduce((sum, item) => sum + item.total, 0), 50);
  counts.forEach(item => {
    assert.ok(Model.CATEGORIES.includes(item.category));
    assert.ok(item.total > 0, `${item.category} doit contenir au moins un module`);
  });
});

test('Feature Lab : normalisation des drapeaux et migration des anciens index', () => {
  const defaults = Model.normalizeFlags(null);
  assert.equal(Object.keys(defaults).length, 50);
  assert.equal(defaults['liquid-glass'], true);
  assert.equal(defaults['high-contrast'], false);
  assert.equal(defaults['private'], false);
  assert.equal(defaults['micro'], true);

  const migrated = Model.normalizeFlags({ 0: false, 2: true, 50: false, inconnu: true });
  assert.equal(migrated[Model.FEATURES[0].id], false);
  assert.equal(migrated[Model.FEATURES[2].id], true);
  assert.equal(migrated[Model.FEATURES[1].id], true);
  assert.equal('inconnu' in migrated, false);

  const byId = Model.normalizeFlags({ 'quick-search': false, private: true });
  assert.equal(byId['quick-search'], false);
  assert.equal(byId.private, true);
  assert.equal(byId['quick-note'] ?? byId['quick-capture'], true);
});

test('Feature Lab : compteur de modules actifs', () => {
  const allOn = Model.normalizeFlags(Object.fromEntries(Model.FEATURES.map(feature => [feature.id, true])));
  assert.equal(Model.activeCount(allOn), 50);
  const allOff = Model.normalizeFlags(Object.fromEntries(Model.FEATURES.map(feature => [feature.id, false])));
  assert.equal(Model.activeCount(allOff), 0);
  const partial = Model.normalizeFlags({ 'quick-search': false, 'liquid-glass': false });
  assert.equal(Model.activeCount(partial), 43);
});

test('Feature Lab : recherche et filtres par catégorie', () => {
  assert.equal(Model.filterFeatures('', 'all').length, 50);
  const appearance = Model.filterFeatures('', 'Apparence');
  assert.ok(appearance.length > 0);
  assert.ok(appearance.every(feature => feature.category === 'Apparence'));
  const search = Model.filterFeatures('focus');
  assert.ok(search.length >= 2);
  assert.ok(search.every(feature => `${feature.name} ${feature.category} ${feature.description}`.toLowerCase().includes('focus')));
  assert.equal(Model.filterFeatures('introuvable-xyz').length, 0);
  assert.equal(Model.filterFeatures('', 'Catégorie inconnue').length, 0);
});

test('Feature Lab : recherche par identifiant, index et cible d’action', () => {
  assert.equal(Model.findFeature('pomodoro').name, 'Focus Pomodoro');
  assert.equal(Model.findFeature(0).id, 'liquid-glass');
  assert.equal(Model.findFeature('inconnu'), null);
  assert.deepEqual(Model.actionTarget(Model.findFeature('pomodoro')), { kind: 'focus', value: 'start' });
  assert.deepEqual(Model.actionTarget(Model.findFeature('quick-search')), { kind: 'palette', value: 'open' });
  assert.deepEqual(Model.actionTarget(Model.findFeature('export-backup')), { kind: 'download', value: 'backup' });
  assert.deepEqual(Model.actionTarget({ action: 'page:account' }), { kind: 'page', value: 'account' });
  assert.equal(Model.actionTarget({}), null);
});

test('Feature Lab : préférences visuelles rattachées à de vrais modules', () => {
  const keys = Model.PREFERENCE_KEYS;
  assert.ok(keys.length >= 9);
  ['liquidGlass', 'supernova', 'highContrast', 'starfield', 'intro', 'sound', 'privateMode', 'microInteractions'].forEach(key => {
    assert.ok(keys.includes(key), `${key} doit piloter un module`);
  });
  keys.forEach(key => {
    const owners = Model.FEATURES.filter(feature => feature.preference === key);
    assert.equal(owners.length, 1, `${key} doit avoir un seul module propriétaire`);
  });
});

test('Feature Lab : toutes les actions sont exécutables côté interface', () => {
  const supported = new Set(['page', 'effect', 'cycle', 'sound', 'intro', 'palette', 'note', 'task', 'focus', 'journal', 'ai', 'modal', 'download', 'import', 'cloud', 'toggle']);
  Model.FEATURES.forEach(feature => {
    const target = Model.actionTarget(feature);
    assert.ok(target, `${feature.id} doit définir une cible`);
    assert.ok(supported.has(target.kind), `${feature.id} utilise un type d’action inconnu : ${target.kind}`);
  });
});
