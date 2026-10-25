// room.js — membangun seluruh isi ControlRoom sebagai scene graph:
// Floor, Walls, ConsoleGroup (3 panel), DoorGroup, MachineGroup, HologramGroup, PropsGroup.
import * as THREE from 'three';
import { fitModel, createFallbackRobot, createFallbackTerminal, createFallbackHoloModel } from './assets.js';
import { createHologramBasicMaterial } from './effects.js';

// ====================================================================
// KONSTANTA LAYOUT (satuan: meter). Dipakai juga oleh scene.js untuk posisi light.
// ====================================================================
export const ROOM = { width: 18, depth: 14, height: 5.5, wall: 0.3 };
const HALF_W = ROOM.width / 2;
const HALF_D = ROOM.depth / 2;

export const COLORS = {
  cyan: 0x2ee6ff,
  red: 0xff2a3a,
  amber: 0xffb02e,
  purple: 0xb36bff,
  green: 0x3dff9a,
};

export const LAYOUT = {
  console: new THREE.Vector3(0, 0, -0.6),
  door: new THREE.Vector3(0, 0, -HALF_D),
  machine: new THREE.Vector3(-5.6, 0, -3.2),
  hologram: new THREE.Vector3(5.4, 0, -2.6),
  warningLights: [new THREE.Vector3(-5.6, 4.3, -HALF_D + 0.15), new THREE.Vector3(5.6, 4.3, -HALF_D + 0.15)],
  robot: new THREE.Vector3(-3.5, 0, 0.6),
  terminal: new THREE.Vector3(-2.95, 0, -HALF_D + 0.5), // kiri pintu, simetris dengan Final Terminal
};

// Urutan aktivasi yang benar ada di state.js (POWER -> NETWORK -> SECURITY).
// Posisi di console sengaja TIDAK berurutan (slot -1 = kiri, 0 = tengah, 1 = kanan)
// supaya pemain harus membaca hint, bukan sekadar klik kiri ke kanan.
export const PANEL_DEFS = [
  { id: 'security', label: 'SECURITY', color: COLORS.purple, slot: -1 },
  { id: 'power', label: 'POWER', color: COLORS.amber, slot: 0 },
  { id: 'network', label: 'NETWORK', color: COLORS.cyan, slot: 1 },
];

// ====================================================================
// HELPER
// ====================================================================
function mesh(geometry, material, { name, cast = false, receive = false } = {}) {
  const m = new THREE.Mesh(geometry, material);
  if (name) m.name = name;
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

function box(w, h, d, material, [x, y, z], opts) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), material, opts);
  m.position.set(x, y, z);
  return m;
}

/**
 * Skala UV BoxGeometry sesuai ukuran fisik tiap sisi, agar texture berulang dengan
 * kerapatan sama di semua dinding (1 tile texture = `tile` meter). Asumsi: segment = 1,
 * urutan face BoxGeometry: +x, -x, +y, -y, +z, -z (masing-masing 4 vertex).
 */
function scaleBoxUVs(geometry, w, h, d, tile) {
  const uv = geometry.attributes.uv;
  const faceDims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let i = 0; i < uv.count; i++) {
    const [du, dv] = faceDims[Math.floor(i / 4)];
    uv.setXY(i, (uv.getX(i) * du) / tile, (uv.getY(i) * dv) / tile);
  }
  uv.needsUpdate = true;
  return geometry;
}

