// audio.js — suara memakai sistem audio Three.js (Web Audio API):
//   1. Musik latar (BGM) dari file mp3.
//   2. Efek suara (SFX) SINTETIS: dibangkitkan dari oscillator & noise lewat kode, tanpa file audio.
//
// Alur sinyal:
//   BGM: <audio> (streaming) -> THREE.Audio -> lowpass filter -> gain ─┐
//   SFX: oscillator / noise -> envelope gain -> sfxBus ────────────────┼─> AudioListener (master) -> speaker
// - AudioListener ("telinga") dipasang sebagai child kamera.
// - Lowpass filter membuat musik teredam saat lockdown, lalu jernih seiring level POWER naik.
import * as THREE from 'three';
import { AUDIO_FILES, isAvailable, assetUrl } from './assets.js';

const MUSIC_VOLUME = 0.35;
const SFX_VOLUME = 0.6;
const MUTE_KEY = 'scifi-control-room:muted';

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMuted(muted) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // abaikan: preferensi mute hanya pelengkap
  }
}

export function createAudio(camera) {
  const musicAvailable = isAvailable(AUDIO_FILES.bgm);
  let muted = readMuted();
  let listener = null;
  let ctx = null; // AudioContext
  let element = null;
  let bgm = null;
  let filter = null;
  let sfxBus = null; // gain node gabungan semua efek suara
  let noiseBuffer = null;

  // ---------- Helper sintesis ----------
  /**
   * Satu nada: oscillator + envelope (naik cepat, lalu meluruh eksponensial).
   * type: 'sine' (lembut), 'triangle', 'square' (tajam), 'sawtooth' (kasar/buzzer).
   */
  function tone({ type = 'sine', freq, freqEnd = null, start = 0, duration = 0.2, volume = 0.3, attack = 0.005 }) {
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + duration); // pitch sweep
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(volume, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(env).connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05); // node otomatis dibuang browser setelah berhenti
  }

  /** Noise putih yang disaring bandpass bergerak (desis/whoosh), mis. untuk pintu hidrolik. */
  function noise({ start = 0, duration = 1, volume = 0.3, from = 2000, to = 300, q = 1.2 }) {
    const t0 = ctx.currentTime + start;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = q;
    band.frequency.setValueAtTime(from, t0);
    band.frequency.exponentialRampToValueAtTime(to, t0 + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(volume, t0 + duration * 0.15);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    source.connect(band).connect(env).connect(sfxBus);
    source.start(t0);
    source.stop(t0 + duration + 0.05);
  }

  function createNoiseBuffer() {
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); // 1 detik, mono
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  const applyVolume = () => {
    if (!ctx) return;
    // setTargetAtTime: fade halus (~0.3 s), bukan lompatan yang terdengar "klik".
    if (bgm) bgm.gain.gain.setTargetAtTime(muted ? 0 : MUSIC_VOLUME, ctx.currentTime, 0.3);
    sfxBus.gain.setTargetAtTime(muted ? 0 : SFX_VOLUME, ctx.currentTime, 0.05);
  };

  // Nada dasar per sistem (Hz): POWER rendah, NETWORK sedang, SECURITY tinggi.
  const SYSTEM_BASE = { power: 392, network: 523.25, security: 659.25 };

  const sfx = {
    /** Tombol panel ditekan. */
    click() {
      tone({ type: 'square', freq: 1400, freqEnd: 700, duration: 0.06, volume: 0.12 });
    },
    /** Sistem berhasil aktif: arpeggio naik (nada dasar, terts besar, kuint, oktaf). */
    activate(id) {
      const base = SYSTEM_BASE[id] ?? 440;
      [1, 1.25, 1.5, 2].forEach((ratio, i) => {
        tone({ type: 'triangle', freq: base * ratio, start: 0.06 + i * 0.07, duration: 0.35, volume: 0.18 });
      });
    },
    /** Urutan salah: buzzer kasar dua kali (dua sawtooth sedikit fals -> efek "beating"). */
    denied() {
      for (const start of [0, 0.22]) {
        tone({ type: 'sawtooth', freq: 110, start, duration: 0.18, volume: 0.16 });
        tone({ type: 'sawtooth', freq: 116, start, duration: 0.18, volume: 0.16 });
      }
    },
    /** Ketiga sistem aktif: akor mayor yang mengembang. */
    ready() {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq) => {
        tone({ type: 'sine', freq, start: 0.45, duration: 1.2, volume: 0.1, attack: 0.15 });
      });
    },
    /** Final Terminal diklik saat masih terkunci. */
    locked() {
      tone({ type: 'square', freq: 220, duration: 0.12, volume: 0.1 });
      tone({ type: 'square', freq: 180, start: 0.15, duration: 0.16, volume: 0.1 });
    },
    /** Pintu terbuka: dentum kunci lepas + desis hidrolik. */
    door() {
      tone({ type: 'sine', freq: 90, freqEnd: 40, duration: 0.45, volume: 0.45 });
      noise({ start: 0.1, duration: 2.2, volume: 0.22, from: 2500, to: 250 });
    },
    /** Mission Complete: fanfare singkat. */
    complete() {
      const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
      notes.forEach((freq, i) => {
        tone({ type: 'triangle', freq, start: i * 0.11, duration: i === notes.length - 1 ? 0.9 : 0.25, volume: 0.16 });
      });
    },
    /** Kamera fokus ke hologram (naik) / kembali (turun). */
    whoosh(up = true) {
      tone({ type: 'sine', freq: up ? 300 : 900, freqEnd: up ? 900 : 300, duration: 0.45, volume: 0.08, attack: 0.1 });
      noise({ duration: 0.45, volume: 0.05, from: up ? 800 : 3000, to: up ? 3000 : 800, q: 0.8 });
    },
    /** Reset misi: blip menurun. */
    reset() {
      [880, 660, 440].forEach((freq, i) => tone({ type: 'square', freq, start: i * 0.08, duration: 0.09, volume: 0.08 }));
    },
  };

  // Semua fungsi SFX aman dipanggil sebelum audio dimulai (cukup diabaikan).
  const guardedSfx = Object.fromEntries(
    Object.entries(sfx).map(([name, fn]) => [name, (...args) => (ctx ? fn(...args) : undefined)]),
  );

  return {
    available: true, // efek suara sintetis selalu tersedia, walau file musik tidak ada
    sfx: guardedSfx,
    get muted() {
      return muted;
    },
    get playing() {
      return Boolean(element && !element.paused);
    },

    /**
     * Menyiapkan audio. WAJIB dipanggil dari event pengguna (klik/Enter): kebijakan autoplay browser
     * melarang suara dan pembuatan AudioContext sebelum ada interaksi pengguna.
     */
    start() {
      if (ctx) return;
      listener = new THREE.AudioListener(); // membuat AudioContext (di dalam event pengguna)
      camera.add(listener);
      ctx = listener.context;

      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0;
      sfxBus.connect(listener.getInput()); // SFX lewat listener -> ikut master volume
      noiseBuffer = createNoiseBuffer();

      if (musicAvailable) {
        element = new Audio(assetUrl(AUDIO_FILES.bgm));
        element.loop = true;
        bgm = new THREE.Audio(listener);
        bgm.setMediaElementSource(element); // streaming: tidak perlu decode seluruh file ke memori
        filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 600;
        bgm.setFilter(filter);
        bgm.gain.gain.value = 0;
        element.play().catch((error) => console.info(`[audio] Musik tidak bisa diputar: ${error.message}`));

        // Hentikan musik saat tab disembunyikan, lanjutkan saat kembali.
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) element.pause();
          else element.play().catch(() => {});
        });
      }
      applyVolume(); // fade-in dari 0
    },

    toggleMute() {
      muted = !muted;
      saveMuted(muted);
      applyVolume();
      return muted;
    },

    /** Dipanggil tiap frame: cutoff filter musik mengikuti level POWER (0..1). */
    update(powerLevel) {
      if (!filter) return;
      // Skala eksponensial karena pendengaran manusia terhadap frekuensi bersifat logaritmik.
      filter.frequency.value = 600 * Math.pow(30, powerLevel);
    },
  };
}
