// state.js — state machine misi.
// Sengaja TIDAK bergantung pada Three.js maupun DOM: hanya menyimpan aturan & data misi,
// lalu memberi tahu modul lain lewat event. Visual (animation.js) dan HUD (ui.js) cukup
// "mendengarkan" event ini, sehingga logika misi mudah diuji dan dijelaskan.

/** Urutan aktivasi yang benar. */
export const SEQUENCE = ['power', 'network', 'security'];

export const SYSTEM_LABELS = { power: 'POWER', network: 'NETWORK', security: 'SECURITY' };

/**
 * Status misi:
 *   LOCKDOWN  -> belum semua sistem aktif (0..2 sistem aktif)
 *   READY     -> 3 sistem aktif, Final Terminal bisa dipakai
 *   COMPLETE  -> pintu terbuka (completion state)
 */
export const PHASE = { LOCKDOWN: 'lockdown', READY: 'ready', COMPLETE: 'complete' };

export function createMission() {
  const data = {
    active: [], // sistem yang sudah aktif, berurutan
    errors: 0, // jumlah salah urutan
    doorOpen: false,
    startTime: null, // ms (performance.now) saat misi dimulai
    endTime: null,
  };
  const listeners = new Map();

  const phase = () => {
    if (data.doorOpen) return PHASE.COMPLETE;
    return data.active.length === SEQUENCE.length ? PHASE.READY : PHASE.LOCKDOWN;
  };

  const elapsed = (now = performance.now()) => {
    if (data.startTime === null) return 0;
    return ((data.endTime ?? now) - data.startTime) / 1000;
  };

  /** Salinan state yang aman dibaca modul lain (tidak bisa mengubah data asli). */
  const snapshot = () => ({
    active: [...data.active],
    errors: data.errors,
    doorOpen: data.doorOpen,
    phase: phase(),
    ready: phase() !== PHASE.LOCKDOWN,
    nextExpected: SEQUENCE[data.active.length] ?? null,
    elapsed: elapsed(),
  });

  const emit = (event, payload = {}) => {
    const snap = snapshot();
    for (const fn of listeners.get(event) ?? []) fn(payload, snap);
  };

  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },

    snapshot,
    elapsed,

    /** Mulai menghitung waktu (dipanggil setelah intro kamera selesai). */
    start(now = performance.now()) {
      if (data.startTime === null) data.startTime = now;
    },

    /**
     * Mencoba mengaktifkan sistem `id`.
     * @returns {'activated'|'rejected'|'already-active'|'ignored'}
     */
    activate(id) {
      if (phase() === PHASE.COMPLETE) return 'ignored';
      if (data.active.includes(id)) {
        emit('already-active', { id });
        return 'already-active';
      }

      const expected = SEQUENCE[data.active.length];
      if (id !== expected) {
        // Urutan salah: tolak, hitung kesalahan, dan kembalikan semua sistem ke standby.
        const revoked = data.active;
        data.active = [];
        data.errors += 1;
        emit('rejected', { id, expected, revoked });
        emit('change');
        return 'rejected';
      }

      data.active.push(id);
      emit('activated', { id });
      if (phase() === PHASE.READY) emit('ready');
      emit('change');
      return 'activated';
    },

    /**
     * Membuka pintu lewat Final Terminal. Hanya berhasil pada fase READY.
     * @returns {'opened'|'locked'|'ignored'}
     */
    openDoor(now = performance.now()) {
      if (phase() === PHASE.COMPLETE) return 'ignored';
      if (phase() !== PHASE.READY) {
        emit('locked');
        return 'locked';
      }
      data.doorOpen = true;
      data.endTime = now;
      emit('complete', { time: elapsed(now), errors: data.errors });
      emit('change');
      return 'opened';
    },

    /** Kembali ke kondisi awal; waktu langsung dihitung ulang dari sekarang. */
    reset(now = performance.now()) {
      data.active = [];
      data.errors = 0;
      data.doorOpen = false;
      data.startTime = now;
      data.endTime = null;
      emit('reset');
      emit('change');
    },
  };
}
