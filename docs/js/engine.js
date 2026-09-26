// ---------------------------------------------------------------------------
// Market engine. Pure logic, no DOM or networking, so it can run in the host
// page and be tested on its own.
//
// Price model per tick, for each commodity:
//   log return = event drift + order-flow pressure + mean reversion + noise
// where noise is Normal(0, vol * volatility multiplier).
// ---------------------------------------------------------------------------

import { COMMODITIES, MARKET, DEFAULT_SETTINGS } from './config.js';
import { EVENTS, EVENT_MAP } from './events.js';
import { randomName } from './names.js';

export const SYMS = COMMODITIES.map((c) => c.sym);
const BY_SYM = Object.fromEntries(COMMODITIES.map((c) => [c.sym, c]));

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const jitter = (x, amt = 0.3) => x * (1 - amt + Math.random() * 2 * amt);
const round2 = (x) => Math.round(x * 100) / 100;

export class Market {
  constructor({ openPrices, settings = {}, priceSource = null } = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.priceSource = priceSource;
    this.reset(openPrices);
  }

  reset(openPrices) {
    const open = {};
    for (const c of COMMODITIES) open[c.sym] = +(openPrices?.[c.sym] ?? c.fallback);
    this.open = open;
    this.prices = { ...open };
    this.anchor = Object.fromEntries(SYMS.map((s) => [s, Math.log(open[s])]));
    this.history = Object.fromEntries(SYMS.map((s) => [s, [open[s]]]));
    this.pressure = Object.fromEntries(SYMS.map((s) => [s, 0]));
    this.flow = Object.fromEntries(SYMS.map((s) => [s, { buy: 0, sell: 0 }]));
    this.phase = 'lobby'; // lobby | open | halted | paused | closed
    this.tick = 0;
    this.haltUntil = 0;
    this.lastHaltTick = -999;
    this.effects = [];
    this.vols = [];
    this.scheduled = []; // { tick, fn }
    this.news = [];      // { id, tick, text, kind }
    this.timeline = [];  // { tick, key, label, lesson, module, headline }
    this.bubble = null;
    this.nextAutoTick = null;
    this.newsSeq = 0;
    this.players = new Map();
    this.totalTrades = 0;
    this.outbox = [];    // events for the host UI/network layer: { type, ... }
    this.priceSource = this.priceSource || null;
  }

  // Keep existing players but reset portfolios (used by "Reset session").
  resetKeepPlayers(openPrices) {
    const old = [...this.players.values()];
    this.reset(openPrices);
    for (const p of old) this.addPlayer(p.id, p.name, p.bot, p.strategy);
  }

  get durationTicks() {
    return Math.round((this.settings.durationMin * 60 * 1000) / this.settings.tickMs);
  }
  get remainingTicks() { return Math.max(0, this.durationTicks - this.tick); }
  get lead() { return this.settings.newsLeadTicks; }

  // ---------------------------------------------------------------- players
  addPlayer(id, name, bot = false, strategy = null) {
    let p = this.players.get(id);
    if (p) { p.name = name || p.name; return p; }
    p = {
      id, name, bot, strategy,
      cash: this.settings.startCash,
      holdings: Object.fromEntries(SYMS.map((s) => [s, 0])),
      cost: Object.fromEntries(SYMS.map((s) => [s, 0])),
      trades: 0, lastOrderAt: 0, orderBurst: 0, kicked: false,
    };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id) { this.players.delete(id); }

  names() { return new Set([...this.players.values()].map((p) => p.name)); }

  value(p) {
    let v = p.cash;
    for (const s of SYMS) v += p.holdings[s] * this.prices[s];
    return v;
  }

  leaderboard() {
    const rows = [...this.players.values()]
      .filter((p) => !p.kicked)
      .map((p) => ({ id: p.id, name: p.name, bot: p.bot, value: this.value(p), trades: p.trades }));
    rows.sort((a, b) => b.value - a.value);
    rows.forEach((r, i) => { r.rank = i + 1; r.ret = (r.value / this.settings.startCash - 1) * 100; });
    return rows;
  }

  portfolio(p) {
    return {
      cash: p.cash,
      holdings: { ...p.holdings },
      cost: { ...p.cost },
      trades: p.trades,
      value: this.value(p),
    };
  }

  liquidity() {
    const n = Math.max(MARKET.minLiquidityPlayers, [...this.players.values()].filter((p) => !p.kicked).length);
    return n * this.settings.startCash;
  }

