// ---------------------------------------------------------------------------
// Control panel UI. Used in the host page's drawer and in control.html
// (a second window on the laptop, or the presenter's phone as a remote).
// mountControls(root, send, { isHost }) returns render(state).
// ---------------------------------------------------------------------------

import { COMMODITIES, APP } from './config.js';
import { EVENTS } from './events.js';
import { esc, fmtPrice, fmtPct, fmtMoney, fmtClock, qrSvg, dirClass } from './ui.js';

const PHASE_LABEL = { lobby: 'Pre-market (lobby)', open: 'Market open', halted: 'Trading halted', paused: 'Paused', closed: 'Closed (debrief)' };

export function mountControls(root, send, { isHost = false, onOpenWindow = null, onClose = null } = {}) {
  const groups = [...new Set(EVENTS.map((e) => e.group))];
  const symOpts = COMMODITIES.map((c) => `<option value="${c.sym}">${esc(c.name)}</option>`).join('');

  root.innerHTML = `
  <div class="ctl">
    <h2><span>Control panel</span>${onClose ? '<button class="btn ghost" data-a="close" style="padding:6px 10px">Close</button>' : ''}</h2>
    <p class="meta">Room <b data-f="room">----</b> · <span data-f="net"></span></p>
    <div class="status-line"><i class="dot" data-f="dot"></i><span data-f="status">Starting...</span></div>

    <h3>Session</h3>
    <div class="row" style="margin-bottom:8px"><b data-f="phase">-</b><span style="flex:0;white-space:nowrap" data-f="clock"></span></div>
    <div class="grid">
      <button class="btn mint" data-a="start">Ring opening bell</button>
      <button class="btn" data-a="pause">Pause</button>
      <button class="btn danger" data-a="end">End session now</button>
      <button class="btn ghost" data-a="reset">Reset session</button>
    </div>

    <h3>Events</h3>
    <label>Target commodity (where relevant)
      <select data-f="target"><option value="">Random</option>${symOpts}</select>
    </label>
    ${groups.map((g) => `
      <p class="meta" style="margin-top:10px"><b>${esc(g)}</b></p>
      <div class="grid">
        ${EVENTS.filter((e) => e.group === g).map((e) => `
          <button class="ev ${e.key === 'crash' ? 'crash' : ''}" data-ev="${e.key}">${esc(e.label)}<small>${esc(e.desc)}</small></button>`).join('')}
        ${g === 'Drama' ? '<button class="ev" data-ev="burst">Burst bubble now<small>Pop the active bubble early.</small></button>' : ''}
      </div>`).join('')}

    <h3>Breaking news (custom)</h3>
    <input type="text" data-f="headline" maxlength="140" placeholder="e.g. Huddersfield discovers oil under the campus!" style="width:100%;margin-bottom:8px">
    <div class="row">
      <select data-f="csym"><option value="">No price move</option><option value="ALL">All commodities</option>${symOpts}</select>
      <input type="number" data-f="cpct" value="10" step="1" min="-60" max="100" title="Percentage move">
      <button class="btn" data-a="custom">Send</button>
    </div>
    <p class="note">The price move (percent, use a minus for a fall) starts a few seconds after the headline.</p>

    <h3>Autopilot and bots</h3>
    <label>Autopilot: fire random events <input type="checkbox" data-f="autopilot"></label>
    <p class="note" data-f="autonote"></p>
    <div class="grid3">
      <button class="btn ghost" data-a="bots5">+5 bots</button>
      <button class="btn ghost" data-a="bots20">+20 bots</button>
      <button class="btn ghost" data-a="nobots">Remove bots</button>
    </div>
    <p class="note">Bots are simulated traders with simple strategies (momentum, contrarian, panic seller). Handy for rehearsals and small groups.</p>

    <h3>Settings</h3>
    <div data-f="settings">
      <label>Session length (minutes) <input type="number" data-s="durationMin" min="1" max="60" step="1"></label>
      <label>Starting cash (${esc(APP.currencySymbol)}) <input type="number" data-s="startCash" min="100" step="100"></label>
      <label>Commission per trade (%) <input type="number" data-s="feePct" min="0" max="5" step="0.05"></label>
      <label>Headline warning (seconds) <input type="number" data-s="newsLeadTicks" min="0" max="15" step="1"></label>
      <label>Autopilot gap (seconds) <input type="number" data-s="autopilotEverySec" min="20" max="600" step="5"></label>
      <label>Automatic circuit breaker <input type="checkbox" data-s="circuitBreaker"></label>
      <label>Circuit breaker fall (%) <input type="number" data-s="circuitBreakerPct" min="3" max="50" step="1"></label>
      <label>Halt length (seconds) <input type="number" data-s="haltSec" min="5" max="120" step="5"></label>
      <label>Allow custom trader names <input type="checkbox" data-s="allowCustomNames"></label>
      <label>Show bots on leaderboard <input type="checkbox" data-s="showBotsOnLeaderboard"></label>
    </div>
    <p class="note">Length, cash and commission can only be changed before the opening bell.</p>

    <h3>Prices</h3>
    <div class="prices" data-f="prices"></div>
    <p class="note" data-f="source"></p>
    <button class="btn ghost" data-a="reload" style="width:100%">Reload opening prices</button>

    <h3>Traders <span data-f="pcount"></span></h3>
    <div class="players" data-f="players"></div>

    <h3>Remote control</h3>
    ${isHost ? '<button class="btn ghost" data-a="window" style="width:100%;margin-bottom:8px">Open control panel in a new window</button>' : ''}
    <button class="btn ghost" data-a="phoneqr" style="width:100%">Show phone remote QR code</button>
    <div data-f="phoneqr" class="hidden" style="margin-top:8px">
      <div class="qrbox" data-f="qrbox"></div>
      <p class="note">Scan with your own phone to control the market while you walk around. Keep this code private: it grants full control.</p>
    </div>
    ${isHost ? `
    <h3>Keyboard (big screen)</h3>
    <p class="keys"><kbd>C</kbd> control panel · <kbd>F</kbd> full screen · <kbd>M</kbd> mute sounds · <kbd>Space</kbd> open / pause / resume</p>
    <label>Sound effects <input type="checkbox" data-f="sound"></label>` : ''}
  </div>`;

  const f = (name) => root.querySelector(`[data-f="${name}"]`);
  let state = null;
  let armed = null;

  // Two-click confirm for destructive actions (avoids browser dialogs).
  function confirmClick(btn, label, fn) {
    if (armed === btn) { armed = null; btn.textContent = btn.dataset.orig; fn(); return; }
    if (armed) armed.textContent = armed.dataset.orig;
    armed = btn;
    btn.dataset.orig = btn.dataset.orig || btn.textContent;
    btn.textContent = label;
    setTimeout(() => { if (armed === btn) { armed = null; btn.textContent = btn.dataset.orig; } }, 3500);
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const a = b.dataset.a;
    if (b.dataset.ev) {
      const target = f('target').value;
      send({ cmd: 'event', key: b.dataset.ev, opts: target ? { sym: target } : {} });
      return;
    }
    switch (a) {
      case 'start': send({ cmd: 'start' }); break;
      case 'pause': send({ cmd: state?.phase === 'paused' ? 'resume' : 'pause' }); break;
      case 'end': confirmClick(b, 'Click again to end', () => send({ cmd: 'end' })); break;
      case 'reset': confirmClick(b, 'Click again to reset', () => send({ cmd: 'reset' })); break;
      case 'custom': {
        const headline = f('headline').value.trim();
        if (!headline) { f('headline').focus(); return; }
        send({ cmd: 'event', key: 'custom', opts: { headline, sym: f('csym').value, pct: +f('cpct').value } });
        f('headline').value = '';
        break;
      }
      case 'bots5': send({ cmd: 'bots', n: 5 }); break;
      case 'bots20': send({ cmd: 'bots', n: 20 }); break;
      case 'nobots': send({ cmd: 'removeBots' }); break;
      case 'reload': send({ cmd: 'reloadPrices' }); break;
      case 'window': onOpenWindow?.(); break;
      case 'close': onClose?.(); break;
      case 'phoneqr': {
        const box = f('phoneqr');
        box.classList.toggle('hidden');
        if (!box.classList.contains('hidden') && state?.controlUrl) f('qrbox').innerHTML = qrSvg(state.controlUrl, 'Phone remote');
        break;
      }
      case 'kick': confirmClick(b, 'Sure?', () => send({ cmd: 'kick', id: b.dataset.id })); break;
      case 'rename': send({ cmd: 'rename', id: b.dataset.id }); break;
      default: break;
    }
  });

  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.s) {
      const v = el.type === 'checkbox' ? el.checked : +el.value;
      send({ cmd: 'settings', settings: { [el.dataset.s]: v } });
    } else if (el.dataset.f === 'autopilot') {
      send({ cmd: 'autopilot', on: el.checked });
    } else if (el.dataset.f === 'sound') {
      send({ cmd: 'mute', on: !el.checked });
    }
  });

  return function render(s) {
    state = s;
    f('room').textContent = s.room;
    f('net').textContent = s.net === 'local' ? 'Rehearsal mode (this browser only)' : 'Live (phones via PeerJS)';
    f('dot').className = 'dot ' + (s.status?.level || 'wait');
    f('status').textContent = s.status?.text || '';
    f('phase').textContent = PHASE_LABEL[s.phase] || s.phase;
    f('clock').textContent = s.phase === 'lobby' ? `${s.settings.durationMin} min session` : `${fmtClock(s.remaining)} left`;

    const q = (a) => root.querySelector(`[data-a="${a}"]`);
    q('start').disabled = s.phase !== 'lobby';
    q('pause').disabled = !['open', 'paused', 'halted'].includes(s.phase);
    q('pause').textContent = s.phase === 'paused' ? 'Resume' : 'Pause';
    q('end').disabled = s.phase === 'lobby' || s.phase === 'closed';
    q('reload').disabled = s.phase !== 'lobby';
    const live = ['open', 'halted', 'paused'].includes(s.phase);
    root.querySelectorAll('[data-ev]').forEach((b) => {
      b.disabled = !live || (b.dataset.ev === 'burst' && !s.bubble) || (b.dataset.ev === 'bubble' && s.bubble);
    });
    q('custom').disabled = !live;

    const ap = f('autopilot');
    if (document.activeElement !== ap) ap.checked = !!s.settings.autopilot;
    f('autonote').textContent = s.settings.autopilot
      ? (s.nextAutoIn != null && live ? `Next random event in about ${Math.max(0, Math.round(s.nextAutoIn))}s.` : 'Random events start once the market opens.')
      : 'Off: you fire every event yourself.';

    root.querySelectorAll('[data-s]').forEach((el) => {
      if (document.activeElement === el) return;
      const v = s.settings[el.dataset.s];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
      el.disabled = s.phase !== 'lobby' && ['durationMin', 'startCash', 'feePct'].includes(el.dataset.s);
    });
    const snd = f('sound');
    if (snd) snd.checked = !s.muted;

    f('prices').innerHTML = COMMODITIES.map((c) => {
      const p = s.prices[c.sym], ch = (p / s.open[c.sym] - 1) * 100;
      return `<span>${esc(c.name)}</span><span>${fmtPrice(p)}</span><span class="${dirClass(ch)}">${fmtPct(ch)}</span>`;
    }).join('');
    f('source').textContent = s.priceSource
      ? `Opening prices: ${s.priceSource.label}`
      : 'Opening prices: built-in defaults (data/prices.json not loaded).';

    const humans = s.players.filter((p) => !p.bot).length;
    f('pcount').textContent = `(${humans} people, ${s.players.length - humans} bots)`;
    if (armed && f('players').contains(armed)) return; // don't redraw under a pending confirm
    f('players').innerHTML = s.players.length
      ? s.players.map((p) => `<div class="${p.connected || p.bot ? '' : 'off'}">
          <span>${esc(p.name)}${p.bot ? ' (bot)' : ''}${!p.connected && !p.bot ? ' · offline' : ''}</span>
          <span>${fmtMoney(p.value)}</span>
          ${p.bot ? '' : `<button data-a="rename" data-id="${esc(p.id)}" title="Give a new random name">Rename</button>`}
          <button data-a="kick" data-id="${esc(p.id)}">Remove</button></div>`).join('')
      : '<div><span>No traders yet.</span></div>';
  };
}
