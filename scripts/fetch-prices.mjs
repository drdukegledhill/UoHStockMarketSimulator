#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Fetches the latest closing price for each commodity in docs/js/config.js and
// writes docs/data/prices.json. Run by .github/workflows/update-prices.yml each
// weekday morning, or by hand:  node scripts/fetch-prices.mjs
//
// Sources (no API keys needed):
//   1. Yahoo Finance chart endpoint (unofficial, widely used)
//   2. Stooq CSV quotes (fallback)
// If both fail for a commodity, its previous value is kept and marked stale,
// so the game always has a sensible opening price.
// ---------------------------------------------------------------------------

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { APP, COMMODITIES } from '../docs/js/config.js';

const OUT = fileURLToPath(new URL('../docs/data/prices.json', import.meta.url));
const UA = 'Mozilla/5.0 (compatible; UoH-Market-Challenge/1.0; +https://github.com/)';

async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

export function parseYahoo(j) {
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error('no result');
  const closes = res.indicators?.quote?.[0]?.close || [];
  const ts = res.timestamp || [];
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i] > 0) return { price: +closes[i].toFixed(4), date: new Date(ts[i] * 1000).toISOString().slice(0, 10) };
  }
  const p = res.meta?.regularMarketPrice;
  if (p > 0) return { price: +p, date: new Date((res.meta.regularMarketTime || Date.now() / 1000) * 1000).toISOString().slice(0, 10) };
  throw new Error('no close');
}

export function parseStooq(csv) {
  const [head, row] = csv.trim().split(/\r?\n/);
  const cols = head.split(',').map((s) => s.trim().toLowerCase());
  const vals = (row || '').split(',');
  const close = +vals[cols.indexOf('close')];
  const date = vals[cols.indexOf('date')];
  if (!(close > 0)) throw new Error('no close');
  return { price: close, date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10) };
}

async function fromYahoo(sym) {
  return parseYahoo(await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`));
}
async function fromStooq(sym) {
  return parseStooq(await getText(`https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`));
}

async function main() {
  let old = {};
  try {
    old = JSON.parse(await readFile(OUT, 'utf8'));
  } catch { /* first run */ }
  const previous = old.commodities || {};
  const previousSource = old.source || null;
  let usdPerGbp = +old.usdPerGbp || APP.usdPerGbpFallback;
  let fxAsOf = old.fxAsOf || null;
  let fxSource = old.fxSource || 'built-in fallback';
  let freshFx = false;
  for (const [name, fn, sym] of [['Yahoo Finance', fromYahoo, 'GBPUSD=X'], ['Stooq', fromStooq, 'gbpusd']]) {
    try {
      const r = await fn(sym);
      if (r.price < 0.5 || r.price > 2) throw new Error(`implausible rate ${r.price}`);
      usdPerGbp = +r.price.toFixed(6);
      fxAsOf = r.date;
      fxSource = name;
      freshFx = true;
      break;
    } catch (e) {
      console.warn(`GBP/USD: ${name} failed (${e.message})`);
    }
  }
  if (!freshFx) console.warn(`GBP/USD: using previous rate ${usdPerGbp}${fxAsOf ? ` from ${fxAsOf}` : ''}`);

  const commodities = {};
  const sources = new Set();
  let fresh = 0;
  for (const c of COMMODITIES) {
    const prev = previous[c.sym];
    let got = null, source = null;
    for (const [name, fn, sym] of [['Yahoo Finance', fromYahoo, c.yahoo], ['Stooq', fromStooq, c.stooq]]) {
      if (!sym) continue;
      try {
        const r = await fn(sym);
        // Reject obviously bad data (e.g. unit changes) relative to the last good value.
        if (prev?.price && Math.abs(r.price / prev.price - 1) > 0.5) throw new Error(`implausible ${r.price} vs ${prev.price}`);
        got = r; source = name; break;
      } catch (e) {
        console.warn(`${c.sym}: ${name} failed (${e.message})`);
      }
    }
    if (got) {
      commodities[c.sym] = { name: c.name, price: got.price, unit: c.unit, asOf: got.date, source };
      sources.add(source); fresh++;
      console.log(`${c.sym.padEnd(7)} ${String(got.price).padStart(10)}  ${got.date}  ${source}`);
    } else if (prev) {
      commodities[c.sym] = { ...prev, stale: true };
      console.warn(`${c.sym}: keeping previous value ${prev.price} (${prev.asOf})`);
    } else {
      commodities[c.sym] = { name: c.name, price: c.fallback, unit: c.unit, asOf: null, source: 'built-in default', stale: true };
    }
  }

  const dates = Object.values(commodities).map((x) => x.asOf).filter(Boolean).sort();
  const out = {
    updated: new Date().toISOString(),
    asOf: dates[dates.length - 1] || null,
    source: [...sources].join(' / ') || previousSource || 'built-in defaults',
    currency: 'USD',
    usdPerGbp,
    fxAsOf,
    fxSource,
    commodities,
  };
  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${OUT} (${fresh}/${COMMODITIES.length} fresh)`);
  if (fresh === 0) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
