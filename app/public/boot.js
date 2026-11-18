// Démarrage : filet de sécurité de l'introduction + enregistrement du service worker.
// (Déplacé hors de index.html pour permettre, à terme, une CSP sans script inline.)
window.setTimeout(function () {
  var intro = document.getElementById('novaIntro');
  if (intro && !intro.classList.contains('is-hidden')) intro.classList.add('is-hidden');
}, 12000);
if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
  navigator.serviceWorker.register('/sw.js').catch(function () {});
}
