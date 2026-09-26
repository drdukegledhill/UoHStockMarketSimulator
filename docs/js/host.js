// ---------------------------------------------------------------------------
// Host page: runs the market, serves phones, drives the big screen.
// ---------------------------------------------------------------------------

import { APP, COMMODITIES, DEFAULT_SETTINGS } from './config.js';
import { Market, SYMS } from './engine.js';
import { createHost, netMode } from './net.js';
import { mountControls } from './controls.js';
import { lineChart, sparkline } from './chart.js';
import { randomName, cleanName, isGeneratedName } from './names.js';
import {
  $, $$, esc, fmtPrice, fmtMoney, fmtPct, fmtClock, arrow, dirClass, qrSvg, store, keepAwake, sound, randomCode, toast,
} from './ui.js';

const NET = netMode();
const SAVE_KEY = `uoh-market-host-${NET}`;
const SETTINGS_KEY = 'uoh-market-settings';
const PROTOCOL = 1;

let market, room, key, transport, loopTimer;
let priceData = null;           // { prices, label } from data/prices.json
let status = { text: 'Starting...', level: 'wait' };
const clients = new Map();      // conn.id -> { conn, role, pid }
const pidConns = new Map();     // pid -> conn
let ctlBC = null;
const debugLog = []; // last few orders, for troubleshooting from the console
let renderControls = null;
let lastNewsId = 0;
let lastView = null;
let lastChipsSig = '';
let tilesBuilt = false;
let debriefDrawn = false;
sound.muted = store.get('uoh-market-muted', false);

// ------------------------------------------------------------------ prices
async function loadPrices() {
  try {
    const r = await fetch(`data/prices.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    const prices = {};
    for (const c of COMMODITIES) {
      const v = +j?.commodities?.[c.sym]?.price;
      if (v > 0) prices[c.sym] = v;
    }
    if (!Object.keys(prices).length) throw new Error('empty');
    const d = j.asOf ? new Date(j.asOf + 'T12:00:00Z') : null;
    const when = d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'unknown date';
    return { prices, label: `${j.source || 'market data'}, last close ${when}`, asOf: j.asOf };
  } catch (e) {
    console.warn('Could not load data/prices.json, using built-in defaults', e);
    return null;
  }
}

// ------------------------------------------------------------------ setup
async function init() {
  priceData = await loadPrices();
  const saved = store.get(SAVE_KEY);
  const fresh = !saved || Date.now() - saved.snap.savedAt > 4 * 3600e3 || saved.snap.phase === 'closed';
  if (!fresh && await askResume(saved)) {
    room = saved.room; key = saved.key;
    market = Market.restore(saved.snap);
    for (const p of market.players.values()) p.connected = false;
  } else {
    newSession();
  }
  startNetwork();
  buildStaticUI();
  loopTimer = setInterval(loop, market.settings.tickMs);
  loop();
}

function newSession() {
  room = randomCode(4);
  key = randomCode(12);
  const settings = { ...DEFAULT_SETTINGS, ...store.get(SETTINGS_KEY, {}) };
  market = new Market({ openPrices: priceData?.prices, settings, priceSource: priceData ? { label: priceData.label } : null });
  debriefDrawn = false;
}

function askResume(saved) {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal';
    const n = saved.snap.players.filter((p) => !p.bot).length;
    m.innerHTML = `<div class="box">
      <h2>Resume the last session?</h2>
      <p>Room <b>${esc(saved.room)}</b> with ${n} trader${n === 1 ? '' : 's'} was running in this browser ${Math.round((Date.now() - saved.snap.savedAt) / 60000)} minute(s) ago.
      Resuming keeps everyone's portfolios and phones reconnect automatically. The market resumes paused.</p>
      <div class="actions"><button class="btn ghost" data-r="0">Start a new session</button><button class="btn" data-r="1">Resume</button></div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      m.remove();
      resolve(b.dataset.r === '1');
    });
  });
}