/** Pseudo-random dengan seed tetap, agar texture prosedural selalu sama setiap reload. */
function seededRandom(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Texture panel logam prosedural (Canvas 2D): color map + roughness map.
 * Roughness map: sambungan antar panel lebih kasar (terang) daripada permukaan panel.
 */
function createPanelTextures({ rows, cols, base, seed, size = 512 }) {
  const rand = seededRandom(seed);
  const makeCanvas = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    return canvas;
  };
  const colorCanvas = makeCanvas();
  const roughCanvas = makeCanvas();
  const heightCanvas = makeCanvas(); // tinggi permukaan: dipakai untuk membuat normal map
  const c = colorCanvas.getContext('2d');
  const r = roughCanvas.getContext('2d');
  const hgt = heightCanvas.getContext('2d', { willReadFrequently: true });
  const tw = size / cols;
  const th = size / rows;

  c.fillStyle = '#0b0d10';
  c.fillRect(0, 0, size, size);
  r.fillStyle = '#e6e6e6';
  r.fillRect(0, 0, size, size);
  hgt.fillStyle = '#000'; // sambungan = paling rendah
  hgt.fillRect(0, 0, size, size);

  const baseColor = new THREE.Color(base);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * tw + 3;
      const y = row * th + 3;
      const w = tw - 6;
      const h = th - 6;
      const shade = baseColor.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.05);
      c.fillStyle = `#${shade.getHexString()}`;
      c.fillRect(x, y, w, h);
      // Bevel tipis: tepi atas lebih terang, tepi bawah lebih gelap.
      c.fillStyle = 'rgba(255,255,255,0.06)';
      c.fillRect(x, y, w, 4);
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(x, y + h - 4, w, 4);
      // Height: panel bertingkat (bevel) agar tepinya menangkap cahaya.
      hgt.fillStyle = '#606060';
      hgt.fillRect(x, y, w, h);
      hgt.fillStyle = '#909090';
      hgt.fillRect(x + 4, y + 4, w - 8, h - 8);
      // Baut di tiap sudut panel (warna + tonjolan di height map).
      for (const [bx, by] of [[x + 12, y + 12], [x + w - 12, y + 12], [x + 12, y + h - 12], [x + w - 12, y + h - 12]]) {
        c.fillStyle = 'rgba(200,210,220,0.35)';
        c.beginPath();
        c.arc(bx, by, 3.5, 0, Math.PI * 2);
        c.fill();
        hgt.fillStyle = '#ffffff';
        hgt.beginPath();
        hgt.arc(bx, by, 3.5, 0, Math.PI * 2);
        hgt.fill();
      }
      const roughValue = Math.round(95 + rand() * 45);
      r.fillStyle = `rgb(${roughValue},${roughValue},${roughValue})`;
      r.fillRect(x, y, w, h);
    }
  }
  // Goresan halus untuk variasi roughness (kesan logam yang sudah dipakai).
  for (let i = 0; i < 140; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 10 + rand() * 40;
    const angle = rand() * Math.PI;
    r.strokeStyle = `rgba(255,255,255,${0.08 + rand() * 0.12})`;
    r.lineWidth = 1;
    r.beginPath();
    r.moveTo(x, y);
    r.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    r.stroke();
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  const normalMap = new THREE.CanvasTexture(heightToNormalMap(heightCanvas, 4));
  for (const t of [map, roughnessMap, normalMap]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { map, roughnessMap, normalMap };
}

/**
 * Normal map dari height map (beda hingga / finite difference):
 * kemiringan permukaan = selisih tinggi tetangga kiri-kanan (dx) dan atas-bawah (dy).
 * normal = normalize(-dx, dy, 1) lalu dikodekan ke RGB: (n * 0.5 + 0.5) * 255.
 * (dy tidak dinegasikan karena sumbu y canvas mengarah ke bawah, sedangkan v texture ke atas.)
 */
function heightToNormalMap(heightCanvas, strength) {
  const { width: w, height: h } = heightCanvas;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = new ImageData(w, h);
  // Koordinat dibungkus (modulo) agar normal map tetap tile-able tanpa garis sambungan.
  const heightAt = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  const n = new THREE.Vector3();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * strength;
      const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * strength;
      n.set(-dx, dy, 1).normalize();
      const i = (y * w + x) * 4;
      out.data[i] = (n.x * 0.5 + 0.5) * 255;
      out.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      out.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').putImageData(out, 0, 0);
  return canvas;
}

function createHazardTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, 512, 64);
  ctx.fillStyle = '#d9a514';
  for (let x = -64; x < 512 + 64; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.lineTo(x + 32, 64);
    ctx.lineTo(x + 64, 0);
    ctx.lineTo(x + 32, 0);
    ctx.closePath();
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function emissiveMaterial(color, intensity) {
  return new THREE.MeshStandardMaterial({ color: 0x050505, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0 });
}

// ====================================================================
// MATERIAL (PBR: MeshStandardMaterial / MeshPhysicalMaterial)
// ====================================================================
function createMaterials(textures, maxAnisotropy) {
  // Pakai texture dari public/textures bila ada, selain itu texture prosedural.
  const floorMaps = textures.floor ?? createPanelTextures({ rows: 2, cols: 2, base: 0x2b3038, seed: 7 });
  const wallMaps = textures.wall ?? createPanelTextures({ rows: 2, cols: 2, base: 0x3a414b, seed: 21 });
  for (const t of [...Object.values(floorMaps), ...Object.values(wallMaps)]) t.anisotropy = maxAnisotropy;

  return {
    // roughness = 1 karena nilai sebenarnya diambil dari roughnessMap (dikalikan).
    // normalScale mengatur seberapa kuat normal map "membengkokkan" arah normal permukaan.
    // Bila texture user tidak menyertakan roughnessMap, pakai nilai roughness tetap.
    floor: new THREE.MeshStandardMaterial({
      ...floorMaps,
      color: 0xffffff,
      metalness: 0.75,
      roughness: floorMaps.roughnessMap ? 1 : 0.45,
      normalScale: new THREE.Vector2(0.8, 0.8),
    }),
    wall: new THREE.MeshStandardMaterial({
      ...wallMaps,
      color: 0xffffff,
      metalness: 0.55,
      roughness: wallMaps.roughnessMap ? 1 : 0.55,
      normalScale: new THREE.Vector2(0.6, 0.6),
    }),
    metalDark: new THREE.MeshStandardMaterial({ color: 0x1b1f25, metalness: 0.85, roughness: 0.38 }),
    metalLight: new THREE.MeshStandardMaterial({ color: 0x9aa4b0, metalness: 0.95, roughness: 0.22 }),
    // Logam bercat: metalness lebih rendah -> lebih banyak pantulan difus, bentuk lebih terbaca.
    painted: new THREE.MeshStandardMaterial({ color: 0x343c47, metalness: 0.35, roughness: 0.5 }),
    doorLeaf: new THREE.MeshStandardMaterial({ color: 0x56606b, metalness: 0.9, roughness: 0.32 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x0c0f13, metalness: 0.5, roughness: 0.6 }),
    // MeshPhysicalMaterial: clearcoat memberi lapisan pantulan tambahan seperti kaca/pernis.
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x9fdcff,
      metalness: 0,
      roughness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
    hazard: new THREE.MeshStandardMaterial({
      map: createHazardTexture(),
      metalness: 0.2,
      roughness: 0.7,
      polygonOffset: true, // cegah z-fighting dengan lantai
      polygonOffsetFactor: -1,
    }),
    glowCyan: emissiveMaterial(COLORS.cyan, 2.2),
    glowCyanSoft: emissiveMaterial(COLORS.cyan, 0.7),
    ceilingLight: emissiveMaterial(0xd8f4ff, 2.2),
    // Material yang nanti dianimasikan (berkedip/berubah warna) dibuat terpisah.
    // Intensitas emissive merah dijaga rendah: nilai terlalu tinggi membuat tone mapping
    // menggeser warnanya ke putih/salmon.
    warningLamp: emissiveMaterial(COLORS.red, 1.6),
    lockLight: emissiveMaterial(COLORS.red, 1.4),
    doorStripe: emissiveMaterial(COLORS.red, 1.0),
    reactorCore: emissiveMaterial(COLORS.cyan, 1.6),
    ring: new THREE.MeshStandardMaterial({ color: 0x8f9aa6, metalness: 0.95, roughness: 0.2, emissive: COLORS.cyan, emissiveIntensity: 0.15 }),
    exitGlow: emissiveMaterial(0xd6fff0, 1.8),
    corridor: new THREE.MeshStandardMaterial({ color: 0x2a3038, metalness: 0.6, roughness: 0.5, side: THREE.BackSide }),
    crate: new THREE.MeshStandardMaterial({ color: 0x3b4450, metalness: 0.7, roughness: 0.45 }),
  };
}

// ====================================================================
// SCREEN (CanvasTexture sebagai emissiveMap) — dipakai panel & Final Terminal
// ====================================================================
function createScreen(width, height, px = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = Math.round((px * height) / width);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  // color hitam + emissiveMap: layar "menyala sendiri" tanpa bergantung cahaya scene.
  const material = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: 0xffffff,
    emissiveMap: texture,
    emissiveIntensity: 1.3,
    roughness: 0.25,
    metalness: 0,
  });
  const screenMesh = mesh(new THREE.PlaneGeometry(width, height), material);
  return { mesh: screenMesh, canvas, ctx: canvas.getContext('2d'), texture, material };
}

