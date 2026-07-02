/* ============ Qi Wang — portfolio engine ============ */
import * as THREE from 'three';

const { gsap, ScrollTrigger, Lenis } = window;
gsap.registerPlugin(ScrollTrigger);

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TOUCH = matchMedia('(pointer: coarse)').matches;

const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

document.body.classList.add('is-loading');
if (REDUCED) document.body.classList.add('reduced');

/* ---------- smooth scroll ---------- */
let lenis = null;
if (!REDUCED) {
  lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
  lenis.stop();
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}
$$('a[href^="#"]').forEach((a) =>
  a.addEventListener('click', (e) => {
    const el = $(a.getAttribute('href'));
    if (!el) return;
    e.preventDefault();
    if (a.id === 'logo') heartBurst();
    lenis ? lenis.scrollTo(el, { duration: 1.5 }) : el.scrollIntoView({ behavior: 'smooth' });
  })
);

/* ---------- text splitting ---------- */
function splitChars(el) {
  const chars = [...el.textContent];
  el.textContent = '';
  chars.forEach((c, i) => {
    const s = document.createElement('span');
    s.className = 'ch';
    s.textContent = c;
    if (el.classList.contains('accent')) {
      s.style.backgroundSize = chars.length * 100 + '% 100%';
      s.style.backgroundPosition = (chars.length > 1 ? (i / (chars.length - 1)) * 100 : 0) + '% 0';
    }
    el.appendChild(s);
  });
}
function splitWords(el, outerCls, innerCls) {
  const frag = document.createDocumentFragment();
  [...el.childNodes].forEach((node) => {
    const isEm = node.nodeName === 'EM';
    const words = node.textContent.split(/\s+/).filter(Boolean);
    words.forEach((w) => {
      const o = document.createElement('span');
      o.className = outerCls;
      const i = document.createElement('span');
      i.className = innerCls + (isEm ? ' em-w' : '');
      if (isEm) i.style.color = 'var(--acc)';
      i.textContent = w;
      o.appendChild(i);
      frag.appendChild(o);
    });
  });
  el.textContent = '';
  el.appendChild(frag);
}
$$('.hero-title .line-inner').forEach(splitChars);
$$('.mani-line').forEach((l) => splitWords(l, 'w', 'wi'));
splitWords($('.contact-title'), 'cw', 'cwi');

/* ============ THREE — scene ============ */
THREE.ColorManagement.enabled = false;
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0, 7);

const state = { dim: 1, morph: 0, photoFocus: 0 };
const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
const ndc = new THREE.Vector2(-2, -2);
let domHot = false;

/* ---------- particles ---------- */
const COUNT = 12000;
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
const positions = new Float32Array(COUNT * 3);
const hearts = new Float32Array(COUNT * 3);
const rands = new Float32Array(COUNT);
for (let i = 0; i < COUNT; i++) {
  const i3 = i * 3;
  const arm = (i % 3) * ((Math.PI * 2) / 3);
  const rr = Math.pow(Math.random(), 0.65) * 7;
  const ang = arm + rr * 0.9 + (Math.random() - 0.5) * 0.55;
  positions[i3] = Math.cos(ang) * rr + gauss() * 0.3;
  positions[i3 + 1] = gauss() * 0.5 * Math.max(0.25, 1 - rr / 7);
  positions[i3 + 2] = Math.sin(ang) * rr * 0.6 + gauss() * 0.3;

  let t, hx;
  do {
    t = Math.random() * Math.PI * 2;
    hx = 16 * Math.pow(Math.sin(t), 3);
  } while (Math.abs(hx) < 1.1 && Math.random() > 0.3);
  const hs = 0.16 * Math.pow(Math.random(), 0.3);
  hearts[i3] = hx * hs;
  hearts[i3 + 1] = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * hs + 0.3;
  hearts[i3 + 2] = 2.0 + (Math.random() - 0.5) * 0.9;
  rands[i] = Math.random();
}
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
pGeo.setAttribute('aHeart', new THREE.BufferAttribute(hearts, 3));
pGeo.setAttribute('aRand', new THREE.BufferAttribute(rands, 1));

