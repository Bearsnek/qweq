import '@fontsource-variable/manrope';
import '@fontsource-variable/unbounded';
import './style.css';

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { formatLat, formatLon, latLonToVector, subsolarPoint } from './astro';
import { createEarth } from './earth';
import { createStars, createSun } from './space';

const DEG = Math.PI / 180;
/** Cosmetic screen roll so the globe leans like a desk globe; the lighting itself is physically placed. */
const SCREEN_ROLL = -23.44 * DEG;
const TIMELAPSE_SPEED = 3600; // one simulated hour per second
const HERO_SUN_ANGLE = 55; // degrees between camera and Sun azimuth on first load

interface Shot {
  distance: number;
  /** Horizontal shift of the globe as a fraction of viewport width (desktop). */
  x: number;
  /** Vertical shift as a fraction of viewport height (desktop / portrait). */
  y: number;
  mobileY: number;
  /** Camera azimuth relative to the Sun in degrees; null lets the camera orbit freely. */
  steer: number | null;
}

// One shot per [data-scene] section, in document order.
const SHOTS: Shot[] = [
  { distance: 4.3, x: 0.2, y: 0, mobileY: 0.2, steer: null },
  { distance: 3.5, x: -0.21, y: 0, mobileY: 0.22, steer: null },
  { distance: 2.05, x: -0.3, y: 0, mobileY: 0.2, steer: -100 },
  { distance: 2.9, x: -0.2, y: 0, mobileY: 0.22, steer: 150 },
  { distance: 6.6, x: 0, y: 0.23, mobileY: 0.2, steer: 25 },
];

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);
const smoothstep = (t: number) => clamp01(t) * clamp01(t) * (3 - 2 * clamp01(t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const damp = (current: number, target: number, rate: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-rate * dt));
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function setupPageChrome() {
  const header = $('.topbar');
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.15 },
  );
  document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
}

