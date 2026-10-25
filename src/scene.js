// scene.js — renderer, scene, camera, OrbitControls, lights, environment map, fog, resize.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LAYOUT, COLORS } from './room.js';

// Posisi kamera awal ("home"). Dipakai juga untuk reset & tween kembali dari focus.
export const CAMERA_HOME = {
  position: new THREE.Vector3(0, 3.0, 5.2),
  target: new THREE.Vector3(0, 1.3, -1.0),
};

const BACKGROUND = 0x04070b;

export function createStage(container) {
  let pixelRatioCap = 2; // batas pixel ratio demi performa (bisa diturunkan otomatis bila FPS rendah)
  const applyPixelRatio = () => renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  applyPixelRatio();
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Tone mapping memetakan nilai HDR (cahaya/emissive > 1) ke rentang layar 0..1.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  // Fog eksponensial tipis: object jauh perlahan menyatu dengan warna background.
  scene.fog = new THREE.FogExp2(BACKGROUND, 0.028);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 60);
  camera.name = 'Camera';
  camera.position.copy(CAMERA_HOME.position);
  scene.add(camera);

  const controls = createControls(camera, renderer.domElement);
  const lights = createLights();
  scene.add(lights.group);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix(); // wajib dipanggil setelah mengubah parameter kamera
    applyPixelRatio();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return {
    renderer,
    scene,
    camera,
    controls,
    lights,
    /** Menurunkan/menaikkan batas pixel ratio (dynamic resolution). */
    setPixelRatioCap(cap) {
      pixelRatioCap = cap;
      applyPixelRatio();
      renderer.setSize(window.innerWidth, window.innerHeight);
    },
  };
}

function createControls(camera, domElement) {
  const controls = new OrbitControls(camera, domElement);
  controls.target.copy(CAMERA_HOME.target);
  controls.enableDamping = true; // gerakan melambat halus (inersia)
  controls.dampingFactor = 0.08;
  controls.enablePan = false; // target terkunci di pusat ruangan
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;
  // Batas jarak & sudut dipilih agar kamera tidak menembus dinding/ceiling/lantai.
  controls.minDistance = 2.5;
  controls.maxDistance = 7.5;
  controls.minPolarAngle = 1.05; // ~60 derajat dari atas
  controls.maxPolarAngle = 1.52; // hampir horizontal, tidak bisa ke bawah lantai
  controls.minAzimuthAngle = -1.1; // hanya bisa memutar di setengah ruangan bagian depan
  controls.maxAzimuthAngle = 1.1;
  controls.update();
  return controls;
}

function createLights() {
  const group = new THREE.Group();
  group.name = 'Lights';

  // Cahaya ambient dua warna: dari atas kebiruan, dari bawah gelap.
  const hemi = new THREE.HemisphereLight(0x9ec9ff, 0x0b0f14, 0.6);
  hemi.name = 'HemiLight';
  group.add(hemi);

  // Key light overhead — satu-satunya light yang cast shadow.
  const key = new THREE.DirectionalLight(0xdfe9ff, 1.6);
  key.name = 'KeyLight';
  key.position.set(3.5, 10, 4.5);
  key.target.position.set(0, 0, -1.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  // Shadow camera (orthographic) cukup menutupi ruangan 18 x 14 m.
  Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 2, far: 25 });
  key.shadow.camera.updateProjectionMatrix(); // terapkan batas frustum baru
  key.shadow.bias = -0.0004; // mengurangi shadow acne
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 3; // PCF: sampel di sekitar texel -> tepi bayangan lebih lembut
  group.add(key, key.target);

  // Point light berwarna untuk mendukung tema (tanpa shadow agar ringan).
  const point = (name, color, intensity, distance, pos) => {
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.name = name;
    light.position.copy(pos);
    group.add(light);
    return light;
  };
  const machineLight = point('MachineLight', COLORS.cyan, 18, 10, LAYOUT.machine.clone().setY(2.1));
  const hologramLight = point('HologramLight', COLORS.cyan, 10, 7, LAYOUT.hologram.clone().setY(2.0));
  const consoleLight = point('ConsoleLight', 0x8fbfff, 8, 8, LAYOUT.console.clone().setY(3.2));
  const warningLights = LAYOUT.warningLights.map((pos, i) =>
    point(`WarningPointLight_${i}`, COLORS.red, 8, 7, pos.clone().setZ(pos.z + 0.6)),
  );

  return { group, hemi, key, machineLight, hologramLight, consoleLight, warningLights };
}

