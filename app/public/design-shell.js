/* NovaCore 4.0 — DESIGN FINAL : raccourcis clavier, options rapides, aide, barre d'application. */
(() => {
  'use strict';
  if (localStorage.getItem('novacore.ui') === 'classic') return;
  const d = document, $ = (s, r = d) => r.querySelector(s), $$ = (s, r = d) => [...r.querySelectorAll(s)];
  const KEY = 'novacore.final.opts', def = { read: true, q: 'normal', zen: false, compact: false, still: false, dockAuto: false };
  let o = { ...def }; try { o = { ...def, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { /* stockage indisponible */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(o)); localStorage.setItem('novacore.fx.q', o.q); } catch (e) { /* ignoré */ } };
  const nav = () => window.NovaNav || { go() {}, pages: () => [], orbit() {}, current() {} };
  const say = m => { if (typeof window.toast === 'function') window.toast(m); };
  const has = id => nav().pages().some(p => p.id === id);
  const kb = k => `<kbd>${k}</kbd>`;
  const GO = { o: ['overview', 'NovaOS'], p: ['projects', 'Projets'], t: ['tasks', 'Tâches'], n: ['notes', 'Notes'], c: ['calendar', 'Calendrier'], f: ['focus', 'Focus'], a: ['analytics', 'Analytics'], i: ['ai', 'NOVAI'], e: ['novaengine', 'Nova Engine'], s: ['novaseries', 'NovaSeries'], r: ['retroedge', 'RetroEdge'], d: ['developer', 'Mode développeur'], l: ['learnlab', 'Learn Lab'], k: ['knowledge', 'Knowledge'], j: ['studio', 'Code Studio'], q: ['roadmap', 'Roadmap'], 3: ['anim3d', 'Studio 3D'], h: ['search', 'Recherche'], w: ['cloud', 'Cloud'], z: ['automation', 'Automations'], x: ['plugins', 'Plugins'], m: ['novastore', 'NovaStore'], b: ['featurelab', 'Feature Lab'], v: ['api', 'API'], y: ['system', 'Système'], u: ['account', 'Compte'] };

  window.NovaGO = GO;
  /* ---------- Options ---------- */
  const apply = (user) => {
    const b = d.body; b.classList.toggle('ns-zen', o.zen); b.classList.toggle('ns-readable', o.read); b.classList.toggle('ns-compact', o.compact); b.classList.toggle('ns-dock-auto', o.dockAuto);
    if (o.still) b.classList.add('no-animations'); else if (user) b.classList.remove('no-animations');
    const lite = b.classList.contains('perf-lite');
    (window.NovaFX = window.NovaFX || {}).q = lite ? 'off' : o.q; if (window.NovaScene) { window.NovaScene.refresh(); if (!o.still && !lite) window.NovaScene.wake(); } sync();
  };
  const set = (k, v) => { o[k] = v; save(); apply(true); if (k === 'q' && window.NovaScene) window.NovaScene.refresh(); };

  /* ---------- Aide, options, séquence ---------- */
  const mkEl = (tag, id, cls, html) => { const e = d.createElement(tag); e.id = id; if (cls) e.className = cls; e.innerHTML = html; d.body.appendChild(e); return e; };
  const sections = () => [
    ['NAVIGATION RAPIDE · G puis…', Object.entries(GO).filter(([, v]) => has(v[0])).map(([k, v]) => [[k.toUpperCase()].map(x => 'G ' + x).join(''), v[1]])],
    ['ACTIONS', [['N', 'Nouveau (projet, tâche, note…)'], ['/ ou Ctrl K', 'Palette de commandes'], ['O', 'Navigateur de toutes les pages'], ['[ ou ]', 'Page précédente / suivante'], ['Alt ←  Alt →', 'Historique du navigateur'], ['Alt 1…8', 'Pages du dock'], ['Échap', 'Fermer le panneau ouvert']]],
    ['AFFICHAGE', [['Z', 'Mode Zen (interface masquée)'], ['U', 'Revenir à l’interface classique'], ['T', 'Thème clair / sombre'], ['F', 'Plein écran'], [',', 'Options rapides'], ['?', 'Cette aide']]]
  ];
  const help = mkEl('div', 'nfHelp', 'nf-ov', '<div class="nf-panel" role="dialog" aria-label="Raccourcis clavier"></div>');
  const optsEl = mkEl('div', 'nfOpts', '', `<h4>QUALITÉ 3D</h4><div class="nf-seg">${[['off', 'Off'], ['eco', 'Éco'], ['normal', 'Normal'], ['ultra', 'Ultra']].map(([v, l]) => `<button data-q="${v}">${l}</button>`).join('')}</div>
    <h4>AFFICHAGE</h4>
    <button class="nf-opt" data-t="read" aria-pressed="false"><span>Lisibilité renforcée</span><i></i></button>
    <button class="nf-opt" data-t="zen" aria-pressed="false"><span>Mode Zen</span><em>${kb('Z')}</em><i></i></button>
    <button class="nf-opt" data-t="compact" aria-pressed="false"><span>Interface compacte</span><i></i></button>
    <button class="nf-opt" data-t="dockAuto" aria-pressed="false"><span>Dock automatique</span><i></i></button>
    <button class="nf-opt" data-t="still" aria-pressed="false"><span>Réduire les animations</span><i></i></button>
    <h4 style="margin-top:12px">OUTILS</h4>
    <button class="nf-opt" data-a="theme"><span>Thème clair / sombre</span><em>${kb('T')}</em></button>
    <button class="nf-opt" data-a="full"><span>Plein écran</span><em>${kb('F')}</em></button>
    <button class="nf-opt" data-a="help"><span>Tous les raccourcis</span><em>${kb('?')}</em></button>
    <button class="nf-opt" data-a="studio"><span>Studio 3D · animations</span><em>${kb('G')}${kb('3')}</em></button>
    <button class="nf-opt" data-a="tour"><span>Revoir le tutoriel</span></button>
    <button class="nf-opt" data-a="lang"><span>Langue · FR / EN</span></button>
    <button class="nf-opt" data-a="classic"><span>Revenir à l’interface classique</span><em>${kb('U')}</em></button>`);
  const seqEl = mkEl('div', 'nfSeq', '', '');
  mkEl('button', 'nfZen', '', `Quitter le mode Zen ${kb('Z')}`).type = 'button';
  function sync() { $$('[data-q]', optsEl).forEach(b => b.classList.toggle('on', b.dataset.q === o.q)); $$('[data-t]', optsEl).forEach(b => b.setAttribute('aria-pressed', String(!!o[b.dataset.t]))); }
  const openHelp = on => { const p = $('.nf-panel', help); if (on) { p.innerHTML = '<h2>Raccourcis NovaCore</h2><p>Garde les mains sur le clavier : tout est à portée de touche.</p><div class="nf-cols">' + sections().map(([t, rows]) => `<div><h3>${t}</h3>${rows.map(([k, l]) => `<div class="nf-row"><span>${l}</span><span>${k.split(' ').filter(Boolean).map(x => x === 'ou' ? 'ou' : kb(x)).join('')}</span></div>`).join('')}</div>`).join('') + '</div>'; } help.classList.toggle('on', on); };
  const openOpts = on => { optsEl.classList.toggle('on', on); if (on) sync(); };
  help.addEventListener('click', e => { if (e.target === help) openHelp(false); });
  $('#nfZen').addEventListener('click', () => set('zen', false));
  optsEl.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.q) { set('q', b.dataset.q); if (b.dataset.q !== 'off' && typeof window.setPerformanceMode === 'function') window.setPerformanceMode(false, { silent: true }); } else if (b.dataset.t) set(b.dataset.t, !o[b.dataset.t]);
    else if (b.dataset.a === 'theme') $('#themeBtn')?.click(); else if (b.dataset.a === 'full') full(); else if (b.dataset.a === 'help') { openOpts(false); openHelp(true); } else if (b.dataset.a === 'studio') { openOpts(false); nav().go('anim3d'); } else if (b.dataset.a === 'tour') { openOpts(false); window.NovaTour?.start(true); } else if (b.dataset.a === 'lang') { window.NovaI18n?.toggle(); sync(); } else if (b.dataset.a === 'classic') window.NovaUI?.toggle();
  });
  d.addEventListener('pointerdown', e => { if (optsEl.classList.contains('on') && !e.target.closest('#nfOpts,#nfOptsBtn,.nf-dock-opts')) openOpts(false); });
  const full = () => { try { d.fullscreenElement ? d.exitFullscreen() : d.documentElement.requestFullscreen(); } catch (e) { say('Plein écran indisponible'); } };

  /* ---------- Barre d'application ---------- */
  const bar = $('.top-actions');
  if (bar) {
    const search = d.createElement('button'); search.className = 'nf-search'; search.type = 'button'; search.innerHTML = '⌕<span>Rechercher une page ou une action…</span>' + kb('Ctrl') + kb('K');
    search.addEventListener('click', () => $('#commandBtn')?.click()); bar.insertBefore(search, bar.firstChild);
    const ib = (id, t, tip, fn) => { const b = d.createElement('button'); b.className = 'icon-btn'; b.id = id; b.type = 'button'; b.textContent = t; b.title = tip; b.addEventListener('click', fn); return b; };
    const theme = $('#themeBtn'); const anchor = theme ? theme.nextSibling : null;
    bar.insertBefore(ib('nfClassicBtn', '◧', 'Revenir à l’interface classique (U)', () => window.NovaUI?.toggle()), anchor);
    bar.insertBefore(ib('nfHelpBtn', '⌨', 'Raccourcis clavier (?)', () => openHelp(true)), anchor);
    bar.insertBefore(ib('nfOptsBtn', '⚙', 'Options rapides (,)', () => openOpts(!optsEl.classList.contains('on'))), anchor);
    const user = d.createElement('button'); user.className = 'nf-user'; user.type = 'button'; user.title = 'Mon compte (G U)'; bar.appendChild(user);
    const who = () => { const n = ($('#userName')?.textContent || 'Compte').trim(); user.innerHTML = `<i>${(n[0] || 'N').toUpperCase()}</i><span>${n}</span>`; };
    who(); user.addEventListener('click', () => nav().go('account'));
    const un = $('#userName'); if (un) new MutationObserver(who).observe(un, { childList: true, characterData: true, subtree: true });
  }
  /* Dock : raccourcis dans les infobulles + aide/options */
  const dock = $('#nsDock');
  if (dock) {
    const inv = {}; Object.entries(GO).forEach(([k, v]) => { inv[v[0]] = k.toUpperCase(); });
    $$('.ns-i[data-page]', dock).forEach((b, i) => { const k = inv[b.dataset.page]; const t = $('b', b); if (t) t.insertAdjacentHTML('beforeend', (k ? kb('G') + kb(k) : '') + kb('Alt ' + (i + 1))); });
    const core = $('.ns-core', dock), mk = (ic, lb, keys, fn, cls = '') => { const b = d.createElement('button'); b.type = 'button'; b.className = 'ns-i ' + cls; b.innerHTML = ic + '<b>' + lb + keys.map(kb).join('') + '</b>'; b.addEventListener('click', fn); dock.insertBefore(b, core); };
    mk('⌨', 'Raccourcis', ['?'], () => openHelp(true)); mk('⚙', 'Options', [','], () => openOpts(!optsEl.classList.contains('on')), 'nf-dock-opts');
  }

  /* ---------- Clavier ---------- */
  let seq = false, seqT = 0;
  const showSeq = on => { seq = on; seqEl.classList.toggle('on', on); if (on) seqEl.innerHTML = Object.entries(GO).filter(([, v]) => has(v[0])).map(([k, v]) => `<b>${kb(k.toUpperCase())}${v[1]}</b>`).join(''); clearTimeout(seqT); if (on) seqT = setTimeout(() => showSeq(false), 2600); };
  const visible = el => { if (!el) return false; const cs = getComputedStyle(el); return !el.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'; };
  const blocked = e => { const t = e.target, tag = t && t.tagName; return /INPUT|TEXTAREA|SELECT/.test(tag || '') || (t && t.isContentEditable) || visible($('#commandPalette')) || visible($('#authGate')) || visible($('#termsGate')) || /open|show|active|visible/.test(($('#hackerGame')||{}).className||''); };
  const step = dir => { const P = nav().pages(); if (!P.length) return; const i = P.findIndex(p => p.id === nav().current()); const n = P[(i + dir + P.length) % P.length]; nav().go(n.id); say(n.label); };
  d.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') { if (help.classList.contains('on')) openHelp(false); else if (optsEl.classList.contains('on')) openOpts(false); else if (o.zen) set('zen', false); showSeq(false); return; }
    if (blocked(e) || visible($('#nsOrbit.open'))) return;
    const k = e.key;
    if (e.altKey) { if (k === 'ArrowLeft') { e.preventDefault(); history.back(); } else if (k === 'ArrowRight') { e.preventDefault(); history.forward(); } else if (/^[1-8]$/.test(k) || /^Digit[1-8]$/.test(e.code)) { const b = $$('.ns-i[data-page]', dock || d)[+(e.code.slice(-1)) - 1]; if (b) { e.preventDefault(); b.click(); } } return; }
    if (seq) { e.preventDefault(); const t = GO[k.toLowerCase()]; showSeq(false); if (t && has(t[0])) { nav().go(t[0]); say(t[1]); } else say('Raccourci G inconnu · ? pour l’aide'); return; }
    const lk = k.toLowerCase();
    if (k === '?') { e.preventDefault(); openHelp(!help.classList.contains('on')); }
    else if (lk === 'g') { e.preventDefault(); showSeq(true); }
    else if (lk === 'n') { e.preventDefault(); $('#quickAdd')?.click(); }
    else if (k === '/') { e.preventDefault(); $('#commandBtn')?.click(); }
    else if (lk === 'u') { e.preventDefault(); window.NovaUI?.toggle(); }
    else if (lk === 'z') { e.preventDefault(); set('zen', !o.zen); say(o.zen ? 'Mode Zen · Échap pour quitter' : 'Mode Zen désactivé'); }
    else if (lk === 't') { e.preventDefault(); $('#themeBtn')?.click(); }
    else if (lk === 'f') { e.preventDefault(); full(); }
    else if (k === ',') { e.preventDefault(); openOpts(!optsEl.classList.contains('on')); }
    else if (k === '[') { e.preventDefault(); step(-1); } else if (k === ']') { e.preventDefault(); step(1); }
  });

  /* ---------- Pages signature : thème par page + décors 3D (RetroEdge, Nova Engine) ---------- */
  const retro = () => { const h = $('#view .retroedge-hero'); if (!h || $('.re-hero-3d', h)) return; const e = d.createElement('div'); e.className = 're-hero-3d'; e.setAttribute('aria-hidden', 'true'); let L = ''; for (let i = 1; i <= 12; i++) L += `<div class="re-l" style="--z:${i}"></div>`; e.innerHTML = `<div class="re-sun"></div><div class="re-floor"></div><div class="re-console"><div class="re-body">${L}<div class="re-face"><div class="re-screen"><b>RETROEDGE</b><i>PRESS START</i></div><div class="re-dpad"></div><div class="re-btns"><s></s><s></s><s></s><s></s></div></div></div></div>`; h.appendChild(e); };
  const engine = () => { const o = $('#view .engine-command-orb'); if (!o || o.dataset.nf) return; o.dataset.nf = '1'; o.innerHTML = '<div class="en-scene"><div class="en-ring"></div><div class="en-ring r2"></div><div class="en-cube">' + ['f', 'b', 'l', 'r', 't', 'u'].map(k => `<i class="en-${k}"></i>`).join('') + '<div class="en-core"></div></div></div>'; };
  /* Identité de chaque page : couleur, 3D signature, bannière */
  const cfgOf = pg => (window.NovaAnim ? window.NovaAnim.eff(pg) : null);
  const HERO = ['ai', 'learnlab', 'novastore', 'developer', 'featurelab', 'novaseries'], NOBANNER = ['overview', 'retroedge', 'novaengine', 'anim3d'];
  const emblem = kind => {
    const r = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
    const faces = ['f', 'b', 'l', 'r', 't', 'u'].map(k => `<i class="c-${k}"></i>`).join('');
    const pyr = r(4, i => `<i class="pf" style="--a:${i * 90}deg"></i>`);
    const body = {
      cube: `<div class="cube">${faces}<u class="cc"></u></div>`,
      stack: r(4, i => `<i class="sl" style="--k:${i}"></i>`),
      pyramid: pyr + '<u class="cc"></u>',
      gyro: '<i class="rg"></i><i class="rg" style="--ry:90deg"></i><i class="rg" style="--rx:90deg"></i><u class="cc"></u>',
      disc: r(6, i => `<i class="dc" style="--k:${i}"></i>`) + '<u class="cc"></u>',
      globe: r(4, i => `<i class="rg" style="--ry:${i * 45}deg"></i>`) + '<i class="rg" style="--rx:90deg"></i><i class="rg lat" style="--rx:90deg;--z:.26"></i><i class="rg lat" style="--rx:90deg;--z:-.26"></i>',
      helix: r(18, i => `<b style="--a:${i * 24}deg;--y:${i * 4.4 - 40}%"></b><b class="b2" style="--a:${i * 24 + 180}deg;--y:${i * 4.4 - 40}%"></b>`),
      orbit: '<u class="cc"></u>' + r(3, i => `<i class="og" style="--ry:${i * 60}deg;--t:${7 + i * 3}s"><b></b></i>`),
      crystal: `<div class="cr up">${pyr}</div><div class="cr dn">${pyr}</div><u class="cc"></u>`
    }[kind] || '';
    return `<div class="nf-emb k-${kind}" aria-hidden="true"><div class="o">${body}</div></div>`;
  };
  const banner = pg => {
    const v = $('#view'), cf = cfgOf(pg); if (!v || $('.nf-banner', v) || NOBANNER.includes(pg) || HERO.includes(pg) || !cf || !cf.emb || cf.banner === false) return;
    const p = nav().pages().find(x => x.id === pg); if (!p) return;
    const k = Object.keys(GO).find(x => GO[x][0] === pg), sub = ($('#pageSub')?.textContent || '').trim();
    const b = d.createElement('section'); b.className = 'nf-banner';
    b.innerHTML = `<div class="nf-bt"><small>${p.group}${p.tag ? ' · ' + p.tag : ''}</small><h2>${p.label}</h2>${sub ? `<p>${sub}</p>` : ''}<div class="nf-chips">${k ? `<span>${kb('G')}${kb(k.toUpperCase())} aller ici</span>` : ''}<span>${kb('O')} toutes les pages</span><span>${kb('?')} raccourcis</span></div></div>${emblem(cf.emb)}`;
    v.insertBefore(b, v.firstChild);
  };
  const heroEmb = pg => { const h = $('#view > :first-child'), cf = cfgOf(pg); if (!h || !HERO.includes(pg) || !cf || !cf.emb || cf.banner === false || $('.nf-emb', h)) return; h.insertAdjacentHTML('afterbegin', emblem(cf.emb).replace('nf-emb', 'nf-emb sm' + (pg === 'featurelab' ? ' abs' : ''))); };
  window.NovaEmblem = emblem;
  let lastPg = null;
  const deco = () => {
    const pg = nav().current() || '';
    if (pg !== lastPg) { lastPg = pg; d.body.dataset.page = pg; const c = cfgOf(pg); if (c) { d.body.style.setProperty('--accent-rgb', c.rgb); d.body.style.setProperty('--accent-2', c.c2); } else { d.body.style.removeProperty('--accent-rgb'); d.body.style.removeProperty('--accent-2'); } (window.NovaFX = window.NovaFX || {}).repaint = true; }
    if (pg === 'retroedge') retro(); else if (pg === 'novaengine') engine(); else { banner(pg); heroEmb(pg); }
  };
  const vw = $('#view'); if (vw) new MutationObserver(deco).observe(vw, { childList: true });
  const tt = $('#pageTitle'); if (tt) new MutationObserver(() => setTimeout(deco, 60)).observe(tt, { childList: true, characterData: true, subtree: true });
  deco();
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle('nf-off', !e.isIntersecting)), { rootMargin: '80px' }) : null;
  const watch = () => { if (io) $$('.nf-emb,.re-hero-3d,.engine-command-orb,.nf-banner').forEach(el => { if (!el.dataset.io) { el.dataset.io = '1'; io.observe(el); } }); };
  new MutationObserver(watch).observe(vw || d.body, { childList: true, subtree: true }); watch();
  d.addEventListener('visibilitychange', () => d.documentElement.classList.toggle('nf-hidden', d.hidden));
  if (window.NovaAnim) window.NovaAnim.on(() => { $$('#view .nf-banner,#view .nf-emb:not(.na-p)').forEach(e => e.remove()); lastPg = null; deco(); });
  apply(false);
})();
