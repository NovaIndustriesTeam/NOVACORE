// NovaCore — service worker.
// Le nom du cache est résolu depuis /api/version : une mise à jour de l'application
// invalide automatiquement l'ancien cache au lieu de dépendre d'une chaîne figée.
const FALLBACK_VERSION='3.10.0';
// Jeton de révision du cache : à incrémenter dès qu'un fichier du SHELL change
// sans bump de version, pour que le correctif remplace l'ancien cache.
const CACHE_REVISION='2026-11-17-animation-loops-fix-1';
const SHELL=['/','/index.html','/milenium.css','/nova-perf.css','/nova-ui.css','/feature-lab-model.js','/series-model.js','/i18n.js','/app.js','/nova-commands.js','/nova-tour.js','/motion.js','/boot.js','/three.min.js','/loading-genesis.js','/nova-space.js','/studio-3d.js','/nova-scene.js','/design-shell.js','/manifest.webmanifest','/robots.txt','/nova-industries-poster.png','/retroedge-metal-logo.png','/retroedge-emblem.png','/retroedge-emblem-transparent.png'];
let cacheNamePromise=null;
function resolveCacheName(){
  if(!cacheNamePromise){
    cacheNamePromise=fetch('/api/version',{cache:'no-store'})
      .then(r=>r.ok?r.json():null)
      .then(info=>`novacore-shell-v${(info&&info.version)||FALLBACK_VERSION}-${CACHE_REVISION}`)
      .catch(()=>`novacore-shell-v${FALLBACK_VERSION}-${CACHE_REVISION}`);
  }
  return cacheNamePromise;
}
self.addEventListener('install',e=>e.waitUntil((async()=>{
  const cacheName=await resolveCacheName();
  const cache=await caches.open(cacheName);
  await cache.addAll(SHELL);
  await self.skipWaiting();
})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  const cacheName=await resolveCacheName();
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k!==cacheName).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.pathname.startsWith('/api/')||u.pathname.startsWith('/nova-engine/api/'))return;
  e.respondWith((async()=>{
    const hit=await caches.match(e.request);
    if(hit)return hit;
    const response=await fetch(e.request);
    if(response.ok&&u.origin===location.origin){
      const cacheName=await resolveCacheName();
      const cache=await caches.open(cacheName);
      cache.put(e.request,response.clone());
    }
    return response;
  })());
});
