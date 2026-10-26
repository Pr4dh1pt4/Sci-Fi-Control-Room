// animation.js — mesin tween sederhana, camera rig (intro, focus, kembali), dan animator
// yang menerjemahkan state misi menjadi gerakan & perubahan visual di scene.
import * as THREE from 'three';
import { SEQUENCE } from './state.js';
import { COLORS, drawScreen } from './room.js';
import { createWarningLightEffect, createHologramEffect, createSparkSystem, updatePanelGlow } from './effects.js';

// ====================================================================
// EASING — memetakan progres linear t (0..1) menjadi gerakan yang lebih natural.
// ====================================================================
export const ease = {
  linear: (t) => t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
};

// ====================================================================
// TWEEN ENGINE
// Tween = interpolasi sebuah nilai dari awal ke akhir selama `duration` detik.
// Setiap tween boleh punya `key`; membuat tween baru dengan key sama membatalkan yang lama.
// ====================================================================
const tweens = new Map();

export function tween({ key = Symbol('tween'), duration, delay = 0, easing = ease.linear, onUpdate, onComplete }) {
  tweens.set(key, { elapsed: -delay, duration, easing, onUpdate, onComplete });
  return key;
}

export function cancelTween(key) {
  tweens.delete(key);
}

/** Menjalankan `fn` setelah `seconds` detik (dibatalkan bila key yang sama dipakai lagi). */
export function delay(seconds, fn, key) {
  return tween({ key, duration: seconds, onComplete: fn });
}

/** Dipanggil sekali per frame dari render loop. */
export function updateTweens(dt) {
  for (const [key, t] of tweens) {
    t.elapsed += dt;
    if (t.elapsed < 0) continue; // masih dalam masa delay
    const progress = t.duration > 0 ? Math.min(t.elapsed / t.duration, 1) : 1;
    t.onUpdate?.(t.easing(progress));
    if (progress >= 1) {
      tweens.delete(key);
      t.onComplete?.();
    }
  }
}

/**
 * Smoothing eksponensial yang tidak bergantung frame rate:
 * nilai mendekati target dengan kecepatan `rate`, hasilnya sama di 30 maupun 144 FPS.
 */
function damp(current, target, rate, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-rate * dt));
}

function moveTowards(current, target, maxStep) {
  return Math.abs(target - current) <= maxStep ? target : current + Math.sign(target - current) * maxStep;
}

// ====================================================================
// CAMERA RIG
// Mode 'orbit'     : OrbitControls aktif (user bebas memutar kamera).
// Mode 'cinematic' : kamera digerakkan tween (intro / focus); OrbitControls dimatikan agar
//                    batas-batasnya tidak "melawan" posisi kamera hasil tween.
// ====================================================================
export function createCameraRig(camera, controls, home) {
  const lookTarget = controls.target.clone(); // titik yang dilihat kamera saat mode cinematic
  const fromPosition = new THREE.Vector3();
  const fromTarget = new THREE.Vector3();
  let mode = 'orbit';
  let focusName = null;
  let returnPose = null; // pose orbit terakhir sebelum masuk focus

  const capture = () => ({ position: camera.position.clone(), target: controls.target.clone() });

  function flyTo(pose, { duration = 1.2, onComplete } = {}) {
    if (mode === 'orbit') lookTarget.copy(controls.target);
    mode = 'cinematic';
    controls.enabled = false;
    cancelTween('camera-hold');
    fromPosition.copy(camera.position);
    fromTarget.copy(lookTarget);
    tween({
      key: 'camera',
      duration,
      easing: ease.inOutCubic,
      onUpdate: (t) => {
        camera.position.lerpVectors(fromPosition, pose.position, t);
        lookTarget.lerpVectors(fromTarget, pose.target, t);
      },
      onComplete,
    });
  }

  function enterOrbit(pose) {
    mode = 'orbit';
    focusName = null;
    returnPose = null;
    controls.target.copy(pose.target);
    controls.enabled = true;
    controls.update();
  }

  /** Kembali ke pose orbit sebelum focus. */
  function release({ duration = 1.0 } = {}) {
    if (!returnPose) return;
    const back = returnPose;
    focusName = 'returning';
    flyTo(back, { duration, onComplete: () => enterOrbit(back) });
  }

  return {
    get mode() {
      return mode;
    },
    get focusName() {
      return focusName;
    },

    /** Menahan kamera diam di sebuah pose (dipakai saat layar briefing). */
    hold(pose) {
      camera.position.copy(pose.position);
      lookTarget.copy(pose.target);
      mode = 'cinematic';
      controls.enabled = false;
    },

    /** Intro: kamera mulai dari `startPose` lalu meluncur ke posisi home. */
    playIntro(startPose, { duration = 2.8, onComplete } = {}) {
      camera.position.copy(startPose.position);
      lookTarget.copy(startPose.target);
      mode = 'cinematic';
      controls.enabled = false;
      flyTo(home, {
        duration,
        onComplete: () => {
          enterOrbit(home);
          onComplete?.();
        },
      });
    },

    /** Fokus ke sebuah pose. Bila `hold` diisi, kamera kembali otomatis setelah `hold` detik. */
    focus(name, pose, { duration = 1.0, hold = null } = {}) {
      // Simpan pose untuk kembali. Bila kamera sedang terbang (bukan orbit), kembali ke home.
      if (!returnPose) returnPose = mode === 'orbit' ? capture() : { position: home.position.clone(), target: home.target.clone() };
      focusName = name;
      flyTo(pose, {
        duration,
        onComplete: () => {
          if (hold !== null) delay(hold, release, 'camera-hold');
        },
      });
    },

    release,

    /** Kembali ke posisi awal (dipakai saat reset). */
    goHome({ duration = 1.2 } = {}) {
      returnPose = null;
      focusName = 'returning';
      flyTo(home, { duration, onComplete: () => enterOrbit(home) });
    },

    update(dt) {
      if (mode === 'orbit') controls.update(dt);
      else camera.lookAt(lookTarget);
    },
  };
}

