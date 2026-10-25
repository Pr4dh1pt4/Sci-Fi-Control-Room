// ui.js — HUD/UI HTML di atas canvas: loading, objective, progress, tooltip, toast,
// info hologram, flash alarm, dan overlay MISSION COMPLETE.
import { SEQUENCE, SYSTEM_LABELS } from './state.js';

const $ = (id) => document.getElementById(id);

// ---------- Loading ----------
const loadingEl = $('loading');

export function setLoadingProgress(ratio, label = '') {
  const percent = Math.round(ratio * 100);
  $('loading-fill').style.width = `${percent}%`;
  $('loading-text').textContent = label ? `${percent}% · ${label}` : `${percent}%`;
}

export function hideLoading() {
  loadingEl.classList.add('is-hidden');
  loadingEl.addEventListener('transitionend', () => loadingEl.remove(), { once: true });
}

export function showFatalError(message) {
  $('loading-text').textContent = `ERROR: ${message}`;
  loadingEl.classList.add('is-error');
}

// ---------- HUD ----------
export function initHud({ onReset, onStart }) {
  $('reset-button').addEventListener('click', onReset);
  $('overlay-reset').addEventListener('click', onReset);
  $('start-button').addEventListener('click', onStart);
  $('mission-collapse').addEventListener('click', () => {
    const collapsed = $('mission-panel').classList.toggle('is-collapsed');
    $('mission-collapse').textContent = collapsed ? '+' : '−';
  });
}

// ---------- Briefing ----------
export function showBriefing() {
  $('briefing').classList.add('is-visible');
  $('start-button').focus();
}

export function hideBriefing() {
  $('briefing').classList.remove('is-visible');
}

// ---------- Panel performa ----------
export function togglePerf() {
  return $('perf-panel').classList.toggle('is-visible');
}

export function setPerfText(text) {
  $('perf-body').textContent = text;
}

export function showHud() {
  $('hud').classList.remove('is-hidden');
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

let lastShownSecond = -1;
export function setTime(seconds) {
  const whole = Math.floor(seconds);
  if (whole === lastShownSecond) return; // DOM hanya diubah sekali per detik
  lastShownSecond = whole;
  $('mission-time').textContent = formatTime(seconds);
}

/** Memperbarui objective list, progress bar, jumlah error, dan hint dari snapshot misi. */
export function renderMission(snap) {
  for (const id of SEQUENCE) {
    const item = document.querySelector(`[data-step="${id}"]`);
    const done = snap.active.includes(id);
    const next = snap.nextExpected === id;
    item.dataset.state = done ? 'done' : next ? 'next' : 'pending';
    item.querySelector('.objectives__state').textContent = done ? 'ONLINE' : 'OFFLINE';
  }
  const doorItem = document.querySelector('[data-step="door"]');
  doorItem.dataset.state = snap.doorOpen ? 'done' : snap.ready ? 'next' : 'pending';
  doorItem.querySelector('.objectives__state').textContent = snap.doorOpen ? 'OPEN' : snap.ready ? 'READY' : 'LOCKED';

  const steps = snap.active.length + (snap.doorOpen ? 1 : 0);
  $('progress-fill').style.width = `${(steps / (SEQUENCE.length + 1)) * 100}%`;
  $('progress-text').textContent = `${steps} / ${SEQUENCE.length + 1}`;
  $('error-count').textContent = snap.errors;

  let hint;
  if (snap.doorOpen) hint = 'Pintu utama terbuka. Misi selesai.';
  else if (snap.ready) hint = 'Semua sistem aktif. Klik <b>FINAL TERMINAL</b> di samping pintu.';
  else hint = `Sistem berikutnya: <b>${SYSTEM_LABELS[snap.nextExpected]}</b>`;
  $('sequence-hint').innerHTML = hint;
}

// ---------- Tooltip ----------
const tooltip = $('tooltip');

export function showTooltip(x, y, { title, status, hint, tone = 'info' }) {
  tooltip.innerHTML = `<div class="tooltip__title">${title}</div>
    <div class="tooltip__status tone-${tone}">${status}</div>
    ${hint ? `<div class="tooltip__hint">${hint}</div>` : ''}`;
  // Tooltip digeser agar tidak keluar layar.
  const pad = 18;
  const { offsetWidth: w, offsetHeight: h } = tooltip;
  const left = x + pad + w > window.innerWidth ? x - pad - w : x + pad;
  const top = Math.min(y + pad, window.innerHeight - h - 8);
  tooltip.style.transform = `translate(${left}px, ${top}px)`;
  tooltip.classList.add('is-visible');
}

export function hideTooltip() {
  tooltip.classList.remove('is-visible');
}

// ---------- Toast ----------
const MAX_TOASTS = 3;

export function showToast(message, type = 'info', duration = 2800) {
  const container = $('toasts');
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = message;
  container.prepend(toast);
  while (container.children.length > MAX_TOASTS) container.lastElementChild.remove();
  setTimeout(() => {
    toast.classList.add('is-leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}

// ---------- Flash alarm (vignette merah saat urutan salah) ----------
export function flashAlarm() {
  const el = $('alarm-flash');
  el.classList.remove('is-active');
  void el.offsetWidth; // paksa reflow agar animasi CSS bisa diputar ulang
  el.classList.add('is-active');
}

// ---------- Info hologram ----------
export function showHoloInfo(snap) {
  const rows = SEQUENCE.map((id) => {
    const on = snap.active.includes(id);
    return `<li><span>${SYSTEM_LABELS[id]}</span><span class="tone-${on ? 'success' : 'error'}">${on ? 'ONLINE' : 'OFFLINE'}</span></li>`;
  }).join('');
  const door = snap.doorOpen ? 'OPEN' : snap.ready ? 'READY' : 'LOCKED';
  $('holo-info-body').innerHTML = `
    <ul class="holo-info__list">${rows}<li><span>MAIN DOOR</span><span class="tone-${snap.ready ? 'success' : 'error'}">${door}</span></li></ul>
    <p>Protokol pemulihan: <b>POWER → NETWORK → SECURITY</b>, lalu konfirmasi di Final Terminal.
    Sistem menolak aktivasi di luar urutan dan mengulang protokol dari awal.</p>`;
  $('holo-info').classList.add('is-visible');
}

export function hideHoloInfo() {
  $('holo-info').classList.remove('is-visible');
}

// ---------- Overlay Mission Complete ----------
export function showComplete({ time, errors, best, isNewBest }) {
  $('result-time').textContent = formatTime(time);
  $('result-errors').textContent = errors;
  let note = errors === 0 ? 'Urutan sempurna tanpa kesalahan! ' : '';
  if (isNewBest) note += '★ Rekor waktu baru!';
  else if (best !== null) note += `Waktu terbaik: ${formatTime(best)}`;
  $('result-note').textContent = note;
  $('complete-overlay').classList.add('is-visible');
}

export function hideComplete() {
  $('complete-overlay').classList.remove('is-visible');
}
