/* NovaCore 4.1 — Écran de chargement « GENÈSE NOVA ».
   Vortex de 28 000 particules → étoile Nova en 3D → supernova → galaxie de l'application.
   Se synchronise avec l'intro existante (#novaIntro, .is-hidden) ; se coupe seul à la fin ou au clic sur « Passer ». */
(() => {
  'use strict';
  const d = document, el = d.getElementById('novaIntro');
  if (!el || !window.THREE) return;
  const T = THREE, D = 7.6, TS = 6.2; // durée totale et instant de la supernova (secondes)
  const FX = window.NovaFX = window.NovaFX || { q: localStorage.getItem('novacore.fx.q') || 'normal' };
  let run = null;

  const VS = `attribute vec3 aA,aB,aC;attribute vec4 aR;uniform float uT,uPix,uGlow;uniform vec3 uC1,uC2;varying vec3 vCol;varying float vA;
  mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
  void main(){float s=aR.x;
    vec3 p=aA;p.xz=rot(uT*(.32+.9/(1.+length(aA.xz)*.18)))*aA.xz;
    float k=smoothstep(1.1+s*1.5,4.5+s*1.0,uT);k=k*k*(3.-2.*k);
    vec3 st=aB;st.xz=rot(uT*.7)*aB.xz;
    vec3 q=mix(p,st,k);
    q+=vec3(sin(uT*2.1+s*40.),cos(uT*1.7+s*25.),sin(uT*1.3+s*12.))*(.35*(1.-k)+.05);
    float pulse=smoothstep(5.0,${TS.toFixed(1)},uT)*(1.-step(${TS.toFixed(1)},uT));
    q*=1.-pulse*.5;q+=(aR.yzw-.5)*pulse*.35;
    float e=max(0.,uT-${TS.toFixed(1)});float set=smoothstep(0.,1.5,e);
    vec3 dir=normalize(aB+aA*.05+vec3(.0001));
    q=mix(q+dir*(1.-exp(-e*2.4))*16.*(1.-set),aC,set);
    vec3 base=mix(uC1,uC2,aR.z);vec3 star=mix(vec3(1.,.82,.55),vec3(1.),aR.w);
    vCol=mix(mix(base,star,k*.9),mix(uC1,uC2,aR.z),set)*(1.+uGlow);
    vA=.55+.45*aR.w;
    vec4 mv=modelViewMatrix*vec4(q,1.);
    gl_PointSize=aR.y*uPix*(58./-mv.z)*(1.+pulse*.8+(1.-set)*smoothstep(0.,.3,e)*1.2);
    gl_Position=projectionMatrix*mv;}`;
  const FS = `varying vec3 vCol;varying float vA;void main(){float r=length(gl_PointCoord-.5);float a=smoothstep(.5,0.,r);a*=a;gl_FragColor=vec4(vCol,a*vA);}`;

  const rnd = Math.random, TAU = 6.2832;
  const starPt = () => {
    const u = rnd();
    if (u < .15) { const r = Math.pow(rnd(), .55) * 1.4, th = rnd() * TAU, ph = Math.acos(2 * rnd() - 1); return [r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)]; }
    if (u < .27) { const a = rnd() * TAU, R = 5.6 + (rnd() - .5) * .3; return [Math.cos(a) * R, Math.sin(a) * R * .3, Math.sin(a) * R]; }
    const j = Math.floor(rnd() * 6), long = j < 4 ? 7.4 : 3.9, l = Math.pow(rnd(), 1.2) * long, w = Math.pow(1 - l / long, 1.6) * .95 * (rnd() + .15), a = rnd() * TAU, o0 = Math.cos(a) * w, o1 = Math.sin(a) * w;
    return [[o0, l, o1], [o0, -l, o1], [l, o0, o1], [-l, o0, o1], [o0, o1, l], [o0, o1, -l]][j];
  };

  function start() {
    if (run) return;
    if (d.body.classList.contains('perf-lite')) { el.classList.add('nv-lite'); return; }
    const test = d.createElement('canvas'); if (!(test.getContext('webgl2') || test.getContext('webgl'))) return;
    const weak = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 4, M = weak ? 12000 : 28000;
    const cv = d.createElement('canvas'); cv.id = 'nvIntro'; cv.setAttribute('aria-hidden', 'true'); el.prepend(cv);
    const flash = d.createElement('div'); flash.className = 'nv-flash'; el.appendChild(flash);
    el.classList.add('nv-3d'); FX.pause = true;
    const R = new T.WebGLRenderer({ canvas: cv, alpha: true, antialias: false, powerPreference: 'high-performance' });
    R.setPixelRatio(Math.min(devicePixelRatio || 1, weak ? 1 : 1.75));
    const sc = new T.Scene(); sc.position.y = innerHeight > innerWidth ? 1.6 : 2.7; const cam = new T.PerspectiveCamera(58, 1, .1, 400);
    const cs = getComputedStyle(d.body), acc = (cs.getPropertyValue('--accent-rgb') || '139,108,255').split(',').map(n => +n / 255), c1 = new T.Color(...(acc.length === 3 && acc.every(isFinite) ? acc : [.55, .42, 1])), c2 = new T.Color((cs.getPropertyValue('--accent-2') || '#58d9e8').trim().match(/^#[0-9a-f]{6}$/i) ? cs.getPropertyValue('--accent-2').trim() : '#58d9e8');

    const A = new Float32Array(M * 3), B = new Float32Array(M * 3), C = new Float32Array(M * 3), Q = new Float32Array(M * 4), pos = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) {
      const r = 7 + Math.pow(rnd(), .6) * 38, th = rnd() * TAU; A.set([Math.cos(th) * r, (rnd() - .5) * (3 + r * .28), Math.sin(th) * r], i * 3);
      B.set(starPt(), i * 3);
      const gr = Math.pow(rnd(), 1.6) * 14 + .3, ga = (i % 4) / 4 * TAU + gr * .75; C.set([Math.cos(ga) * gr + (rnd() - .5) * 1.4, (rnd() - .5) * (2 - gr / 9), Math.sin(ga) * gr + (rnd() - .5) * 1.4], i * 3);
      Q.set([rnd(), .5 + rnd() * 1.6, rnd(), rnd()], i * 4);
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('aA', new T.BufferAttribute(A, 3)); g.setAttribute('aB', new T.BufferAttribute(B, 3)); g.setAttribute('aC', new T.BufferAttribute(C, 3)); g.setAttribute('aR', new T.BufferAttribute(Q, 4));
    const U = { uT: { value: 0 }, uPix: { value: R.getPixelRatio() }, uGlow: { value: 0 }, uC1: { value: new T.Vector3(c1.r, c1.g, c1.b) }, uC2: { value: new T.Vector3(c2.r, c2.g, c2.b) } };
    const pts = new T.Points(g, new T.ShaderMaterial({ uniforms: U, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: T.AdditiveBlending })); pts.frustumCulled = false; sc.add(pts);

    const glow = (() => { const k = d.createElement('canvas'); k.width = k.height = 128; const x = k.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.3, 'rgba(255,255,255,.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); return new T.CanvasTexture(k); })();
    const orb = new T.Sprite(new T.SpriteMaterial({ map: glow, color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending })); sc.add(orb);
    const far = (() => { const n = weak ? 800 : 2600, p = new Float32Array(n * 3); for (let i = 0; i < n; i++) p.set([(rnd() - .5) * 260, (rnd() - .5) * 150, -40 - rnd() * 120], i * 3); const gg = new T.BufferGeometry(); gg.setAttribute('position', new T.BufferAttribute(p, 3)); const s = new T.Points(gg, new T.PointsMaterial({ size: .8, map: glow, color: 0xcfe0ff, transparent: true, opacity: .8, depthWrite: false, blending: T.AdditiveBlending })); sc.add(s); return s; })();
    const shocks = [0, 1].map(i => { const m = new T.Mesh(new T.TorusGeometry(1, .035, 8, 200), new T.MeshBasicMaterial({ color: i ? c2 : 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending })); m.rotation.x = 1.1 + i * .5; m.visible = false; sc.add(m); return m; });

    const word = $$w('.intro-wordmark');
    if (word && !word.dataset.nv) { word.dataset.nv = '1'; const sp = s => [...s].map(l => `<i class="nv-l">${l}</i>`).join(''); word.innerHTML = sp('NOVA') + '<span>' + sp('CORE') + '</span>'; }
    const letters = $$w('.nv-l', true) || [];
    const anims = letters.map((l, i) => l.animate([{ opacity: 0, transform: 'perspective(700px) rotateX(-85deg) translateZ(-220px) translateY(40px)', filter: 'blur(12px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 1100, delay: 2300 + i * 110, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' }));
    const sub = ['.intro-byline', '.intro-fact', '.intro-loading', '.intro-progress'].map(s => $$w(s)).filter(Boolean).map((n, i) => n.animate([{ opacity: 0, translate: '0 14px' }, { opacity: 1, translate: '0 0' }], { duration: 900, delay: 3500 + i * 220, easing: 'ease-out', fill: 'both' }));

    const size = () => { const w = el.clientWidth || innerWidth, h = el.clientHeight || innerHeight; R.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    size(); addEventListener('resize', size, { passive: true });
    let mx = 0, my = 0; const pm = e => { mx = e.clientX / innerWidth - .5; my = e.clientY / innerHeight - .5; }; addEventListener('pointermove', pm, { passive: true });
    const ease = x => x * x * (3 - 2 * x), cl = (v, a, b) => Math.min(b, Math.max(a, v));
    const t0 = performance.now(); let raf = 0, alive = true, cx = 0, cy = 0;
    const loop = now => {
      if (!alive) return; raf = requestAnimationFrame(loop);
      const t = (now - (window.__novaIntroT0 || t0)) / 1000; U.uT.value = t;
      const k1 = ease(cl(t / 4.6, 0, 1)), post = Math.max(0, t - TS), shake = t > TS ? Math.exp(-post * 3.2) * .35 : cl((t - 4.6) / 1.6, 0, 1) * .05;
      cx += (mx - cx) * .05; cy += (my - cy) * .05;
      const ang = t * .22 + cx * .8, rad = (34 - 19 * k1) - (t > 4.6 ? Math.min(2.5, (t - 4.6) * .9) : 0) + (t > TS ? Math.min(6, post * 6) : 0) * (1 - cl(post / 1.6, 0, 1) * .4);
      cam.position.set(Math.sin(ang) * rad * .35 + (rnd() - .5) * shake, 6 * (1 - k1) + 1.2 + cy * 2 + (rnd() - .5) * shake, Math.cos(ang) * rad * .35 + rad * .65); cam.lookAt(0, 0, 0);
      cam.fov = 58 + (t > TS ? Math.exp(-post * 2.6) * 18 : 0); cam.updateProjectionMatrix();
      const build = cl((t - 3.2) / 3, 0, 1), flashV = t < TS ? 0 : post < .22 ? post / .22 : Math.exp(-(post - .22) * 2.6);
      orb.material.opacity = (build * build * .85 + (t > TS ? Math.exp(-post * 2) : 0)) * (t > TS + 1.6 ? 0 : 1); orb.scale.setScalar(2 + build * 7 + flashV * 14);
      U.uGlow.value = build * .35 + flashV * 1.6; flash.style.opacity = String(cl(flashV, 0, 1) * .95);
      shocks.forEach((m, i) => { const s = post - i * .18; if (t > TS && s > 0 && s < 2.2) { m.visible = true; m.scale.setScalar(1 + s * 26); m.material.opacity = (1 - s / 2.2) * .8; m.lookAt(cam.position); } else m.visible = false; });
      far.rotation.y = t * .01; R.render(sc, cam);
    };
    run = { stop() { alive = false; cancelAnimationFrame(raf); removeEventListener('resize', size); removeEventListener('pointermove', pm); anims.concat(sub).forEach(a => a.cancel()); g.dispose(); R.dispose(); cv.remove(); flash.remove(); el.classList.remove('nv-3d'); FX.pause = false; run = null; if (window.NovaScene) window.NovaScene.wake(); } };
    raf = requestAnimationFrame(loop);
    cv.addEventListener('webglcontextlost', e => { e.preventDefault(); run && run.stop(); });
  }
  function $$w(s, all) { return all ? [...el.querySelectorAll(s)] : el.querySelector(s); }
  const sync = () => { if (el.classList.contains('is-hidden')) setTimeout(() => { if (el.classList.contains('is-hidden') && run) run.stop(); }, 900); else start(); };
  new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ['class'] });
  sync();
})();