  // Execute a market order. side 'buy' uses `amount` of cash; side 'sell'
  // sells `fraction` (0..1] of the current holding.
  order(id, { sym, side, amount, fraction, rid }) {
    const p = this.players.get(id);
    if (!p || p.kicked) return { ok: false, msg: 'You are not in this session.' };
    if (!BY_SYM[sym]) return { ok: false, msg: 'Unknown commodity.' };
    if (this.phase === 'lobby') return { ok: false, msg: 'The market has not opened yet.' };
    if (this.phase === 'halted') return { ok: false, msg: 'Trading is halted.' };
    if (this.phase === 'paused') return { ok: false, msg: 'The market is paused.' };
    if (this.phase === 'closed') return { ok: false, msg: 'The market is closed.' };

    // ignore a repeated order id (network duplicates)
    if (rid != null) {
      p.rids ||= [];
      if (p.rids.includes(rid)) return { ok: false, dup: true, msg: 'Duplicate order ignored.' };
      p.rids.push(rid); if (p.rids.length > 20) p.rids.shift();
    }

    // simple rate limit: at most 6 orders in any 2 seconds
    const now = Date.now();
    if (now - p.lastOrderAt > 2000) { p.orderBurst = 0; p.lastOrderAt = now; }
    if (++p.orderBurst > 6) return { ok: false, msg: 'Slow down a little!' };

    const fee = this.settings.feePct / 100;
    const price = this.prices[sym];
    const L = this.liquidity();
    let qty, notional, feePaid, fill;

    if (side === 'buy') {
      const spend = Math.min(+amount || 0, p.cash / (1 + fee));
      if (spend < 1) return { ok: false, msg: 'Not enough cash.' };
      const x = spend / L;
      fill = price * Math.exp((MARKET.impactAlpha * x) / 2);
      qty = spend / fill;
      notional = spend;
      feePaid = spend * fee;
      p.cash -= spend + feePaid;
      p.holdings[sym] += qty;
      p.cost[sym] += spend + feePaid;
      this.prices[sym] = price * Math.exp(MARKET.impactAlpha * x);
      this.pressure[sym] += x;
      this.flow[sym].buy += spend;
    } else if (side === 'sell') {
      const held = p.holdings[sym];
      const f = Math.min(1, Math.max(0, +fraction || 0));
      qty = held * f;
      if (qty <= 0 || qty * price < 0.5) return { ok: false, msg: `You don't hold any ${BY_SYM[sym].name}.` };
      const x = (qty * price) / L;
      fill = price * Math.exp((-MARKET.impactAlpha * x) / 2);
      notional = qty * fill;
      feePaid = notional * fee;
      p.cash += notional - feePaid;
      const costShare = held > 0 ? p.cost[sym] * (qty / held) : 0;
      p.cost[sym] -= costShare;
      p.holdings[sym] = f >= 1 ? 0 : held - qty;
      if (p.holdings[sym] < 1e-9) { p.holdings[sym] = 0; p.cost[sym] = 0; }
      this.prices[sym] = price * Math.exp(-MARKET.impactAlpha * x);
      this.pressure[sym] -= x;
      this.flow[sym].sell += notional;
    } else {
      return { ok: false, msg: 'Unknown order type.' };
    }
    p.trades++;
    this.totalTrades++;
    return { ok: true, side, sym, qty, price: fill, notional, fee: feePaid };
  }

  // ---------------------------------------------------------------- session
  start() {
    if (this.phase !== 'lobby') return;
    this.phase = 'open';
    if (this.settings.autopilot) this.scheduleAutopilot(30);
    this.pushNews('The opening bell rings: the market is open!', 'bell');
    this.outbox.push({ type: 'bell', which: 'open' });
  }

  pause() { if (this.phase === 'open') this.phase = 'paused'; }
  resume() { if (this.phase === 'paused') this.phase = 'open'; }

  close() {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    this.pushNews('The closing bell rings: trading is over.', 'bell');
    this.outbox.push({ type: 'bell', which: 'close' });
    this.outbox.push({ type: 'closed' });
  }

  setAutopilot(on) {
    this.settings.autopilot = !!on;
    if (on && (this.phase === 'open' || this.phase === 'halted')) this.scheduleAutopilot(10);
    if (!on) this.nextAutoTick = null;
  }

  scheduleAutopilot(minGapSec) {
    const perSec = 1000 / this.settings.tickMs;
    const gap = Math.max(minGapSec, jitter(this.settings.autopilotEverySec, 0.4)) * perSec;
    this.nextAutoTick = this.tick + Math.round(gap);
  }

