// interaction.js — Raycaster (hover & click) + input keyboard.
//
// Raycasting: dari posisi kursor di layar dibuat sinar (ray) yang berangkat dari kamera menembus
// scene. Object pertama yang terkena sinar = object yang sedang ditunjuk kursor.
import * as THREE from 'three';

const CLICK_MAX_MOVE = 6; // px — lebih dari ini dianggap drag (orbit kamera), bukan klik
const CLICK_MAX_TIME = 500; // ms

/**
 * @param {object} opts
 * @param {THREE.Camera} opts.camera
 * @param {HTMLElement} opts.domElement canvas renderer
 * @param {{type:string, id:string, meshes:THREE.Mesh[]}[]} opts.targets daftar object interaktif
 * @param {(target) => boolean} opts.isEnabled filter target yang boleh diinteraksi saat ini
 * @param {(target|null) => void} opts.onClick
 * @param {(key:string) => void} opts.onKey
 */
export function createInteraction({ camera, domElement, targets, isEnabled, onClick, onKey }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(); // posisi kursor dalam NDC (-1..1)
  const client = { x: 0, y: 0 }; // posisi kursor dalam pixel (untuk tooltip)
  let pointerInside = false;
  let downAt = null;
  let hovered = null;

  // Raycast hanya terhadap mesh milik target interaktif, bukan seluruh scene (lebih cepat).
  const meshes = [];
  for (const target of targets) {
    for (const mesh of target.meshes) {
      mesh.userData.target = target;
      meshes.push(mesh);
    }
  }

  function updatePointer(event) {
    const rect = domElement.getBoundingClientRect();
    // Konversi pixel -> Normalized Device Coordinates: x kiri=-1 kanan=+1, y bawah=-1 atas=+1.
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    client.x = event.clientX;
    client.y = event.clientY;
  }

  function pick() {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(meshes, false); // diurutkan dari yang terdekat
    for (const hit of hits) {
      const target = hit.object.userData.target;
      if (isEnabled(target)) return target;
    }
    return null;
  }

  domElement.addEventListener('pointermove', (event) => {
    updatePointer(event);
    pointerInside = true;
  });
  domElement.addEventListener('pointerleave', () => {
    pointerInside = false;
  });
  domElement.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    updatePointer(event);
    downAt = { x: event.clientX, y: event.clientY, time: performance.now() };
  });
  domElement.addEventListener('pointerup', (event) => {
    if (event.button !== 0 || !downAt) return;
    const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
    const isClick = moved < CLICK_MAX_MOVE && performance.now() - downAt.time < CLICK_MAX_TIME;
    downAt = null;
    if (!isClick) return;
    updatePointer(event);
    onClick(pick());
  });

  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return; // biarkan Ctrl+R dll.
    onKey(event.key.toLowerCase());
  });

  return {
    client,
    get hovered() {
      return hovered;
    },

    /** Dipanggil sekali per frame: satu raycast untuk hover (bukan di setiap event pointermove). */
    update() {
      const previous = hovered;
      hovered = pointerInside && !downAt ? pick() : null;
      // Cursor hanya diubah saat status hover berganti, agar cursor 'grab' milik OrbitControls tidak tertimpa.
      if (Boolean(previous) !== Boolean(hovered)) domElement.style.cursor = hovered ? 'pointer' : '';
      return hovered;
    },
  };
}
