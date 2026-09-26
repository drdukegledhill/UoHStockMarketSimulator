// Small shared helpers for all pages.
import { APP } from './config.js';
import qrcode from '../vendor/qrcode.mjs';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Prices: more decimals for cheap commodities.
export function fmtPrice(p) {
  const d = p >= 1000 ? 2 : p >= 20 ? 2 : 3;
  return APP.currencySymbol + p.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function fmtMoney(v, dp = 0) {
  const neg = v < 0;
  const s = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return (neg ? '-' : '') + APP.currencySymbol + s;
}
export function fmtPct(v, dp = 1) {
  const s = Math.abs(v).toFixed(dp);
  if (+s === 0) return (0).toFixed(dp) + '%';
  return (v > 0 ? '+' : '-') + s + '%';
}
export function fmtQty(q) {
  if (q === 0) return '0';
  if (q >= 100) return q.toLocaleString('en-GB', { maximumFractionDigits: 0 });
  if (q >= 1) return q.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  return q.toLocaleString('en-GB', { maximumFractionDigits: 4 });
}
export function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
export function arrow(v) { return v > 0.0001 ? '▲' : v < -0.0001 ? '▼' : '•'; }
export function dirClass(v) { return v > 0.0001 ? 'up' : v < -0.0001 ? 'down' : 'flat'; }

export function qrSvg(text, title = 'QR code') {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true, title });
}

// localStorage can throw (private mode, blocked storage). Never let it break the app.
export const store = {
  get(k, def = null) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};

export const sessionStore = {
  get(k, def = null) { try { const v = sessionStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};

// Keep screens awake where supported.
let wakeLock = null;
export async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) { /* not allowed yet */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

// Tiny synthesised sounds (no audio files needed).
let actx = null;
export const sound = {
  muted: false,
  ctx() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* ignore */ } } return actx; },
  tone(freq, dur, when = 0, type = 'sine', gain = 0.25) {
    const c = this.ctx(); if (!c || this.muted) return;
    const t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + dur + 0.05);
  },
  bell() { for (let i = 0; i < 3; i++) { this.tone(880, 1.2, i * 0.35, 'sine', 0.3); this.tone(1320, 0.9, i * 0.35, 'sine', 0.12); } },
  alert() { this.tone(660, 0.15, 0, 'square', 0.12); this.tone(990, 0.25, 0.16, 'square', 0.12); },
  blip(up = true) { this.tone(up ? 740 : 440, 0.12, 0, 'triangle', 0.15); },
};

export function randomCode(n = 4) {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  for (const x of buf) s += A[x % A.length];
  return s;
}

export function toast(text, ms = 2200) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}