// ---------- Pose focus (posisi kamera + titik yang dilihat), dihitung dari world transform ----------
const _q = new THREE.Quaternion();

/** Kamera di depan permukaan panel, searah normal panel (sumbu +Y lokal panel). */
export function panelFocusPose(panel, distance = 1.7) {
  const target = panel.group.getWorldPosition(new THREE.Vector3());
  const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(panel.group.getWorldQuaternion(_q));
  return { position: target.clone().addScaledVector(normal, distance), target };
}

export function hologramFocusPose(hologram, distance = 2.5) {
  const target = hologram.pivot.getWorldPosition(new THREE.Vector3());
  const toRoom = new THREE.Vector3(-target.x, 0, 3 - target.z).normalize(); // arah dari hologram ke tengah ruangan
  return { position: target.clone().addScaledVector(toRoom, distance).add(new THREE.Vector3(0, 0.35, 0)), target };
}

export function doorFocusPose(door) {
  const doorPos = door.group.getWorldPosition(new THREE.Vector3());
  return {
    position: new THREE.Vector3(doorPos.x, 2.6, doorPos.z + 4.8),
    target: new THREE.Vector3(doorPos.x, 1.8, doorPos.z),
  };
}


// ====================================================================
// ANIMATOR — semua visual diturunkan dari "level" 0..1 per sistem.
// State misi hanya mengubah TARGET level; setiap frame level bergerak halus menuju target,
// lalu dipakai untuk mengatur kecepatan ring, intensitas lampu, warna, posisi pintu, dll.
// Karena itu reset cukup mengembalikan target ke 0 dan semuanya kembali dengan mulus.
// ====================================================================
export function createAnimator(stage, room) {
  const { lights, scene } = stage;
  const { panels, door, machine, hologram, props, materials: mats } = room;

  const level = { power: 0, network: 0, security: 0, ready: 0, open: 0, holoFocus: 0 };
  const goal = { ...level };
  let doorProgress = 0; // 0 = tertutup, 1 = terbuka (bergerak dengan kecepatan konstan)
  let alarmTime = 0;
  let hoveredId = null;
  const hover = {}; // targetId -> nilai highlight 0..1
  const flash = {}; // panelId -> kilatan aktivasi 1 -> 0
  const panelStatus = {}; // panelId -> 'standby' | 'active' | 'denied'
  let terminalStatus = null;

  // ---------- VFX ----------
  const warning = createWarningLightEffect(mats.warningLamp, lights.warningLights);
  const holoFx = createHologramEffect(hologram);
  const sparks = createSparkSystem({ maxParticles: 240 });
  scene.add(sparks.points);
  const baseEnvIntensity = scene.environmentIntensity;

  // ---------- Robot idle: pakai animasi bawaan GLB bila ada, selain itu gerakan prosedural ----------
  let mixer = null;
  const robotModel = props.robot.children[0];
  const robotBaseYaw = props.robot.rotation.y;
  if (props.robotAnimations.length > 0) {
    mixer = new THREE.AnimationMixer(robotModel);
    const clip = props.robotAnimations.find((c) => /idle/i.test(c.name)) ?? props.robotAnimations[0];
    mixer.clipAction(clip).play();
  }

  const ringSpeeds = [0.9, -1.4, 1.9];
  const red = new THREE.Color(COLORS.red);
  const amber = new THREE.Color(COLORS.amber);
  const green = new THREE.Color(COLORS.green);
  const tmpColor = new THREE.Color();
  const tmpVec = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();

  // ---------- Panel (isi layar & warna; intensitas per frame diatur updatePanelGlow) ----------
  function drawPanel(panel, status) {
    const { def } = panel;
    if (status === 'active') {
      drawScreen(panel.screen, { title: def.label, status: 'STATUS: ONLINE', color: def.color, statusColor: COLORS.green, footer: 'SYSTEM ACTIVE' });
      panel.indicator.material.emissive.setHex(COLORS.green);
    } else if (status === 'denied') {
      drawScreen(panel.screen, { title: 'ACCESS DENIED', status: 'SEQUENCE ERROR', color: COLORS.red, footer: 'PROTOCOL RESET' });
      panel.indicator.material.emissive.setHex(COLORS.red);
    } else {
      drawScreen(panel.screen, { title: def.label, status: 'STATUS: STANDBY', color: def.color, footer: 'SYSTEM OFFLINE' });
      panel.indicator.material.emissive.setHex(COLORS.red);
    }
  }

  function setPanelStatus(id, status) {
    if (panelStatus[id] === status) return; // gambar ulang canvas hanya bila status berubah
    panelStatus[id] = status;
    drawPanel(panels[id], status);
  }

  function setTerminalStatus(status) {
    if (terminalStatus === status) return;
    terminalStatus = status;
    const { screen } = door.terminal;
    if (status === 'open') {
      drawScreen(screen, { title: 'ACCESS GRANTED', status: 'DOOR OPEN', color: COLORS.green });
    } else if (status === 'ready') {
      drawScreen(screen, { title: 'DOOR CONTROL', status: 'READY', color: COLORS.amber, statusColor: COLORS.green, footer: 'TOUCH PAD TO OPEN' });
    } else {
      drawScreen(screen, { title: 'DOOR CONTROL', status: 'LOCKED', color: COLORS.red, footer: 'AWAITING POWER / NETWORK / SECURITY' });
    }
  }

  /** Percikan dari tombol panel, diarahkan sepanjang normal panel (+Y lokal panel). */
  function sparkFromPanel(id, color, count) {
    const panel = panels[id];
    panel.button.getWorldPosition(tmpVec);
    tmpDir.set(0, 1, 0).applyQuaternion(panel.group.getWorldQuaternion(tmpQuat));
    sparks.burst(tmpVec, color, { count, direction: tmpDir, speed: 2.6 });
  }

  return {
    hologramEffect: holoFx,
    levels: level, // hanya untuk dibaca modul lain (mis. audio mengikuti level POWER)

    /** Menyesuaikan target visual dengan snapshot state misi. */
    applyMission(snap) {
      for (const id of SEQUENCE) {
        const isActive = snap.active.includes(id);
        goal[id] = isActive ? 1 : 0;
        // Panel yang sedang menampilkan ACCESS DENIED dibiarkan sampai animasinya selesai.
        if (panelStatus[id] !== 'denied') setPanelStatus(id, isActive ? 'active' : 'standby');
      }
      goal.ready = snap.ready ? 1 : 0;
      goal.open = snap.doorOpen ? 1 : 0;
      setTerminalStatus(snap.doorOpen ? 'open' : snap.ready ? 'ready' : 'locked');
    },

    /** Langsung lompat ke target tanpa transisi (dipakai saat pertama kali dimuat). */
    snap() {
      Object.assign(level, goal);
      doorProgress = goal.open;
    },

    /** Animasi tombol tertekan: turun lalu naik lagi. */
    pressButton(id) {
      const button = panels[id].button;
      tween({
        key: `button-${id}`,
        duration: 0.35,
        onUpdate: (t) => {
          button.position.y = button.userData.restY - 0.035 * Math.sin(Math.PI * t);
        },
      });
    },

    /** VFX aktivasi berhasil: kilatan emissive + percikan warna sistem. */
    activatePanel(id) {
      flash[id] = 1;
      sparkFromPanel(id, panels[id].def.color, 60);
    },

    /** Panel menampilkan ACCESS DENIED sebentar (+ percikan merah), lalu kembali standby. */
    denyPanel(id) {
      setPanelStatus(id, 'denied');
      sparkFromPanel(id, COLORS.red, 45);
      delay(1.4, () => setPanelStatus(id, goal[id] ? 'active' : 'standby'), `deny-${id}`);
    },

    /** Percikan hijau dari lockLight saat pintu terbuka. */
    doorOpened() {
      door.lockLight.getWorldPosition(tmpVec);
      sparks.burst(tmpVec, COLORS.green, { count: 70, direction: tmpDir.set(0, -0.2, 1), speed: 3 });
    },

    triggerAlarm(seconds = 1.8) {
      alarmTime = seconds;
    },

    setHovered(id) {
      hoveredId = id;
    },

    setHoloFocus(on) {
      goal.holoFocus = on ? 1 : 0;
    },

    reset() {
      alarmTime = 0;
      sparks.reset();
      for (const id of SEQUENCE) {
        cancelTween(`deny-${id}`);
        flash[id] = 0;
        panelStatus[id] = null; // paksa gambar ulang
      }
    },

    update(dt, time) {
      for (const key of Object.keys(level)) level[key] = damp(level[key], goal[key], 2.5, dt);
      alarmTime = Math.max(0, alarmTime - dt);

      // ---- Hover highlight (nilai 0..1 per target) ----
      for (const id of [...SEQUENCE, 'hologram', 'terminal']) {
        hover[id] = damp(hover[id] ?? 0, hoveredId === id ? 1 : 0, 12, dt);
      }

      // ---- Panel: emissive pulse / flash / hover ----
      SEQUENCE.forEach((id, i) => {
        flash[id] = Math.max(0, (flash[id] ?? 0) - dt * 1.6);
        updatePanelGlow(panels[id], { status: panelStatus[id], hover: hover[id], flash: flash[id], time, phase: i * 2.1 });
      });

      // ---- POWER: reactor & lampu ruangan ----
      const p = level.power;
      const spin = 0.15 + 1.1 * p;
      machine.ringPivot.rotation.y += 0.5 * spin * dt;
      machine.rings.forEach((ring, i) => (ring.rotation.y += ringSpeeds[i] * spin * dt));
      machine.core.material.emissiveIntensity = 0.45 + 1.3 * p + (0.08 + 0.25 * p) * Math.sin(time * 9);
      mats.ring.emissiveIntensity = 0.05 + 0.35 * p;
      lights.machineLight.intensity = 4 + 14 * p;
      mats.ceilingLight.emissiveIntensity = 0.35 + 1.85 * p;
      lights.key.intensity = 0.55 + 1.05 * p;
      lights.hemi.intensity = 0.3 + 0.3 * p;
      lights.consoleLight.intensity = 3 + 5 * p;
      scene.environmentIntensity = baseEnvIntensity * (0.55 + 0.45 * p); // pantulan ikut meredup saat power mati

      // ---- NETWORK: hologram (shader) ----
      const n = level.network;
      holoFx.update(time, { signal: n, hover: hover.hologram, focus: level.holoFocus });
      hologram.materials.ring.opacity = 0.25 + 0.45 * n + 0.2 * hover.hologram;
      lights.hologramLight.intensity = 2 + 8 * n;
      hologram.pivot.rotation.y += (0.35 + 0.5 * n + 2.2 * level.holoFocus) * dt;
      hologram.pivot.position.y = hologram.pivotBaseY + Math.sin(time * 1.6) * 0.06;
      hologram.ring.rotation.z = Math.sin(time * 0.7) * 0.15; // ring sedikit bergoyang

      // ---- SECURITY: warning light lockdown & alarm salah urutan ----
      warning.update(time, { lockdown: 1 - level.security, alarm: alarmTime > 0 });

      // ---- Pintu: warna lock (merah -> amber saat READY -> hijau saat terbuka) ----
      tmpColor.copy(red).lerp(amber, level.ready).lerp(green, level.open);
      mats.lockLight.emissive.copy(tmpColor);
      mats.doorStripe.emissive.copy(tmpColor);
      mats.exitGlow.emissiveIntensity = 0.6 + 1.6 * level.open;

      doorProgress = moveTowards(doorProgress, goal.open, dt / 2.4); // buka/tutup dalam 2.4 detik
      const doorT = ease.inOutCubic(doorProgress);
      for (const leaf of [door.leftLeaf, door.rightLeaf]) {
        leaf.position.x = THREE.MathUtils.lerp(leaf.userData.closedX, leaf.userData.openX, doorT);
      }

      // ---- Final Terminal: pad berdenyut saat READY ----
      const padPulse = level.ready * (1 - level.open) * (0.5 + 0.5 * Math.sin(time * 4));
      door.terminal.pad.material.emissive.copy(red).lerp(green, level.ready);
      door.terminal.pad.material.emissiveIntensity = 0.6 + 1.6 * padPulse + 1.2 * hover.terminal;

      // ---- Robot idle ----
      if (mixer) mixer.update(dt);
      else props.robot.rotation.y = robotBaseYaw + Math.sin(time * 0.5) * 0.35; // menoleh pelan

      sparks.update(dt);
    },
  };
}
