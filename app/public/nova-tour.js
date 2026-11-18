/* NovaCore 3.10.0 — tutoriel de bienvenue détaillé.
   Visite guidée en 8 étapes : navigation au clavier, focus piégé dans la carte,
   restauration du focus à la fermeture, persistance via `nova:tourdone`.
   API : window.NovaTour = { start, close, isOpen, version, total }.
   Aucune dépendance réseau, aucun identifiant, aucun accès aux données du compte. */
(() => {
  'use strict';

  const VERSION = 1;
  const TOTAL = 8;
  const CONTAINER_ID = 'novaTour';

  /* Repli français si i18n.js n'est pas chargé : le tutoriel ne doit jamais rester vide. */
  const FALLBACK = [
    ['Un seul espace, tous tes outils', 'NovaCore réunit création, organisation et développement dans une interface unique. Ce guide de deux minutes présente les modules essentiels et les raccourcis qui font gagner du temps.'],
    ['La navigation', 'La barre latérale donne accès à tous les modules. Ctrl+K ouvre la palette de commandes, la touche O affiche l’anneau des pages, et G puis une lettre mène directement à un écran. Le bouton + Nouveau crée l’élément adapté à la page courante.'],
    ['Créer et organiser', 'Projets, Tâches, Notes, Calendrier et Nova Focus partagent le même espace de travail. Les projets suivent leur progression, les tâches se terminent en un clic et le calendrier relie les échéances aux tâches réelles.'],
    ['Créer sans limites', 'Nova Engine configure et teste le socle C++, NovaSeries Studio prépare séries et storyboards, Studio 3D personnalise les animations de chaque page, et RetroEdge présente la plateforme portable.'],
    ['NOVAI, ton copilote', 'NOVAI lit le contexte de ton espace et peut exécuter des actions whitelistées : naviguer, créer un projet, une tâche, une note, une ressource ou modifier un réglage. Les suppressions demandent toujours une confirmation explicite.'],
    ['Apprendre et étendre', 'Learn Lab versionne tes jeux de données et compare les évaluations. NovaCloud synchronise ton espace, NovaPlugins étend l’interface et NovaStore prépare la future place de marché.'],
    ['À ton image', 'Change le thème, la couleur d’accent, la taille du texte, la langue FR/EN et le mode performance depuis Compte & sécurité ou les options rapides. Chaque réglage est enregistré dans ton espace.'],
    ['Tes données restent à toi', 'Le workspace est stocké localement puis synchronisé avec ton NovaID. Exporte une sauvegarde JSON à tout moment. Le mode privé coupe la synchronisation et conserve tout sur cet appareil.']
  ];

  const tr = (key, fallback) => {
    try {
      const value = window.t ? window.t(key) : key;
      return typeof value === 'string' && value && value !== key ? value : fallback;
    } catch { return fallback; }
  };

  let open = false;
  let index = 0;
  let dontShow = false;
  let lastFocus = null;
  let nodes = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function stepCopy(step) {
    const fallback = FALLBACK[step - 1] || FALLBACK[0];
    return {
      title: tr('tour.step' + step + '.title', fallback[0]),
      text: tr('tour.step' + step + '.text', fallback[1])
    };
  }

  function build(container) {
    container.innerHTML = '';
    const card = el('div', 'tour-card');
    card.setAttribute('role', 'document');

    const head = el('div', 'tour-head');
    const eyebrow = el('span', 'eyebrow', tr('tour.welcome', 'Bienvenue dans NovaCore'));
    const close = el('button', 'icon-btn tour-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', tr('tour.skip', 'Passer le tutoriel'));
    close.addEventListener('click', () => closeTour({ skipped: true, persist: dontShow }));
    head.append(eyebrow, close);

    const progress = el('div', 'tour-progress');
    const bar = el('i');
    bar.style.width = '0%';
    progress.appendChild(bar);

    const body = el('div', 'tour-body');
    body.setAttribute('aria-live', 'polite');
    const stepLabel = el('p', 'eyebrow tour-step', '');
    const title = el('h2', '', '');
    title.id = 'novaTourTitle';
    const text = el('p', '', '');
    body.append(stepLabel, title, text);

    const actions = el('div', 'tour-actions');
    const label = el('label', 'tour-dontshow');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = dontShow;
    checkbox.addEventListener('change', () => { dontShow = checkbox.checked; });
    label.append(checkbox, document.createTextNode(' ' + tr('tour.dontShow', 'Ne plus afficher au démarrage')));

    const buttons = el('div', 'tour-buttons');
    const skip = el('button', 'secondary', tr('tour.skip', 'Passer le tutoriel'));
    skip.type = 'button';
    skip.dataset.tour = 'skip';
    skip.addEventListener('click', () => closeTour({ skipped: true, persist: dontShow }));
    const back = el('button', 'secondary', tr('tour.back', 'Précédent'));
    back.type = 'button';
    back.dataset.tour = 'back';
    back.addEventListener('click', () => go(index - 1));
    const next = el('button', 'primary', tr('tour.next', 'Suivant'));
    next.type = 'button';
    next.dataset.tour = 'next';
    next.addEventListener('click', () => (index >= TOTAL - 1 ? finish() : go(index + 1)));
    buttons.append(skip, back, next);
    actions.append(label, buttons);

    const dots = el('div', 'tour-dot-row');
    dots.setAttribute('aria-hidden', 'true');
    const dotNodes = [];
    for (let i = 0; i < TOTAL; i++) {
      const dot = el('span');
      dotNodes.push(dot);
      dots.appendChild(dot);
    }

    card.append(head, progress, body, actions, dots);
    container.appendChild(card);

    nodes = { container, card, bar, stepLabel, title, text, back, next, dots: dotNodes };
  }

  function render() {
    if (!nodes) return;
    const step = index + 1;
    const copy = stepCopy(step);
    nodes.bar.style.width = ((step / TOTAL) * 100).toFixed(2) + '%';
    nodes.stepLabel.textContent = tr('tour.step', 'Étape {n} sur {total}')
      .replace('{n}', String(step)).replace('{total}', String(TOTAL));
    nodes.title.textContent = copy.title;
    nodes.text.textContent = copy.text;
    nodes.back.disabled = index === 0;
    const last = index === TOTAL - 1;
    nodes.next.textContent = last ? tr('tour.finish', 'Ouvrir NovaOS') : tr('tour.next', 'Suivant');
    nodes.next.dataset.tour = last ? 'finish' : 'next';
    nodes.dots.forEach((dot, i) => dot.classList.toggle('on', i === index));
    nodes.card.setAttribute('aria-label', tr('tour.label', 'Tutoriel de bienvenue NovaCore'));
    nodes.card.scrollTop = 0;
  }

  function go(step) {
    index = Math.max(0, Math.min(TOTAL - 1, step));
    render();
    try { nodes.next.focus({ preventScroll: true }); } catch { /* focus facultatif */ }
  }

  function closeTour(options = {}) {
    if (!open) return false;
    open = false;
    if (nodes && nodes.container) {
      nodes.container.hidden = true;
      nodes.container.classList.remove('visible');
      nodes.container.innerHTML = '';
    }
    nodes = null;
    document.removeEventListener('keydown', onKeydown, true);
    document.body.classList.remove('nova-tour-open');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus({ preventScroll: true }); } catch { /* élément détaché */ }
    }
    lastFocus = null;
    document.dispatchEvent(new CustomEvent('nova:tourdone', {
      detail: { version: VERSION, skipped: options.skipped === true, persist: options.persist !== false }
    }));
    return true;
  }

  function finish() { closeTour({ skipped: false, persist: true }); }

  function focusables() {
    if (!nodes || !nodes.card) return [];
    return Array.from(nodes.card.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
      .filter(node => node.offsetParent !== null || node === document.activeElement);
  }

  function onKeydown(event) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeTour({ skipped: true, persist: dontShow });
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (index >= TOTAL - 1) finish(); else go(index + 1);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (index > 0) go(index - 1);
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || !nodes.card.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function start(force = false) {
    const container = document.getElementById(CONTAINER_ID);
    if (!container) return false;
    if (!open) {
      lastFocus = document.activeElement;
      dontShow = false;
      index = 0;
      build(container);
      container.hidden = false;
      document.body.classList.add('nova-tour-open');
      document.addEventListener('keydown', onKeydown, true);
      open = true;
    } else if (force) {
      index = 0;
      dontShow = false;
      if (nodes) {
        const checkbox = nodes.container.querySelector('.tour-dontshow input');
        if (checkbox) checkbox.checked = false;
      }
    }
    render();
    const target = nodes && nodes.container.querySelector('[data-tour="next"], [data-tour="finish"]');
    setTimeout(() => { try { target && target.focus({ preventScroll: true }); } catch { /* focus facultatif */ } }, 40);
    return true;
  }

  window.NovaTour = {
    start,
    close: () => closeTour({ skipped: true, persist: false }),
    isOpen: () => open,
    version: VERSION,
    total: TOTAL
  };
})();
