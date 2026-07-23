'use client';

// Haptics & sound effects for iOS-like feedback. Toggleable via localStorage.

const HAPTICS_KEY = 'shiftops_haptics';
const SOUNDS_KEY = 'shiftops_sounds';

export function getHaptics() {
  if (typeof window === 'undefined') return true;
  const v = window.localStorage.getItem(HAPTICS_KEY);
  return v === null ? true : v === '1';
}
export function setHaptics(on) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(HAPTICS_KEY, on ? '1' : '0');
}
export function getSounds() {
  if (typeof window === 'undefined') return true;
  const v = window.localStorage.getItem(SOUNDS_KEY);
  return v === null ? true : v === '1';
}
export function setSounds(on) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SOUNDS_KEY, on ? '1' : '0');
}

// -------- Haptics --------
export function hapticTap() {
  if (!getHaptics()) return;
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  navigator.vibrate(8);
}
export function hapticImpact() {
  if (!getHaptics()) return;
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  navigator.vibrate(18);
}
export function hapticSuccess() {
  if (!getHaptics()) return;
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  navigator.vibrate([12, 40, 30]);
}
export function hapticWarning() {
  if (!getHaptics()) return;
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  navigator.vibrate([25, 60, 25]);
}
export function hapticError() {
  if (!getHaptics()) return;
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  navigator.vibrate([40, 60, 40, 60, 40]);
}

// -------- Sounds (Web Audio API — iOS-style tones) --------
let audioCtx = null;
function ctx() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  }
  return audioCtx;
}

function tone({ freq, dur = 0.12, type = 'sine', volume = 0.15, delay = 0 }) {
  const c = ctx(); if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime + delay);
  gain.gain.setValueAtTime(0, c.currentTime + delay);
  gain.gain.linearRampToValueAtTime(volume, c.currentTime + delay + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + delay + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(c.currentTime + delay);
  osc.stop(c.currentTime + delay + dur + 0.02);
}

export function soundTap() {
  if (!getSounds()) return;
  tone({ freq: 880, dur: 0.06, type: 'sine', volume: 0.06 });
}
export function soundSuccess() {
  if (!getSounds()) return;
  tone({ freq: 660, dur: 0.09, volume: 0.12 });
  tone({ freq: 990, dur: 0.14, volume: 0.14, delay: 0.09 });
}
export function soundError() {
  if (!getSounds()) return;
  tone({ freq: 220, dur: 0.14, type: 'sawtooth', volume: 0.14 });
  tone({ freq: 165, dur: 0.18, type: 'sawtooth', volume: 0.14, delay: 0.14 });
}
export function soundNotify() {
  if (!getSounds()) return;
  // iOS "tri-tone" style
  tone({ freq: 1046, dur: 0.10, volume: 0.13 });
  tone({ freq: 1318, dur: 0.10, volume: 0.13, delay: 0.10 });
  tone({ freq: 1568, dur: 0.16, volume: 0.14, delay: 0.20 });
}

// Combos
export const fx = {
  tap: () => { hapticTap(); soundTap(); },
  success: () => { hapticSuccess(); soundSuccess(); },
  error: () => { hapticError(); soundError(); },
  warning: () => { hapticWarning(); },
  notify: () => { hapticImpact(); soundNotify(); },
};

// Web push notifications
export async function ensureNotifPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') {
    try { return await Notification.requestPermission(); } catch { return 'denied'; }
  }
  return Notification.permission;
}
export function showBrowserNotif(title, body) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, icon: '/icon.svg', badge: '/icon.svg', silent: !getSounds() });
    n.onclick = () => { try { window.focus(); n.close(); } catch {} };
  } catch {}
}