/** Menggambar ulang isi layar. Dipanggil lagi di Milestone 2 saat status berubah. */
export function drawScreen(screen, { title, status, color, statusColor = color, footer = '' }) {
  const { ctx, canvas } = screen;
  const w = canvas.width;
  const h = canvas.height;
  const toCss = (hex) => `#${new THREE.Color(hex).getHexString()}`;
  const css = toCss(color);
  const font = (px, bold = false) => `${bold ? 'bold ' : ''}${Math.round(px)}px Consolas, "Courier New", monospace`;

  ctx.fillStyle = '#020b12';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(120,220,255,0.06)';
  for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 2); // garis scanline statis
  ctx.strokeStyle = css;
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  ctx.fillStyle = css;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(h * 0.22, true);
  ctx.fillText(title, w / 2, h * 0.36);
  ctx.font = font(h * 0.11);
  ctx.fillStyle = toCss(statusColor);
  ctx.fillText(status, w / 2, h * 0.64);
  ctx.fillStyle = css;
  if (footer) {
    ctx.globalAlpha = 0.65;
    ctx.font = font(h * 0.075);
    ctx.fillText(footer, w / 2, h * 0.84);
    ctx.globalAlpha = 1;
  }
  screen.texture.needsUpdate = true;
}

// ====================================================================
// FLOOR & WALLS
// ====================================================================
function buildFloor(mats) {
  const group = new THREE.Group();
  group.name = 'Floor';

  const tile = 3; // 1 tile texture = 3 m (berisi 2x2 panel lantai)
  const geometry = new THREE.PlaneGeometry(ROOM.width, ROOM.depth);
  geometry.attributes.uv.array.forEach((v, i, arr) => (arr[i] = v * (i % 2 === 0 ? ROOM.width : ROOM.depth) / tile));
  const surface = mesh(geometry, mats.floor, { name: 'FloorSurface', receive: true });
  surface.rotation.x = -Math.PI / 2;
  group.add(surface);

  const hazard = mesh(new THREE.PlaneGeometry(4.2, 0.45), mats.hazard, { name: 'DoorHazardStripe', receive: true });
  hazard.rotation.x = -Math.PI / 2;
  hazard.position.set(0, 0.002, -HALF_D + 1.0);
  group.add(hazard);
  return group;
}

