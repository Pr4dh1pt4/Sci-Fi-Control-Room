// assets.js — path konstanta asset, loader (GLB/HDR/texture), dan fallback prosedural.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// HDRLoader = nama baru RGBELoader sejak three r180 (RGBELoader kini hanya alias deprecated).
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
// Daftar file yang benar-benar ada di public/ (dibuat plugin di vite.config.js).
import availableFiles from 'virtual:asset-manifest';

// ====================================================================
// PATH KONSTANTA (relatif terhadap folder public/).
// Taruh file dengan nama persis seperti ini, atau ubah path di sini.
// ====================================================================
export const MODEL_FILES = {
  robot: 'models/robot.glb', // robot/drone kecil di lantai
  terminal: 'models/terminal.glb', // komputer / server rack sci-fi
  hologram: 'models/hologram.glb', // model yang ditampilkan di proyektor hologram
};

export const HDR_FILE = 'environments/control_room.hdr';

// Key = nama properti material (map / normalMap / roughnessMap). Semua opsional.
export const TEXTURE_FILES = {
  floor: {
    map: 'textures/floor_color.jpg',
    normalMap: 'textures/floor_normal.jpg',
    roughnessMap: 'textures/floor_roughness.jpg',
  },
  wall: {
    map: 'textures/wall_color.jpg',
    normalMap: 'textures/wall_normal.jpg',
    roughnessMap: 'textures/wall_roughness.jpg',
  },
};

// Audio tidak di-preload lewat LoadingManager: diputar secara streaming oleh audio.js setelah klik MULAI.
export const AUDIO_FILES = {
  bgm: 'audio/bgm-magical-technology.mp3', // musik latar (Pixabay, lihat README)
};

const available = new Set(availableFiles);
const toUrl = (file) => import.meta.env.BASE_URL + file;

/** Apakah file ada di public/ (berdasarkan manifest). */
export const isAvailable = (file) => available.has(file);
export const assetUrl = toUrl;

/**
 * Memuat semua asset yang tersedia. Asset yang tidak ada / gagal dimuat
 * bernilai null sehingga room.js memakai fallback prosedural.
 * @param {(ratio:number, label:string) => void} onProgress callback untuk layar loading
 */
export async function loadAssets(onProgress) {
  // LoadingManager melacak jumlah item yang sedang/selesai dimuat oleh semua loader.
  const manager = new THREE.LoadingManager();
  manager.onProgress = (url, loaded, total) => {
    onProgress?.(loaded / total, url.split('/').pop());
  };

  const gltfLoader = new GLTFLoader(manager);
  const hdrLoader = new HDRLoader(manager);
  const textureLoader = new THREE.TextureLoader(manager);

  const result = { models: {}, hdr: null, textures: {} };
  const missing = [];
  const tasks = [];

  // Helper: jalankan load hanya bila file ada; error ditangkap -> fallback.
  const tryLoad = (file, load, assign) => {
    if (!available.has(file)) {
      missing.push(file);
      return;
    }
    tasks.push(
      load(toUrl(file))
        .then(assign)
        .catch((err) => {
          console.info(`[assets] Gagal memuat ${file} (${err.message}). Memakai fallback.`);
        }),
    );
  };

  for (const [key, file] of Object.entries(MODEL_FILES)) {
    result.models[key] = null;
    tryLoad(file, (url) => gltfLoader.loadAsync(url), (gltf) => (result.models[key] = gltf));
  }

  tryLoad(HDR_FILE, (url) => hdrLoader.loadAsync(url), (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    result.hdr = texture;
  });

  for (const [setName, slots] of Object.entries(TEXTURE_FILES)) {
    for (const [slot, file] of Object.entries(slots)) {
      tryLoad(file, (url) => textureLoader.loadAsync(url), (texture) => {
        // Hanya texture warna (map) yang berada di sRGB; normal/roughness adalah data linear.
        texture.colorSpace = slot === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        (result.textures[setName] ??= {})[slot] = texture;
      });
    }
  }

  for (const file of Object.values(AUDIO_FILES)) {
    if (!available.has(file)) missing.push(file);
  }

  if (missing.length > 0) {
    console.info(`[assets] Belum tersedia, memakai fallback prosedural:\n  - ${missing.join('\n  - ')}`);
  }
  if (tasks.length === 0) onProgress?.(1, 'fallback prosedural');

  await Promise.all(tasks);
  return result;
}

/**
 * Menyesuaikan ukuran & posisi model sembarang (GLB dari mana pun) memakai bounding box,
 * supaya model apa pun yang dipakai pas di scene tanpa perlu edit manual.
 * Model dibungkus Group: transform wrapper dipakai untuk penempatan di scene,
 * transform model di dalamnya hanya untuk normalisasi skala/pusat.
 * @param {THREE.Object3D} object
 * @param {{size:number, fit?:'height'|'max', align?:'floor'|'center', castShadow?:boolean, receiveShadow?:boolean}} opts
 */