  // One tick of the clock. Called by the host every settings.tickMs.
  step() {
    if (this.phase !== 'open' && this.phase !== 'halted') return;
    this.tick++;

    // scheduled callbacks (news, bursts, etc.)
    const due = this.scheduled.filter((s) => s.tick <= this.tick);
    this.scheduled = this.scheduled.filter((s) => s.tick > this.tick);
    for (const s of due) s.fn();

    if (this.phase === 'halted' && this.tick >= this.haltUntil) {
      this.phase = 'open';
      this.pushNews('Trading resumes', 'news');
    }

    if (this.phase === 'open') {
      this.movePrices();
      this.runBots();
      this.checkCircuitBreaker();
      if (this.settings.autopilot && this.nextAutoTick !== null && this.tick >= this.nextAutoTick) {
        const perSec = 1000 / this.settings.tickMs;
        if (this.remainingTicks > 45 * perSec) this.fireRandomEvent();
        this.scheduleAutopilot(40);
      }
    }

    for (const s of SYMS) this.history[s].push(this.prices[s]);
    if (this.tick >= this.durationTicks) this.close();
  }

  movePrices() {
    const volMult = Object.fromEntries(SYMS.map((s) => [s, 1]));
    this.vols = this.vols.filter((v) => this.tick < v.end);
    for (const v of this.vols) {
      if (this.tick < v.start) continue;
      for (const s of v.syms || SYMS) volMult[s] = Math.max(volMult[s], v.mult);
    }
    const drift = Object.fromEntries(SYMS.map((s) => [s, 0]));
    for (const e of this.effects) {
      if (this.tick < e.start || e.remaining <= 0) continue;
      drift[e.sym] += e.perTick;
      if (e.permanent) this.anchor[e.sym] += e.perTick;
      e.remaining--;
    }
    this.effects = this.effects.filter((e) => e.remaining > 0);

    for (const c of COMMODITIES) {
      const s = c.sym;
      const lp = Math.log(this.prices[s]);
      const r = drift[s]
        + MARKET.pressureBeta * this.pressure[s]
        + MARKET.meanReversion * (this.anchor[s] - lp)
        + c.vol * volMult[s] * gauss();
      this.prices[s] = Math.exp(lp + r);
      this.pressure[s] *= MARKET.pressureDecay;
    }
  }

  checkCircuitBreaker() {
    if (!this.settings.circuitBreaker) return;
    const perSec = 1000 / this.settings.tickMs;
    const look = Math.round(60 * perSec);
    if (this.tick - this.lastHaltTick < look * 2) return;
    for (const c of COMMODITIES) {
      const h = this.history[c.sym];
      const ref = h[Math.max(0, h.length - look)];
      const fall = (1 - this.prices[c.sym] / ref) * 100;
      if (fall >= this.settings.circuitBreakerPct) {
        this.halt(`Circuit breaker: ${c.name} down ${fall.toFixed(0)}% in a minute. Trading halted.`);
        this.logEvent(EVENT_MAP.halt, 'Automatic circuit breaker');
        return;
      }
    }
  }

  halt(text) {
    if (this.phase !== 'open') return;
    const perSec = 1000 / this.settings.tickMs;
    this.phase = 'halted';
    this.haltUntil = this.tick + Math.round(this.settings.haltSec * perSec);
    this.lastHaltTick = this.tick;
    this.pushNews(`${text} (${this.settings.haltSec}s)`, 'halt');
  }

  // ---------------------------------------------------------------- events
  helpers(label) {
    const m = this;
    return {
      lead: m.lead,
      name: (s) => BY_SYM[s]?.name || s,
      randomSym: (exclude = []) => {
        const pool = SYMS.filter((s) => !exclude.includes(s));
        return pool[Math.floor(Math.random() * pool.length)];
      },
      news: (text, { kind = 'news', delay = 0, tag = null } = {}) => {
        if (delay <= 0) m.pushNews(text, kind, label);
        else m.scheduled.push({ tick: m.tick + delay, tag, fn: () => m.pushNews(text, kind, label) });
      },
      move: (map, duration, { delay = m.lead, permanent = false, tag = null } = {}) => {
        for (const [s, pct] of Object.entries(map)) {
          const total = Math.log(1 + jitter(pct, 0.25) / 100);
          const d = Math.max(1, Math.round(jitter(duration, 0.15)));
          m.effects.push({ sym: s, perTick: total / d, remaining: d, start: m.tick + delay, permanent, tag });
        }
      },
      vol: (mult, duration, { delay = m.lead, syms = null } = {}) => {
        m.vols.push({ mult, syms, start: m.tick + delay, end: m.tick + delay + duration });
      },
      halt: (text) => m.halt(text),
      scheduleBurst: (s, len) => {
        const t = m.tick + m.lead + len;
        m.bubble = { sym: s, tick: t };
        m.scheduled.push({ tick: t, tag: 'burst', fn: () => m.burstBubble() });
      },
    };
  }