function buildWalls(mats) {
  const group = new THREE.Group();
  group.name = 'Walls';
  const T = ROOM.wall;
  const H = ROOM.height;
  const tile = H / 2;

  const wall = (name, w, h, d, pos) => {
    const m = mesh(scaleBoxUVs(new THREE.BoxGeometry(w, h, d), w, h, d, tile), mats.wall, { name, receive: true });
    m.position.set(...pos);
    group.add(m);
    return m;
  };

  // Dinding belakang dibagi 3 bagian agar ada lubang untuk pintu.
  const doorW = 3.2;
  const doorH = 3.6;
  const sideW = HALF_W - doorW / 2;
  wall('BackWall_Left', sideW, H, T, [-(doorW / 2 + sideW / 2), H / 2, -HALF_D]);
  wall('BackWall_Right', sideW, H, T, [doorW / 2 + sideW / 2, H / 2, -HALF_D]);
  wall('BackWall_Top', doorW, H - doorH, T, [0, doorH + (H - doorH) / 2, -HALF_D]);
  wall('FrontWall', ROOM.width, H, T, [0, H / 2, HALF_D]);
  wall('LeftWall', T, H, ROOM.depth, [-HALF_W, H / 2, 0]);
  wall('RightWall', T, H, ROOM.depth, [HALF_W, H / 2, 0]);
  wall('Ceiling', ROOM.width + T, T, ROOM.depth + T, [0, H + T / 2, 0]);

  // Pilar struktural: 12 pilar identik digambar dengan InstancedMesh -> 1 draw call, bukan 12.
  // Setiap instance hanya menyimpan matriks transform-nya sendiri (posisi + rotasi).
  const inner = T / 2;
  const pillarTransforms = [];
  for (const z of [-4.5, -1.5, 1.5, 4.5]) {
    for (const side of [-1, 1]) pillarTransforms.push({ x: side * (HALF_W - inner - 0.175), z, rotY: 0 });
  }
  for (const x of [-7.4, -3.9, 3.9, 7.4]) {
    pillarTransforms.push({ x, z: -HALF_D + inner + 0.175, rotY: Math.PI / 2 }); // diputar 90° menempel dinding belakang
  }
  const pillars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, H, 0.45), mats.metalDark, pillarTransforms.length);
  pillars.name = 'Pillars';
  pillars.receiveShadow = true;
  const dummy = new THREE.Object3D();
  pillarTransforms.forEach(({ x, z, rotY }, i) => {
    dummy.position.set(x, H / 2, z);
    dummy.rotation.y = rotY;
    dummy.updateMatrix();
    pillars.setMatrixAt(i, dummy.matrix);
  });
  pillars.computeBoundingSphere(); // agar frustum culling memakai batas semua instance
  group.add(pillars);

  // Garis lampu emissive: di kaki dinding dan pada ketinggian 3.6 m.
  for (const y of [0.08, 3.6]) {
    for (const side of [-1, 1]) {
      group.add(box(0.03, 0.05, ROOM.depth - 0.4, mats.glowCyanSoft, [side * (HALF_W - inner - 0.02), y, 0], { name: 'WallStrip' }));
      group.add(box(sideW - 0.4, 0.05, 0.03, mats.glowCyanSoft, [side * (doorW / 2 + sideW / 2), y, -HALF_D + inner + 0.02], { name: 'WallStrip' }));
    }
  }

  // Lampu panjang di ceiling.
  for (const x of [-4.5, 0, 4.5]) {
    group.add(box(0.28, 0.05, ROOM.depth - 3, mats.ceilingLight, [x, H - 0.03, 0], { name: 'CeilingLight' }));
  }

  // Warning light merah di dinding belakang (dianimasikan berkedip di Milestone 3).
  const warningLamps = [];
  LAYOUT.warningLights.forEach((pos, i) => {
    const lamp = new THREE.Group();
    lamp.name = `WarningLight_${i === 0 ? 'L' : 'R'}`;
    lamp.position.copy(pos);
    const housing = mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.12, 24), mats.metalDark, { name: 'Housing' });
    housing.rotation.x = Math.PI / 2; // sumbu silinder menghadap keluar dinding (+Z)
    lamp.add(housing);
    const dome = mesh(new THREE.SphereGeometry(0.18, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.warningLamp, { name: 'Dome' });
    dome.rotation.x = Math.PI / 2;
    dome.position.z = 0.06;
    lamp.add(dome);
    group.add(lamp);
    warningLamps.push(lamp);
  });

  return { group, warningLamps };
}

