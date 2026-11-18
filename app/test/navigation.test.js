const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const motion = fs.readFileSync(path.join(root, 'public', 'motion.js'), 'utf8');

function navPages(source) {
  return [...new Set([...source.matchAll(/data-page="([^"]+)"/g)].map(m => m[1]))];
}

test('navigation : le lien d’évitement cible la zone de contenu réelle', () => {
  const skip = html.match(/<a class="skip-link" href="(#[^"]+)"/);
  assert.ok(skip, 'lien d’évitement absent');
  const id = skip[1].slice(1);
  assert.match(html, new RegExp(`id="${id}"`), `la cible ${skip[1]} n’existe pas`);
});

test('navigation : chaque page du menu est déclarée dans NAV_PAGES', () => {
  const declared = app.match(/const NAV_PAGES=new Set\(\[([^\]]+)\]\)/);
  assert.ok(declared, 'NAV_PAGES absent');
  const allowed = new Set([...declared[1].matchAll(/'([^']+)'/g)].map(m => m[1]));
  for (const p of navPages(html)) assert.ok(allowed.has(p), `page de menu non déclarée : ${p}`);
});

test('navigation : URL profonde, historique et retour navigateur', () => {
  assert.match(app, /function pageFromUrl\(\)/, 'pageFromUrl absent');
  assert.match(app, /history\.pushState/, 'pushState absent');
  assert.match(app, /history\.replaceState/, 'replaceState absent');
  assert.match(app, /addEventListener\('popstate'/, 'écouteur popstate absent');
});

test('navigation : un rendu asynchrone obsolète n’écrase pas la vue courante', () => {
  assert.match(app, /let renderGeneration=0/, 'garde de rendu absente');
  assert.match(app, /const stale=\(\)=>generation!==renderGeneration\|\|page!==pageAtStart/, 'détection de rendu obsolète absente');
});

test('navigation : le défilement manuel de la barre latérale n’est jamais annulé', () => {
  // « ready » ne doit pas être réécrit s’il est déjà présent : cette mutation relançait
  // le MutationObserver en boucle et scrollIntoView ramenait la barre sur l’entrée active.
  assert.match(motion, /if \(!ind\.classList\.contains\('ready'\)\) ind\.classList\.add\('ready'\)/, 'garde de classe « ready » absente');
  // La boucle de placement ignore les mutations de l’indicateur lui-même.
  assert.match(motion, /r\.target !== ind/, 'filtre des mutations de l’indicateur absent');
  // Le défilement automatique ne se produit que si l’entrée active change réellement.
  assert.match(motion, /let first = true, lastActive = \$\('\.nav\.active', side\)/, 'mémorisation de l’entrée active absente');
  assert.match(motion, /if \(!a \|\| a === lastActive\) return;/, 'garde de changement d’entrée active absente');
});

test('NovaOS 3.0 : le brief du jour est calculé depuis les données réelles', () => {
  assert.match(app, /\{id:'brief',label:'Brief du jour'/, 'widget brief absent');
  assert.match(app, /brief:novaOSWidget\('brief',novaOSBrief\(\)/, 'widget brief non rendu');
  assert.match(app, /function novaOSBriefData\(\)/, 'calcul du brief absent');
  assert.match(app, /const overdue=open\.filter\(t=>taskDueKey\(t\)/, 'tâches en retard non calculées');
  assert.match(app, /const dueToday=open\.filter\(t=>taskDueKey\(t\)===calendarDayKey\(today\)\)/, 'échéances du jour non calculées');
  assert.match(app, /class="novaos-brief-item/, 'éléments du brief absents');
});

test('palette de commandes : Ctrl/Cmd+K ouvre une palette accessible', () => {
  assert.match(html, /id="commandPalette"[^>]*role="dialog"[^>]*aria-modal="true"/, 'dialogue de palette absent');
  assert.match(html, /id="commandInput"[^>]*role="combobox"/, 'champ de commande absent');
  assert.match(html, /id="commandResults"[^>]*role="listbox"/, 'liste de résultats absente');
  assert.match(app, /const COMMAND_PAGE_ENTRIES=/, 'catalogue de pages absent');
  assert.match(app, /function openCommandPalette\(\)/, 'ouverture de palette absente');
  assert.match(app, /function runCommand\(id\)/, 'exécution de commande absente');
  assert.match(app, /&&e\.key\.toLowerCase\(\)==='k'\)\{e\.preventDefault\(\);toggleCommandPalette\(\)/, 'raccourci Ctrl/Cmd+K non branché');
});

test('Nova Engine 3.0 : statut réel et checklist isolée par compte', () => {
  assert.match(app, /async function loadEngineStatus\(\)/, 'chargement du statut Workbench absent');
  assert.match(app, /\/nova-engine\/api\/status/, 'route de statut Workbench absente');
  assert.match(app, /function engineCheckStorageKey\(key\)/, 'clé de checklist non centralisée');
  assert.match(app, /novaEngineCheck:\$\{currentUserId\(\)\|\|'guest'\}:\$\{key\}/, 'checklist non isolée par compte');
  assert.match(app, /engineCheckStorageKey\(el\.dataset\.engineCheck\)/, 'checklist non branchée sur la clé par compte');
  assert.match(app, /engineLiveStatus/, 'statut réel non conservé pour l’export');
  assert.match(app, /toolchain:\{cmake:/, 'brief moteur sans toolchain réelle');
});

test('NovaSeries 3.0 : import de projet et diagnostic déterministe', () => {
  assert.match(app, /function seriesReadiness\(\)/, 'diagnostic de production absent');
  assert.match(app, /class="card series-readiness"/, 'panneau de diagnostic absent');
  assert.match(app, /function normalizeSeriesProject\(data\)/, 'normalisation de projet absente');
  assert.match(app, /function importSeriesProjectData\(data,options=\{\}\)/, 'import de projet absent');
  assert.match(app, /function importSeriesProject\(event\)/, 'lecteur de fichier absent');
  assert.match(app, /function normalizeStructuredScript\(data\)/, 'normalisation de script non partagée');
  assert.match(app, /format!=='NovaSeriesProject'/, 'format de projet non validé');
  assert.match(app, /Importer un projet<input hidden type="file"/, 'bouton d’import absent');
});

test('NOVAI 3.0 : conversation persistée et historique borné', () => {
  assert.match(app, /novaiChat:\[\]/, 'novaiChat absent de l’état par défaut');
  assert.match(app, /function novaiSaveChat\(\)/, 'sauvegarde de conversation absente');
  assert.match(app, /state\.novaiChat=chatHistory\.slice\(-24\)/, 'conversation non persistée/bornée');
  assert.match(app, /novaiLoadChat\(\);view\.innerHTML=renderAI\(\)/, 'conversation non rechargée à l’ouverture');
  assert.match(app, /messages:chatHistory\.slice\(-20\)/, 'historique envoyé non borné');
  assert.match(app, /function novaiPromptChips\(\)/, 'suggestions de prompts absentes');
  assert.match(app, /data-prompt="\$\{esc\(p\)\}"/, 'prompts non échappés');
});

test('navigation : ?next= ne renvoie que vers la même origine', () => {
  const src = app.match(/function safeNextPath\(\)\{[^\n]*\}/);
  assert.ok(src, 'safeNextPath absent');
  const vm = require('node:vm');
  const resolveNext = search => vm.runInNewContext(
    `${src[0]}\nsafeNextPath()`,
    { location: { origin: 'http://127.0.0.1:6300', search, pathname: '/', hash: '' }, URL, URLSearchParams }
  );
  assert.equal(resolveNext('?next=%2Fnova-engine%2F'), '/nova-engine/');
  assert.equal(resolveNext('?next=%2Fa%3Fb%3D1%23c'), '/a?b=1#c');
  assert.equal(resolveNext('?next=https%3A%2F%2Fevil.example%2Fx'), null);
  assert.equal(resolveNext('?next=%2F%2Fevil.example%2Fx'), null);
  assert.equal(resolveNext(''), null);
  assert.match(app, /if\(followNextPath\(\)\)return;/, 'next non suivi après connexion');
});