  burstBubble() {
    if (!this.bubble) return false;
    const s = this.bubble.sym;
    this.bubble = null;
    this.effects = this.effects.filter((e) => e.tag !== 'bubble');
    this.scheduled = this.scheduled.filter((x) => x.tag !== 'burst' && x.tag !== 'bubble');
    const h = this.helpers('Bubble bursts');
    h.news(`${h.name(s)} bubble bursts! Panic selling as prices collapse`, { kind: 'breaking' });
    h.move({ [s]: -42 }, 12, { delay: 1 });
    h.vol(2.5, 40, { syms: [s], delay: 1 });
    return true;
  }

  logEvent(ev, headline) {
    this.timeline.push({ tick: this.tick, key: ev.key, label: ev.label, lesson: ev.lesson, module: ev.module, headline });
  }

  trigger(key, opts = {}) {
    if (this.phase !== 'open' && this.phase !== 'halted' && this.phase !== 'paused') {
      return { ok: false, msg: 'Start the market first.' };
    }
    if (key === 'burst') return { ok: this.burstBubble() };
    if (key === 'custom') return this.triggerCustom(opts);
    const ev = EVENT_MAP[key];
    if (!ev) return { ok: false, msg: 'Unknown event.' };
    if (key === 'bubble' && this.bubble) return { ok: false, msg: 'A bubble is already inflating.' };
    const before = this.newsSeq;
    ev.fire(this.helpers(ev.label), opts);
    const firstNews = this.news.find((n) => n.id > before);
    this.logEvent(ev, firstNews?.text || ev.label);
    return { ok: true };
  }

  triggerCustom({ headline, sym, pct = 0, duration = 20, kind = 'breaking' }) {
    const text = String(headline || '').trim().slice(0, 140);
    if (!text) return { ok: false, msg: 'Type a headline.' };
    const h = this.helpers('Custom');
    h.news(text, { kind });
    const move = +pct;
    if (move && (sym === 'ALL' || BY_SYM[sym])) {
      const map = {};
      for (const s of sym === 'ALL' ? SYMS : [sym]) map[s] = move;
      h.move(map, +duration || 20, { permanent: true });
    }
    this.timeline.push({ tick: this.tick, key: 'custom', label: 'Breaking news', headline: text, lesson: 'News moves markets: prices react to new information within seconds.', module: 'Foundations of Finance (Year 1)' });
    return { ok: true };
  }

  fireRandomEvent() {
    const used = new Set(this.timeline.map((t) => t.key));
    let pool = EVENTS.filter((e) => e.autopilot && !(e.key === 'bubble' && this.bubble));
    const fresh = pool.filter((e) => !used.has(e.key));
    if (fresh.length) pool = fresh;
    const ev = pool[Math.floor(Math.random() * pool.length)];
    this.trigger(ev.key, {});
  }

  pushNews(text, kind = 'news', source = null) {
    const item = { id: ++this.newsSeq, tick: this.tick, text, kind, source };
    this.news.push(item);
    if (this.news.length > 60) this.news.shift();
    this.outbox.push({ type: 'news', item });
  }

  // ---------------------------------------------------------------- bots
  addBots(n) {
    const strategies = ['random', 'momentum', 'contrarian', 'holder', 'panic'];
    const added = [];
    for (let i = 0; i < n; i++) {
      const id = 'bot-' + Math.random().toString(36).slice(2, 8);
      const strategy = strategies[Math.floor(Math.random() * strategies.length)];
      added.push(this.addPlayer(id, randomName(this.names()), true, strategy));
    }
    return added;
  }

  removeBots() {
    for (const [id, p] of this.players) if (p.bot) this.players.delete(id);
  }

