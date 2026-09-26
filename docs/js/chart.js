// ---------------------------------------------------------------------------
// Lightweight canvas charts (no library). Designed for a projector first:
// thick-enough lines, recessive grid, direct labels at line ends so colour is
// never the only way to tell series apart.
// ---------------------------------------------------------------------------

const THEMES = {
  dark:  { text: '#FFFFFF', muted: 'rgba(255,255,255,0.62)', grid: 'rgba(255,255,255,0.10)', zero: 'rgba(255,255,255,0.45)', marker: 'rgba(253,229,128,0.75)', markerText: '#FDE580', surface: '#1A1464' },
  light: { text: '#14104D', muted: 'rgba(20,16,77,0.62)',    grid: 'rgba(20,16,77,0.09)',    zero: 'rgba(20,16,77,0.40)',    marker: 'rgba(26,20,100,0.55)',   markerText: '#1A1464', surface: '#FFFFFF' },
};

function setup(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function niceStep(range, target) {
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

function fmtTime(sec) {
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}

/**
 * Multi-series line chart.
 * opts: {
 *   series: [{ label, color, values }], mode: 'pct' | 'price',
 *   xMax: total ticks for the x axis, secPerTick, markers: [{ x, label }],
 *   theme: 'dark' | 'light', endLabels: true, priceFmt: fn, fontScale
 *   hover: { x } to draw a crosshair at tick x
 * }
 */
export function lineChart(canvas, opts) {
  const s = setup(canvas);
  if (!s) return null;
  const { ctx, w, h } = s;
  const T = THEMES[opts.theme || 'dark'];
  const fs = opts.fontScale || Math.max(15, Math.min(20, h / 24));
  const font = (px, weight = 400) => `${weight} ${px}px Arial, Helvetica, sans-serif`;
  const mode = opts.mode || 'pct';

  const series = opts.series.map((sr) => {
    const base = sr.values[0];
    return { ...sr, pts: mode === 'pct' ? sr.values.map((v) => (v / base - 1) * 100) : sr.values.slice() };
  });
  const n = Math.max(...series.map((sr) => sr.pts.length));
  const xMax = Math.max(opts.xMax || 0, n - 1, 1);

  let lo = Infinity, hi = -Infinity;
  for (const sr of series) for (const v of sr.pts) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (mode === 'pct') { lo = Math.min(lo, -1); hi = Math.max(hi, 1); }
  else { const pad = Math.max((hi - lo) * 0.12, Math.abs(hi) * 0.002); lo -= pad; hi += pad; }
  const step = niceStep(hi - lo, Math.max(3, Math.round(h / 70)));
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;

  // Layout
  ctx.font = font(fs);
  const yLabelW = Math.max(...[lo, hi].map((v) => ctx.measureText(yLabel(v)).width)) + 10;
  const endW = opts.endLabels === false ? 12 : Math.max(...series.map((sr) => ctx.measureText(endText(sr)).width)) + fs * 1.6;
  const topPad = opts.markers?.length ? fs * 4.4 : fs * 0.8;
  const L = yLabelW + 6, R = w - endW - 8, Tp = topPad, B = h - (opts.xLabels === false ? fs * 0.8 : fs * 2);
  const X = (i) => L + (i / xMax) * (R - L);
  const Y = (v) => B - ((v - lo) / (hi - lo)) * (B - Tp);

  function yLabel(v) {
    if (mode === 'pct') return (v > 0 ? '+' : '') + (Math.abs(step) < 1 ? v.toFixed(1) : v.toFixed(0)) + '%';
    return opts.priceFmt ? opts.priceFmt(v) : v.toFixed(2);
  }
  function endText(sr) {
    const last = sr.pts[sr.pts.length - 1];
    if (mode === 'pct') return `${sr.label} ${last >= 0 ? '+' : ''}${last.toFixed(1)}%`;
    return sr.label;
  }

  // Grid + y labels
  ctx.lineWidth = 1;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  for (let v = lo; v <= hi + step / 2; v += step) {
    const y = Math.round(Y(v)) + 0.5;
    const isZero = mode === 'pct' && Math.abs(v) < step / 100;
    ctx.strokeStyle = isZero ? T.zero : T.grid;
    ctx.lineWidth = isZero ? 1.5 : 1;
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke();
    ctx.fillStyle = isZero ? T.text : T.muted;
    ctx.font = font(fs, isZero ? 700 : 400);
    ctx.fillText(yLabel(v), L - 8, y);
  }

  // X axis labels (time)
  const spt = opts.secPerTick || 1;
  const totalSec = xMax * spt;
  const xStep = niceStep(totalSec, Math.max(3, Math.round((R - L) / 140)));
  const secStep = Math.max(30, Math.round(xStep / 30) * 30);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = T.muted;
  ctx.font = font(fs * 0.9);
  if (opts.xLabels !== false) for (let t = 0; t <= totalSec + 0.1; t += secStep) ctx.fillText(fmtTime(t), X(t / spt), B + fs * 0.45);

  // Event markers: dashed line plus a label in the first free row (up to 3);
  // if all rows are taken the label is skipped rather than overprinted.
  if (opts.markers?.length) {
    ctx.font = font(fs * 0.85, 700);
    const rowEnd = [-1e9, -1e9, -1e9];
    opts.markers.forEach((mk) => {
      const x = Math.round(X(mk.x)) + 0.5;
      ctx.strokeStyle = T.marker; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, Tp - fs * 0.3); ctx.lineTo(x, B); ctx.stroke();
      ctx.setLineDash([]);
      const label = mk.label.length > 24 ? mk.label.slice(0, 23) + '…' : mk.label;
      const tw = ctx.measureText(label).width;
      const lx = Math.min(Math.max(x, L + tw / 2), R - tw / 2);
      const row = rowEnd.findIndex((end) => lx - tw / 2 > end + fs * 0.6);
      if (row < 0) return;
      ctx.fillStyle = T.markerText; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(label, lx, fs * 1.2 + row * fs * 1.15);
      rowEnd[row] = lx + tw / 2;
    });
  }

  // Lines
  const lw = Math.max(2, Math.min(3.5, h / 180));
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const sr of series) {
    ctx.strokeStyle = sr.color; ctx.lineWidth = lw;
    ctx.beginPath();
    sr.pts.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    ctx.stroke();
  }
  // End dots with a surface ring
  for (const sr of series) {
    const i = sr.pts.length - 1;
    ctx.fillStyle = sr.color; ctx.strokeStyle = T.surface; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(X(i), Y(sr.pts[i]), lw * 1.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  // Direct end labels (collision-avoided), text in ink with a colour swatch.
  if (opts.endLabels !== false) {
    const items = series.map((sr) => ({ sr, y: Y(sr.pts[sr.pts.length - 1]), x: X(sr.pts.length - 1) }));
    items.sort((a, b) => a.y - b.y);
    const gap = fs * 1.25;
    for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < gap) items[i].y = items[i - 1].y + gap;
    const overflow = items.length ? items[items.length - 1].y - (B + fs * 0.5) : 0;
    if (overflow > 0) items.forEach((it) => { it.y -= overflow; });
    for (let i = items.length - 2; i >= 0; i--) if (items[i + 1].y - items[i].y < gap) items[i].y = items[i + 1].y - gap;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const it of items) {
      const lx = Math.min(it.x, R) + fs * 0.7;
      ctx.fillStyle = it.sr.color;
      ctx.fillRect(lx, it.y - fs * 0.35, fs * 0.7, fs * 0.7);
      ctx.fillStyle = T.text; ctx.font = font(fs, 700);
      ctx.fillText(endText(it.sr), lx + fs * 0.95, it.y);
    }
  }

  // Hover crosshair
  if (opts.hover && opts.hover.x != null) {
    const i = Math.max(0, Math.min(n - 1, Math.round(opts.hover.x)));
    const x = X(i);
    ctx.strokeStyle = T.zero; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, Tp); ctx.lineTo(x, B); ctx.stroke();
    for (const sr of series) {
      if (sr.pts[i] == null) continue;
      ctx.fillStyle = sr.color; ctx.strokeStyle = T.surface; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, Y(sr.pts[i]), lw * 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  return { xFromPx: (px) => ((px - L) / (R - L)) * xMax, L, R };
}

// Minimal sparkline for tiles.
export function sparkline(canvas, values, color, theme = 'dark') {
  const s = setup(canvas);
  if (!s || values.length < 2) return;
  const { ctx, w, h } = s;
  const T = THEMES[theme];
  let lo = Math.min(...values), hi = Math.max(...values);
  const base = values[0];
  if (hi - lo < base * 0.004) { const mid = (hi + lo) / 2; lo = mid - base * 0.002; hi = mid + base * 0.002; }
  const X = (i) => 2 + (i / (values.length - 1)) * (w - 8);
  const Y = (v) => h - 3 - ((v - lo) / (hi - lo)) * (h - 6);
  // open reference line
  ctx.strokeStyle = T.grid; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(0, Y(base)); ctx.lineTo(w, Y(base)); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  values.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
  ctx.stroke();
  const i = values.length - 1;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(X(i), Y(values[i]), 3, 0, Math.PI * 2); ctx.fill();
}
