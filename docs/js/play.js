// ---------------------------------------------------------------------------
// Phone player page.
// ---------------------------------------------------------------------------

import { APP, COMMODITIES } from './config.js';
import { connectToHost, netMode } from './net.js';
import { lineChart, sparkline } from './chart.js';
import { randomName, cleanName } from './names.js';
import { $, $$, esc, fmtPrice, fmtMoney, fmtPct, fmtQty, fmtClock, arrow, dirClass, store as localStore, sessionStore, keepAwake, toast } from './ui.js';

// Real phones remember who they are across reloads. In rehearsal mode every
// test-phone window is a separate trader, so use per-window storage.
const store = netMode() === 'local' ? sessionStore : localStore;

const q = new URLSearchParams(location.search);
const room = (q.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const BY = Object.fromEntries(COMMODITIES.map((c) => [c.sym, c]));
const SYMS = COMMODITIES.map((c) => c.sym);

const S = {
  conn: null, connected: false, joined: false, kicked: false, ended: false,
  pid: null, name: null, allowCustom: false,
  settings: { startCash: 10000, feePct: 0.1 },
  open: {}, prices: {}, hist: {}, phase: 'lobby', remaining: 0, rank: null, n: 0,
  pf: null, news: [], sheetSym: null, pending: false, hoverX: null,
  retry: 0, endData: null,
};

// ------------------------------------------------------------------ screens
function show(id) {
  $$('.screen').forEach((el) => el.classList.toggle('hidden', el.id !== id));
  window.scrollTo(0, 0);
}
function setConn(state, text) {
  const el = $('#conn');
  el.className = 'conn ' + state;
  $('#conn-text').textContent = text;
}

// ------------------------------------------------------------------ join
function initJoin() {
  if (!room) {
    show('screen-code');
    $('#code-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = $('#code-input').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length < 4) { $('#code-err').textContent = 'Codes are four characters.'; return; }
      const u = new URL(location.href);
      u.searchParams.set('room', code);
      location.href = u.toString();
    });
    setConn('', 'Not connected');
    return;
  }
  $('#room-label').textContent = `Room ${room}`;
  S.pid = store.get(`uoh-market-pid-${room}`);
  if (!S.pid) { S.pid = 'p-' + crypto.getRandomValues(new Uint32Array(2)).join('-'); store.set(`uoh-market-pid-${room}`, S.pid); }
  S.name = store.get(`uoh-market-name-${room}`) || randomName();
  $('#name-display').textContent = S.name;
  $('#reroll').addEventListener('click', () => { S.name = randomName(new Set([S.name])); $('#name-display').textContent = S.name; });
  $('#custom-toggle').addEventListener('click', () => {
    $('#name-display').classList.add('hidden');
    const inp = $('#name-input');
    inp.classList.remove('hidden'); inp.value = ''; inp.focus();
    $('#custom-toggle').classList.add('hidden');
  });
  $('#join-btn').addEventListener('click', join);
  show('screen-join');
  connect();
}

function join() {
  const inp = $('#name-input');
  if (!inp.classList.contains('hidden') && inp.value.trim()) {
    const c = cleanName(inp.value);
    if (!c.ok) { $('#join-err').textContent = c.msg; return; }
    S.name = c.name;
  }
  store.set(`uoh-market-name-${room}`, S.name);
  S.joined = true;
  keepAwake();
  if (S.connected) S.conn.send({ t: 'hello', pid: S.pid, name: S.name });
  else $('#join-err').textContent = 'Connecting to the market...';
}

// ------------------------------------------------------------------ network
async function connect() {
  setConn('', S.retry ? 'Reconnecting...' : 'Connecting...');
  try {
    const conn = await connectToHost(room);
    S.conn = conn; S.connected = true; S.retry = 0;
    setConn('ok', 'Live');
    conn.onMessage(onMessage);
    conn.onClose(() => {
      S.connected = false; S.conn = null;
      if (S.kicked) return;
      setConn('bad', 'Reconnecting...');
      scheduleReconnect();
    });
    conn.send({ t: 'info', pid: S.pid });
    const known = store.get(`uoh-market-name-${room}`);
    if (S.joined || known) { S.joined = true; conn.send({ t: 'hello', pid: S.pid, name: S.name }); }
  } catch (e) {
    S.connected = false;
    if (e.message === 'not-found') {
      setConn('bad', 'Room not found');
      $('#join-err').textContent = `Can't find room ${room}. Check the code on the big screen. Retrying...`;
    } else {
      setConn('bad', 'Connection problem');
      if (!S.pf) {
        $('#join-err').textContent = S.retry >= 1
          ? "Still can't reach the big screen from this network. Try switching between Wi-Fi and mobile data, then reload."
          : 'Having trouble reaching the big screen. Still trying...';
      }
    }
    scheduleReconnect();
  }
}
let reconnectTimer = null;
function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  S.retry++;
  reconnectTimer = setTimeout(connect, Math.min(8000, 1000 * S.retry));
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !S.connected && !S.kicked && room) { clearTimeout(reconnectTimer); connect(); }
});