const pUniforms = {
  uTime: { value: 0 },
  uMorph: { value: 0 },
  uDim: { value: 1 },
  uSize: { value: 1.7 * renderer.getPixelRatio() },
  uHeartScale: { value: 1 },
  uColorIn: { value: new THREE.Color(0xbdd2ff) },
  uColorOut: { value: new THREE.Color(0x6f5bd0) },
  uColorHeart: { value: new THREE.Color(0xff6b9d) },
};
const pMat = new THREE.ShaderMaterial({
  uniforms: pUniforms,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */ `
    attribute vec3 aHeart;
    attribute float aRand;
    uniform float uTime, uMorph, uDim, uSize, uHeartScale;
    uniform vec3 uColorIn, uColorOut, uColorHeart;
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
      float c = cos(uTime * 0.04), s = sin(uTime * 0.04);
      vec3 g = vec3(c * position.x + s * position.z, position.y, -s * position.x + c * position.z);
      g.y += sin(uTime * 0.6 + aRand * 6.2831) * 0.07;
      vec3 h = aHeart;
      h.xy *= uHeartScale;
      h.x += sin(uTime * 0.9 + aRand * 6.2831) * 0.05;
      h.y += cos(uTime * 0.7 + aRand * 4.0) * 0.05;
      vec3 p = mix(g, h, uMorph);
      float r = length(position.xz) / 7.0;
      vColor = mix(mix(uColorIn, uColorOut, smoothstep(0.08, 0.95, r)), uColorHeart, uMorph);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uSize * (0.6 + aRand * 1.7) * (14.0 / -mv.z);
      vAlpha = uDim * (0.3 + 0.7 * aRand);
    }`,
  fragmentShader: /* glsl */ `
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.06, d) * vAlpha;
      if (a < 0.012) discard;
      gl_FragColor = vec4(vColor, a);
    }`,
});
const particles = new THREE.Points(pGeo, pMat);
const particleGroup = new THREE.Group();
particleGroup.add(particles);
scene.add(particleGroup);

/* ---------- icosahedron (stack) ---------- */
const icoGroup = new THREE.Group();
icoGroup.add(
  new THREE.Mesh(new THREE.IcosahedronGeometry(2.1, 1), new THREE.MeshBasicMaterial({ color: 0x7aa2ff, wireframe: true, transparent: true, opacity: 0.16 })),
  new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), new THREE.MeshBasicMaterial({ color: 0xff6b9d, wireframe: true, transparent: true, opacity: 0.28 }))
);
icoGroup.position.set(2.3, -0.1, 0.5);
icoGroup.scale.setScalar(0.0001);
scene.add(icoGroup);

/* ---------- photo planes ---------- */
const PLANE_W = 4.6, PLANE_H = 3.45;
const PHOTOS = [
  { src: 'assets/banff-1.jpg', x: -1.45, y: 0.3, rot: 0.18, video: false },
  { src: 'assets/banff-3.jpg', x: 1.55, y: -0.2, rot: -0.18, video: false },
  { src: 'assets/banff-5.jpg', x: -1.2, y: 0.25, rot: 0.16, video: false },
];
const photoGroup = new THREE.Group();
scene.add(photoGroup);
const photoMeshes = [];