export function fitModel(object, { size, fit = 'height', align = 'floor', castShadow = true, receiveShadow = false }) {
  const wrapper = new THREE.Group();
  wrapper.add(object);

  const box = new THREE.Box3().setFromObject(object);
  const dims = box.getSize(new THREE.Vector3());
  const reference = fit === 'max' ? Math.max(dims.x, dims.y, dims.z) : dims.y;
  object.scale.multiplyScalar(size / (reference || 1));

  // Hitung ulang bounding box setelah skala, lalu geser agar terpusat di XZ.
  box.setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= align === 'floor' ? box.min.y : center.y;

  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = castShadow;
      child.receiveShadow = receiveShadow;
    }
  });
  return wrapper;
}

// ====================================================================
// FALLBACK PROSEDURAL (dipakai bila GLB belum tersedia)
// ====================================================================

function part(geometry, material, x, y, z) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
}

/** Robot kecil dari primitive geometry. */
export function createFallbackRobot() {
  const shell = new THREE.MeshStandardMaterial({ color: 0xd5dae1, metalness: 0.35, roughness: 0.35 });
  const joint = new THREE.MeshStandardMaterial({ color: 0x23272e, metalness: 0.8, roughness: 0.4 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x2ee6ff, emissiveIntensity: 2.5 });
  const alert = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff3040, emissiveIntensity: 2 });

  const robot = new THREE.Group();
  robot.name = 'FallbackRobot';
  robot.add(part(new THREE.CylinderGeometry(0.3, 0.36, 0.18, 24), joint, 0, 0.09, 0));
  robot.add(part(new THREE.BoxGeometry(0.62, 0.55, 0.45), shell, 0, 0.48, 0));
  robot.add(part(new THREE.BoxGeometry(0.22, 0.06, 0.02), glow, 0, 0.55, 0.23));
  robot.add(part(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 12), joint, 0, 0.82, 0));
  const head = part(new THREE.SphereGeometry(0.22, 24, 16), shell, 0, 0.98, 0);
  head.scale.set(1.25, 0.85, 1);
  robot.add(head);
  robot.add(part(new THREE.BoxGeometry(0.34, 0.07, 0.06), glow, 0, 0.99, 0.17));
  robot.add(part(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6), joint, 0.1, 1.24, 0));
  robot.add(part(new THREE.SphereGeometry(0.035, 12, 8), alert, 0.1, 1.36, 0));
  for (const side of [-1, 1]) {
    robot.add(part(new THREE.BoxGeometry(0.1, 0.42, 0.12), joint, side * 0.38, 0.47, 0));
  }
  return robot;
}

/** Server rack / komputer sci-fi. */
export function createFallbackTerminal() {
  const body = new THREE.MeshStandardMaterial({ color: 0x1e232a, metalness: 0.8, roughness: 0.35 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x8b95a1, metalness: 0.9, roughness: 0.25 });
  const rack = new THREE.Group();
  rack.name = 'FallbackTerminal';
  rack.add(part(new THREE.BoxGeometry(1.0, 2.1, 0.7), body, 0, 1.05, 0));
  rack.add(part(new THREE.BoxGeometry(1.06, 0.06, 0.74), frame, 0, 2.1, 0));
  rack.add(part(new THREE.BoxGeometry(1.06, 0.06, 0.74), frame, 0, 0.03, 0));

  // Deretan LED di sisi depan (+Z): InstancedMesh (2 draw call untuk 18 LED).
  // LED memakai MeshBasicMaterial (tidak terpengaruh cahaya) dengan warna per-instance.
  const ledMaterial = new THREE.MeshBasicMaterial();
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.03, 0.02), ledMaterial, 9);
  const dots = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), ledMaterial, 9);
  const cyan = new THREE.Color(0x2ee6ff).multiplyScalar(1.6);
  const amber = new THREE.Color(0xffb02e).multiplyScalar(1.6);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 9; i++) {
    const y = 0.35 + i * 0.18;
    bars.setMatrixAt(i, matrix.makeTranslation(-0.08, y, 0.36));
    bars.setColorAt(i, i % 3 === 1 ? amber : cyan);
    dots.setMatrixAt(i, matrix.makeTranslation(0.36, y, 0.36));
    dots.setColorAt(i, amber);
  }
  for (const leds of [bars, dots]) {
    leds.computeBoundingSphere();
    rack.add(leds);
  }
  return rack;
}

/** Model hologram default: stasiun orbit sederhana (material diganti material hologram di room.js). */
export function createFallbackHoloModel() {
  const placeholder = new THREE.MeshBasicMaterial();
  const station = new THREE.Group();
  station.name = 'FallbackHoloStation';
  station.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), placeholder));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 8, 48), placeholder);
  ring.rotation.x = Math.PI / 2;
  station.add(ring);
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const spoke = part(new THREE.BoxGeometry(0.04, 0.04, 0.7), placeholder, Math.sin(angle) * 0.4, 0, Math.cos(angle) * 0.4);
    spoke.rotation.y = angle;
    station.add(spoke);
  }
  station.add(part(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 8), placeholder, 0, 0, 0));
  return station;
}