function onMessage(m) {
  switch (m.t) {
    case 'info':
      S.allowCustom = !!m.allowCustomNames;
      $('#custom-toggle').classList.toggle('hidden', !S.allowCustom);
      break;
    case 'welcome':
      S.name = m.name; store.set(`uoh-market-name-${room}`, S.name);
      S.settings = m.settings; S.open = m.open; S.prices = m.prices; S.hist = m.hist;
      S.phase = m.phase; S.remaining = m.remaining; S.pf = m.pf; S.lastTick = m.k;
      S.news = m.news || [];
      S.ended = false; S.endData = null;
      $('#join-err').textContent = '';
      show('screen-game');
      buildMarkets();
      renderAll();
      if (S.news.length) showNews(S.news[S.news.length - 1], false);
      break;
    case 'tick':
      m.p.forEach((v, i) => {
        const s = SYMS[i];
        S.prices[s] = v;
        if (m.k !== S.lastTick) { (S.hist[s] ||= []).push(v); if (S.hist[s].length > 300) S.hist[s].shift(); }
      });
      S.lastTick = m.k;
      S.phase = m.ph; S.remaining = m.e; S.rank = m.r; S.n = m.n;
      if (!S.ended) renderAll();
      break;
    case 'news':
      S.news.push(m.item);
      showNews(m.item, true);
      break;
    case 'fill':
      S.pending = false;
      if (m.pf) S.pf = m.pf;
      if (m.ok) {
        const c = BY[m.sym];
        toast(`${m.side === 'buy' ? 'Bought' : 'Sold'} ${fmtQty(m.qty)} ${c.unit} of ${c.name} at ${fmtPrice(m.price)}`);
        try { navigator.vibrate?.(30); } catch (e) { /* ignore */ }
      } else toast(m.msg || 'Order rejected');
      renderAll();
      break;
    case 'renamed':
      S.name = m.name; store.set(`uoh-market-name-${room}`, S.name);
      toast(`The presenter renamed you: ${m.name}`);
      renderAll();
      break;
    case 'end':
      S.ended = true; S.endData = m;
      closeSheet();
      renderDebrief(m);
      show('screen-end');
      break;
    case 'kicked':
      S.kicked = true;
      show('screen-kicked');
      setConn('bad', 'Removed');
      break;
    default: break;
  }
}

// ------------------------------------------------------------------ render game
function value() {
  if (!S.pf) return 0;
  let v = S.pf.cash;
  for (const s of SYMS) v += (S.pf.holdings[s] || 0) * S.prices[s];
  return v;
}

function buildMarkets() {
  $('#markets').innerHTML = COMMODITIES.map((c) => `
    <button class="mkt" data-sym="${c.sym}" style="--c:${c.color}" aria-label="Trade ${esc(c.name)}">
      <span class="sw"></span>
      <span><span class="nm">${esc(c.name)}</span><div class="own" data-f="own"></div></span>
      <canvas aria-hidden="true"></canvas>
      <span class="px"><b data-f="price"></b><span data-f="chg"></span></span>
    </button>`).join('');
}

const PHASE_TEXT = {
  lobby: 'Waiting for the opening bell',
  open: 'Market open',
  halted: 'Trading halted',
  paused: 'Paused by the presenter',
  closed: 'Market closed',
};

