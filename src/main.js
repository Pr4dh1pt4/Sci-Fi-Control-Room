// main.js — bootstrap aplikasi: buat stage, muat asset, bangun ruangan, hubungkan
// state misi <-> interaksi <-> animasi <-> HUD, lalu jalankan render loop.
import './style.css';
import * as THREE from 'three';
import { createStage, applyEnvironment, createDebugHelpers, createPerfMonitor, CAMERA_HOME } from './scene.js';
import { loadAssets } from './assets.js';
import { buildControlRoom } from './room.js';
import { createMission, SYSTEM_LABELS, PHASE } from './state.js';
import { createInteraction } from './interaction.js';
import {
  updateTweens,
  delay,
  cancelTween,
  createCameraRig,
  createAnimator,
  panelFocusPose,
  hologramFocusPose,
  doorFocusPose,
} from './animation.js';
import * as ui from './ui.js';

const INTRO_START = {
  position: new THREE.Vector3(-4.2, 4.7, 6.2),
  target: new THREE.Vector3(0, 2.2, -4),
};

// Waktu terbaik disimpan di localStorage browser (opsional: bisa gagal di mode privat, jadi pakai try/catch).
const BEST_TIME_KEY = 'scifi-control-room:best-time';

function readBestTime() {
  try {
    const value = Number.parseFloat(localStorage.getItem(BEST_TIME_KEY));
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function saveBestTime(seconds) {
  try {
    localStorage.setItem(BEST_TIME_KEY, String(seconds));
  } catch {
    // abaikan: fitur rekor hanya pelengkap
  }
}

async function init() {
  const stage = createStage(document.getElementById('app'));
  const { renderer, scene, camera, controls } = stage;

  const assets = await loadAssets(ui.setLoadingProgress);
  applyEnvironment(stage, assets.hdr);

  const room = buildControlRoom(assets, { maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
  scene.add(room.root);

  // ---------- Modul utama ----------
  const mission = createMission();
  const animator = createAnimator(stage, room);
  const rig = createCameraRig(camera, controls, CAMERA_HOME);
  let started = false; // sudah menekan MULAI di layar briefing
  let introDone = false;

  animator.applyMission(mission.snapshot());
  animator.snap(); // kondisi awal: lockdown (lampu redup, alarm berdenyut)
  ui.renderMission(mission.snapshot());

  // ---------- Reaksi terhadap event misi ----------
  mission.on('change', (_, snap) => {
    animator.applyMission(snap);
    ui.renderMission(snap);
    if (rig.focusName === 'hologram') ui.showHoloInfo(snap);
  });

  mission.on('activated', ({ id }) => {
    animator.activatePanel(id);
    const messages = {
      power: 'POWER ONLINE — reactor & lampu fasilitas menyala',
      network: 'NETWORK ONLINE — sinyal hologram stabil',
      security: 'SECURITY ONLINE — lockdown dicabut',
    };
    ui.showToast(messages[id], 'success');
  });

  mission.on('rejected', ({ id, expected }) => {
    animator.denyPanel(id);
    animator.triggerAlarm();
    ui.flashAlarm();
    ui.showToast(
      `<b>AKSES DITOLAK</b> — ${SYSTEM_LABELS[id]} di luar urutan (seharusnya ${SYSTEM_LABELS[expected]}). Protokol di-reset.`,
      'error',
      3600,
    );
  });

  mission.on('already-active', ({ id }) => ui.showToast(`${SYSTEM_LABELS[id]} sudah aktif.`, 'info'));
  mission.on('ready', () => ui.showToast('Semua sistem aktif. Final Terminal siap dipakai.', 'success', 3600));
  mission.on('locked', () => ui.showToast('Final Terminal terkunci — aktifkan POWER, NETWORK, SECURITY dulu.', 'error'));

  mission.on('complete', ({ time, errors }) => {
    ui.hideHoloInfo();
    animator.doorOpened();
    rig.focus('door', doorFocusPose(room.door), { duration: 1.4 });
    const previousBest = readBestTime();
    const isNewBest = previousBest === null || time < previousBest;
    if (isNewBest) saveBestTime(time);
    delay(3.4, () => ui.showComplete({ time, errors, best: previousBest, isNewBest }), 'show-complete');
  });

  mission.on('reset', () => {
    introDone = true; // reset saat intro: goHome membatalkan tween intro, jadi tandai selesai di sini
    cancelTween('show-complete');
    animator.reset();
    animator.setHoloFocus(false);
    ui.hideComplete();
    ui.hideHoloInfo();
    rig.goHome();
    ui.showToast('Misi di-reset. Mulai lagi dari POWER.', 'info');
  });

  // ---------- Interaksi ----------
  const panelTargets = Object.values(room.panels).map((panel) => ({
    type: 'panel',
    id: panel.id,
    meshes: collectMeshes(panel.station),
  }));
  const targets = [
    ...panelTargets,
    { type: 'hologram', id: 'hologram', meshes: [room.hologram.hitProxy] },
    { type: 'terminal', id: 'terminal', meshes: collectMeshes(room.door.terminal.group) },
  ];

  function enterHologramFocus() {
    animator.setHoloFocus(true);
    ui.showHoloInfo(mission.snapshot());
    rig.focus('hologram', hologramFocusPose(room.hologram), { duration: 1.2 });
  }

  function exitHologramFocus() {
    animator.setHoloFocus(false);
    ui.hideHoloInfo();
    rig.release({ duration: 1.1 });
  }

  const interaction = createInteraction({
    camera,
    domElement: renderer.domElement,
    targets,
    // Target yang boleh diinteraksi tergantung kondisi saat ini.
    isEnabled: (target) => {
      if (!introDone || mission.snapshot().phase === PHASE.COMPLETE) return false;
      if (rig.focusName === 'hologram') return target.type === 'hologram';
      return true;
    },
    onClick: (target) => {
      if (!target) return;
      if (target.type === 'panel') {
        animator.pressButton(target.id);
        // Kamera fokus singkat ke panel agar perubahan layar terlihat, lalu kembali otomatis.
        rig.focus('panel', panelFocusPose(room.panels[target.id]), { duration: 0.8, hold: 1.1 });
        mission.activate(target.id);
      } else if (target.type === 'hologram') {
        if (rig.focusName === 'hologram') exitHologramFocus();
        else enterHologramFocus();
      } else if (target.type === 'terminal') {
        mission.openDoor();
      }
    },
    onKey: (key) => {
      if (!started) {
        if (key === 'enter') startMission(); // selama briefing hanya Enter yang berlaku
        return;
      }
      if (key === 'r') mission.reset();
      else if (key === 'escape' && rig.focusName === 'hologram') exitHologramFocus();
      else if (key === 'h') {
        const visible = helpers.toggle();
        ui.showToast(`Debug helper ${visible ? 'ON' : 'OFF'} (shadow camera & posisi light)`, 'info');
      } else if (key === 'p') {
        perfVisible = ui.togglePerf();
      }
    },
  });

  const helpers = createDebugHelpers(stage);
  let perfVisible = false;
  const perf = createPerfMonitor(stage, {
    onDowngrade: (fps) => {
      console.info(`[perf] FPS rata-rata ${fps.toFixed(0)} < 40 — pixel ratio diturunkan ke 1.`);
      ui.showToast('Performa rendah terdeteksi: resolusi render diturunkan otomatis.', 'info', 3600);
    },
  });

  // Bila shader custom gagal di-compile (mis. GPU/driver tertentu), hologram beralih ke material
  // additive biasa agar project tetap berjalan.
  renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
    const log = gl.getShaderInfoLog(fragmentShader) || gl.getShaderInfoLog(vertexShader) || gl.getProgramInfoLog(program);
    console.warn('[effects] Shader gagal di-compile, hologram memakai fallback material.\n', log);
    animator.hologramEffect.useFallback();
  };

  // ---------- Mulai ----------
  // Alur: loading -> briefing (kamera diam di pose intro) -> MULAI -> intro dolly -> timer berjalan.
  function startMission() {
    if (started) return;
    started = true;
    ui.hideBriefing();
    ui.showHud();
    rig.playIntro(INTRO_START, {
      onComplete: () => {
        introDone = true;
        mission.start();
      },
    });
  }

  ui.initHud({ onReset: () => mission.reset(), onStart: startMission });

  // Compile semua shader sebelum frame pertama agar tidak patah-patah saat mulai.
  // (compile sinkron; compileAsync memunculkan warning di GPU tanpa KHR_parallel_shader_compile)
  rig.hold(INTRO_START);
  renderer.compile(scene, camera);
  ui.hideLoading();
  ui.showBriefing();

  // THREE.Timer: penghitung waktu antar-frame (pengganti THREE.Clock yang deprecated).
  const timer = new THREE.Timer();
  timer.connect(document); // delta tidak melonjak saat tab disembunyikan lalu dibuka lagi

  renderer.setAnimationLoop((timestamp) => {
    timer.update(timestamp);
    const rawDt = timer.getDelta();
    const dt = Math.min(rawDt, 0.1); // batasi delta agar animasi tidak "loncat" saat lag
    const time = timer.getElapsed();

    updateTweens(dt);
    rig.update(dt);
    camera.updateMatrixWorld();

    const hovered = interaction.update(); // satu raycast per frame
    animator.setHovered(hovered?.id ?? null);
    if (hovered) ui.showTooltip(interaction.client.x, interaction.client.y, describeTarget(hovered, mission.snapshot(), rig));
    else ui.hideTooltip();

    animator.update(dt, time);
    ui.setTime(mission.elapsed());
    renderer.render(scene, camera);

    // FPS diukur dari delta asli (bukan yang dibatasi); statistik dibaca setelah render.
    if (perf.update(rawDt) && perfVisible) ui.setPerfText(perf.report());
  });

  // Mode dev: akses dari DevTools, mis. __controlRoom.printSceneGraph()
  if (import.meta.env.DEV) {
    window.__controlRoom = { ...stage, room, mission, rig, animator, perf, printSceneGraph: () => printSceneGraph(scene) };
  }
}

function collectMeshes(root) {
  const meshes = [];
  root.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });
  return meshes;
}

/** Isi tooltip berdasarkan target yang di-hover & state misi. */
function describeTarget(target, snap, rig) {
  if (target.type === 'panel') {
    const active = snap.active.includes(target.id);
    return {
      title: `${SYSTEM_LABELS[target.id]} PANEL`,
      status: active ? 'ONLINE' : 'STANDBY',
      tone: active ? 'success' : 'warning',
      hint: active ? 'Sistem sudah aktif' : 'Klik untuk mengaktifkan',
    };
  }
  if (target.type === 'hologram') {
    const focused = rig.focusName === 'hologram';
    return {
      title: 'HOLOGRAM PROJECTOR',
      status: snap.active.includes('network') ? 'SIGNAL STABLE' : 'SIGNAL WEAK',
      tone: 'info',
      hint: focused ? 'Klik untuk kembali' : 'Klik untuk melihat status fasilitas',
    };
  }
  return {
    title: 'FINAL TERMINAL',
    status: snap.ready ? 'READY' : 'LOCKED',
    tone: snap.ready ? 'success' : 'error',
    hint: snap.ready ? 'Klik untuk membuka pintu utama' : 'Aktifkan 3 sistem terlebih dahulu',
  };
}

/** Mencetak hierarki scene graph (hanya Group & object bernama) — berguna saat demo. */
function printSceneGraph(object, depth = 0, maxDepth = 4) {
  const lines = [];
  const walk = (node, d) => {
    if (d > maxDepth) return;
    if (node.isGroup || node.isScene || node.isCamera || node.isLight || d <= 2) {
      lines.push(`${'  '.repeat(d)}${node.name || node.type} (${node.type})`);
    }
    node.children.forEach((child) => walk(child, d + 1));
  };
  walk(object, depth);
  console.info(lines.join('\n'));
}

init().catch((error) => {
  console.error(error);
  ui.showFatalError(error.message);
});