// ====================================================================
// CONSOLE + PANEL (Power / Network / Security)
// ====================================================================
function buildPanel(def, mats) {
  // Hierarki: <Label>Panel (Group) -> Base, Screen, Button, Indicator.
  const group = new THREE.Group();
  group.name = `${def.label.charAt(0)}${def.label.slice(1).toLowerCase()}Panel`;

  // Material per panel di-clone agar highlight/pulse satu panel tidak mempengaruhi panel lain.
  const baseMat = mats.metalDark.clone();
  baseMat.emissive.setHex(def.color);
  baseMat.emissiveIntensity = 0;
  const base = box(1.4, 0.07, 0.66, baseMat, [0, 0, 0], { name: 'Base', cast: true, receive: true });
  group.add(base);

  const screen = createScreen(0.8, 0.45);
  screen.mesh.name = 'Screen';
  screen.mesh.rotation.x = -Math.PI / 2; // plane rebah menghadap ke atas (local +Y)
  screen.mesh.position.set(-0.2, 0.037, -0.02);
  drawScreen(screen, { title: def.label, status: 'STATUS: STANDBY', color: def.color, footer: 'SYSTEM OFFLINE' });
  group.add(screen.mesh);

  const ringMount = mesh(new THREE.TorusGeometry(0.14, 0.014, 8, 40), mats.metalLight, { name: 'ButtonRing' });
  ringMount.rotation.x = Math.PI / 2;
  ringMount.position.set(0.44, 0.04, 0.06);
  group.add(ringMount);

  const button = mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.06, 32), emissiveMaterial(def.color, 0.6), { name: 'Button', cast: true });
  button.position.set(0.44, 0.065, 0.06);
  button.userData.restY = button.position.y; // posisi awal untuk animasi tombol tertekan
  group.add(button);

  const indicator = mesh(new THREE.SphereGeometry(0.035, 16, 12), emissiveMaterial(COLORS.red, 1.5), { name: 'Indicator' });
  indicator.position.set(0.44, 0.055, -0.2);
  group.add(indicator);

  return { id: def.id, def, group, base, screen, button, indicator };
}

function buildConsole(mats) {
  const group = new THREE.Group();
  group.name = 'ConsoleGroup';
  group.position.copy(LAYOUT.console);

  const platform = mesh(new THREE.CylinderGeometry(3.6, 3.7, 0.1, 64), mats.metalDark, { name: 'ConsolePlatform', receive: true });
  platform.position.y = 0.05;
  group.add(platform);
  const edge = mesh(new THREE.TorusGeometry(3.65, 0.02, 6, 128), mats.glowCyanSoft, { name: 'PlatformEdge' });
  edge.rotation.x = Math.PI / 2;
  edge.position.y = 0.1;
  group.add(edge);

  const panels = {};
  const focus = new THREE.Vector3(0, 0, 4.5); // titik (local) yang dihadap semua station
  for (const def of PANEL_DEFS) {
    // Station = meja + panel. Station diputar menghadap `focus` -> panel ikut berputar (child).
    const station = new THREE.Group();
    station.name = `Station_${def.label}`;
    station.position.set(def.slot * 2.5, 0.1, def.slot === 0 ? -0.7 : -0.1);
    station.rotation.y = Math.atan2(focus.x - station.position.x, focus.z - station.position.z);

    const desk = new THREE.Group();
    desk.name = 'Desk';
    desk.add(box(1.5, 0.86, 0.72, mats.painted, [0, 0.43, 0], { name: 'DeskBody', cast: true, receive: true }));
    desk.add(box(1.52, 0.05, 0.02, mats.glowCyanSoft, [0, 0.12, 0.37], { name: 'DeskKickLight' }));
    for (const side of [-1, 1]) {
      desk.add(box(0.06, 1.0, 0.8, mats.metalLight, [side * 0.78, 0.5, 0], { name: 'DeskFin', cast: true }));
    }
    station.add(desk);

    const panel = buildPanel(def, mats);
    panel.group.position.set(0, 0.92, 0.04);
    panel.group.rotation.x = 0.5; // panel dimiringkan menghadap operator
    station.add(panel.group);

    group.add(station);
    panel.station = station; // seluruh station (meja + panel) dipakai sebagai area klik
    panels[def.id] = panel;
  }
  return { group, panels };
}