  runBots() {
    const perSec = 1000 / this.settings.tickMs;
    for (const p of this.players.values()) {
      if (!p.bot || Math.random() > 0.07 / perSec) continue;
      const recent = (s) => {
        const h = this.history[s];
        const ref = h[Math.max(0, h.length - 20)];
        return this.prices[s] / ref - 1;
      };
      const held = SYMS.filter((s) => p.holdings[s] > 0);
      const lastNews = this.news[this.news.length - 1];
      const scared = lastNews && this.tick - lastNews.tick < 8 && (lastNews.kind === 'breaking' || lastNews.kind === 'halt');
      let sym, side;
      switch (p.strategy) {
        case 'momentum': {
          const best = [...SYMS].sort((a, b) => recent(b) - recent(a));
          if (recent(best[0]) > 0.003) { sym = best[0]; side = 'buy'; }
          else if (held.length) { sym = held.sort((a, b) => recent(a) - recent(b))[0]; side = 'sell'; }
          break;
        }
        case 'contrarian': {
          const worst = [...SYMS].sort((a, b) => recent(a) - recent(b));
          if (recent(worst[0]) < -0.004) { sym = worst[0]; side = 'buy'; }
          else if (held.length) { sym = held.sort((a, b) => recent(b) - recent(a))[0]; side = 'sell'; }
          break;
        }
        case 'holder':
          if (p.trades < 3) { sym = SYMS[Math.floor(Math.random() * SYMS.length)]; side = 'buy'; }
          break;
        case 'panic':
          if (scared && held.length) { sym = held[0]; side = 'sell'; }
          else if (!scared) { sym = SYMS[Math.floor(Math.random() * SYMS.length)]; side = 'buy'; }
          break;
        default:
          sym = SYMS[Math.floor(Math.random() * SYMS.length)];
          side = held.includes(sym) && Math.random() < 0.5 ? 'sell' : 'buy';
      }
      if (!sym) continue;
      if (side === 'buy') this.order(p.id, { sym, side, amount: round2(p.cash * (0.2 + Math.random() * 0.4)) });
      else this.order(p.id, { sym, side, fraction: Math.random() < 0.5 ? 1 : 0.5 });
      p.orderBurst = 0;
    }
  }

  // ---------------------------------------------------------------- results
  benchmark() {
    // Equal split across all commodities at the open, then do nothing.
    const start = this.settings.startCash;
    let v = 0;
    for (const s of SYMS) v += (start / SYMS.length) * (this.prices[s] / this.open[s]);
    return { value: v, ret: (v / start - 1) * 100 };
  }

  summary() {
    const lb = this.leaderboard();
    const bench = this.benchmark();
    const humans = lb.filter((r) => !r.bot);
    const pool = humans.length ? humans : lb;
    const beat = pool.filter((r) => r.value > bench.value).length;
    const heldCash = pool.filter((r) => r.trades === 0).length;
    const changes = Object.fromEntries(SYMS.map((s) => [s, (this.prices[s] / this.open[s] - 1) * 100]));
    return {
      leaderboard: lb,
      benchmark: bench,
      beatPct: pool.length ? (beat / pool.length) * 100 : 0,
      noTrades: heldCash,
      players: pool.length,
      trades: this.totalTrades,
      changes,
      timeline: this.timeline,
      ticks: this.tick,
    };
  }

  // ---------------------------------------------------------------- persistence
  snapshot() {
    return {
      v: 1, savedAt: Date.now(),
      settings: this.settings, priceSource: this.priceSource,
      open: this.open, prices: this.prices, anchor: this.anchor, history: this.history,
      pressure: this.pressure, flow: this.flow, phase: this.phase, tick: this.tick,
      haltUntil: this.haltUntil, lastHaltTick: this.lastHaltTick,
      effects: this.effects, vols: this.vols, news: this.news, timeline: this.timeline,
      newsSeq: this.newsSeq, totalTrades: this.totalTrades,
      players: [...this.players.values()],
    };
  }

  static restore(snap) {
    const m = new Market({ openPrices: snap.open, settings: snap.settings, priceSource: snap.priceSource });
    Object.assign(m, {
      prices: snap.prices, anchor: snap.anchor, history: snap.history, pressure: snap.pressure,
      flow: snap.flow, phase: snap.phase === 'open' || snap.phase === 'halted' ? 'paused' : snap.phase,
      tick: snap.tick, haltUntil: snap.haltUntil, lastHaltTick: snap.lastHaltTick,
      effects: snap.effects || [], vols: snap.vols || [], news: snap.news || [], timeline: snap.timeline || [],
      newsSeq: snap.newsSeq || 0, totalTrades: snap.totalTrades || 0,
    });
    // Scheduled callbacks (pending headlines, bubble bursts) cannot be saved; they are dropped.
    for (const p of snap.players || []) m.players.set(p.id, p);
    return m;
  }
}