function makePhotoMesh(tex, meta, idx) {
  const uniforms = {
    uTex: { value: tex },
    uTime: { value: 0 },
    uHover: { value: 0 },
    uMouse: { value: new THREE.Vector2(0.5, 0.5) },
    uOpacity: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime, uHover;
      uniform vec2 uMouse;
      void main() {
        vUv = uv;
        vec3 p = position;
        float d = distance(uv, uMouse);
        p.z += sin(d * 22.0 - uTime * 5.0) * exp(-d * 4.0) * uHover * 0.16;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex;
      uniform float uTime, uHover, uOpacity;
      uniform vec2 uMouse;
      varying vec2 vUv;
      void main() {
        float d = distance(vUv, uMouse);
        vec2 uv = vUv + sin(d * 22.0 - uTime * 5.0) * exp(-d * 4.0) * uHover * 0.014;
        float sh = 0.006 * uHover;
        vec3 col = vec3(
          texture2D(uTex, uv + vec2(sh, 0.0)).r,
          texture2D(uTex, uv).g,
          texture2D(uTex, uv - vec2(sh, 0.0)).b
        );
        float vig = smoothstep(0.98, 0.4, distance(vUv, vec2(0.5)));
        col *= mix(0.72, 1.0, vig);
        gl_FragColor = vec4(col, uOpacity);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_W, PLANE_H, 48, 36), mat);
  mesh.userData = { ...meta, idx, hoverT: 0 };
  mesh.renderOrder = 5;
  mesh.visible = false;
  photoGroup.add(mesh);
  photoMeshes.push(mesh);
}

/* gallery scroll choreography */
function zOf(l) {
  if (l < 0.45) { const e = 1 - Math.pow(1 - l / 0.45, 3); return -24 + e * 23; }
  if (l < 0.8) return -1 + ((l - 0.45) / 0.35) * 2.6;
  const e = Math.pow((l - 0.8) / 0.2, 3);
  return 1.6 + e * 4.9;
}
const captions = $$('.caption');
let activeCap = -1;
function updateGallery(p) {
  let active = -1;
  let maxOp = 0;
  photoMeshes.forEach((m, i) => {
    const local = clamp(p * 3 - i, 0, 1);
    if (local <= 0.001 || local >= 0.999) { m.visible = false; return; }
    m.visible = true;
    const k = 1 - local;
    m.position.z = zOf(local);
    m.position.x = m.userData.x * (0.3 + k * 0.7);
    m.position.y = m.userData.y * (0.3 + k * 0.7) + Math.sin(local * Math.PI) * 0.12;
    m.rotation.y = m.userData.rot * (1 - local * 1.7);
    const op = smooth(0.02, 0.16, local) * (1 - smooth(0.8, 0.95, local));
    m.material.uniforms.uOpacity.value = op;
    maxOp = Math.max(maxOp, op);
    if (local > 0.28 && local < 0.88) active = i;
  });
  state.photoFocus = maxOp;
  if (active !== activeCap) {
    captions.forEach((c, i) => c.classList.toggle('active', i === active));
    activeCap = active;
  }
}

/* ---------- pointer ---------- */
const raycaster = new THREE.Raycaster();
addEventListener('pointermove', (e) => {
  mouse.tx = (e.clientX / innerWidth) * 2 - 1;
  mouse.ty = -(e.clientY / innerHeight) * 2 + 1;
  ndc.set(mouse.tx, mouse.ty);
});

/* ---------- resize ---------- */
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  const visW = 2 * 6 * Math.tan(THREE.MathUtils.degToRad(27.5)) * camera.aspect;
  const s = Math.min(1, (visW * 0.82) / PLANE_W);
  photoGroup.scale.set(s, s, 1);
  pUniforms.uHeartScale.value = Math.min(1, camera.aspect * 0.62);
  icoGroup.position.x = camera.aspect > 1 ? 2.3 : 0;
}
addEventListener('resize', resize);
resize();