// ====================================================================
// DOOR (frame + 2 daun pintu geser + lockLight + FinalTerminal)
// ====================================================================
function buildDoor(mats) {
  const group = new THREE.Group();
  group.name = 'DoorGroup';
  group.position.copy(LAYOUT.door);
  const W = 3.2;
  const H = 3.6;

  const frame = new THREE.Group();
  frame.name = 'DoorFrame';
  for (const side of [-1, 1]) {
    frame.add(box(0.5, H + 0.5, 0.6, mats.metalDark, [side * (W / 2 + 0.25), (H + 0.5) / 2, 0.3], { name: 'Post', cast: true, receive: true }));
    frame.add(box(0.04, H, 0.02, mats.glowCyanSoft, [side * (W / 2 + 0.12), H / 2, 0.61], { name: 'FrameGlow' }));
  }
  frame.add(box(W + 1.0, 0.5, 0.6, mats.metalDark, [0, H + 0.25, 0.3], { name: 'Lintel', cast: true, receive: true }));
  frame.add(box(W + 1.0, 0.04, 0.8, mats.metalLight, [0, 0.02, 0.15], { name: 'Threshold', receive: true }));
  group.add(frame);

  const lockLight = box(1.0, 0.12, 0.05, mats.lockLight, [0, H + 0.25, 0.625], { name: 'LockLight' });
  group.add(lockLight);

  // Daun pintu = child DoorGroup. Animasi buka cukup menggeser position.x LOCAL-nya.
  const makeLeaf = (name, side) => {
    const leaf = new THREE.Group();
    leaf.name = name;
    leaf.position.x = side * (W / 4);
    leaf.userData.closedX = leaf.position.x;
    leaf.userData.openX = side * (W / 4 + W / 2 - 0.05);
    leaf.add(box(W / 2, H, 0.12, mats.doorLeaf, [0, H / 2, 0], { name: 'LeafPanel', cast: true, receive: true }));
    for (const y of [0.6, 1.8, 3.0]) {
      leaf.add(box(W / 2 - 0.25, 0.06, 0.03, mats.metalDark, [0, y, 0.07], { name: 'LeafRib' }));
    }
    leaf.add(box(0.07, H * 0.8, 0.02, mats.doorStripe, [-side * (W / 4 - 0.12), H / 2, 0.075], { name: 'LeafStripe' }));
    group.add(leaf);
    return leaf;
  };
  const leftLeaf = makeLeaf('leftLeaf', -1);
  const rightLeaf = makeLeaf('rightLeaf', 1);

  // Lorong di balik pintu: box BackSide (hanya sisi dalam yang dirender).
  const corridor = new THREE.Group();
  corridor.name = 'Corridor';
  corridor.add(box(W, H, 6, mats.corridor, [0, H / 2, -3.15], { name: 'CorridorShell', receive: true }));
  const exit = mesh(new THREE.PlaneGeometry(W - 0.6, H - 0.6), mats.exitGlow, { name: 'ExitGlow' });
  exit.position.set(0, H / 2, -6.1);
  corridor.add(exit);
  corridor.add(box(0.2, 0.04, 5.6, mats.ceilingLight, [0, H - 0.03, -3.2], { name: 'CorridorLight' }));
  group.add(corridor);

  // Final Terminal: child DoorGroup, di kanan pintu.
  const terminal = new THREE.Group();
  terminal.name = 'FinalTerminal';
  terminal.position.set(2.95, 0, 0.6);
  terminal.add(box(0.55, 1.0, 0.4, mats.painted, [0, 0.5, 0], { name: 'Pedestal', cast: true, receive: true }));
  const head = new THREE.Group();
  head.name = 'TerminalHead';
  head.position.y = 1.0;
  head.rotation.x = -0.3; // miring ke belakang agar layar menghadap ke atas-depan
  head.add(box(0.72, 0.52, 0.12, mats.metalDark, [0, 0.26, 0], { name: 'HeadBody', cast: true }));
  const screen = createScreen(0.6, 0.34);
  screen.mesh.name = 'TerminalScreen';
  screen.mesh.position.set(0, 0.29, 0.061);
  drawScreen(screen, { title: 'DOOR CONTROL', status: 'LOCKED', color: COLORS.red, footer: 'AWAITING POWER / NETWORK / SECURITY' });
  head.add(screen.mesh);
  terminal.add(head);
  const padMat = emissiveMaterial(COLORS.red, 0.8);
  const pad = box(0.3, 0.06, 0.06, padMat, [0, 0.9, 0.2], { name: 'TerminalPad' });
  terminal.add(pad);
  group.add(terminal);

  return { group, leftLeaf, rightLeaf, lockLight, corridor, terminal: { group: terminal, screen, pad } };
}

