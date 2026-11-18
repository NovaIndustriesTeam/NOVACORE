// Vérifie le protocole d'actions NOVAI : extraction, liste blanche, limite et
// absence d'effet quand l'utilisateur désactive les actions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { buildActionInstructions, parseActions, MAX_ACTIONS } = require('../server/ai-actions');
const { startServer, createVerifiedUser } = require('./helpers');

test('parseActions extrait un bloc valide et le retire du texte affiché', () => {
  const reply = [
    'Je crée la tâche et j’ouvre la page Projets.',
    '```nova-actions',
    JSON.stringify([
      { type: 'create_task', title: 'Préparer la démo', priority: 'Haute', due: '2026-12-01' },
      { type: 'navigate', page: 'projects' }
    ]),
    '```'
  ].join('\n');
  const parsed = parseActions(reply);
  assert.equal(parsed.actions.length, 2);
  assert.deepEqual(parsed.actions[0], { type: 'create_task', title: 'Préparer la démo', project: '', priority: 'Haute', due: '2026-12-01' });
  assert.equal(parsed.actions[1].page, 'projects');
  assert.doesNotMatch(parsed.reply, /nova-actions/);
  assert.match(parsed.reply, /^Je crée la tâche/);
});

test('parseActions rejette les types et champs inconnus', () => {
  const raw = '```nova-actions\n' + JSON.stringify([
    { type: 'run_shell', command: 'rm -rf /' },
    { type: 'navigate', page: 'not-a-page' },
    { type: 'set_setting', key: 'theme', value: 'neon' },
    { type: 'create_task', title: '   ' },
    { type: 'create_note', title: 'Note gardée', content: 'ok', evil: '<script>' }
  ]) + '\n```';
  const parsed = parseActions(raw);
  assert.equal(parsed.actions.length, 1, 'seule la note valide doit rester');
  assert.deepEqual(parsed.actions[0], { type: 'create_note', title: 'Note gardée', content: 'ok' });
  assert.equal(parsed.reply, '');
});

test('parseActions limite à trois actions', () => {
  const list = Array.from({ length: 6 }, (_, i) => ({ type: 'create_note', title: 'Note ' + i }));
  const parsed = parseActions('```nova-actions\n' + JSON.stringify(list) + '\n```');
  assert.equal(parsed.actions.length, MAX_ACTIONS);
  assert.equal(MAX_ACTIONS, 3);
});

test('parseActions conserve delete_item sans exécution implicite', () => {
  const parsed = parseActions('```nova-actions\n' + JSON.stringify([{ type: 'delete_item', collection: 'notes', id: 'n1' }]) + '\n```');
  assert.deepEqual(parsed.actions, [{ type: 'delete_item', collection: 'notes', id: 'n1' }]);
  assert.equal(parsed.actions[0].confirmed, undefined, 'la confirmation vient du navigateur, jamais du modèle');
});

test('parseActions tolère un bloc JSON invalide et nettoie le texte', () => {
  const parsed = parseActions('Réponse utile.\n```nova-actions\n{ pas du json ]\n```');
  assert.deepEqual(parsed.actions, []);
  assert.equal(parsed.reply, 'Réponse utile.');
});

test('parseActions accepte un objet {"actions": [...]} sans fence', () => {
  const parsed = parseActions(JSON.stringify({ actions: [{ type: 'search', query: 'RetroEdge' }] }));
  assert.deepEqual(parsed.actions, [{ type: 'search', query: 'RetroEdge' }]);
  assert.equal(parsed.reply, '');
});

test('buildActionInstructions décrit uniquement le protocole whitelisté', () => {
  const text = buildActionInstructions();
  assert.match(text, /nova-actions/);
  for (const type of ['navigate', 'create_project', 'create_task', 'create_note', 'create_knowledge', 'create_roadmap', 'create_automation', 'search', 'set_setting', 'delete_item']) {
    assert.match(text, new RegExp(type), 'type attendu dans les instructions : ' + type);
  }
  assert.doesNotMatch(text, /eval|child_process|fetch\(/i);
});

function startMockProvider(replyText) {
  return new Promise(resolve => {
    const captured = [];
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        let body = null;
        try { body = JSON.parse(raw); } catch { /* requête non JSON */ }
        captured.push(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: replyText } }] }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, captured }));
  });
}

test('l’API renvoie les actions validées et respecte la préférence novaiActions', async () => {
  const reply = 'Voici la tâche.\n```nova-actions\n' + JSON.stringify([
    { type: 'create_task', title: 'Tâche NOVAI', priority: 'Haute' },
    { type: 'navigate', page: 'projects' },
    { type: 'navigate', page: 'inconnue' }
  ]) + '\n```';
  const mock = await startMockProvider(reply);
  let srv;
  try {
    srv = await startServer({
      env: {
        AI_LOCAL_API_URL: `http://127.0.0.1:${mock.port}/v1/chat/completions`,
        AI_LOCAL_MODEL: 'mock-nova-model',
        AI_CLOUD_API_URL: '', AI_CLOUD_API_KEY: '', AI_CLOUD_MODEL: ''
      }
    });
    const user = await createVerifiedUser(srv, 'novai.actions@example.test');
    const enabled = await srv.api('POST', '/api/ai/chat', {
      token: user.token,
      body: { messages: [{ role: 'user', content: 'Crée une tâche.' }], provider: 'local', novaiActions: true }
    });
    assert.equal(enabled.status, 200, JSON.stringify(enabled.json));
    assert.equal(enabled.json.actions.length, 2, 'la page inconnue doit être écartée');
    assert.equal(enabled.json.actions[0].type, 'create_task');
    assert.equal(enabled.json.actions[1].type, 'navigate');
    assert.doesNotMatch(enabled.json.reply, /nova-actions/);
    assert.match(mock.captured[0].messages[0].content, /ACTIONS APPLICATION/, 'les instructions doivent être transmises quand les actions sont actives');

    const disabled = await srv.api('POST', '/api/ai/chat', {
      token: user.token,
      body: { messages: [{ role: 'user', content: 'Crée une tâche.' }], provider: 'local', novaiActions: false }
    });
    assert.equal(disabled.status, 200, JSON.stringify(disabled.json));
    assert.deepEqual(disabled.json.actions, [], 'aucune action ne doit être renvoyée quand la préférence est désactivée');
    assert.doesNotMatch(mock.captured[1].messages[0].content, /ACTIONS APPLICATION/, 'le protocole ne doit pas être envoyé quand les actions sont désactivées');
  } finally {
    if (srv) await srv.stop();
    await new Promise(resolve => mock.server.close(resolve));
  }
});
