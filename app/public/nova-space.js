/* NovaCore 3.8 — NOVA SPACE. Galaxie WebGL + dock 3D + anneau de navigation + cartes en relief.
   N'altère aucune logique métier : la navigation passe par les boutons .nav existants. */
(() => {
  'use strict';
  const d = document, $ = (s, r = d) => r.querySelector(s), $$ = (s, r = d) => [...r.querySelectorAll(s)];
  const cl = (v, a, b) => Math.min(b, Math.max(a, v));
  window.NovaFX = window.NovaFX || { q: localStorage.getItem('novacore.fx.q') || 'normal' };
  const rm = matchMedia('(prefers-reduced-motion: reduce)'), fine = matchMedia('(hover:hover) and (pointer:fine)');
  const ok = () => !rm.matches && !d.body.classList.contains('no-animations');
  const guard = (n, f) => { try { f(); } catch (e) { console.warn('[NovaSpace] ' + n + ' :', e.message); } };
  let energy = 0, mood = 0, orbitOpen = false;
  const toggleUI = () => { try { localStorage.setItem('novacore.ui', localStorage.getItem('novacore.ui') === 'classic' ? 'nova' : 'classic'); } catch (e) { /* ignoré */ } location.reload(); };
  window.NovaUI = { toggle: toggleUI };
  if (localStorage.getItem('novacore.ui') === 'classic') {
    guard('retour 3D', () => {
      const b = d.createElement('button'); b.id = 'nfBack3d'; b.type = 'button'; b.innerHTML = '✦ <span>Interface 3D</span>'; b.title = 'Passer à la nouvelle interface 3D (U)'; b.addEventListener('click', toggleUI); d.body.appendChild(b);
      d.addEventListener('keydown', e => { if ((e.key === 'u' || e.key === 'U') && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '') && !e.target.isContentEditable && !e.ctrlKey && !e.metaKey && !e.altKey) toggleUI(); });
    });
    return;
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const webgl = () => { try { const c = d.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } };
  if (reduced.matches || d.body.classList.contains('no-animations') || d.body.classList.contains('perf-lite') || !webgl()) return;
  d.body.classList.add('ns-on');
  const FX = window.NovaFX;
  { const nb = d.createElement('div'); nb.id = 'nsNebula'; nb.setAttribute('aria-hidden', 'true'); d.body.prepend(nb); }

  const ICON = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    projects: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    tasks: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
    notes: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    focus: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    knowledge: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M9 7h6"/>',
    studio: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>',
    novaengine: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 22V12M3 7l9 5 9-5"/>',
    novaseries: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M3 12h18M7 8l3-5M13 8l3-5M19 8l2-4"/>',
    roadmap: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>',
    ai: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    learnlab: '<path d="M9 3h6M10 3v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3"/>',
    cloud: '<path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8z"/>',
    plugins: '<path d="M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0zM12 17v5"/>',
    novastore: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
    api: '<path d="M8 4c-3 0-3 3-3 5s-1 3-3 3c2 0 3 1 3 3s0 5 3 5M16 4c3 0 3 3 3 5s1 3 3 3c-2 0-3 1-3 3s0 5-3 5"/>',
    automation: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    analytics: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    system: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    developer: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
    featurelab: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    anim3d: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 22V12M3 7l9 5 9-5"/><circle cx="12" cy="12" r="2.2"/>',
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    retroedge: '<rect x="2" y="7" width="20" height="10" rx="4"/><path d="M7 10v4M5 12h4"/><circle cx="16" cy="11" r=".8"/><circle cx="18.5" cy="13" r=".8"/>'
  };
  const icon = id => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[id] || ICON.overview) + '</svg>';
  const pages = () => $$('.sidebar .nav[data-page]').map(b => {
    const mark = $('.nav-ico,.retroedge-nav-mark,.nav-novai-mark,.developer-icon', b);
    const lab = $('span:not(.retroedge-nav-mark):not(.nav-novai-mark):not(.developer-icon)', b) || b;
    let g = b.previousElementSibling; while (g && !g.classList.contains('nav-label')) g = g.previousElementSibling;
    return { id: b.dataset.page, label: lab.textContent.trim(), icon: icon(b.dataset.page), tag: ($('.tag', b) || {}).textContent || '', group: g ? g.textContent.trim() : 'COMPTE' };
  });
  const go = id => { const b = $(`.sidebar .nav[data-page="${id}"]`); if (b) b.click(); };
  const current = () => ($('.sidebar .nav.active') || {}).dataset?.page;
  window.NovaNav = { pages, go, current, orbit: () => toggleOrbit() };

  /* ---------- Dock 3D (favoris + historique + anneau) ---------- */
  guard('dock', () => {
    if (!$('.sidebar')) return;
    const P = pages(), fav = ['overview', 'projects', 'tasks', 'notes', 'calendar', 'ai', 'novaengine', 'novaseries'];
    const dock = d.createElement('nav'); dock.id = 'nsDock'; dock.setAttribute('aria-label', 'Navigation NovaCore');
    const mk = (ic, lb, fn, cls = '') => { const b = d.createElement('button'); b.type = 'button'; b.className = 'ns-i ' + cls; b.innerHTML = ic + '<b>' + lb + '</b>'; b.setAttribute('aria-label', lb); b.addEventListener('click', fn); dock.appendChild(b); return b; };
    const sep = () => { const s = d.createElement('i'); s.className = 'ns-sep'; dock.appendChild(s); };
    const items = {};
    fav.map(id => P.find(p => p.id === id)).filter(Boolean).forEach(p => { items[p.id] = mk(p.icon, p.label, () => go(p.id)); items[p.id].dataset.page = p.id; });
    sep(); mk('⌕', 'Rechercher (Ctrl+K)', () => d.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })));
    mk('✦', 'Toutes les pages (O)', () => toggleOrbit(), 'ns-core');
    d.body.appendChild(dock);
    const sync = () => { const c = current(); $$('.ns-i', dock).forEach(b => b.classList.remove('on')); if (items[c]) items[c].classList.add('on'); };
    new MutationObserver(sync).observe($('.sidebar'), { subtree: true, attributes: true, attributeFilter: ['class'] }); sync();
    if (fine.matches) dock.addEventListener('pointermove', e => $$('.ns-i', dock).forEach(b => { const r = b.getBoundingClientRect(); b.style.setProperty('--k', Math.max(0, 1 - Math.abs(e.clientX - (r.left + r.width / 2)) / 90).toFixed(2)); }));
    dock.addEventListener('pointerleave', () => $$('.ns-i', dock).forEach(b => b.style.setProperty('--k', 0)));
  });

  /* ---------- Navigateur 3D : lanceur de toutes les pages ---------- */
  let toggleOrbit = () => {};
  guard('navigateur', () => {
    if (!$('.sidebar')) return;
    const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const ov = d.createElement('div'); ov.id = 'nsOrbit'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Navigation NovaCore');
    ov.innerHTML = `<div class="nn-wrap"><div class="nn-head"><label class="nn-search">${icon('search')}<input id="nnQ" type="text" placeholder="Aller à une page…" autocomplete="off" spellcheck="false"><kbd>Échap</kbd></label><button class="ns-x" type="button" aria-label="Fermer">×</button></div><div class="nn-body" id="nnBody"></div><div class="nn-foot"><span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> naviguer</span><span><kbd>Entrée</kbd> ouvrir</span><span><kbd>G</kbd> + lettre : accès direct</span><span><kbd>Échap</kbd> fermer</span></div></div>`;
    d.body.appendChild(ov);
    const body = $('#nnBody', ov), q = $('#nnQ', ov); let P = [];
    const recent = () => { try { return JSON.parse(localStorage.getItem('novacore.recent') || '[]'); } catch (e) { return []; } };
    const track = () => { const c = current(); if (!c) return; try { localStorage.setItem('novacore.recent', JSON.stringify([c, ...recent().filter(x => x !== c)].slice(0, 8))); } catch (e) { /* ignoré */ } };
    const pt = $('#pageTitle'); if (pt) new MutationObserver(track).observe(pt, { childList: true, characterData: true, subtree: true });
    const keysOf = id => { const m = window.NovaGO || {}, k = Object.keys(m).find(x => m[x][0] === id); return k ? '<span class="nn-keys"><kbd>G</kbd><kbd>' + k.toUpperCase() + '</kbd></span>' : ''; };
    const tile = (p, i) => `<button class="nn-tile${p.id === current() ? ' on' : ''}" type="button" data-id="${p.id}" style="--i:${i}"><span class="nn-ic">${icon(p.id)}</span><strong>${p.label}</strong><small>${p.group}</small>${p.tag ? '<em>' + p.tag + '</em>' : ''}${keysOf(p.id)}</button>`;
    const render = () => {
      const f = norm(q.value.trim()); let n = 0, h = '';
      const list = f ? P.filter(p => norm(p.label + ' ' + p.group + ' ' + p.id).includes(f)) : P;
      if (!f) { const R = recent().map(id => P.find(p => p.id === id)).filter(Boolean).slice(0, 6); if (R.length > 1) h += '<h3 class="nn-g">RÉCENTS</h3><div class="nn-grid">' + R.map(p => tile(p, n++)).join('') + '</div>'; }
      [...new Set(list.map(p => p.group))].forEach(g => { h += `<h3 class="nn-g">${f ? 'RÉSULTATS · ' : ''}${g}</h3><div class="nn-grid">` + list.filter(p => p.group === g).map(p => tile(p, n++)).join('') + '</div>'; });
      body.innerHTML = h || '<p class="nn-empty">Aucune page ne correspond.</p>';
    };
    const tiles = () => $$('.nn-tile', body);
    const open = () => { P = pages(); q.value = ''; render(); orbitOpen = true; FX.kick = 1.2; FX.orbit = true; ov.classList.add('open'); const fq = n => { if (!orbitOpen) return; q.focus({ preventScroll: true }); if (d.activeElement !== q && n < 10) setTimeout(() => fq(n + 1), 90); }; setTimeout(() => fq(0), 60); };
    const close = () => { orbitOpen = false; FX.orbit = false; ov.classList.remove('open'); q.blur(); };
    toggleOrbit = () => (orbitOpen ? close() : open());
    body.addEventListener('click', e => { const t = e.target.closest('.nn-tile'); if (t) { close(); go(t.dataset.id); } });
    body.addEventListener('pointermove', e => { const t = e.target.closest('.nn-tile'); if (!t) return; const r = t.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; t.style.setProperty('--rx', ((.5 - y) * 14).toFixed(1) + 'deg'); t.style.setProperty('--ry', ((x - .5) * 18).toFixed(1) + 'deg'); t.style.setProperty('--gx', (x * 100).toFixed(0) + '%'); t.style.setProperty('--gy', (y * 100).toFixed(0) + '%'); });
    ov.addEventListener('pointermove', e => { ov.style.setProperty('--px', (e.clientX / innerWidth - .5).toFixed(3)); ov.style.setProperty('--py', (e.clientY / innerHeight - .5).toFixed(3)); });
    ov.addEventListener('mousedown', e => { if (e.target === ov || e.target.classList.contains('nn-wrap')) close(); });
    $('.ns-x', ov).addEventListener('click', close); q.addEventListener('input', render);
    addEventListener('keydown', e => { if (orbitOpen && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) e.stopPropagation(); }, true);
    q.addEventListener('keydown', e => { if (e.key.length === 1) e.stopPropagation(); }); q.addEventListener('keypress', e => e.stopPropagation()); q.addEventListener('keyup', e => e.stopPropagation());
    const move = dir => {
      const T = tiles(); if (!T.length) return; const cur = T.indexOf(d.activeElement); if (cur < 0) { T[0].focus(); return; }
      if (dir === 'l') T[Math.max(0, cur - 1)].focus(); else if (dir === 'r') T[Math.min(T.length - 1, cur + 1)].focus();
      else { const r = T[cur].getBoundingClientRect(); let best = null, bd = 1e9; T.forEach(t => { const b = t.getBoundingClientRect(), dy = (b.top - r.top) * (dir === 'd' ? 1 : -1); if (dy > 10) { const dist = dy * 2 + Math.abs(b.left - r.left); if (dist < bd) { bd = dist; best = t; } } }); if (best) best.focus(); else if (dir === 'u') q.focus(); }
    };
    const overlayOpen = () => !!$('#nsOrbit.open,#commandPalette:not([hidden]),#authGate.visible,#termsGate.visible,#modalBackdrop.open,#novaTour.visible,#nfHelp.on,#nfOpts.on,#nfSeq.on,#nfBack3d');
    d.addEventListener('keydown', e => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target.tagName || '')) || e.target.isContentEditable;
      if (!orbitOpen) { if ((e.key === 'o' || e.key === 'O') && !typing && !overlayOpen() && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); open(); } return; }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); move('d'); } else if (e.key === 'ArrowUp') { e.preventDefault(); move('u'); }
      else if (e.key === 'ArrowRight' && d.activeElement !== q) { e.preventDefault(); move('r'); } else if (e.key === 'ArrowLeft' && d.activeElement !== q) { e.preventDefault(); move('l'); }
      else if (e.key === 'Enter' && d.activeElement === q) { const t = tiles()[0]; if (t) { close(); go(t.dataset.id); } }
    });
  });

  /* ---------- Cartes en relief ---------- */
  guard('cartes', () => {
    if (!fine.matches) return;
    const SEL = '.card,.project-card,.note-card,.featurelab-card,.roadmap-item,.search-card,.novaos-widget,.novaos-hero,.store-hero,.series-hero,.engine-command-hero';
    let cur = null, raf = 0, ev = null;
    const reset = el => { if (el) { el.classList.remove('n3d-live'); el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); } };
    const apply = () => { raf = 0; if (!cur || !ev) return; const r = cur.getBoundingClientRect(); if (!r.width) return; const x = cl((ev.clientX - r.left) / r.width, 0, 1), y = cl((ev.clientY - r.top) / r.height, 0, 1), a = (r.width > 640 || r.height > 380) ? 2.4 : 8; cur.style.setProperty('--rx', ((.5 - y) * a).toFixed(2) + 'deg'); cur.style.setProperty('--ry', ((x - .5) * a * 1.2).toFixed(2) + 'deg'); cur.style.setProperty('--gx', (x * 100).toFixed(1) + '%'); cur.style.setProperty('--gy', (y * 100).toFixed(1) + '%'); };
    d.addEventListener('pointermove', e => {
      if (!ok() || orbitOpen) return; const el = e.target.closest ? e.target.closest(SEL) : null;
      if (el !== cur) { reset(cur); cur = el && !el.closest('.modal,.access-gate,.nova-tutorial') ? el : null; if (cur) { cur.classList.add('n3d-tilt', 'n3d-live'); if (!cur.querySelector(':scope > .n3d-glare') && getComputedStyle(cur).position !== 'static') { const s = d.createElement('span'); s.className = 'n3d-glare'; s.setAttribute('aria-hidden', 'true'); cur.appendChild(s); } } }
      ev = e; if (cur && !raf) raf = requestAnimationFrame(apply);
    }, { passive: true });
  });

  /* ---------- Entrée de page depuis l'espace ---------- */
  guard('transition', () => {
    const t = $('#pageTitle'), v = $('#view'); if (!t || !v) return; let id = 0;
    new MutationObserver(() => { if (!ok()) return; v.classList.remove('ns-enter'); void v.offsetWidth; v.classList.add('ns-enter'); clearTimeout(id); id = setTimeout(() => v.classList.remove('ns-enter'), 1000); }).observe(t, { childList: true, characterData: true, subtree: true });
  });
})();
