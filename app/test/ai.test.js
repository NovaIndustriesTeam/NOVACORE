// Vérifie le contexte réellement transmis à NOVAI et la validation de l'historique.
// Un faux fournisseur local capture la requête : aucune clé ni service externe n'est requis.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, createVerifiedUser } = require('./helpers');

function startMockProvider() {
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
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Réponse du fournisseur simulé.' } }] }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, captured }));
  });
}

test('NOVAI reçoit un contexte factuel du workspace et valide l’historique', async () => {
  const mock = await startMockProvider();
  let srv;
  try {
    srv = await startServer({
      env: {
        AI_LOCAL_API_URL: `http://127.0.0.1:${mock.port}/v1/chat/completions`,
        AI_LOCAL_MODEL: 'mock-nova-model',
        AI_CLOUD_API_URL: '',
        AI_CLOUD_API_KEY: '',
        AI_CLOUD_MODEL: ''
      }
    });
    const user = await createVerifiedUser(srv, 'novai.context@example.test');
    const workspace = {
      projects: [{ id: 'p1', name: 'NovaEngine Test', description: 'Moteur de test', progress: 40 }],
      tasks: [
        { id: 't1', title: 'Corriger le rendu', project: 'NovaEngine Test', priority: 'Haute', done: false, due: '2020-01-01' },
        { id: 't2', title: 'Documenter', project: 'NovaEngine Test', priority: 'Basse', done: false }
      ],
      notes: [{ id: 'n1', title: 'Note réelle', content: 'Contenu de test' }],
      knowledge: [{ id: 'k1', title: 'Référence Vulkan', content: 'Documentation', tags: ['graphics'] }],
      roadmap: [{ id: 'r1', title: 'Jalon test', status: 'En cours', priority: 'Moyenne', area: 'NovaCore' }],
      focusSessions: [{ id: 'f1', minutes: 25, label: 'Focus test', completedAt: new Date().toISOString() }],
      seriesStudio: { title: 'Série de test' }
    };
    assert.equal((await srv.api('PUT', '/api/sync', { token: user.token, body: { data: workspace } })).status, 200);

    const chat = await srv.api('POST', '/api/ai/chat', {
      token: user.token,
      body: { messages: [{ role: 'user', content: 'Résume mon workspace.' }], provider: 'local', mode: 'assistant' }
    });
    assert.equal(chat.status, 200, JSON.stringify(chat.json));
    assert.equal(chat.json.reply, 'Réponse du fournisseur simulé.');
    assert.equal(mock.captured.length, 1, 'le fournisseur simulé doit recevoir une requête');

    const system = mock.captured[0].messages[0];
    assert.equal(system.role, 'system');
    assert.match(system.content, /"projets":1/, 'le nombre de projets doit venir des données réelles');
    assert.match(system.content, /"tachesOuvertes":2/, 'les tâches ouvertes doivent être comptées');
    assert.match(system.content, /"tachesEnRetard":1/, 'les tâches en retard doivent être comptées');
    assert.match(system.content, /"minutesFocus":25/, 'le temps de focus doit être transmis');
    assert.match(system.content, /NovaEngine Test/, 'les projets réels doivent être transmis');
    assert.match(system.content, /Référence Vulkan/, 'les ressources réelles doivent être transmises');
    assert.match(system.content, /sync\.saved/, 'l’activité récente du compte doit être transmise');
    assert.match(system.content, /Série de test/, 'le titre NovaSeries doit être transmis');
    assert.doesNotMatch(system.content, /novai\.context@example\.test/, 'l’adresse e-mail ne doit pas être transmise');

    const tooLong = Array.from({ length: 31 }, () => ({ role: 'user', content: 'test' }));
    assert.equal((await srv.api('POST', '/api/ai/chat', { token: user.token, body: { messages: tooLong } })).status, 400);
    assert.equal(mock.captured.length, 1, 'un historique invalide ne doit jamais atteindre le fournisseur');
  } finally {
    if (srv) await srv.stop();
    await new Promise(resolve => mock.server.close(resolve));
  }
});