function renderAll() {
  if (!S.pf) return;
  const v = value();
  const ret = (v / S.settings.startCash - 1) * 100;
  $('#me-name').textContent = S.name;
  $('#me-rank').textContent = S.rank ? `#${S.rank} of ${S.n}` : '';
  $('#me-value').textContent = fmtMoney(v);
  const r = $('#me-ret');
  r.textContent = `${arrow(ret)} ${fmtPct(ret, 2)}`;
  r.className = dirClass(ret);
  $('#me-cash').textContent = `Cash ${fmtMoney(S.pf.cash)}`;

  const pb = $('#phase-bar');
  pb.className = 'phase-bar ' + S.phase;
  $('#phase-text').textContent = PHASE_TEXT[S.phase] || S.phase;
  $('#phase-clock').textContent = S.phase === 'lobby' ? '' : fmtClock(S.remaining);
  $('#hint').textContent = S.phase === 'lobby'
    ? 'Tap a commodity to read about it. Trading starts at the opening bell.'
    : 'Tap a commodity to buy or sell.';

  for (const c of COMMODITIES) {
    const row = $(`.mkt[data-sym="${c.sym}"]`);
    if (!row) continue;
    const p = S.prices[c.sym];
    const ch = (p / S.open[c.sym] - 1) * 100;
    row.querySelector('[data-f="price"]').textContent = fmtPrice(p);
    const chg = row.querySelector('[data-f="chg"]');
    chg.textContent = `${arrow(ch)} ${fmtPct(ch)}`;
    chg.className = dirClass(ch);
    const held = S.pf.holdings[c.sym] || 0;
    row.querySelector('[data-f="own"]').innerHTML = held > 0
      ? `You own <b>${fmtMoney(held * p)}</b>`
      : `per ${esc(c.unit)}`;
    sparkline(row.querySelector('canvas'), (S.hist[c.sym] || []).slice(-90), c.color, 'light');
  }
  if (S.sheetSym) renderSheet();
}

function showNews(item, fresh) {
  const el = $('#newsbar');
  const labels = { breaking: 'Breaking news', rumour: 'Rumour', halt: 'Trading halt', bell: 'Market', news: 'News' };
  el.className = 'newsbar ' + item.kind + (fresh ? ' fresh' : '');
  el.innerHTML = `<small>${labels[item.kind] || 'News'}</small>${esc(item.text)}`;
  el.classList.remove('hidden');
  if (fresh && (item.kind === 'breaking' || item.kind === 'halt')) { try { navigator.vibrate?.([80, 60, 80]); } catch (e) { /* ignore */ } }
}

// ------------------------------------------------------------------ trade sheet
function openSheet(sym) {
  S.sheetSym = sym;
  const c = BY[sym];
  const sheet = $('#sheet');
  sheet.style.setProperty('--c', c.color);
  $('#sh-name').textContent = c.name;
  $('#sh-unit').textContent = `US dollars per ${c.unitLong}`;
  $('#sh-blurb').textContent = c.blurb;
  const sc = S.settings.startCash;
  const amounts = [0.05, 0.1, 0.25].map((f) => Math.round((sc * f) / 50) * 50);
  $('#buy-row').innerHTML = amounts.map((a) => `<button data-buy="${a}">${fmtMoney(a)}</button>`).join('') + '<button data-buy="all">All cash</button>';
  $('#sell-row').innerHTML = '<button data-sell="0.25">25%</button><button data-sell="0.5">50%</button><button data-sell="1">Sell all</button>';
  $('#sheet-bg').classList.add('open');
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  renderSheet();
}
function closeSheet() {
  S.sheetSym = null; S.hoverX = null;
  $('#sheet-bg').classList.remove('open');
  $('#sheet').classList.remove('open');
  $('#sheet').setAttribute('aria-hidden', 'true');
}

let sheetChart = null;
function renderSheet() {
  const sym = S.sheetSym;
  const c = BY[sym];
  const p = S.prices[sym];
  const ch = (p / S.open[sym] - 1) * 100;
  const hist = S.hist[sym] || [];
  let shownPrice = p;
  if (S.hoverX != null && hist.length) shownPrice = hist[Math.max(0, Math.min(hist.length - 1, Math.round(S.hoverX)))];
  $('#sh-price').innerHTML = `${fmtPrice(shownPrice)} <span class="${dirClass(ch)}">${S.hoverX != null ? '' : `${arrow(ch)} ${fmtPct(ch, 2)} today`}</span>`;
  sheetChart = lineChart($('#sh-chart'), {
    series: [{ label: c.name, color: c.color, values: hist }],
    mode: 'price', theme: 'light', endLabels: false, fontScale: 11, xLabels: false,
    priceFmt: (v) => fmtPrice(v), hover: S.hoverX != null ? { x: S.hoverX } : null,
    secPerTick: 1,
  });
  const held = S.pf.holdings[sym] || 0;
  const cost = S.pf.cost?.[sym] || 0;
  const worth = held * p;
  const pl = worth - cost;
  $('#sh-pos').innerHTML = `
    <div>You own<b>${fmtQty(held)} ${esc(c.unit)}</b></div>
    <div>Worth<b>${fmtMoney(worth)}</b></div>
    <div>Profit/loss<b class="${held > 0 ? dirClass(pl) : ''}">${held > 0 ? (pl >= 0 ? '+' : '-') + fmtMoney(Math.abs(pl)).replace('-', '') : '-'}</b></div>`;
  const tradable = S.phase === 'open' && !S.pending;
  $$('#buy-row button').forEach((b) => { b.disabled = !tradable || S.pf.cash < 1; });
  $$('#sell-row button').forEach((b) => { b.disabled = !tradable || held <= 0; });
  $('#sh-cash').textContent = S.phase === 'open'
    ? `Cash available ${fmtMoney(S.pf.cash)} · commission ${S.settings.feePct}% per trade`
    : PHASE_TEXT[S.phase];
}