/* ---------- render loop ---------- */
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  const speed = REDUCED ? 0.12 : 1;
  pUniforms.uTime.value = t * speed;
  pUniforms.uMorph.value = state.morph;
  pUniforms.uDim.value = lerp(state.dim * (1 - 0.78 * state.photoFocus), 0.88, state.morph);

  mouse.x = lerp(mouse.x, mouse.tx, 0.05);
  mouse.y = lerp(mouse.y, mouse.ty, 0.05);
  particleGroup.rotation.y = mouse.x * 0.16;
  particleGroup.rotation.x = 0.34 * (1 - state.morph) - mouse.y * 0.1;
  camera.position.x = mouse.x * 0.25;
  camera.position.y = mouse.y * 0.18;
  camera.lookAt(0, 0, 0);

  icoGroup.rotation.y += 0.0016;
  icoGroup.rotation.x += 0.0007;

  const anyVisible = photoMeshes.some((m) => m.visible);
  if (anyVisible) {
    let hit = null;
    if (!TOUCH) {
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(photoMeshes.filter((m) => m.visible));
      if (hits.length) hit = hits[0];
    }
    photoMeshes.forEach((m) => {
      if (!m.visible) return;
      const u = m.material.uniforms;
      u.uTime.value = t;
      if (TOUCH) {
        u.uHover.value = 0.32 + 0.14 * Math.sin(t * 1.4);
        u.uMouse.value.set(0.5 + 0.28 * Math.cos(t * 0.5), 0.5 + 0.28 * Math.sin(t * 0.7));
      } else {
        const isHit = hit && hit.object === m;
        m.userData.hoverT = isHit ? 1 : 0;
        if (isHit) u.uMouse.value.lerp(hit.uv, 0.12);
        u.uHover.value = lerp(u.uHover.value, m.userData.hoverT, 0.07);
      }
    });
    document.body.classList.toggle('cursor-hot', domHot || !!hit);
  }
  renderer.render(scene, camera);
});

