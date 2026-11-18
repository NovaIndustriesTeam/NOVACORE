/* NovaCore 4.4 — SCÈNE 3D DE FOND (optimisée).
   • Morphing de formes calculé sur le GPU (aucune boucle CPU par image).
   • Nombre d'images adaptatif (plein régime en interaction, 30 puis 15 i/s au repos), pause hors-onglet.
   • Densité, résolution et effets réglables ; dégradation automatique si la machine peine (l'interface ne bascule jamais).
   • Formes, couleurs et réglages pilotés par window.NovaAnim (Studio 3D). */
(() => {
  'use strict';
  const d = document, TAU = 6.2832, rnd = Math.random, cl = (v, a, b) => Math.min(b, Math.max(a, v));
  const gs = () => (rnd() + rnd() + rnd() - 1.5) * .8;
  const sph = R => { const z = rnd() * 2 - 1, a = rnd() * TAU, s = Math.sqrt(1 - z * z); return [R * s * Math.cos(a), R * z, R * s * Math.sin(a)]; };
  const MODE = { galaxy: 'gal', vortex: 'gal', wave: 'wave', tunnel: 'tun', retro: 'tun', rain: 'rain' };
  const TINT = { galaxy: [1, 1, 1], vortex: [1, .95, .9], grid: [.6, 1, .9], cubelat: [.7, .95, 1], neural: [.7, .9, 1], brain: [1, .75, .95], cloud: [.85, .92, 1], techsphere: [.6, 1, 1], sphere: [.75, .9, 1], saturn: [1, .9, .75], rings: [1, .88, .6], wave: [.7, 1, .95], bars: [.75, 1, .7], helix: [.8, 1, .7], knot: [1, .75, .95], circuit: [.6, 1, .85], torus: [1, .7, .5], portal: [.8, .7, 1], retro: [1, .55, .95], tunnel: [.78, .74, 1], rain: [.6, 1, .7], modules: [.9, .85, 1], orbital: [1, .85, .7], holo: [.55, .95, 1] };
  const RX = { galaxy: .5, vortex: .15, grid: .3, cubelat: .35, neural: .2, brain: .2, cloud: .25, techsphere: .2, sphere: .2, saturn: .45, rings: .6, wave: .12, bars: .35, helix: .35, knot: .25, circuit: .45, torus: .5, portal: 0, retro: 0, tunnel: 0, rain: 0, modules: .3, orbital: .5, holo: .25 };

  /* ---------- Générateurs de formes (purs : servent aussi aux miniatures) ---------- */
  function gen(k, N, perm, rg) {
    const a = new Float32Array(N * 3), n = Math.round(Math.cbrt(N));
    const hubs = Array.from({ length: 60 }, () => k === 'brain' ? sph(Math.cbrt(rnd()) * 6.5) : sph(6)), cols = Array.from({ length: 81 }, () => 1 + rnd() * 5.5), blobs = Array.from({ length: 9 }, () => [(rnd() - .5) * 13, (rnd() - .3) * 4, (rnd() - .5) * 8, 1.4 + rnd() * 1.6]), mods = Array.from({ length: 12 }, () => sph(Math.cbrt(rnd()) * 6)), prods = Array.from({ length: 14 }, (_, j) => [2.2 + (j % 3) * 2.4, j * 2.4 + rnd(), (rnd() - .5) * .8]);
    for (let i = 0; i < N; i++) {
      const ii = perm ? perm[i] : i, t = ii / N, u = rnd(), v = rnd(), w = rnd(); let x = 0, y = 0, z = 0;
      switch (k) {
        case 'galaxy': { const gr = rg ? rg[i] : Math.pow(rnd(), 1.7) * 11 + .15, an = (ii % 4) / 4 * TAU + gr * .75, rr = () => (rnd() - .5) * Math.pow(rnd(), 2) * (.5 + gr * .22); x = Math.cos(an) * gr + rr() * 2; y = rr() * .9 * (1.2 - gr / 14); z = Math.sin(an) * gr + rr() * 2; break; }
        case 'vortex': { y = (t * 2 - 1) * 7; const rad = 1.2 + (y + 7) * .55 * (.7 + w * .6), an = y * 2.6 + (ii % 3) * 2.09 + u * .5; x = Math.cos(an) * rad; z = Math.sin(an) * rad; break; }
        case 'grid': x = ((ii % n) - n / 2) * .5; y = ((Math.floor(ii / n) % n) - n / 2) * .5; z = (Math.floor(ii / (n * n)) - n / 2) * .5; break;
        case 'cubelat': { const ax = Math.floor(u * 3), sg = v < .5 ? -6 : 6, sn = (Math.floor(w * 9) - 4) * 1.5, fr = (rnd() - .5) * 12; if (ax === 0) { x = fr; y = sn; z = sg; } else if (ax === 1) { x = sg; y = fr; z = sn; } else { x = sn; y = sg; z = fr; } break; }
        case 'neural': case 'brain': { const h = hubs[ii % 60]; if (u < .55) { x = h[0] + gs() * .45; y = h[1] + gs() * .45; z = h[2] + gs() * .45; } else { const h2 = hubs[(ii * 7 + 3) % 60]; x = h[0] + (h2[0] - h[0]) * v; y = h[1] + (h2[1] - h[1]) * v; z = h[2] + (h2[2] - h[2]) * v; } break; }
        case 'cloud': { const b = blobs[ii % 9]; x = b[0] + gs() * b[3]; y = b[1] + gs() * b[3] * .6; z = b[2] + gs() * b[3]; break; }
        case 'techsphere': { let la, lo; if (u < .5) { lo = Math.floor(v * 24) / 24 * TAU; la = (w - .5) * 3.1416; } else { la = (Math.floor(v * 13) / 12 - .5) * 3.1416; lo = w * TAU; } x = 6 * Math.cos(la) * Math.cos(lo); y = 6 * Math.sin(la); z = 6 * Math.cos(la) * Math.sin(lo); break; }
        case 'sphere': { const ph = Math.acos(1 - 2 * t), th = Math.PI * (1 + Math.sqrt(5)) * ii, R = 6 + (w - .5) * .4; x = R * Math.sin(ph) * Math.cos(th); y = R * Math.cos(ph); z = R * Math.sin(ph) * Math.sin(th); break; }
        case 'saturn': { if (u < .55) { const q = sph(2.6); x = q[0]; y = q[1]; z = q[2]; } else { const R = 3.8 + v * 2.8, an = w * TAU, px = Math.cos(an) * R; z = Math.sin(an) * R; x = px * .9; y = px * .435; } break; }
        case 'rings': { const j = ii % 12, R = 2 + j * .75, an = u * TAU, tl = j * .18; x = Math.cos(an) * R; y = Math.sin(an) * R * Math.sin(tl) + gs() * .08; z = Math.sin(an) * R * Math.cos(tl); break; }
        case 'wave': x = (u - .5) * 22; y = -1.2; z = (v - .5) * 22; break;
        case 'bars': { const c = ii % 81; x = ((c % 9) - 4) * 1.6 + (v - .5) * .5; z = (Math.floor(c / 9) - 4) * 1.6 + (w - .5) * .5; y = -3 + u * cols[c]; break; }
        case 'helix': { const s = t * 2 - 1, an = s * 18, st = ii % 2 ? 0 : Math.PI, rd = 1.8 + (u - .5) * .5; x = s * 10; y = Math.cos(an + st) * rd; z = Math.sin(an + st) * rd; if (ii % 7 === 0) { const f = w * 2 - 1; y = Math.cos(an) * 1.8 * f; z = Math.sin(an) * 1.8 * f; } break; }
        case 'knot': { const th = t * TAU, q = 2 + Math.cos(3 * th); x = q * Math.cos(2 * th) * 2.4 + (u - .5) * .6; y = q * Math.sin(2 * th) * 2.4 + (v - .5) * .6; z = Math.sin(3 * th) * 2.4 + (w - .5) * .6; break; }
        case 'circuit': { y = Math.floor(u * 4) * 2 - 3 + (w - .5) * .12; const gx = (Math.floor(v * 17) - 8) * 1.3, run = (rnd() - .5) * 22; if (ii % 2) { x = gx; z = run; } else { z = gx; x = run; } break; }
        case 'torus': { if (u < .22) { x = gs() * 1.1; y = gs() * 1.1; z = gs() * 1.1; } else { const th = v * TAU, ph = w * TAU; x = (4.4 + 1.5 * Math.cos(ph)) * Math.cos(th); y = 1.5 * Math.sin(ph); z = (4.4 + 1.5 * Math.cos(ph)) * Math.sin(th); } break; }
        case 'portal': { if (u < .4) { const th = v * TAU, R = 5 + (w - .5) * .7; x = R * Math.cos(th); y = R * Math.sin(th); z = (rnd() - .5) * .5; } else if (u < .85) { const r = Math.pow(v, .7) * 4.6, an = w * TAU + r * 1.1; x = r * Math.cos(an); y = r * Math.sin(an); z = gs() * .25; } else { x = (v - .5) * 24; y = (w - .5) * 14; z = (rnd() - .5) * 16 - 4; } break; }
        case 'retro': { const zz = (Math.floor(u * 14) - 7) * 2, e = Math.floor(v * 4), q = (v * 4 - e) * 10 - 5; if (w < .75) { z = zz; if (e === 0) { x = q; y = -4.5; } else if (e === 1) { x = 5; y = q * .9; } else if (e === 2) { x = -q; y = 4.5; } else { x = -5; y = -q * .9; } } else { z = (rnd() - .5) * 28; x = (e % 2 ? 1 : -1) * 5; y = (e < 2 ? -1 : 1) * 4.5; } break; }
        case 'rain': x = (Math.floor(u * 42) - 21) * .62; z = (v - .5) * 14 - 3; y = (w - .5) * 28; break;
        case 'modules': { const m = mods[ii % 12]; if (u < .6) { const f = [v, w, rnd()].map(c => (c - .5) * 1.1), ax = ii % 3; f[ax] = f[ax] < 0 ? -.55 : .55; x = m[0] + f[0]; y = m[1] + f[1]; z = m[2] + f[2]; } else { const m2 = mods[(ii * 5 + 1) % 12]; x = m[0] + (m2[0] - m[0]) * v; y = m[1] + (m2[1] - m[1]) * v; z = m[2] + (m2[2] - m[2]) * v; } break; }
        case 'orbital': { const p = prods[ii % 14]; if (u < .75) { x = Math.cos(p[1]) * p[0] + gs() * .4; z = Math.sin(p[1]) * p[0] + gs() * .4; y = p[2] + gs() * .4; } else { const th = v * TAU; x = Math.cos(th) * p[0]; z = Math.sin(th) * p[0]; y = p[2] * .5; } break; }
        case 'holo': { const ly = (Math.floor(u * 5) - 2) * 1.6; if (v < .78) { const R = (1 + Math.floor(w * 5)) * 1.3, th = rnd() * TAU; x = R * Math.cos(th); z = R * Math.sin(th); y = ly + gs() * .04; } else { x = gs() * .3; z = gs() * .3; y = (rnd() - .5) * 8; } break; }
        default: { const th = u * TAU, R = 4.2 + (v - .5) * 1.2; x = Math.cos(th) * R; y = Math.sin(th) * R; z = (w - .5) * 28; }
      }
      a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z;
    }
    return a;
  }

  /* Miniatures 2D (aucune dépendance WebGL) */
  const thumbs = {};
  const thumb = (k, c1, c2) => {
    const key = k + c1 + c2; if (thumbs[key]) return thumbs[key];
    try {
      const W = 176, H = 108, cv = d.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d'), N = 900, p = gen(k, N);
      x.fillStyle = '#070a1c'; x.fillRect(0, 0, W, H); const ca = Math.cos(.5), sa = Math.sin(.5), cb = Math.cos(.6), sb = Math.sin(.6);
      for (let i = 0; i < N; i++) {
        let X = p[i * 3], Y = p[i * 3 + 1], Z = p[i * 3 + 2]; const x1 = X * cb - Z * sb, z1 = X * sb + Z * cb, y2 = Y * ca - z1 * sa, z2 = Y * sa + z1 * ca, s = 22 / (1 + (z2 + 8) * .035);
        x.globalAlpha = .35 + .5 * cl((z2 + 9) / 18, 0, 1); x.fillStyle = i % 3 ? c1 : c2; x.fillRect(W / 2 + x1 * s * .6, H / 2 + y2 * s * .6, 1.6, 1.6);
      }
      return (thumbs[key] = cv.toDataURL('image/png'));
    } catch (e) { return ''; }
  };
  const FX = window.NovaFX = window.NovaFX || { q: 'normal' };
  const API = window.NovaScene = { thumb, TINT, ready: false, refresh() {}, wake() {}, setQuality() {} };

  /* ---------- Scène WebGL ---------- */
  const T = window.THREE; if (!T || !d.body.classList.contains('ns-on')) return;
  const probe = d.createElement('canvas'); if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return;
  const weak = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 4, MAXN = weak ? 12000 : 20000;
  const QL = { ultra: { dq: 1, dpr: 1.5, fx: 1.4 }, normal: { dq: .62, dpr: 1, fx: 1 }, eco: { dq: .3, dpr: .75, fx: 0 } };
  const cv = d.createElement('canvas'); cv.id = 'nova3d'; cv.setAttribute('aria-hidden', 'true'); d.body.prepend(cv);
  const R = new T.WebGLRenderer({ canvas: cv, alpha: true, antialias: false, powerPreference: 'default' });
  const sc = new T.Scene(), cam = new T.PerspectiveCamera(60, 1, .1, 200);
  const DEF = { shape: 'galaxy', c1: '#8b6cff', c2: '#58d9e8', speed: 1, density: 1, size: 1, mouse: 1, swirl: 1, glow: 1, custom: false };
  const getCfg = () => { const A = window.NovaAnim, N = window.NovaNav; return (A && N && A.eff(N.current() || 'overview')) || DEF; };

  const perm = Uint32Array.from({ length: MAXN }, (_, i) => i); for (let i = MAXN - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)), s = perm[i]; perm[i] = perm[j]; perm[j] = s; }
  const rg = new Float32Array(MAXN), A_ = new Float32Array(MAXN * 3), Q = new Float32Array(MAXN * 4), Sw = new Float32Array(MAXN * 3);
  for (let i = 0; i < MAXN; i++) { const r = Math.pow(rnd(), 1.7) * 11 + .15; rg[i] = r; Q.set([rnd() * .5, (rnd() < .03 ? 3.2 : 1) * (.5 + rnd()), cl(r / 4, 0, 1), cl((r - 4) / 8, 0, 1) * .85], i * 4); Sw.set([(rnd() - .5) * 5, (rnd() - .5) * 5, (rnd() - .5) * 5], i * 3); }
  const cache = {}, arr = k => cache[k] || (cache[k] = gen(k, MAXN, perm, rg));
  const aFrom = new T.BufferAttribute(new Float32Array(MAXN * 3), 3), aTo = new T.BufferAttribute(new Float32Array(MAXN * 3), 3);
  const g = new T.BufferGeometry(); g.setAttribute('position', aTo); g.setAttribute('aTo', aTo); g.setAttribute('aFrom', aFrom); g.setAttribute('aSw', new T.BufferAttribute(Sw, 3)); g.setAttribute('aR', new T.BufferAttribute(Q, 4)); g.setDrawRange(0, 1);
  const U = { uT: { value: 0 }, uMt: { value: 1 }, uPix: { value: 1 }, uSz: { value: 1 }, uBright: { value: 1 }, uWarp: { value: 0 }, uGal: { value: 1 }, uWave: { value: 0 }, uTun: { value: 0 }, uRain: { value: 0 }, uPT: { value: 9 }, uFx: { value: 1 }, uSwirl: { value: 1.6 }, uTint: { value: new T.Vector3(1, 1, 1) }, uMouse: { value: new T.Vector3(99, 99, 99) }, uC1: { value: new T.Vector3(.55, .42, 1) }, uC2: { value: new T.Vector3(.35, .85, .91) } };
  const mat = new T.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    vertexShader: `attribute vec3 aFrom,aTo,aSw;attribute vec4 aR;uniform float uT,uMt,uPix,uSz,uWarp,uGal,uWave,uTun,uRain,uPT,uFx,uSwirl;uniform vec3 uTint,uMouse,uC1,uC2;varying vec3 vCol;
    void main(){float q=clamp(uMt*1.5-aR.x,0.,1.);float e=q*q*(3.-2.*q);vec3 P=mix(aFrom,aTo,e)+aSw*sin(q*3.1416)*uSwirl;
      float r=length(P.xz);float a=atan(P.z,P.x)+uT*.16/(.7+r*.32)*uGal;vec3 p=vec3(cos(a)*r,P.y,sin(a)*r);
      p.y+=uWave*(sin(p.x*.55+uT*1.1)+cos(p.z*.5+uT*.9))*.6;
      p.z=mix(p.z,mod(p.z+uT*3.+14.,28.)-14.,uTun);
      p.y=mix(p.y,mod(p.y+uT*(1.2+fract(floor(P.x*1.7)*.618)*3.)+14.,28.)-14.,uRain);
      vec3 dm=p-uMouse;float dl=length(dm);vec3 dn=dm/(dl+.0001);p+=dn*exp(-dl*dl*.12)*1.1*uFx;p+=dn*exp(-pow(dl-uPT*12.,2.)*.4)*max(0.,1.-uPT/1.4)*1.6*uFx;
      vec3 col=mix(mix(vec3(1.,.86,.7),uC1,aR.z),uC2,aR.w);if(fract(aR.y*91.7)>.93)col=vec3(1.);vCol=col*uTint;
      vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=min(aR.y*uPix*uSz*(46./-mv.z)*(1.+uWarp*.7),30.*uPix);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: 'uniform float uBright;varying vec3 vCol;void main(){float r=length(gl_PointCoord-.5);float a=smoothstep(.5,0.,r);gl_FragColor=vec4(vCol*uBright,a*a);}'
  });
  const gal = new T.Points(g, mat); gal.frustumCulled = false; sc.add(gal);
  const dotTex = (() => { const k = d.createElement('canvas'); k.width = k.height = 64; const x = k.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.3, 'rgba(255,255,255,.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new T.CanvasTexture(k); })();
  const cA = new T.Color('#8b6cff'), cB = new T.Color('#58d9e8'), tA = new T.Color(), tB = new T.Color();
  const core = new T.Sprite(new T.SpriteMaterial({ map: dotTex, color: cA, transparent: true, opacity: .9, depthWrite: false, blending: T.AdditiveBlending })); core.scale.setScalar(5); sc.add(core);
  const flare = new T.Sprite(new T.SpriteMaterial({ map: dotTex, color: 0xffffff, transparent: true, opacity: .8, depthWrite: false, blending: T.AdditiveBlending })); flare.scale.setScalar(1.6); sc.add(flare);
  const farN = weak ? 350 : 900, fp = new Float32Array(farN * 3); for (let i = 0; i < farN; i++) fp.set([(rnd() - .5) * 160, (rnd() - .5) * 90, -30 - rnd() * 60], i * 3);
  const fg = new T.BufferGeometry(); fg.setAttribute('position', new T.BufferAttribute(fp, 3)); const far = new T.Points(fg, new T.PointsMaterial({ size: .55, map: dotTex, color: 0xffffff, transparent: true, opacity: .75, depthWrite: false, blending: T.AdditiveBlending })); sc.add(far);
  const ringM = new T.Mesh(new T.TorusGeometry(1, .02, 8, 128), new T.MeshBasicMaterial({ color: cA, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending })); ringM.visible = false; sc.add(ringM);

  /* État */
  let shape = null, mt = 1, from = null, cur = DEF, perf = 1, lastQ = null, energy = 0, shock = 0, sy = 0, tx = 0, ty = 0, px = 0, py = 0, aim = [0, 0, 0], rxb = .5, mood = 0, T_ = 0;
  let running = false, raf = 0, last = performance.now(), lastRender = 0, lastInput = last, slowN = 0, frN = 0, tmark = 0, pending = true;
  /* Plafond explicite : le plein régime ne dépasse jamais 60 i/s, même sur un écran 120/165 Hz.
     Au repos, la scène descend à 30 puis 15 i/s. Un onglet non visible ou une fenêtre
     sans focus libère totalement le GPU. */
  const FPS_BUSY = 60, FPS_IDLE = 30, FPS_QUIET = 15;
  const ndc = new T.Vector2(), ray = new T.Raycaster(), mpos = new T.Vector3();
  const ease = x => x * x * (3 - 2 * x);
  const setShape = k => {
    if (k === shape) return; const to = arr(k);
    if (!shape) { aFrom.array.set(to); aTo.array.set(to); mt = 1; }
    else { const fa = aFrom.array, ta = aTo.array; for (let i = 0; i < MAXN; i++) { const q = cl(mt * 1.5 - Q[i * 4], 0, 1), e = ease(q), j = i * 3; fa[j] = fa[j] + (ta[j] - fa[j]) * e; fa[j + 1] = fa[j + 1] + (ta[j + 1] - fa[j + 1]) * e; fa[j + 2] = fa[j + 2] + (ta[j + 2] - fa[j + 2]) * e; } ta.set(to); mt = 0; }
    aFrom.needsUpdate = true; aTo.needsUpdate = true; U.uMt.value = mt; shape = k;
  };
  const applyCfg = () => {
    cur = getCfg(); setShape(MODE[cur.shape] !== undefined || TINT[cur.shape] ? cur.shape : 'galaxy');
    tA.set(cur.c1); tB.set(cur.c2); pending = true; wake();
  };
  const sizeNow = () => { const q = QL[FX.q] || QL.normal, dpr = Math.min(devicePixelRatio || 1, q.dpr) * (perf < .6 ? .8 : 1); R.setPixelRatio(dpr); R.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); U.uPix.value = dpr; };
  const note = () => { lastInput = performance.now(); wake(); };
  addEventListener('resize', () => { sizeNow(); }, { passive: true });
  addEventListener('pointermove', e => { tx = e.clientX / innerWidth - .5; ty = e.clientY / innerHeight - .5; note(); }, { passive: true });
  addEventListener('pointerdown', () => { energy = Math.min(1.6, energy + .4); U.uPT.value = 0; note(); }, { passive: true });
  addEventListener('keydown', note, { passive: true }); addEventListener('wheel', note, { passive: true });
  addEventListener('scroll', e => { const t = e.target; sy = t && t.scrollTop !== undefined && t !== d ? t.scrollTop : (scrollY || 0); note(); }, { passive: true, capture: true });
  d.addEventListener('visibilitychange', () => { if (!d.hidden) wake(); });
  addEventListener('blur', () => { running = false; cancelAnimationFrame(raf); raf = 0; }, { passive: true });
  addEventListener('focus', () => wake(), { passive: true });
  addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); raf = 0; }, { passive: true });
  const pt = d.getElementById('pageTitle');
  if (pt) new MutationObserver(() => { energy = Math.max(energy, 1.5); shock = 1; const s = pt.textContent || ''; let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 997; aim = [Math.sin(h) * .55, (h % 7 - 3) * .22, Math.cos(h) * 1.6]; applyCfg(); }).observe(pt, { childList: true, characterData: true, subtree: true });
  if (window.NovaAnim) NovaAnim.on(applyCfg);

  function step(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    const q = QL[FX.q] || QL.normal;
    if (FX.q !== lastQ) { lastQ = FX.q; sizeNow(); pending = true; }
    if (FX.kick) { energy = Math.max(energy, FX.kick); FX.kick = 0; }
    mood += ((FX.orbit ? 1 : 0) - mood) * Math.min(1, dt * 2.5);
    energy *= Math.pow(.05, dt);
    if (mt < 1) { mt = Math.min(1, mt + dt / 2.1); U.uMt.value = mt; }
    const kk = Math.min(1, dt * 3), md = MODE[shape], tn = TINT[shape] || TINT.galaxy, amt = cur.custom ? .3 : 1;
    U.uGal.value += ((md === 'gal' ? 1 : 0) - U.uGal.value) * kk; U.uWave.value += ((md === 'wave' ? 1 : 0) - U.uWave.value) * kk; U.uTun.value += ((md === 'tun' ? 1 : 0) - U.uTun.value) * kk * .7; U.uRain.value += ((md === 'rain' ? 1 : 0) - U.uRain.value) * kk;
    U.uTint.value.set(U.uTint.value.x + (1 + (tn[0] - 1) * amt - U.uTint.value.x) * kk, U.uTint.value.y + (1 + (tn[1] - 1) * amt - U.uTint.value.y) * kk, U.uTint.value.z + (1 + (tn[2] - 1) * amt - U.uTint.value.z) * kk);
    cA.lerp(tA, kk * .6); cB.lerp(tB, kk * .6); U.uC1.value.set(cA.r, cA.g, cA.b); U.uC2.value.set(cB.r, cB.g, cB.b); core.material.color.copy(cA);
    rxb += ((RX[shape] === undefined ? .5 : RX[shape]) - rxb) * kk * .7;
    if (pending) { const n = Math.max(600, Math.floor(MAXN * q.dq * cur.density * perf)); g.setDrawRange(0, n); U.uSz.value = cur.size; U.uSwirl.value = 1.6 * cur.swirl; U.uBright.value = cur.glow; pending = false; }
    U.uFx.value = q.fx * cur.mouse;
    px += (tx - px) * Math.min(1, dt * 2.5); py += (ty - py) * Math.min(1, dt * 2.5);
    T_ += dt * cur.speed * (1 + energy * 3 + mood * 1.5); U.uT.value = T_; U.uWarp.value = energy * .35 + mood * .3; U.uPT.value += dt;
    gal.rotation.x = rxb + aim[0] * .5 + py * .25 - sy * .0002 + mood * .35; gal.rotation.z = aim[1] + px * .15; gal.rotation.y = T_ * .01 + aim[2] * .12;
    cam.position.set(px * 2 + aim[1], 1.8 + py * 1.2 + mood * 2.5, 7.5 - energy * 1.3 + mood * 3.5 + sy * .0006); cam.lookAt(0, 0, 0);
    const fv = 60 + energy * 12 + mood * 6; if (Math.abs(cam.fov - fv) > .05) { cam.fov = fv; cam.updateProjectionMatrix(); }
    ndc.set(px * 2, -py * 2); ray.setFromCamera(ndc, cam); mpos.copy(cam.position).addScaledVector(ray.ray.direction, cam.position.length()); gal.updateMatrixWorld(); U.uMouse.value.copy(gal.worldToLocal(mpos));
    const gv = U.uGal.value; core.visible = flare.visible = gv > .02;
    if (core.visible) { core.scale.setScalar(5 + Math.sin(T_ * 1.4) * .4 + energy * 1.2); core.material.opacity = (.75 + energy * .2) * gv * Math.min(1.4, cur.glow); flare.scale.setScalar(1.6 + energy * .8); flare.material.opacity = .8 * gv; }
    far.rotation.y = T_ * .005 + px * .03;
    if (shock > 0) { shock = Math.max(0, shock - dt / 1.2); ringM.visible = true; ringM.scale.setScalar(1 + (1 - shock) * 28); ringM.material.opacity = shock * .4; ringM.material.color.copy(cA); ringM.lookAt(cam.position); } else ringM.visible = false;
    R.render(sc, cam);
  }
  function loop(now) {
    raf = 0;
    if (d.hidden || !d.hasFocus() || FX.pause || FX.q === 'off' || d.body.classList.contains('no-animations')) { running = false; cv.style.visibility = (FX.q === 'off' || d.body.classList.contains('no-animations')) ? 'hidden' : ''; return; }
    raf = requestAnimationFrame(loop);
    const since = now - lastInput;
    /* Epsilon obligatoire : une interpolation de couleur n'atteint jamais l'égalité exacte
       en virgule flottante. Sans cette marge, la scène restait « occupée » pour toujours. */
    const colorMoving = Math.abs(cA.r - tA.r) > 1e-3 || Math.abs(cA.g - tA.g) > 1e-3 || Math.abs(cA.b - tA.b) > 1e-3;
    const busy = energy > .04 || mt < 1 || mood > .02 || shock > 0 || since < 1200 || colorMoving;
    const fps = busy ? FPS_BUSY : (since > 20000 ? FPS_QUIET : FPS_IDLE);
    // -3 ms de tolérance pour ne pas rater la vsync ; le plafond reste strictement borné.
    if (now - lastRender < (1000 / fps) - 3) return;
    const t0 = performance.now(); lastRender = now; step(now);
    /* gouverneur : si les images arrivent trop lentement, on allège sans jamais couper l'interface */
    if (busy) { frN++; const spent = performance.now() - t0; if (spent > 14 || (tmark && now - tmark > 40)) slowN++; tmark = now; if (frN >= 90) { if (slowN > 50 && perf > .3) { perf = Math.max(.3, perf * .78); pending = true; if (perf < .6) lastQ = null; FX.perf = perf; } else if (slowN < 6 && perf < 1) { perf = Math.min(1, perf * 1.08); pending = true; FX.perf = perf; } frN = 0; slowN = 0; } } else { tmark = 0; }
  }
  function wake() { if (running || d.hidden || !d.hasFocus() || FX.pause || FX.q === 'off' || d.body.classList.contains('no-animations')) { if (FX.q !== 'off' && !d.body.classList.contains('no-animations')) cv.style.visibility = ''; return; } running = true; cv.style.visibility = ''; last = performance.now(); lastRender = 0; raf = requestAnimationFrame(loop); }
  cv.addEventListener('webglcontextlost', e => { e.preventDefault(); running = false; cancelAnimationFrame(raf); cv.style.display = 'none'; });
  API.ready = true; API.wake = wake; API.refresh = () => { lastQ = null; applyCfg(); };
  API.setQuality = q => { const next = ['off', 'eco', 'normal', 'ultra'].includes(q) ? q : 'normal'; FX.q = next; lastQ = null; if (next === 'off') { running = false; cancelAnimationFrame(raf); raf = 0; cv.style.visibility = 'hidden'; } else { cv.style.visibility = ''; applyCfg(); wake(); } };
  sizeNow(); applyCfg(); wake();
})();