function sendOrder(o) {
  if (!S.connected || S.pending) return;
  S.pending = true;
  S.conn.send({ t: 'order', rid: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, sym: S.sheetSym, ...o });
  renderSheet();
  setTimeout(() => { if (S.pending) { S.pending = false; renderSheet(); } }, 4000);
}

// ------------------------------------------------------------------ debrief
function renderDebrief(d) {
  const beat = d.value > d.bench.value;
  const noTrade = d.trades === 0;
  $('#end-rank').textContent = d.rank ? `#${d.rank} of ${d.n}` : '';
  $('#end-value').textContent = fmtMoney(d.value);
  $('#end-ret').innerHTML = `<span class="${dirClass(d.ret)}">${fmtPct(d.ret, 2)}</span>`;
  $('#end-verdict').textContent = noTrade
    ? `You kept your cash. Sometimes doing nothing is a strategy! The buy-and-hold benchmark returned ${fmtPct(d.bench.ret)}.`
    : beat
      ? `You beat the buy-and-hold benchmark (${fmtPct(d.bench.ret)}). Nice trading! Professional fund managers often fail to do that.`
      : `The buy-and-hold benchmark returned ${fmtPct(d.bench.ret)}, so doing nothing would have beaten you. That happens to most professional fund managers too.`;
  $('#end-top').innerHTML = d.top.map((t, i) => `<div><span>${i + 1}. ${esc(t.name)}</span><b>${fmtPct(t.ret)}</b></div>`).join('');
  $('#end-events').innerHTML = d.timeline.length
    ? d.timeline.map((t) => `<li><b>${esc(t.headline || t.label)}</b>${esc(t.lesson || '')}${t.module ? `<div class="mod">Study it: ${esc(t.module)}</div>` : ''}</li>`).join('')
    : '<li>A quiet session: no big events.</li>';
  $('#end-course').textContent = APP.course.name;
  $('#end-highlights').innerHTML = APP.course.highlights.map((h) => `<li>${esc(h)}</li>`).join('');
  $('#end-cta').href = APP.course.url;
  const sec = $('#end-cta2');
  if (APP.course.secondary?.url) { sec.href = APP.course.secondary.url; sec.textContent = APP.course.secondary.label; sec.classList.remove('hidden'); }
}

// ------------------------------------------------------------------ events
document.addEventListener('click', (e) => {
  const mkt = e.target.closest('.mkt');
  if (mkt) { openSheet(mkt.dataset.sym); return; }
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.dataset.buy) {
    const amount = b.dataset.buy === 'all' ? S.pf.cash : +b.dataset.buy;
    sendOrder({ side: 'buy', amount });
  } else if (b.dataset.sell) {
    sendOrder({ side: 'sell', fraction: +b.dataset.sell });
  }
});
$('#sheet-bg').addEventListener('click', closeSheet);
$('#sh-close').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// Crosshair on the sheet chart (touch or mouse).
const shc = $('#sh-chart');
const hover = (e) => {
  if (!sheetChart) return;
  const rect = shc.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  S.hoverX = sheetChart.xFromPx(x);
  const n = (S.hist[S.sheetSym] || []).length;
  if (S.hoverX < 0 || S.hoverX > n - 1) S.hoverX = null;
  renderSheet();
};
const unhover = () => { S.hoverX = null; if (S.sheetSym) renderSheet(); };
shc.addEventListener('pointermove', hover);
shc.addEventListener('touchmove', hover, { passive: true });
shc.addEventListener('pointerleave', unhover);
shc.addEventListener('touchend', unhover);

window.addEventListener('resize', () => renderAll());
initJoin();