// ====================================================================
// MACHINE (reactor dengan ring berputar)
// ====================================================================
function buildMachine(mats) {
  const group = new THREE.Group();
  group.name = 'MachineGroup';
  group.position.copy(LAYOUT.machine);
  const opts = (name) => ({ name, cast: true, receive: true });

  const base = mesh(new THREE.CylinderGeometry(1.45, 1.6, 0.35, 48), mats.metalDark, opts('ReactorBase'));
  base.position.y = 0.175;
  const deck = mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.25, 48), mats.metalLight, opts('ReactorDeck'));
  deck.position.y = 0.475;
  const cap = mesh(new THREE.CylinderGeometry(1.45, 1.3, 0.35, 48), mats.metalDark, opts('ReactorCap'));
  cap.position.y = 3.75;
  group.add(base, deck, cap);

  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    group.add(box(0.16, 3.0, 0.16, mats.metalDark, [Math.cos(a) * 1.35, 2.1, Math.sin(a) * 1.35], opts('Strut')));
  }
  for (const x of [-0.55, 0.55]) {
    const pipe = mesh(new THREE.CylinderGeometry(0.12, 0.12, ROOM.height - 3.9, 16), mats.metalLight, opts('Pipe'));
    pipe.position.set(x, 3.9 + (ROOM.height - 3.9) / 2, 0);
    group.add(pipe);
  }

  const core = mesh(new THREE.CylinderGeometry(0.26, 0.26, 3.0, 24), mats.reactorCore, { name: 'ReactorCore' });
  core.position.y = 2.1;
  const glass = mesh(new THREE.CylinderGeometry(0.5, 0.5, 3.0, 32, 1, true), mats.glass, { name: 'ReactorGlass' });
  glass.position.y = 2.1;
  group.add(core, glass);

  // RingPivot -> RingTilt_i (kemiringan tetap) -> Ring_i (diputar di animation.js).
  const ringPivot = new THREE.Group();
  ringPivot.name = 'RingPivot';
  ringPivot.position.y = 2.1;
  const ringSpecs = [
    { radius: 1.2, tube: 0.06, tilt: [Math.PI / 2, 0, 0] },
    { radius: 1.0, tube: 0.05, tilt: [Math.PI / 2 + 0.5, 0.3, 0] },
    { radius: 0.8, tube: 0.04, tilt: [Math.PI / 2 - 0.6, -0.4, 0] },
  ];
  const rings = ringSpecs.map((spec, i) => {
    const tilt = new THREE.Group();
    tilt.name = `RingTilt_${i}`;
    tilt.rotation.set(...spec.tilt);
    const ring = mesh(new THREE.TorusGeometry(spec.radius, spec.tube, 12, 80), mats.ring, { name: `Ring_${i}`, cast: true });
    tilt.add(ring);
    ringPivot.add(tilt);
    return ring;
  });
  group.add(ringPivot);

  return { group, core, ringPivot, rings };
}

