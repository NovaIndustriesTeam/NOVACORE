/* NovaCore 4.4 — STUDIO 3D : crée et personnalise l'animation 3D de chaque page.
   Données dans localStorage (« novacore.anim.v1 »). API : window.NovaAnim. */
(() => {
  'use strict';
  const d = document, KEY = 'novacore.anim.v1';
  const $ = (s, r = d) => r.querySelector(s), $$ = (s, r = d) => [...r.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = m => { if (typeof window.toast === 'function') window.toast(m); };

  const SHAPES = [['galaxy', 'Galaxie spirale'], ['vortex', 'Vortex'], ['grid', 'Grille de cubes'], ['cubelat', 'Cube filaire'], ['neural', 'Réseau neuronal'], ['brain', 'Cerveau 3D'], ['cloud', 'Nuage de données'], ['techsphere', 'Sphère technologique'], ['sphere', 'Globe de particules'], ['saturn', 'Planète et anneaux'], ['rings', 'Anneaux orbitaux'], ['wave', 'Océan de vagues'], ['bars', 'Graphiques 3D'], ['helix', 'Double hélice'], ['knot', 'Nœud torique'], ['circuit', 'Circuits'], ['torus', 'Noyau torique'], ['portal', 'Portail'], ['retro', 'Tunnel néon'], ['tunnel', 'Tunnel de flux'], ['rain', 'Pluie de code'], ['modules', 'Modules reliés'], ['orbital', 'Produits en orbite'], ['holo', 'Plateformes holo']];
  const EMBS = [['', 'Aucun'], ['cube', 'Cube'], ['stack', 'Strates'], ['pyramid', 'Pyramide'], ['gyro', 'Gyroscope'], ['disc', 'Disques'], ['globe', 'Globe'], ['helix', 'Hélice'], ['orbit', 'Atome'], ['crystal', 'Cristal']];
  const SLIDERS = [['speed', 'Vitesse', .2, 2.5, .05], ['density', 'Densité de particules', .2, 1, .05], ['size', 'Taille des particules', .5, 2.2, .05], ['mouse', 'Réactivité à la souris', 0, 2.5, .05], ['swirl', 'Tourbillon de transition', 0, 2.5, .05], ['glow', 'Éclat', .4, 2, .05]];
  const hex = rgb => '#' + rgb.split(',').map(n => (+n).toString(16).padStart(2, '0')).join('');
  const rgbOf = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(',');
  // id : [couleur principale, couleur secondaire, objet du bandeau, fond 3D]
  const BASE = { overview: ['139,108,255', '#58d9e8', '', 'galaxy'], projects: ['80,160,255', '#7fe0ff', 'cube', 'grid'], tasks: ['60,220,150', '#9dffd6', 'stack', 'grid'], notes: ['255,196,60', '#ffe08a', 'pyramid', 'neural'], calendar: ['255,110,110', '#ffb199', 'gyro', 'rings'], focus: ['255,150,60', '#ffd08a', 'disc', 'wave'], knowledge: ['130,120,255', '#b9b3ff', 'globe', 'neural'], studio: ['90,230,255', '#b4f3ff', 'helix', 'helix'], roadmap: ['255,90,160', '#ffb0d6', 'crystal', 'grid'], search: ['120,200,255', '#bfe6ff', 'orbit', 'neural'], ai: ['190,120,255', '#e0b8ff', 'crystal', 'brain'], learnlab: ['120,255,170', '#c4ffe0', 'helix', 'helix'], cloud: ['100,190,255', '#c4e6ff', 'globe', 'cloud'], plugins: ['255,120,220', '#ffc2ee', 'cube', 'modules'], novastore: ['255,170,80', '#ffd9a8', 'pyramid', 'orbital'], api: ['70,230,200', '#b0fff0', 'gyro', 'circuit'], automation: ['255,220,70', '#fff0a0', 'orbit', 'tunnel'], analytics: ['90,220,120', '#c0ffd0', 'stack', 'bars'], system: ['150,170,200', '#d4deef', 'gyro', 'techsphere'], developer: ['80,255,120', '#c0ffd0', 'cube', 'circuit'], featurelab: ['255,100,255', '#ffc0ff', 'crystal', 'holo'], account: ['160,180,255', '#d0d8ff', 'disc', 'techsphere'], novaseries: ['255,90,70', '#ffc0b0', 'disc', 'portal'], retroedge: ['255,64,200', '#2ff3ff', '', 'retro'], novaengine: ['0,200,255', '#7affc8', '', 'torus'], anim3d: ['150,140,255', '#ffd0ff', 'crystal', 'vortex'] };
  const P0 = { speed: 1, density: 1, size: 1, mouse: 1, swirl: 1, glow: 1, banner: true };
  const PRESETS = [
    { id: 'cosmos', name: 'Cosmos', c: { shape: 'galaxy', emb: 'crystal', c1: '#8b6cff', c2: '#58d9e8' } },
    { id: 'matrix', name: 'Matrice', c: { shape: 'rain', emb: 'cube', c1: '#35ff7a', c2: '#b9ffd2', speed: 1.1 } },
    { id: 'neon', name: 'Néon rétro', c: { shape: 'retro', emb: 'disc', c1: '#ff40c8', c2: '#2ff3ff' } },
    { id: 'ocean', name: 'Océan', c: { shape: 'wave', emb: 'orbit', c1: '#3f9bff', c2: '#9df0ff', speed: .8 } },
    { id: 'storm', name: 'Tempête', c: { shape: 'vortex', emb: 'gyro', c1: '#ffd24a', c2: '#ff6a3d', speed: 1.6, size: 1.2 } },
    { id: 'calm', name: 'Calme (éco)', c: { shape: 'sphere', emb: 'globe', speed: .5, density: .5, mouse: .4, swirl: .5 } }
  ];

  let S = { pages: {}, presets: [] }; try { S = { pages: {}, presets: [], ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { /* données illisibles : on repart de zéro */ }
  const subs = []; let saveT = 0, sel = 'overview';
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* stockage plein */ } }, 250); };
  const emit = () => subs.forEach(f => { try { f(); } catch (e) { /* abonné défaillant */ } });
  const base = id => { const b = BASE[id] || BASE.overview; return { shape: b[3], emb: b[2], c1: hex(b[0]), c2: b[1], ...P0 }; };
  const cfg = id => { const c = { ...base(id), ...(S.pages[id] || {}) }; c.rgb = rgbOf(c.c1); c.custom = !!(S.pages[id] && (S.pages[id].c1 || S.pages[id].c2)); return c; };
  const eff = id => cfg(id === 'anim3d' && sel ? sel : id);
  const api = window.NovaAnim = {
    SHAPES, EMBS, cfg, eff, rgb: rgbOf, on: f => subs.push(f),
    set(id, patch) { S.pages[id] = { ...(S.pages[id] || {}), ...patch }; save(); emit(); },
    reset(id) { delete S.pages[id]; save(); emit(); },
    setPreview(id) { sel = id; emit(); },
    all: () => Object.keys(BASE)
  };

  /* ---------- Interface du Studio ---------- */
  const NP = () => (window.NovaNav ? window.NovaNav.pages() : $$('.sidebar .nav[data-page]').map(b => ({ id: b.dataset.page, label: (b.querySelector('span:last-of-type') || b).textContent.trim(), group: 'PAGES' }))).filter(p => p.id !== 'anim3d');
  const label = id => (NP().find(p => p.id === id) || { label: id }).label;
  const shapeName = id => (SHAPES.find(s => s[0] === id) || [0, id])[1];
  const thumb = (shape, c1, c2) => (window.NovaScene && window.NovaScene.thumb(shape, c1, c2)) || '';
  const lib = () => [...PRESETS, ...S.presets];
  const copyTo = (ids, c) => { ids.forEach(id => { S.pages[id] = { ...(S.pages[id] || {}), shape: c.shape, emb: c.emb, c1: c.c1, c2: c.c2, speed: c.speed, density: c.density, size: c.size, mouse: c.mouse, swirl: c.swirl, glow: c.glow }; }); save(); emit(); };
  const preview = () => { d.body.classList.add('na-full'); toast('Aperçu plein écran · clique ou Échap pour revenir'); const off = () => { d.body.classList.remove('na-full'); removeEventListener('pointerdown', off, true); removeEventListener('keydown', off, true); }; setTimeout(() => { addEventListener('pointerdown', off, true); addEventListener('keydown', off, true); }, 600); setTimeout(off, 15000); };

  const listHtml = () => { let g = '', h = ''; NP().forEach(p => { if (p.group !== g) { g = p.group; h += `<h4>${esc(g)}</h4>`; } const c = cfg(p.id); h += `<button class="na-pg${p.id === sel ? ' on' : ''}" data-pg="${p.id}"><i style="background:${c.c1};box-shadow:0 0 10px ${c.c1}"></i><span>${esc(p.label)}</span><small>${esc(shapeName(c.shape))}</small></button>`; }); return h; };
  const edHtml = () => {
    const c = cfg(sel), embs = EMBS.map(([k, n]) => `<button class="na-emb${c.emb === k ? ' on' : ''}" data-emb="${k}" title="${n}">${k ? (window.NovaEmblem ? window.NovaEmblem(k).replace('class="nf-emb', 'class="nf-emb na-p') : '') : '<span class="na-none">∅</span>'}<span>${n}</span></button>`).join('');
    const shapes = SHAPES.map(([k, n]) => `<button class="na-shape${c.shape === k ? ' on' : ''}" data-shape="${k}"><img alt="" src="${thumb(k, c.c1, c.c2)}"><span>${n}</span></button>`).join('');
    const sl = SLIDERS.map(([k, n, mi, ma, st]) => `<label class="na-sl"><span>${n}<b id="nav-${k}">${(+c[k]).toFixed(2)}</b></span><input type="range" data-sl="${k}" min="${mi}" max="${ma}" step="${st}" value="${c[k]}"></label>`).join('');
    const sw = ['#8b6cff', '#4aa8ff', '#35ff7a', '#ffd24a', '#ff6a3d', '#ff40c8', '#2ff3ff', '#ffffff'].map(x => `<button class="na-sw" data-sw="${x}" style="background:${x}" title="${x}"></button>`).join('');
    return `<div class="card na-card"><div class="na-ph"><div><small>PAGE SÉLECTIONNÉE</small><h3>${esc(label(sel))}</h3></div><div class="na-acts"><button class="primary" data-act="preview">▶ Aperçu plein écran</button><button data-act="goto">Ouvrir la page</button><button data-act="reset">Réinitialiser</button></div></div>
      <h4>FOND 3D</h4><div class="na-shapes">${shapes}</div>
      <h4>OBJET 3D DU BANDEAU</h4><div class="na-embs">${embs}</div>
      <label class="na-chk"><input type="checkbox" data-chk="banner" ${c.banner !== false ? 'checked' : ''}> Afficher le bandeau 3D en haut de la page</label>
      <h4>COULEURS</h4><div class="na-colors"><label>Principale <input type="color" data-col="c1" value="${c.c1}"></label><label>Secondaire <input type="color" data-col="c2" value="${c.c2}"></label><div class="na-sws">${sw}</div><button data-act="defcol">Couleurs d’origine</button></div>
      <h4>MOUVEMENT</h4><div class="na-sliders">${sl}</div>
      <h4>DIFFUSER</h4><div class="na-acts"><button data-act="all">Appliquer à toutes les pages</button><button data-act="grp">Appliquer à son groupe</button></div>
      <div class="na-save"><input id="naName" type="text" maxlength="28" placeholder="Nom de ta nouvelle animation…"><button class="primary" data-act="save">Enregistrer comme animation</button></div></div>`;
  };
  const libHtml = () => `<div class="na-lh"><div><small>BIBLIOTHÈQUE</small><h3>Animations prêtes à l’emploi</h3></div></div><div class="na-lib">${lib().map(p => { const c = { ...base(sel), ...p.c }; const mine = S.presets.includes(p); return `<div class="na-pre"><img alt="" src="${thumb(c.shape, c.c1 || cfg(sel).c1, c.c2 || cfg(sel).c2)}"><strong>${esc(p.name)}</strong><small>${esc(shapeName(c.shape))}</small><div><button data-pre="${p.id}" data-to="page">Cette page</button><button data-pre="${p.id}" data-to="all">Toutes</button>${mine ? `<button data-pre="${p.id}" data-to="del" class="na-del" title="Supprimer">×</button>` : ''}</div></div>`; }).join('')}</div>`;
  const head = () => `<div class="na-hd"><div><small>NOVA SPACE</small><h3>Studio 3D · Crée l’animation de chaque page</h3><p>Choisis une page, un fond 3D, un objet, des couleurs et un rythme : tout s’applique en direct. Enregistre tes créations pour les réutiliser.</p></div><div class="na-acts"><button data-act="export">Exporter</button><button data-act="import">Importer</button></div></div>`;
  const paint = () => { const l = $('#naList'), e = $('#naEd'), b = $('#naLib'), h = $('#naHead'); if (!l) return; l.innerHTML = listHtml(); e.innerHTML = edHtml(); b.innerHTML = libHtml(); h.innerHTML = head(); };
  api.render = () => { if (!NP().some(p => p.id === sel)) sel = (window.NovaNav && NovaNav.current && NovaNav.current() !== 'anim3d' && NovaNav.current()) || 'overview'; return `<div class="na-studio"><section class="card na-head" id="naHead"></section><div class="na-cols"><aside class="card na-list" id="naList"></aside><section class="na-editor" id="naEd"></section></div><section class="card na-libwrap" id="naLib"></section></div>`; };

  const onClick = e => {
    const t = e.target.closest('button'); if (!t) return; const D = t.dataset;
    if (D.pg) { sel = D.pg; paint(); emit(); }
    else if (D.shape) { api.set(sel, { shape: D.shape }); paint(); }
    else if (D.emb !== undefined) { api.set(sel, { emb: D.emb }); paint(); }
    else if (D.sw) { api.set(sel, { c1: D.sw }); paint(); }
    else if (D.pre) {
      const p = lib().find(x => x.id === D.pre); if (!p) return;
      if (D.to === 'del') { S.presets = S.presets.filter(x => x.id !== D.pre); save(); paint(); toast('Animation supprimée'); }
      else { const c = { ...cfg(sel), ...p.c }; copyTo(D.to === 'all' ? api.all() : [sel], c); paint(); toast(D.to === 'all' ? 'Animation appliquée à toutes les pages' : 'Animation appliquée à ' + label(sel)); }
    } else if (D.act) {
      const c = cfg(sel);
      if (D.act === 'preview') preview();
      else if (D.act === 'goto') { window.NovaNav && NovaNav.go(sel); }
      else if (D.act === 'reset') { api.reset(sel); paint(); toast('Page réinitialisée'); }
      else if (D.act === 'defcol') { const b = base(sel); api.set(sel, { c1: b.c1, c2: b.c2 }); paint(); }
      else if (D.act === 'all') { copyTo(api.all(), c); paint(); toast('Appliqué à toutes les pages'); }
      else if (D.act === 'grp') { const g = (NP().find(p => p.id === sel) || {}).group; copyTo(NP().filter(p => p.group === g).map(p => p.id), c); paint(); toast('Appliqué au groupe ' + g); }
      else if (D.act === 'save') { const n = ($('#naName') || {}).value || ''; if (!n.trim()) { toast('Donne un nom à ton animation'); return; } S.presets.push({ id: 'u' + Date.now().toString(36), name: n.trim(), c: { shape: c.shape, emb: c.emb, c1: c.c1, c2: c.c2, speed: c.speed, density: c.density, size: c.size, mouse: c.mouse, swirl: c.swirl, glow: c.glow } }); save(); paint(); toast('Animation « ' + n.trim() + ' » enregistrée'); }
      else if (D.act === 'export') { const j = JSON.stringify(S); (navigator.clipboard ? navigator.clipboard.writeText(j) : Promise.reject()).then(() => toast('Configuration copiée dans le presse-papiers'), () => prompt('Copie cette configuration :', j)); }
      else if (D.act === 'import') { const j = prompt('Colle ici la configuration exportée :'); if (!j) return; try { const o = JSON.parse(j); if (o && typeof o.pages === 'object') { S = { pages: o.pages || {}, presets: Array.isArray(o.presets) ? o.presets : [] }; save(); emit(); paint(); toast('Configuration importée'); } else toast('Format non reconnu'); } catch (er) { toast('Configuration illisible'); } }
    }
  };
  const onInput = e => {
    const t = e.target, D = t.dataset;
    if (D.sl) { const v = +t.value; const o = $('#nav-' + D.sl); if (o) o.textContent = v.toFixed(2); api.set(sel, { [D.sl]: v }); }
    else if (D.col) { api.set(sel, { [D.col]: t.value }); const dot = $(`.na-pg[data-pg="${sel}"] i`); if (dot && D.col === 'c1') { dot.style.background = t.value; } }
  };
  const onChange = e => { const t = e.target; if (t.dataset.chk) api.set(sel, { banner: t.checked }); else if (t.dataset.col) paint(); };
  d.addEventListener('click', e => { if (e.target.closest('.na-studio')) onClick(e); });
  d.addEventListener('input', e => { if (e.target.closest('.na-studio')) onInput(e); });
  d.addEventListener('change', e => { if (e.target.closest('.na-studio')) onChange(e); });
  const v = $('#view'); if (v) new MutationObserver(() => { if ($('.na-studio', v) && !$('#naList').firstChild) paint(); }).observe(v, { childList: true, subtree: true });
})();