/**
 * Monitor performa: menghitung FPS & membaca statistik renderer.info.
 * Dynamic resolution: bila rata-rata FPS < 40 selama 3 detik, pixel ratio diturunkan ke 1
 * (jumlah pixel yang dirender bisa turun hingga 4x pada layar high-DPI).
 */
export function createPerfMonitor(stage, { onDowngrade } = {}) {
  const { renderer } = stage;
  let frames = 0;
  let elapsed = 0;
  let fps = 0;
  let lowTime = 0;
  let downgraded = false;

  return {
    get fps() {
      return fps;
    },

    /** Dipanggil sekali per frame setelah render. Mengembalikan true bila statistik baru tersedia. */
    update(dt) {
      frames++;
      elapsed += dt;
      if (elapsed < 0.5) return false;
      fps = frames / elapsed;
      // Dynamic resolution (hanya bila memang sedang merender di atas 1x).
      lowTime = fps < 40 ? lowTime + elapsed : 0;
      if (!downgraded && lowTime >= 3 && renderer.getPixelRatio() > 1) {
        downgraded = true;
        stage.setPixelRatioCap(1);
        onDowngrade?.(fps);
      }
      frames = 0;
      elapsed = 0;
      return true;
    },

    report() {
      const { render, memory, programs } = renderer.info;
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      return [
        `FPS          ${fps.toFixed(0)}  (${(1000 / Math.max(fps, 1)).toFixed(1)} ms)`,
        `Draw calls   ${render.calls}`,
        `Triangles    ${render.triangles.toLocaleString('id-ID')}`,
        `Geometries   ${memory.geometries}`,
        `Textures     ${memory.textures}`,
        `Programs     ${programs?.length ?? '-'}`,
        `Resolution   ${size.x}x${size.y} @${renderer.getPixelRatio().toFixed(2)}x`,
      ].join('\n');
    },
  };
}

/**
 * Helper visual untuk demo/debug (tombol H): kotak shadow camera DirectionalLight,
 * arah KeyLight, dan posisi PointLight. Tersembunyi secara default.
 */
export function createDebugHelpers({ scene, lights }) {
  const group = new THREE.Group();
  group.name = 'DebugHelpers';
  group.visible = false;
  const shadowHelper = new THREE.CameraHelper(lights.key.shadow.camera);
  // Frustum shadow (±10 m) lebih besar dari ruangan -> garisnya tertutup dinding. Matikan depth test
  // agar garis tetap terlihat menembus dinding.
  shadowHelper.material.depthTest = false;
  shadowHelper.renderOrder = 999;
  group.add(shadowHelper);
  group.add(new THREE.DirectionalLightHelper(lights.key, 1.5));
  for (const light of [lights.machineLight, lights.hologramLight, lights.consoleLight, ...lights.warningLights]) {
    group.add(new THREE.PointLightHelper(light, 0.25));
  }
  scene.add(group);
  return {
    toggle() {
      group.visible = !group.visible;
      if (group.visible) shadowHelper.update(); // ambil posisi & frustum shadow camera terbaru
      return group.visible;
    },
  };
}

/**
 * Environment map untuk image-based lighting (pantulan pada material metalik).
 * HDR dari public/environments bila ada, selain itu RoomEnvironment (prosedural).
 * PMREMGenerator mengubahnya menjadi mipmap ber-blur untuk berbagai tingkat roughness.
 */
export function applyEnvironment({ renderer, scene }, hdrTexture) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  if (hdrTexture) {
    scene.environment = pmrem.fromEquirectangular(hdrTexture).texture;
    scene.environmentIntensity = 0.5;
    hdrTexture.dispose();
  } else {
    const roomEnv = new RoomEnvironment();
    scene.environment = pmrem.fromScene(roomEnv, 0.04).texture;
    scene.environmentIntensity = 0.3;
    roomEnv.dispose();
  }
  pmrem.dispose();
}