// ====================================================================
// HOLOGRAM (projector + model hologram + ring)
// ====================================================================
function buildHologram(assets, mats) {
  const group = new THREE.Group();
  group.name = 'HologramGroup';
  group.position.copy(LAYOUT.hologram);

  const base = mesh(new THREE.CylinderGeometry(0.95, 1.1, 0.3, 48), mats.metalDark, { name: 'ProjectorBase', cast: true, receive: true });
  base.position.y = 0.15;
  const column = mesh(new THREE.CylinderGeometry(0.6, 0.75, 0.45, 48), mats.metalLight, { name: 'ProjectorColumn', cast: true });
  column.position.y = 0.525;
  const emitter = mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.04, 48), mats.glowCyan, { name: 'Emitter' });
  emitter.position.y = 0.77;
  group.add(base, column, emitter);

  const beamMat = createHologramBasicMaterial(COLORS.cyan, 0.08);
  const beam = mesh(new THREE.CylinderGeometry(0.9, 0.42, 1.5, 48, 1, true), beamMat, { name: 'HoloBeam' });
  beam.position.y = 1.54;
  group.add(beam);

  // HoloPivot berputar/bobbing; model dan ring ikut karena merupakan child-nya.
  const pivot = new THREE.Group();
  pivot.name = 'HoloPivot';
  pivot.position.y = 2.05;

  const source = assets.models.hologram?.scene ?? createFallbackHoloModel();
  const model = fitModel(source, { size: 1.25, fit: 'max', align: 'center', castShadow: false });
  model.name = 'HoloModel';
  const holoMat = createHologramBasicMaterial(COLORS.cyan, 0.3);
  model.traverse((child) => {
    if (child.isMesh) child.material = holoMat;
  });
  pivot.add(model);

  const ringMat = createHologramBasicMaterial(COLORS.cyan, 0.7);
  const ring = mesh(new THREE.TorusGeometry(0.95, 0.012, 8, 96), ringMat, { name: 'HoloRing' });
  ring.rotation.x = Math.PI / 2;
  pivot.add(ring);
  group.add(pivot);

  // Hit-box tak terlihat untuk raycast: hologram tipis & transparan sulit diklik tepat.
  // visible = false -> tidak dirender, tetapi Raycaster tetap bisa mengenainya.
  const hitProxy = mesh(new THREE.SphereGeometry(1.0, 12, 8), new THREE.MeshBasicMaterial(), { name: 'HoloHitProxy' });
  hitProxy.visible = false;
  hitProxy.position.y = 1.7;
  hitProxy.scale.set(1, 1.3, 1);
  group.add(hitProxy);

  return { group, pivot, pivotBaseY: pivot.position.y, model, ring, beam, hitProxy, materials: { model: holoMat, beam: beamMat, ring: ringMat } };
}

// ====================================================================
// PROPS (robot, server terminal, crate)
// ====================================================================
function buildProps(assets, mats) {
  const group = new THREE.Group();
  group.name = 'PropsGroup';
  const faceTowards = (object, x, z) => {
    object.rotation.y = Math.atan2(x - object.position.x, z - object.position.z);
  };

  const robot = fitModel(assets.models.robot?.scene ?? createFallbackRobot(), { size: 1.25 });
  robot.name = 'Robot';
  robot.position.copy(LAYOUT.robot);
  faceTowards(robot, 0, 5.2);
  group.add(robot);

  const terminal = fitModel(assets.models.terminal?.scene ?? createFallbackTerminal(), { size: 2.1, receiveShadow: true });
  terminal.name = 'ServerTerminal';
  terminal.position.copy(LAYOUT.terminal); // menempel dinding belakang, menghadap +Z (ke ruangan)
  group.add(terminal);

  const crates = new THREE.Group();
  crates.name = 'Crates';
  const crateSpecs = [
    { size: 0.8, pos: [7.7, 0.4, 0.5], rot: 0.1 },
    { size: 0.8, pos: [7.6, 0.4, 1.5], rot: -0.15 },
    { size: 0.55, pos: [7.65, 1.075, 0.9], rot: 0.4 },
  ];
  for (const spec of crateSpecs) {
    const crate = box(spec.size, spec.size, spec.size, mats.crate, spec.pos, { name: 'Crate', cast: true, receive: true });
    crate.rotation.y = spec.rot;
    crate.add(box(spec.size * 1.01, 0.04, spec.size * 1.01, mats.glowCyanSoft, [0, spec.size * 0.3, 0], { name: 'CrateStripe' }));
    crates.add(crate);
  }
  group.add(crates);

  return { group, robot, terminal, robotAnimations: assets.models.robot?.animations ?? [] };
}

// ====================================================================
// ENTRY POINT
// ====================================================================
/**
 * Membangun seluruh ControlRoom dan mengembalikan referensi ke bagian-bagian penting
 * (panel, pintu, mesin, hologram) supaya modul lain (interaction/animation) bisa mengaksesnya.
 */
export function buildControlRoom(assets, { maxAnisotropy = 1 } = {}) {
  const mats = createMaterials(assets.textures, maxAnisotropy);

  const root = new THREE.Group();
  root.name = 'ControlRoom';

  const floor = buildFloor(mats);
  const walls = buildWalls(mats);
  const consoleParts = buildConsole(mats);
  const door = buildDoor(mats);
  const machine = buildMachine(mats);
  const hologram = buildHologram(assets, mats);
  const props = buildProps(assets, mats);

  root.add(floor, walls.group, consoleParts.group, door.group, machine.group, hologram.group, props.group);

  return {
    root,
    materials: mats,
    panels: consoleParts.panels,
    door,
    machine,
    hologram,
    props,
    warningLamps: walls.warningLamps,
  };
}