function joinUrl() {
  const u = new URL('play.html', location.href);
  u.search = '';
  u.searchParams.set('room', room);
  if (NET === 'local') u.searchParams.set('net', 'local');
  for (const k of ['peer', 'turnurl']) {
    const v = new URLSearchParams(location.search).get(k);
    if (v) u.searchParams.set(k, v);
  }
  return u.toString();
}
function controlUrl(sameBrowser = false) {
  const u = new URL('control.html', location.href);
  u.search = '';
  u.searchParams.set('room', room);
  u.searchParams.set('key', key);
  if (NET === 'local') u.searchParams.set('net', 'local');
  if (sameBrowser) u.searchParams.set('same', '1');
  for (const k of ['peer', 'turnurl']) {
    const v = new URLSearchParams(location.search).get(k);
    if (v) u.searchParams.set(k, v);
  }
  return u.toString();
}

// ------------------------------------------------------------------ network
function startNetwork() {
  transport?.close();
  transport = createHost(room, {
    onStatus: (text, level) => { status = { text, level }; renderTop(); },
    onConnection: (conn) => {
      clients.set(conn.id, { conn, role: null, pid: null });
      conn.onMessage((msg) => onMessage(conn, msg));
      conn.onClose(() => {
        const c = clients.get(conn.id);
        clients.delete(conn.id);
        if (c?.pid && pidConns.get(c.pid) === conn) {
          pidConns.delete(c.pid);
          const p = market.players.get(c.pid);
          if (p) p.connected = false;
        }
      });
    },
  });
  transport.ready.catch((e) => { status = { text: e.message, level: 'warn' }; toast(e.message, 6000); });

  // Same-browser control window (no network needed).
  ctlBC?.close();
  ctlBC = new BroadcastChannel(`uoh-market-ctl-${room}`);
  ctlBC.onmessage = ({ data: m }) => {
    if (!m || m.key !== key) return;
    if (m.type === 'cmd') {
      const res = handleCommand(m.cmd);
      ctlBC.postMessage({ type: 'result', to: m.from, res });
    }
  };
}

function onMessage(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  const c = clients.get(conn.id);
  if (!c) return;
  switch (msg.t) {
    case 'hello': return onHello(conn, c, msg);
    case 'order': {
      if (c.role !== 'player') return;
      debugLog.push([Date.now(), conn.id, JSON.stringify(msg)]); if (debugLog.length > 50) debugLog.shift();
      const res = market.order(c.pid, msg);
      if (res.dup) return;
      const p = market.players.get(c.pid);
      conn.send({ t: 'fill', rid: msg.rid, ...res, pf: p ? market.portfolio(p) : null });
      return;
    }
    case 'ctl-hello':
      if (msg.key === key) { c.role = 'control'; conn.send({ t: 'ctl-ok', state: controlState() }); }
      else { conn.send({ t: 'ctl-deny' }); setTimeout(() => conn.close(), 200); }
      return;
    case 'cmd':
      if (c.role !== 'control') return;
      conn.send({ t: 'ctl-result', res: handleCommand(msg.cmd) });
      return;
    case 'ping': conn.send({ t: 'pong' }); return;
    case 'info':
      conn.send({ t: 'info', allowCustomNames: market.settings.allowCustomNames, phase: market.phase, known: market.players.has(String(msg.pid || '')) });
      return;
    default: return;
  }
}

