/* NovaCore 2.20 — moteur de mouvement.
   Principes : (1) jamais bloquant — chaque module est isolé par try/catch ;
   (2) transform/opacity uniquement, une seule boucle rAF ; (3) respecte prefers-reduced-motion
   ET la préférence « animations » de l'application (body.no-animations) à chaque usage. */
(() => {
  'use strict';
  const doc = document, root = doc.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const $ = (s, r = doc) => r.querySelector(s);
  const $$ = (s, r = doc) => Array.from(r.querySelectorAll(s));
  const canAnimate = () => !reduced.matches && !(doc.body && (doc.body.classList.contains('no-animations') || doc.body.classList.contains('perf-lite')));
  const guard = (name, fn) => { try { fn(); } catch (e) { console.warn(`[NovaMotion] ${name} désactivé :`, e.message); } };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------------------------------------------------------------- Révélations en cascade */
  const REVEAL = '.novaos-hero,.novaos-retroedge-spotlight,.novaos-widget,.card,.project-card,.note-card,.series-hero,.store-hero,.engine-command-hero,.roadmap-item,.search-card,.featurelab-card,.novaos-launch,.focus-card,.knowledge-item,.learn-item,.glass-panel,.ai-chat-card';
  let io = null, batchStart = 0, lastPage = null;

  function pickTargets(view) {
    const all = $$(REVEAL, view).filter(el => !el.closest('.retroedge-page, .re-reveal, .rv'));
    return all.filter(el => !all.some(o => o !== el && o.contains(el))); // pas d'animation imbriquée
  }
  function onRevealed(el) {
    guard('compteurs', () => countUp(el));
    guard('barres', () => fillBars(el));
  }
  function countUp(el) {
    const nodes = el.matches('.stat-value,.novaos-kpis b,.novaos-kpi-total,.series-metrics b,[data-count]') ? [el] : $$('.stat-value,.novaos-kpis b,.novaos-kpi-total,.series-metrics b,[data-count]', el);
    for (const n of nodes) {
      if (n.dataset.counted || n.children.length) continue;
      const m = n.textContent.trim().match(/^([^\d-]*)(-?\d+(?:[.,]\d+)?)(\D*)$/);
      if (!m) continue;
      n.dataset.counted = '1';
      const decimals = (m[2].split(/[.,]/)[1] || '').length, sep = m[2].includes(',') ? ',' : '.', target = parseFloat(m[2].replace(',', '.'));
      if (!isFinite(target) || Math.abs(target) > 1e9 || target === 0) continue;
      const t0 = performance.now(), dur = clamp(500 + Math.log10(Math.abs(target) + 1) * 260, 600, 1400);
      const tick = now => {
        const p = clamp((now - t0) / dur, 0, 1), e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
        const val = (target * e).toFixed(decimals).replace('.', sep);
        n.textContent = m[1] + val + m[3];
        if (p < 1) requestAnimationFrame(tick); else n.textContent = m[0].trim();
      };
      n.textContent = m[1] + (0).toFixed(decimals).replace('.', sep) + m[3];
      requestAnimationFrame(tick);
    }
  }
  function fillBars(el) {
    const bars = $$('.progress>span,.progress>i,.novaos-progress>span,.novaos-progress>i,.series-progress-track>span', el);
    for (const b of bars) {
      if (!b.style.width) continue;
      b.classList.add('nc-fill-pending');
      requestAnimationFrame(() => requestAnimationFrame(() => b.classList.remove('nc-fill-pending')));
    }
  }
  function stagger(view) {
    if (!canAnimate() || !view) return;
    if (io) io.disconnect();
    batchStart = performance.now();
    const nodes = pickTargets(view);
    nodes.forEach((el, i) => { el.classList.add('rv'); el.style.setProperty('--rv-i', String(Math.min(i, 9))); });
    io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target;
        if (performance.now() - batchStart > 500) el.style.setProperty('--rv-i', '0'); // défilement : pas de retard
        el.classList.add('rv-in'); io.unobserve(el); onRevealed(el);
      }
    }, { rootMargin: '0px 0px -5% 0px', threshold: 0.04 });
    nodes.forEach(el => io.observe(el));
    // Filet de sécurité : si l'observateur ne répond pas (onglet masqué), rien ne reste invisible dans l'écran.
    setTimeout(() => nodes.forEach(el => { if (!el.classList.contains('rv-in') && el.getBoundingClientRect().top < innerHeight * 1.5) { el.classList.add('rv-in'); onRevealed(el); } }), 2200);
  }
  function replay() {
    const view = $('#view'); if (!view) return;
    $$('.rv', view).forEach(el => { el.classList.remove('rv', 'rv-in'); el.style.removeProperty('--rv-i'); });
    stagger(view);
  }
  guard('révélations', () => {
    const view = $('#view'); if (!view) return;
    const currentPage = () => { const a = $('.sidebar .nav.active'); return a ? a.dataset.page : null; };
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return; scheduled = true;
      queueMicrotask(() => { // avant la peinture : aucun flash de contenu non animé
        scheduled = false;
        const p = currentPage();
        if (p !== lastPage) { lastPage = p; stagger(view); root.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); root.style.scrollBehavior = ''; }
      });
    }).observe(view, { childList: true });
    lastPage = null; if (view.children.length) { lastPage = currentPage(); stagger(view); }
    // Rejouer l'entrée une fois l'introduction et les écrans d'accès fermés.
    const rewatch = el => el && new MutationObserver(() => { if (el.classList.contains('is-hidden') || !el.classList.contains('visible')) requestAnimationFrame(replay); }).observe(el, { attributes: true, attributeFilter: ['class'] });
    rewatch($('#novaIntro')); rewatch($('#termsGate')); rewatch($('#authGate'));
  });

  /* ---------------------------------------------------------------- Titre de page */
  guard('titre', () => {
    const t = $('#pageTitle'); if (!t) return;
    let last = t.textContent;
    new MutationObserver(() => { if (t.textContent === last) return; last = t.textContent; if (!canAnimate()) return; t.classList.remove('title-swap'); void t.offsetWidth; t.classList.add('title-swap'); }).observe(t, { childList: true, characterData: true, subtree: true });
  });

  /* ---------------------------------------------------------------- Indicateur de navigation (glisse entre les entrées) */
  guard('indicateur', () => {
    const side = $('.sidebar'); if (!side) return;
    const ind = doc.createElement('div'); ind.className = 'nav-indicator instant'; ind.setAttribute('aria-hidden', 'true'); side.appendChild(ind);
    let first = true, lastActive = $('.nav.active', side);
    const place = () => {
      const act = $('.nav.active', side);
      if (!act) { if (ind.classList.contains('ready')) ind.classList.remove('ready'); return; }
      const s = side.getBoundingClientRect(), r = act.getBoundingClientRect();
      if (!r.width) return;
      ind.style.width = r.width + 'px'; ind.style.height = r.height + 'px';
      ind.style.transform = `translate3d(${r.left - s.left + side.scrollLeft}px,${r.top - s.top + side.scrollTop}px,0)`;
      // Ne pas réécrire une classe déjà présente : la mutation relançait le MutationObserver
      // en boucle et scrollIntoView ramenait la barre sur l'entrée active pendant le défilement.
      if (!ind.classList.contains('ready')) ind.classList.add('ready');
      if (first) { first = false; requestAnimationFrame(() => { if (ind.classList.contains('instant')) ind.classList.remove('instant'); }); }
    };
    const sched = () => requestAnimationFrame(place);
    // Ignorer les mutations de l'indicateur lui-même : seul l'état des entrées .nav compte.
    new MutationObserver(records => {
      if (records.some(r => r.target !== ind && r.target.classList && r.target.classList.contains('nav'))) sched();
    }).observe(side, { attributes: true, attributeFilter: ['class'], subtree: true });
    addEventListener('resize', sched, { passive: true });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(sched).observe(side);
    doc.fonts && doc.fonts.ready.then(sched);
    sched();
    // Faire défiler l'entrée active uniquement lorsqu'elle change réellement : un simple
    // défilement manuel de la barre ne doit jamais être annulé.
    new MutationObserver(() => {
      const a = $('.nav.active', side);
      if (!a || a === lastActive) return;
      lastActive = a;
      if (canAnimate()) a.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }).observe(side, { attributes: true, attributeFilter: ['class'], subtree: true });
  });

  /* ---------------------------------------------------------------- Colonne d'icônes alignée dans la navigation */
  guard('icônes', () => {
    $$('.sidebar .nav').forEach(n => {
      const first = n.firstChild;
      if (first && first.nodeType === 3 && first.textContent.trim()) {
        const i = doc.createElement('i'); i.className = 'nav-ico'; i.setAttribute('aria-hidden', 'true'); i.textContent = first.textContent.trim(); n.replaceChild(i, first);
      }
    });
  });

  /* ---------------------------------------------------------------- Ondulation au clic */
  guard('ondulation', () => {
    doc.addEventListener('pointerdown', e => {
      if (!canAnimate() || e.button > 0) return;
      const el = e.target.closest && e.target.closest('.primary,.secondary,.icon-btn,.sidebar .nav,.novaos-hero-shortcuts button');
      if (!el || el.disabled) return;
      const r = el.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2.2;
      const s = doc.createElement('span'); s.className = 'nc-ripple';
      s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      el.appendChild(s); s.addEventListener('animationend', () => s.remove(), { once: true });
      setTimeout(() => s.remove(), 900);
    }, { passive: true });
  });

  /* ---------------------------------------------------------------- Halo qui suit le pointeur sur les cartes */
  guard('halo', () => {
    const SPOT = '.card,.novaos-widget,.project-card,.note-card,.featurelab-card,.roadmap-item,.search-card,.novaos-launch';
    let pending = null, ticking = false;
    doc.addEventListener('pointermove', e => {
      if (!finePointer.matches || !canAnimate()) return;
      const el = e.target.closest && e.target.closest(SPOT); if (!el) return;
      pending = { el, x: e.clientX, y: e.clientY };
      if (ticking) return; ticking = true;
      requestAnimationFrame(() => {
        ticking = false; if (!pending) return;
        const { el, x, y } = pending, r = el.getBoundingClientRect();
        if (!el.querySelector(':scope>.nc-spot')) {
          if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
          const s = doc.createElement('i'); s.className = 'nc-spot'; s.setAttribute('aria-hidden', 'true'); el.prepend(s);
        }
        el.style.setProperty('--mx', (x - r.left) + 'px'); el.style.setProperty('--my', (y - r.top) + 'px');
      });
    }, { passive: true });
  });

  /* ---------------------------------------------------------------- Parallaxe douce (lissée, une seule boucle) */
  const par = { tx: 0, ty: 0, x: 0, y: 0, running: false };
  guard('parallaxe', () => {
    const loop = () => {
      par.x += (par.tx - par.x) * 0.08; par.y += (par.ty - par.y) * 0.08;
      root.style.setProperty('--px', par.x.toFixed(4)); root.style.setProperty('--py', par.y.toFixed(4));
      if (Math.abs(par.tx - par.x) > 0.001 || Math.abs(par.ty - par.y) > 0.001) requestAnimationFrame(loop); else par.running = false;
    };
    doc.addEventListener('pointermove', e => {
      if (!finePointer.matches || !canAnimate()) return;
      par.tx = (e.clientX / innerWidth - 0.5) * 2; par.ty = (e.clientY / innerHeight - 0.5) * 2;
      if (!par.running) { par.running = true; requestAnimationFrame(loop); }
    }, { passive: true });
  });

  /* ---------------------------------------------------------------- Défilement : barre de progression + en-tête */
  guard('défilement', () => {
    const bar = doc.createElement('div'); bar.className = 'nc-scroll-progress'; bar.setAttribute('aria-hidden', 'true'); doc.body.appendChild(bar);
    let ticking = false;
    const update = () => {
      ticking = false;
      const max = Math.max(1, root.scrollHeight - innerHeight), y = scrollY;
      bar.style.transform = `scaleX(${clamp(y / max, 0, 1)})`;
      doc.body.classList.toggle('is-scrolled', y > 8);
    };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    addEventListener('resize', update, { passive: true }); update();
  });

  /* ---------------------------------------------------------------- Modales : sortie animée (sans casser les appels synchrones existants) */
  guard('modales', () => {
    const bd = $('#modalBackdrop'); if (!bd || typeof window.closeModal !== 'function' || typeof window.openModal !== 'function') return;
    const origClose = window.closeModal, origOpen = window.openModal; let timer = null;
    window.openModal = function () { clearTimeout(timer); timer = null; bd.classList.remove('closing'); return origOpen.apply(this, arguments); };
    window.closeModal = function () {
      if (!bd.classList.contains('open') || !canAnimate()) { clearTimeout(timer); timer = null; bd.classList.remove('closing'); return origClose.apply(this, arguments); }
      if (timer) return;
      bd.classList.add('closing');
      timer = setTimeout(() => { timer = null; bd.classList.remove('closing'); origClose(); }, 170);
    };
    // app.js lie closeModal par référence : on intercepte en phase de capture pour passer par la version animée.
    const closeBtn = $('#modalClose');
    if (closeBtn) closeBtn.addEventListener('click', e => { e.stopImmediatePropagation(); window.closeModal(); }, true);
    bd.addEventListener('click', e => { if (e.target === bd) { e.stopImmediatePropagation(); window.closeModal(); } }, true);
    // Accessibilité clavier : Échap ferme la modale et rend le focus à l'élément qui l'avait ouverte.
    let opener = null;
    new MutationObserver(() => { if (bd.classList.contains('open') && !bd.classList.contains('closing')) { if (!opener) opener = doc.activeElement; requestAnimationFrame(() => { const f = $('input,textarea,select,button:not(#modalClose)', $('#modalBody')); if (f && !bd.contains(doc.activeElement)) f.focus({ preventScroll: true }); }); } else if (!bd.classList.contains('open') && opener) { try { opener.focus({ preventScroll: true }); } catch { /* élément disparu */ } opener = null; } }).observe(bd, { attributes: true, attributeFilter: ['class'] });
    doc.addEventListener('keydown', e => { if (e.key === 'Escape' && bd.classList.contains('open') && !bd.classList.contains('closing')) { e.preventDefault(); window.closeModal(); } });
  });

  /* ---------------------------------------------------------------- Ciel étoilé (canvas) */
  guard('étoiles', () => {
    const cv = $('#novaStars'); if (!cv) return;
    const ctx = cv.getContext('2d', { alpha: true }); if (!ctx) return;
    let w = 0, h = 0, dpr = 1, stars = [], shoot = null, nextShoot = performance.now() + 5000, raf = 0, rgb = '139,108,255';
    const readAccent = () => { const v = getComputedStyle(root).getPropertyValue('--accent-rgb').trim() || getComputedStyle(doc.body).getPropertyValue('--accent-rgb').trim(); rgb = /^\d+\s*,\s*\d+\s*,\s*\d+$/.test(v) ? v : '139,108,255'; };
    const seed = () => {
      const count = clamp(Math.round((w * h) / 16000), 28, 110);
      stars = Array.from({ length: count }, () => ({ x: Math.random() * w, y: Math.random() * h, z: Math.random() * 0.9 + 0.1, r: Math.random() * 1.2 + 0.25, tw: Math.random() * Math.PI * 2, sp: Math.random() * 0.8 + 0.25, tint: Math.random() < 0.22 }));
    };
    const resize = () => { dpr = Math.min(devicePixelRatio || 1, 2); w = innerWidth; h = innerHeight; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); seed(); draw(performance.now(), true); };
    function draw(t, still) {
      ctx.clearRect(0, 0, w, h);
      const ox = par.x * 14, oy = par.y * 10;
      for (const s of stars) {
        const a = still ? 0.45 * s.z : (0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.001 * s.sp + s.tw))) * s.z;
        ctx.fillStyle = s.tint ? `rgba(${rgb},${a.toFixed(3)})` : `rgba(214,228,255,${a.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(((s.x + ox * s.z) % w + w) % w, ((s.y + oy * s.z) % h + h) % h, s.r * (0.6 + s.z * 0.6), 0, 6.2832); ctx.fill();
      }
      if (shoot) {
        const k = (t - shoot.t0) / shoot.dur;
        if (k >= 1) shoot = null; else {
          const x = shoot.x + shoot.dx * k, y = shoot.y + shoot.dy * k, len = 120 * (1 - k * 0.4);
          const g = ctx.createLinearGradient(x, y, x - shoot.dx / shoot.dist * len, y - shoot.dy / shoot.dist * len);
          g.addColorStop(0, `rgba(235,244,255,${(0.85 * (1 - k)).toFixed(3)})`); g.addColorStop(1, 'rgba(235,244,255,0)');
          ctx.strokeStyle = g; ctx.lineWidth = 1.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - shoot.dx / shoot.dist * len, y - shoot.dy / shoot.dist * len); ctx.stroke();
        }
      }
    }
    let lastDraw = 0;
    function frame(t) {
      raf = 0; if (doc.hidden || !doc.hasFocus() || !canAnimate() || doc.body.classList.contains('ns-on')) { draw(t, true); return; }
      if (t - lastDraw < 33) { raf = requestAnimationFrame(frame); return; } // plafond ~30 fps : fond d'ambiance, pas de gaspillage
      lastDraw = t;
      if (!shoot && t > nextShoot) { const dx = 260 + Math.random() * 220, dy = 110 + Math.random() * 120; shoot = { x: Math.random() * w * 0.7, y: Math.random() * h * 0.4, dx, dy, dist: Math.hypot(dx, dy), t0: t, dur: 900 + Math.random() * 500 }; nextShoot = t + 7000 + Math.random() * 9000; }
      draw(t, false); raf = requestAnimationFrame(frame);
    }
    const start = () => { if (!raf && canAnimate() && !doc.hidden && doc.hasFocus() && !doc.body.classList.contains('ns-on')) raf = requestAnimationFrame(frame); };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; draw(performance.now(), true); };
    readAccent(); resize();
    let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(resize, 150); }, { passive: true });
    doc.addEventListener('visibilitychange', () => doc.hidden ? stop() : start());
    addEventListener('blur', stop, { passive: true });
    addEventListener('focus', start, { passive: true });
    reduced.addEventListener && reduced.addEventListener('change', () => canAnimate() ? start() : stop());
    new MutationObserver(() => { readAccent(); canAnimate() ? start() : stop(); }).observe(doc.body, { attributes: true, attributeFilter: ['class', 'data-accent', 'data-theme'] });
    start();
  });

  /* ---------------------------------------------------------------- Accessibilité : lien d'évitement + annonces */
  guard('accessibilité', () => {
    const toast = $('#toast'); if (toast) { toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); toast.setAttribute('aria-atomic', 'true'); }
    const main = $('main.main'); if (main && !main.id) { main.id = 'contenu'; main.setAttribute('tabindex', '-1'); }
  });

  window.NovaMotion = { replay, canAnimate };
})();