/* ============ preloader ============ */
const bootLog = $('#bootLog');
const pctNum = $('#pctNum');
const BOOT = [
  '<span class="cmd">&gt; qi.sh --init</span>',
  '&gt; fetching banff/*.jpg .......... <span class="ok">ok</span>',
  '&gt; compiling shaders ............. <span class="ok">ok</span>',
  '&gt; mounting scene graph .......... <span class="ok">ok</span>',
  '&gt; hello, visitor 👋',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function typeBoot() {
  for (const line of BOOT) {
    const div = document.createElement('div');
    div.innerHTML = line;
    bootLog.appendChild(div);
    await sleep(REDUCED ? 40 : 235);
  }
}

const texLoader = new THREE.TextureLoader();
async function loadPhotos() {
  const texs = await Promise.all(PHOTOS.map((p) => texLoader.loadAsync(p.src)));
  texs.forEach((tex, i) => {
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    makePhotoMesh(tex, PHOTOS[i], i);
  });
}

const pct = { v: 0 };
let pctTween = null;
function pctTo(v, d, e) {
  pctTween?.kill();
  pctTween = gsap.to(pct, { v, duration: d, ease: e || 'power1.inOut', onUpdate: () => (pctNum.textContent = Math.round(pct.v)) });
  return pctTween;
}

async function boot() {
  const typing = typeBoot();
  const loading = loadPhotos().catch((err) => console.error('texture load failed', err));
  pctTo(84, REDUCED ? 0.3 : 1.9);
  await Promise.all([typing, loading]);
  await pctTo(100, REDUCED ? 0.2 : 0.45, 'power3.out').then(() => sleep(150));
  reveal();
}

function reveal() {
  document.body.classList.remove('is-loading');
  const tl = gsap.timeline();
  tl.to('#preloader', {
    yPercent: -100, duration: REDUCED ? 0.4 : 0.95, ease: 'power4.inOut',
    onComplete: () => ($('#preloader').style.display = 'none'),
  });
  tl.fromTo('.hero-title .ch', { yPercent: 130, rotate: 8 }, { yPercent: 0, rotate: 0, duration: 1.15, ease: 'power4.out', stagger: 0.04 }, '-=0.35');
  tl.fromTo(['.hero .eyebrow', '.hero-sub', '.scroll-cue'], { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.09 }, '-=0.7');
  tl.to('.nav', { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' }, '-=0.6');
  tl.add(() => {
    if (lenis) lenis.start();
    initScroll();
  }, '-=0.9');
}

/* ============ scroll choreography ============ */
function initScroll() {
  if (REDUCED) {
    gsap.set(['.mani-line .wi', '.contact-title .cwi'], { yPercent: 0, opacity: 1 });
    $$('.mani-line').forEach((l, i) => (l.style.position = 'relative', l.style.opacity = 1));
    $('.manifesto').style.height = 'auto';
    $('.manifesto').style.paddingTop = $('.manifesto').style.paddingBottom = '14vh';
    typeTerminal(true);
    state.dim = 0.5;
    return;
  }

  /* hero → dim particles */
  ScrollTrigger.create({
    trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.6,
    onUpdate: (st) => { state.dim = 1 - st.progress * 0.68; particleGroup.position.z = st.progress * 1.6; },
  });

  /* manifesto — pinned line-by-line */
  const lines = $$('.mani-line');
  gsap.set($$('.mani-line .wi'), { yPercent: 120, opacity: 0 });
  const maniTl = gsap.timeline({
    scrollTrigger: {
      trigger: '.manifesto', start: 'top top', end: '+=300%', scrub: 0.6, pin: true,
      onUpdate: (st) => ($('#maniIdx').textContent = String(Math.min(3, Math.floor(st.progress * 4)) + 1).padStart(2, '0')),
    },
  });
  lines.forEach((line, i) => {
    const words = $$('.wi', line);
    maniTl.to(words, { yPercent: 0, opacity: 1, stagger: 0.07, duration: 0.62, ease: 'power3.out' }, i);
    if (i < lines.length - 1)
      maniTl.to(words, { yPercent: -120, opacity: 0, stagger: 0.05, duration: 0.5, ease: 'power2.in' }, i + 0.66);
  });

  /* whoami */
  ScrollTrigger.create({ trigger: '.whoami', start: 'top 62%', once: true, onEnter: () => typeTerminal(false) });
  gsap.from('.who-left > *', {
    y: 40, opacity: 0, stagger: 0.12, duration: 1, ease: 'power3.out',
    scrollTrigger: { trigger: '.whoami', start: 'top 70%' },
  });
  gsap.from('.terminal', {
    y: 60, opacity: 0, duration: 1.1, ease: 'power3.out',
    scrollTrigger: { trigger: '.whoami', start: 'top 65%' },
  });

  /* gallery — pinned WebGL fly-through */
  ScrollTrigger.create({
    trigger: '.gallery', start: 'top top', end: '+=340%', pin: true, scrub: 0.7,
    onUpdate: (st) => updateGallery(st.progress),
    onLeave: () => updateGallery(1),
    onLeaveBack: () => updateGallery(0),
  });
  gsap.from('.gallery-head > *', {
    y: 36, opacity: 0, stagger: 0.1, duration: 0.9, ease: 'power3.out',
    scrollTrigger: { trigger: '.gallery', start: 'top 55%' },
  });

  /* stack — icosahedron + chips */
  ScrollTrigger.create({
    trigger: '.stack', start: 'top 75%', end: 'bottom top',
    onEnter: () => gsap.to(icoGroup.scale, { x: 1, y: 1, z: 1, duration: 1.4, ease: 'elastic.out(1, 0.6)' }),
    onLeaveBack: () => gsap.to(icoGroup.scale, { x: 0.0001, y: 0.0001, z: 0.0001, duration: 0.5 }),
    onLeave: () => gsap.to(icoGroup.scale, { x: 0.0001, y: 0.0001, z: 0.0001, duration: 0.5 }),
    onEnterBack: () => gsap.to(icoGroup.scale, { x: 1, y: 1, z: 1, duration: 1, ease: 'power3.out' }),
  });
  ScrollTrigger.create({
    trigger: '.stack', start: 'top bottom', end: 'bottom top', scrub: 0.8,
    onUpdate: (st) => { icoGroup.rotation.z = st.progress * 1.2; },
  });
  gsap.from('.stack h2', { y: 40, opacity: 0, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: '.stack', start: 'top 70%' } });
  $$('.stack-group').forEach((g, gi) => {
    gsap.from($$('.chip, h4', g), {
      y: 26, opacity: 0, stagger: 0.05, duration: 0.7, ease: 'power3.out',
      scrollTrigger: { trigger: g, start: 'top 82%' },
    });
  });

  /* work — horizontal scroll */
  const track = $('#workTrack');
  gsap.to(track, {
    x: () => -(track.scrollWidth - innerWidth + innerWidth * 0.06),
    ease: 'none',
    scrollTrigger: {
      trigger: '.work', start: 'top top', pin: true, scrub: 1, invalidateOnRefresh: true,
      end: () => '+=' + (track.scrollWidth - innerWidth * 0.5),
    },
  });

  /* contact — heart morph + title wave */
  gsap.set('.contact-title .cwi', { yPercent: 120 });
  ScrollTrigger.create({
    trigger: '.contact', start: 'top 72%', once: true,
    onEnter: () => {
      gsap.to('.contact-title .cwi', { yPercent: 0, duration: 1.1, ease: 'power4.out', stagger: { each: 0.05, from: 'start' } });
      gsap.from(['.contact-sub', '#cta', '.contact-links', '.foot'], { y: 30, opacity: 0, stagger: 0.1, duration: 0.9, ease: 'power3.out', delay: 0.2 });
    },
  });
  ScrollTrigger.create({
    trigger: '.contact', start: 'top 80%', end: 'bottom bottom', scrub: 0.8,
    onUpdate: (st) => { state.morph = st.progress; },
  });

  ScrollTrigger.refresh();
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

/* ============ terminal typing ============ */
const TERM_LINES = [
  { t: '$ whoami', c: 'cmd' },
  { t: 'qi.wang — software engineer @ blue cross · winnipeg 🇨🇦', c: '' },
  { t: '$ cat ~/focus', c: 'cmd' },
  { t: 'mobile-first : Swift · SwiftUI · Flutter · Kotlin · Compose', c: '' },
  { t: 'full-stack   : TypeScript · React · Node · Spring · Go', c: '' },
  { t: '$ ls ~/side-quests', c: 'cmd' },
  { t: '[ photography ]  [ open-source ]  [ this-site ]', c: 'ok' },
  { t: '$ echo $TASTE', c: 'cmd' },
  { t: '"design-minded — details, restraint, polish"', c: 'str' },
];
let termStarted = false;
async function typeTerminal(instant) {
  if (termStarted) return;
  termStarted = true;
  const body = $('#termBody');
  const caret = document.createElement('span');
  caret.className = 'caret';
  body.appendChild(caret);
  for (const line of TERM_LINES) {
    const span = document.createElement('span');
    if (line.c) span.className = line.c;
    body.insertBefore(span, caret);
    if (instant) {
      span.textContent = line.t + '\n';
    } else {
      const isCmd = line.c === 'cmd';
      for (const ch of line.t) {
        span.textContent += ch;
        await sleep(isCmd ? 26 : 7);
      }
      span.textContent += '\n';
      await sleep(isCmd ? 120 : 60);
    }
  }
}

/* ============ DOM flourishes ============ */
/* ticker */
gsap.to('#tickerTrack', { xPercent: -50, ease: 'none', duration: 28, repeat: -1 });

/* rotating role word */
const ROLES = ['SwiftUI', 'Flutter', 'Jetpack Compose', 'TypeScript', 'Three.js', 'on-device AI', 'Rust 🦀'];
let ri = 0;
if (!REDUCED)
  setInterval(() => {
    ri = (ri + 1) % ROLES.length;
    const el = $('#roleWord');
    gsap.timeline()
      .to(el, { yPercent: -70, opacity: 0, duration: 0.26, ease: 'power2.in' })
      .add(() => (el.textContent = ROLES[ri]))
      .fromTo(el, { yPercent: 70, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.34, ease: 'power2.out' });
  }, 2500);

/* nav state + scroll progress */
const nav = $('#nav');
const bar = $('#progressBar');
gsap.ticker.add(() => {
  const y = window.scrollY || 0;
  nav.classList.toggle('scrolled', y > 70);
  const max = document.documentElement.scrollHeight - innerHeight;
  bar.style.transform = `scaleX(${max > 0 ? clamp(y / max, 0, 1) : 0})`;
});

/* custom cursor */
if (!TOUCH) {
  const dot = $('#cursorDot');
  const ring = $('#cursorRing');
  const pos = { x: -100, y: -100, rx: -100, ry: -100 };
  addEventListener('pointermove', (e) => {
    pos.x = e.clientX; pos.y = e.clientY;
    dot.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%,-50%)`;
  });
  gsap.ticker.add(() => {
    pos.rx = lerp(pos.rx, pos.x, 0.14);
    pos.ry = lerp(pos.ry, pos.y, 0.14);
    ring.style.transform = `translate(${pos.rx}px, ${pos.ry}px) translate(-50%,-50%)`;
  });
  addEventListener('mouseover', (e) => {
    if (e.target.closest('a, button, [data-hover]')) { domHot = true; document.body.classList.add('cursor-hot'); }
  });
  addEventListener('mouseout', (e) => {
    if (e.target.closest('a, button, [data-hover]')) { domHot = false; document.body.classList.remove('cursor-hot'); }
  });
}

/* magnetic elements */
if (!TOUCH && !REDUCED)
  $$('.chips .chip, .who-chips .chip, #cta').forEach((el) => {
    const strength = el.id === 'cta' ? 0.42 : 0.3;
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      gsap.to(el, { x: (e.clientX - r.left - r.width / 2) * strength, y: (e.clientY - r.top - r.height / 2) * strength, duration: 0.4, ease: 'power2.out' });
    });
    el.addEventListener('mouseleave', () => gsap.to(el, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, 0.4)' }));
  });

/* 3D tilt — terminal + work cards */
if (!TOUCH && !REDUCED) {
  const tiltEls = [[$('#terminal'), 4], ...$$('.work-card').map((c) => [c, 7])];
  tiltEls.forEach(([el, max]) => {
    if (!el) return;
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      gsap.to(el, { rotationY: (px - 0.5) * max * 2, rotationX: -(py - 0.5) * max * 2, transformPerspective: 900, duration: 0.5, ease: 'power2.out' });
      el.style.setProperty('--gx', px * 100 + '%');
      el.style.setProperty('--gy', py * 100 + '%');
    });
    el.addEventListener('mouseleave', () => gsap.to(el, { rotationY: 0, rotationX: 0, duration: 0.8, ease: 'power3.out' }));
  });
}

/* logo easter egg — particle heart burst */
let bursting = false;
function heartBurst() {
  if (bursting) return;
  bursting = true;
  gsap.timeline({ onComplete: () => (bursting = false) })
    .to(state, { morph: 1, duration: 1.0, ease: 'power3.inOut' })
    .to(state, { morph: 0, duration: 1.2, ease: 'power3.inOut' }, '+=0.65');
}

/* geek signature */
console.log('%c~/qi — Qi Wang', 'color:#7aa2ff;font-size:16px;font-weight:bold;font-family:monospace');
console.log('%cbuilt with three.js + gsap + taste · 12,000 particles · Winnipeg 🇨🇦', 'color:#8899aa;font-family:monospace');
console.log('%ctry clicking the logo 😏', 'color:#ff6b9d;font-family:monospace');

boot();