function uniqueName(name, pid) {
  const taken = new Set([...market.players.values()].filter((p) => p.id !== pid).map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; i < 100; i++) if (!taken.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
  return randomName();
}

function onHello(conn, c, msg) {
  const pid = String(msg.pid || '').slice(0, 40);
  if (!/^[a-z0-9-]{6,40}$/i.test(pid)) { conn.close(); return; }
  let p = market.players.get(pid);
  if (p?.kicked) { conn.send({ t: 'kicked' }); setTimeout(() => conn.close(), 300); return; }
  if (!p) {
    let name = cleanName(msg.name);
    name = name.ok && (market.settings.allowCustomNames || isGeneratedName(name.name)) ? name.name : randomName(market.names());
    p = market.addPlayer(pid, uniqueName(name, pid));
  }
  // one live connection per player
  const old = pidConns.get(pid);
  if (old && old !== conn) old.close();
  pidConns.set(pid, conn);
  c.role = 'player'; c.pid = pid;
  p.connected = true;
  conn.send(welcomeFor(p));
  if (market.phase === 'closed') conn.send(endFor(p, market.summary()));
}

function welcomeFor(p) {
  return {
    t: 'welcome', v: PROTOCOL, room, name: p.name, k: market.tick,
    settings: { startCash: market.settings.startCash, feePct: market.settings.feePct, allowCustomNames: market.settings.allowCustomNames },
    open: market.open, prices: market.prices,
    hist: Object.fromEntries(SYMS.map((s) => [s, market.history[s].slice(-180)])),
    phase: market.phase, remaining: remainingSec(), pf: market.portfolio(p),
    news: market.news.slice(-3),
  };
}

function rankedBoard() {
  const lb = market.leaderboard();
  const rows = market.settings.showBotsOnLeaderboard ? lb : lb.filter((r) => !r.bot);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

// Final results rank people only (bots are there to liven things up), unless
// nobody real took part.
function podiumRows(leaderboard) {
  const humans = leaderboard.filter((r) => !r.bot);
  const rows = (humans.length ? humans : leaderboard).map((r) => ({ ...r }));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

function endFor(p, summary) {
  const rows = podiumRows(summary.leaderboard);
  const i = rows.findIndex((r) => r.id === p.id);
  const me = rows[i] || { value: market.value(p), ret: (market.value(p) / market.settings.startCash - 1) * 100 };
  return {
    t: 'end', rank: i + 1, n: rows.length, value: me.value, ret: me.ret, trades: p.trades,
    bench: summary.benchmark, beatPct: summary.beatPct,
    top: rows.slice(0, 3).map((r) => ({ name: r.name, value: r.value, ret: r.ret })),
    timeline: summary.timeline.map((t) => ({ tick: t.tick, label: t.label, headline: t.headline, lesson: t.lesson, module: t.module })),
    changes: summary.changes,
  };
}

function remainingSec() {
  return market.phase === 'lobby' ? market.settings.durationMin * 60 : (market.remainingTicks * market.settings.tickMs) / 1000;
}

function broadcastPlayers(fn) {
  for (const [pid, conn] of pidConns) {
    const p = market.players.get(pid);
    if (p) conn.send(fn(p));
  }
}

// ------------------------------------------------------------------ commands
function handleCommand(cmd) {
  if (!cmd || typeof cmd !== 'object') return { ok: false };
  const m = market;
  let res = { ok: true };
  switch (cmd.cmd) {
    case 'start': m.start(); break;
    case 'pause': m.pause(); break;
    case 'resume': m.resume(); break;
    case 'end': m.close(); break;
    case 'reset':
      m.resetKeepPlayers(priceData?.prices);
      debriefDrawn = false; lastNewsId = 0;
      broadcastPlayers((p) => welcomeFor(p));
      res.msg = 'Session reset. Everyone is back to their starting cash.';
      break;
    case 'event': res = m.trigger(cmd.key, cmd.opts || {}); break;
    case 'autopilot': m.setAutopilot(cmd.on); saveSettings(); break;
    case 'settings': {
      const lobbyOnly = ['durationMin', 'startCash', 'feePct'];
      for (const [k, v] of Object.entries(cmd.settings || {})) {
        if (!(k in DEFAULT_SETTINGS)) continue;
        if (lobbyOnly.includes(k) && m.phase !== 'lobby') continue;
        if (typeof DEFAULT_SETTINGS[k] === 'number' && !(Number.isFinite(+v) && +v >= 0)) continue;
        m.settings[k] = typeof DEFAULT_SETTINGS[k] === 'boolean' ? !!v : +v;
      }
      if (m.phase === 'lobby') {
        // starting cash applies to everyone already in the lobby
        for (const p of m.players.values()) { p.cash = m.settings.startCash; }
      }
      saveSettings();
      break;
    }
    case 'bots': {
      const bots = [...m.players.values()].filter((p) => p.bot).length;
      const n = Math.max(0, Math.min(+cmd.n || 0, 80 - bots));
      m.addBots(n);
      res.msg = n ? `Added ${n} bots.` : 'Bot limit reached.';
      break;
    }
    case 'removeBots': m.removeBots(); break;
    case 'kick': {
      const p = m.players.get(cmd.id);
      if (!p) break;
      if (p.bot) m.removePlayer(p.id);
      else {
        p.kicked = true;
        const conn = pidConns.get(p.id);
        conn?.send({ t: 'kicked' });
        setTimeout(() => conn?.close(), 300);
      }
      break;
    }
    case 'rename': {
      const p = m.players.get(cmd.id);
      if (!p) break;
      p.name = randomName(m.names());
      pidConns.get(p.id)?.send({ t: 'renamed', name: p.name });
      break;
    }
    case 'reloadPrices':
      if (m.phase !== 'lobby') { res = { ok: false, msg: 'Only before the opening bell.' }; break; }
      loadPrices().then((pd) => {
        if (pd) { priceData = pd; m.priceSource = { label: pd.label }; m.resetKeepPlayers(pd.prices); broadcastPlayers((p) => welcomeFor(p)); toast('Opening prices reloaded'); }
        else toast('Could not load data/prices.json');
      });
      break;
    case 'mute':
      sound.muted = !!cmd.on; store.set('uoh-market-muted', sound.muted); break;
    default: res = { ok: false, msg: 'Unknown command' };
  }
  if (res && res.ok === false && res.msg) toast(res.msg);
  else if (res?.msg) toast(res.msg);
  loop(true);
  return res;
}

function saveSettings() {
  const { autopilot, autopilotEverySec, circuitBreaker, circuitBreakerPct, haltSec, allowCustomNames, showBotsOnLeaderboard, durationMin, startCash, feePct, newsLeadTicks } = market.settings;
  store.set(SETTINGS_KEY, { autopilot, autopilotEverySec, circuitBreaker, circuitBreakerPct, haltSec, allowCustomNames, showBotsOnLeaderboard, durationMin, startCash, feePct, newsLeadTicks });
}

function controlState() {
  const lb = market.leaderboard();
  const byId = Object.fromEntries(lb.map((r) => [r.id, r]));
  return {
    room, net: NET, status, phase: market.phase, remaining: remainingSec(),
    settings: market.settings, prices: market.prices, open: market.open,
    players: [...market.players.values()].filter((p) => !p.kicked)
      .map((p) => ({ id: p.id, name: p.name, bot: p.bot, connected: !!p.connected, value: byId[p.id]?.value ?? 0, trades: p.trades }))
      .sort((a, b) => (a.bot - b.bot) || b.value - a.value),
    bubble: !!market.bubble,
    nextAutoIn: market.nextAutoTick != null ? ((market.nextAutoTick - market.tick) * market.settings.tickMs) / 1000 : null,
    priceSource: market.priceSource, muted: sound.muted,
    controlUrl: controlUrl(false),
  };
}

// ------------------------------------------------------------------ main loop
let saveCounter = 0;
function loop(renderOnly = false) {
  if (!renderOnly) market.step();

  // Drain engine events
  for (const ev of market.outbox.splice(0)) {
    if (ev.type === 'news') {
      broadcastPlayers(() => ({ t: 'news', item: ev.item }));
      if (ev.item.kind === 'breaking' || ev.item.kind === 'halt') sound.alert();
    } else if (ev.type === 'bell') {
      sound.bell();
    } else if (ev.type === 'closed') {
      const summary = market.summary();
      broadcastPlayers((p) => endFor(p, summary));
    }
  }

  // Per-player tick
  const board = rankedBoard();
  const rankOf = Object.fromEntries(board.map((r) => [r.id, r.rank]));
  const prices = SYMS.map((s) => market.prices[s]);
  const remaining = remainingSec();
  broadcastPlayers((p) => ({ t: 'tick', k: market.tick, p: prices, ph: market.phase, e: remaining, r: rankOf[p.id] || null, n: board.length }));

  render(board);

  // Controllers
  const cs = controlState();
  for (const c of clients.values()) if (c.role === 'control') c.conn.send({ t: 'ctl-state', state: cs });
  ctlBC?.postMessage({ type: 'state', state: cs });
  if (renderControls && $('#drawer').classList.contains('open')) renderControls(cs);

  if (!renderOnly && ++saveCounter % 5 === 0) {
    store.set(SAVE_KEY, { room, key, snap: market.snapshot() });
  }
}

// ------------------------------------------------------------------ rendering
function buildStaticUI() {
  document.title = `${APP.title} · Room ${room}`;
  $('#title').textContent = APP.title;
  $('#subtitle').textContent = `${APP.subtitle} · ${APP.course.name}`;
  const url = joinUrl();
  $('#qr-big').innerHTML = qrSvg(url, 'Scan to join');
  $('#qr-small').innerHTML = qrSvg(url, 'Scan to join');
  $$('.room-code').forEach((el) => { el.textContent = room; });
  $('#join-url').textContent = url.replace(/^https?:\/\//, '').replace(/\?.*$/, '') + `  ·  code ${room}`;
  if (NET === 'local') {
    const a = document.createElement('button');
    a.className = 'btn yellow';
    a.style.marginTop = '1.4vh';
    a.textContent = 'Open a test phone (rehearsal mode)';
    a.onclick = () => window.open(url, '_blank', 'width=420,height=860');
    $('.join-hero').appendChild(a);
  }
  $('#cta-course').textContent = APP.course.name;
  $('#cta-list').innerHTML = APP.course.highlights.map((h) => `<li>${esc(h)}</li>`).join('');
  $('#cta-qr').innerHTML = qrSvg(APP.course.url, 'Course page');

  renderControls = mountControls($('#drawer'), (cmd) => handleCommand(cmd), {
    isHost: true,
    onOpenWindow: () => window.open(controlUrl(true), 'uoh-market-control', 'width=560,height=900'),
    onClose: () => toggleDrawer(false),
  });
}

function buildTiles(container, withBlurb) {
  container.innerHTML = COMMODITIES.map((c) => `
    <div class="tile" data-sym="${c.sym}" style="--c:${c.color}">
      <div class="name">${esc(c.name)}</div>
      <div class="price"><span data-f="price"></span><span class="unit">/${esc(c.unit)}</span></div>
      <div class="chg" data-f="chg"></div>
      ${withBlurb ? `<div class="blurb">${esc(c.blurb)}</div>` : '<canvas aria-hidden="true"></canvas>'}
    </div>`).join('');
}

const prevPrice = {};
function updateTiles(container) {
  for (const c of COMMODITIES) {
    const el = container.querySelector(`[data-sym="${c.sym}"]`);
    if (!el) continue;
    const p = market.prices[c.sym];
    const ch = (p / market.open[c.sym] - 1) * 100;
    el.querySelector('[data-f="price"]').textContent = fmtPrice(p);
    const chg = el.querySelector('[data-f="chg"]');
    chg.textContent = `${arrow(ch)} ${fmtPct(ch)}`;
    chg.className = 'chg ' + dirClass(ch);
    const cv = el.querySelector('canvas');
    if (cv) sparkline(cv, market.history[c.sym].slice(-150), c.color, 'dark');
    const key2 = container.id + c.sym;
    if (prevPrice[key2] != null && Math.abs(p / prevPrice[key2] - 1) > 0.012) {
      el.classList.remove('flash-up', 'flash-down');
      void el.offsetWidth;
      el.classList.add(p > prevPrice[key2] ? 'flash-up' : 'flash-down');
    }
    prevPrice[key2] = p;
  }
}

function renderTop() {
  const pill = $('#phase');
  const labels = { lobby: 'Pre-market', open: 'Market open', halted: 'Halted', paused: 'Paused', closed: 'Closed' };
  pill.textContent = labels[market?.phase] || '';
  pill.className = 'pill ' + (market?.phase || '');
  const clock = $('#clock');
  const rem = market ? remainingSec() : 0;
  clock.textContent = fmtClock(rem);
  clock.classList.toggle('warn', market?.phase !== 'lobby' && rem <= 60 && market?.phase !== 'closed');
  const humans = market ? [...market.players.values()].filter((p) => !p.bot && !p.kicked).length : 0;
  const bots = market ? [...market.players.values()].filter((p) => p.bot).length : 0;
  $('#count').textContent = `${humans} trader${humans === 1 ? '' : 's'}${bots ? ` + ${bots} bots` : ''}`;
  $('#net-warn').classList.toggle('hidden', status.level !== 'warn');
  $('#net-warn').textContent = status.text;
}

function render(board) {
  renderTop();
  const phase = market.phase;
  const view = phase === 'lobby' ? 'lobby' : phase === 'closed' ? 'debrief' : 'live';
  if (view !== lastView) {
    $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${view}`));
    lastView = view;
  }
  if (!tilesBuilt) { buildTiles($('#tiles-lobby'), true); buildTiles($('#tiles-live'), false); tilesBuilt = true; }

  if (view === 'lobby') {
    updateTiles($('#tiles-lobby'));
    $('#start-cash').textContent = fmtMoney(market.settings.startCash);
    const people = [...market.players.values()].filter((p) => !p.kicked);
    const sig = people.map((p) => p.id + p.name).join('|');
    if (sig !== lastChipsSig) {
      lastChipsSig = sig;
      const humans = people.filter((p) => !p.bot);
      $('#floor-count').textContent = `${humans.length} joined`;
      $('#chips').innerHTML = people.length
        ? people.slice(-80).map((p) => `<span class="chip ${p.bot ? 'bot' : ''}">${esc(p.name)}</span>`).join('')
        : '<p class="empty">Waiting for the first trader. Scan the code to join!</p>';
    }
  } else if (view === 'live') {
    updateTiles($('#tiles-live'));
    drawMainChart($('#chart-live'));
    const top = board.slice(0, 10);
    $('#board-list').innerHTML = top.length ? top.map((r) => `
      <li><span class="rk">${r.rank}</span>
      <span class="nm">${esc(r.name)}${r.bot ? '<em>bot</em>' : ''}</span>
      <span class="vl">${fmtMoney(r.value)}<small class="${dirClass(r.ret)}">${fmtPct(r.ret)}</small></span></li>`).join('')
      : '<li class="empty">No traders yet</li>';
    $('#board-n').textContent = `${board.length} ranked`;
    const halted = phase === 'halted' || phase === 'paused';
    $('#halt').classList.toggle('hidden', !halted);
    if (halted) {
      $('#halt-title').textContent = phase === 'halted' ? 'Trading halted' : 'Market paused';
      $('#halt-sub').textContent = phase === 'halted'
        ? `Circuit breaker: resumes in ${Math.max(0, Math.ceil(((market.haltUntil - market.tick) * market.settings.tickMs) / 1000))}s`
        : 'Listen up! Trading will resume shortly.';
    }
  } else if (view === 'debrief' && !debriefDrawn) {
    drawDebrief();
    debriefDrawn = true;
  }
  renderNews();
}

function drawMainChart(canvas, final = false) {
  lineChart(canvas, {
    series: COMMODITIES.map((c) => ({ label: c.name, color: c.color, values: market.history[c.sym] })),
    mode: 'pct',
    xMax: final ? Math.max(market.tick, 30) : market.durationTicks,
    secPerTick: market.settings.tickMs / 1000,
    markers: market.timeline.map((t) => ({ x: t.tick, label: t.label })),
    theme: 'dark',
  });
}

function drawDebrief() {
  const s = market.summary();
  drawMainChart($('#chart-final'), true);
  const rows = podiumRows(s.leaderboard);
  const [w, ...rest] = rows;
  $('#podium').innerHTML = w ? `
    <div class="winner"><div class="lbl">Top trader</div><div class="nm">${esc(w.name)}${w.bot ? ' (bot)' : ''}</div>
    <div class="vl">${fmtMoney(w.value)} · ${fmtPct(w.ret)}</div></div>
    <div class="rest">${rest.slice(0, 4).map((r, i) => `<div><span>${i + 2}. ${esc(r.name)}${r.bot ? ' (bot)' : ''}</span><b>${fmtPct(r.ret)}</b></div>`).join('')}</div>`
    : '<p>No traders took part.</p>';
  $('#stats').innerHTML = `
    <div><b class="${dirClass(s.benchmark.ret)}">${fmtPct(s.benchmark.ret)}</b><span>Buy-and-hold benchmark (equal split, no trading)</span></div>
    <div><b>${Math.round(s.beatPct)}%</b><span>of traders beat the benchmark</span></div>
    <div><b>${s.trades.toLocaleString('en-GB')}</b><span>trades placed</span></div>`;
  const spt = market.settings.tickMs / 1000;
  $('#timeline-list').innerHTML = s.timeline.length ? s.timeline.slice(-6).map((t) => `
    <li><span class="t">${fmtClock(t.tick * spt)}</span><div>
      <div class="hd">${esc(t.headline || t.label)}</div>
      <div class="ls">${esc(t.lesson || '')}</div>
      ${t.module ? `<div class="md">Study it: ${esc(t.module)}</div>` : ''}</div></li>`).join('')
    : '<li class="empty">A quiet day on the markets: no events were triggered.</li>';
}

let tickerTimer = null;
function renderNews() {
  const items = market.news;
  const last = items[items.length - 1];
  if (!last || last.id === lastNewsId) return;
  lastNewsId = last.id;
  const tag = $('#news-tag');
  const labels = { breaking: 'Breaking', rumour: 'Rumour', halt: 'Halt', bell: 'Bell', news: 'News' };
  tag.textContent = labels[last.kind] || 'News';
  tag.className = 'tag ' + last.kind;
  $('#news-text').textContent = last.text;
  const prev = items.slice(-4, -1).reverse().map((n) => n.text).join('   ·   ');
  $('#news-prev').textContent = prev;
  const t = $('#ticker');
  t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash');
  clearTimeout(tickerTimer);
}

// ------------------------------------------------------------------ keyboard + drawer
function toggleDrawer(force) {
  const d = $('#drawer');
  const open = force ?? !d.classList.contains('open');
  d.classList.toggle('open', open);
  if (open) renderControls?.(controlState());
}

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  sound.ctx()?.resume?.();
  if (e.key === 'c' || e.key === 'C') toggleDrawer();
  else if (e.key === 'f' || e.key === 'F') {
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
  } else if (e.key === 'm' || e.key === 'M') {
    handleCommand({ cmd: 'mute', on: !sound.muted }); toast(sound.muted ? 'Sounds off' : 'Sounds on');
  } else if (e.key === ' ') {
    e.preventDefault();
    const ph = market.phase;
    handleCommand({ cmd: ph === 'lobby' ? 'start' : ph === 'paused' ? 'resume' : 'pause' });
  } else if (e.key === 'Escape') toggleDrawer(false);
});
document.addEventListener('click', () => { sound.ctx()?.resume?.(); keepAwake(); }, { once: false });
$('#ctl-toggle').addEventListener('click', () => toggleDrawer());
window.addEventListener('resize', () => { debriefDrawn = false; loop(true); });
keepAwake();

// Handy for debugging from the browser console: __uoh.market
window.__uoh = { get market() { return market; }, get clients() { return clients; }, debugLog };

init();