function createRenderer(canvas: HTMLCanvasElement) {
  try {
    return new THREE.WebGLRenderer({ canvas, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
}

async function start() {
  setupPageChrome();

  const canvas = $<HTMLCanvasElement>('#globe');
  const renderer = createRenderer(canvas);
  if (!renderer) {
    document.body.classList.add('no-webgl', 'is-ready');
    return;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  // Textures
  const loaderValue = $('#loader-value');
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => {
    loaderValue.textContent = `${Math.round((loaded / total) * 100)}%`;
  };
  const textureLoader = new THREE.TextureLoader(manager);
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const loadTexture = async (name: string, color: boolean) => {
    const texture = await textureLoader.loadAsync(`${import.meta.env.BASE_URL}textures/${name}`);
    texture.anisotropy = anisotropy;
    if (color) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const [day, night, bumpRoughnessClouds] = await Promise.all([
    loadTexture('earth_day_4096.jpg', true),
    loadTexture('earth_night_4096.jpg', true),
    loadTexture('earth_bump_roughness_clouds_4096.jpg', false),
  ]);
  bumpRoughnessClouds.wrapS = THREE.RepeatWrapping; // clouds drift across the antimeridian

  // Scene
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000);
  const earth = createEarth({ day, night, bumpRoughnessClouds });
  const stars = createStars();
  const sun = createSun();
  scene.add(stars.points, sun.sprite, earth.group);

  let simTime = Date.now();
  let timelapse = false;
  const sunTarget = new THREE.Vector3();
  let subsolar = subsolarPoint(new Date(simTime));
  latLonToVector(subsolar.lat, subsolar.lon, earth.sunDirection);
  sun.setDirection(earth.sunDirection);

  const sunAzimuth = () => Math.atan2(earth.sunDirection.x, earth.sunDirection.z);
  const spherical = new THREE.Spherical(SHOTS[0].distance, 68 * DEG, sunAzimuth() + HERO_SUN_ANGLE * DEG);
  camera.position.setFromSpherical(spherical);
  camera.lookAt(0, 0, 0);

  // Post-processing: bloom makes city lights, sun glare and the atmosphere glow.
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }),
  );
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.6, 0.88);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // Controls: drag to orbit; wheel and touch keep scrolling the page.
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.rotateSpeed = 0.45;
  controls.autoRotateSpeed = 0.18;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = Math.PI - 0.35;
  let dragging = false;
  let lastInteraction = -Infinity;
  controls.addEventListener('start', () => {
    dragging = true;
    document.body.classList.add('is-dragging', 'has-dragged');
  });
  controls.addEventListener('end', () => {
    dragging = false;
    lastInteraction = performance.now();
    document.body.classList.remove('is-dragging');
  });
  if (coarsePointer) {
    controls.enabled = false;
    canvas.style.pointerEvents = 'none';
    canvas.style.touchAction = 'auto';
  }

  // Layout
  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-scene]'));
  let sectionCenters: number[] = [];
  const navLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.nav a'));

  function measure() {
    sectionCenters = sections.map((s) => {
      const rect = s.getBoundingClientRect();
      return rect.top + window.scrollY + rect.height / 2;
    });
  }

  function resize() {
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    pixelRatio = Math.min(window.devicePixelRatio, coarsePointer ? 1.5 : 2);
    renderer!.setPixelRatio(pixelRatio);
    renderer!.setSize(width, height, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    measure();
  }
  window.addEventListener('resize', resize);
  resize();
  document.fonts?.ready.then(measure);

  /** Continuous section index of the viewport centre (0 = hero, 1 = next section, …). */
  function scrollProgress() {
    const anchor = window.scrollY + window.innerHeight / 2;
    if (anchor <= sectionCenters[0]) return 0;
    for (let i = 0; i < sectionCenters.length - 1; i++) {
      if (anchor < sectionCenters[i + 1]) {
        return i + (anchor - sectionCenters[i]) / (sectionCenters[i + 1] - sectionCenters[i]);
      }
    }
    return sectionCenters.length - 1;
  }

  // Live panel and time-lapse
  const clockTime = $('#clock-time');
  const clockDate = $('#clock-date');
  const subsolarLabel = $('#subsolar');
  const modeLabel = $('#mode-label');
  const timeFormat = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const dateFormat = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  function updatePanel() {
    const date = new Date(simTime);
    clockTime.textContent = timeFormat.format(date);
    clockDate.textContent = dateFormat.format(date).replace(/\s*г\.$/, '');
    subsolarLabel.textContent = `${formatLat(subsolar.lat)} · ${formatLon(subsolar.lon)}`;
  }

  const timelapseButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-action="timelapse"]'),
  );
  for (const button of timelapseButtons) {
    const label = button.querySelector('.btn__label')!;
    button.dataset.idleLabel = label.textContent ?? '';
    button.addEventListener('click', () => setTimelapse(!timelapse));
  }

  function setTimelapse(on: boolean) {
    timelapse = on;
    if (!on) simTime = Date.now();
    document.body.classList.toggle('is-timelapse', on);
    modeLabel.textContent = on ? 'Таймлапс · 1 час в секунду' : 'Реальное время';
    for (const button of timelapseButtons) {
      button.setAttribute('aria-pressed', String(on));
      button.querySelector('.btn__label')!.textContent = on
        ? 'Вернуться к «сейчас»'
        : button.dataset.idleLabel!;
    }
    updatePanel();
  }

  // Frame loop
  let distance = SHOTS[0].distance;
  let offsetX = SHOTS[0].x;
  let offsetY = 0;
  let cloudShift = 0;
  let elapsed = 0;
  let last = performance.now();
  let lastPanelUpdate = 0;
  let activeNav = -1;

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    elapsed += dt;

    // Sun
    simTime = timelapse ? simTime + dt * 1000 * TIMELAPSE_SPEED : Date.now();
    subsolar = subsolarPoint(new Date(simTime));
    latLonToVector(subsolar.lat, subsolar.lon, sunTarget);
    earth.sunDirection.lerp(sunTarget, 1 - Math.exp(-dt * (timelapse ? 14 : 3))).normalize();
    sun.setDirection(earth.sunDirection);

    if (!reducedMotion) cloudShift = (cloudShift + dt * (timelapse ? 0.004 : 0.0005)) % 1;
    earth.setCloudShift(cloudShift);

    // Scroll-driven framing
    const progress = scrollProgress();
    const i = Math.min(Math.floor(progress), SHOTS.length - 2);
    const t = smoothstep(progress - i);
    const a = SHOTS[i];
    const b = SHOTS[i + 1];
    const portrait = camera.aspect < 0.9;
    const fit = portrait ? Math.min(Math.max(0.8 / camera.aspect, 1), 2.4) : 1;
    distance = damp(distance, lerp(a.distance, b.distance, t) * fit, 2.5, dt);
    offsetX = damp(offsetX, portrait ? 0 : lerp(a.x, b.x, t), 2.5, dt);
    offsetY = damp(offsetY, portrait ? lerp(a.mobileY, b.mobileY, t) : lerp(a.y, b.y, t), 2.5, dt);

    // Sections with a steer angle swing the camera to a fixed angle relative to the Sun.
    let steerAngle = 0;
    let steerWeight = 0;
    SHOTS.forEach((shot, index) => {
      if (shot.steer === null) return;
      const w = clamp01(1 - Math.abs(progress - index) * 1.6);
      if (w > steerWeight) {
        steerWeight = w;
        steerAngle = shot.steer;
      }
    });
    const idle = !dragging && now - lastInteraction > 4000;
    if (steerWeight > 0 && idle) {
      spherical.setFromVector3(camera.position);
      const k = 1 - Math.exp(-dt * 1.6 * steerWeight);
      spherical.theta += wrapAngle(sunAzimuth() + steerAngle * DEG - spherical.theta) * k;
      spherical.phi += (75 * DEG - spherical.phi) * k;
      camera.position.setFromSpherical(spherical);
    }
    controls.autoRotate = !reducedMotion && steerWeight < 0.05;
    controls.update(dt);
    camera.position.setLength(distance);
    camera.rotateZ(SCREEN_ROLL);
    camera.setViewOffset(width, height, -offsetX * width, offsetY * height, width, height);

    stars.update(reducedMotion ? 0 : elapsed, pixelRatio);
    composer.render(dt);

    if (now - lastPanelUpdate > (timelapse ? 60 : 250)) {
      updatePanel();
      lastPanelUpdate = now;
    }

    const nav = Math.round(progress) - 1;
    if (nav !== activeNav) {
      activeNav = nav;
      navLinks.forEach((link, index) => link.classList.toggle('is-active', index === nav));
    }
  }

  updatePanel();
  await renderer.compileAsync(scene, camera);
  renderer.setAnimationLoop(frame);
  requestAnimationFrame(() => document.body.classList.add('is-ready'));
}

start().catch((error) => {
  console.error(error);
  $('#loader-text').textContent = 'Не удалось загрузить планету. Обновите страницу.';
});
