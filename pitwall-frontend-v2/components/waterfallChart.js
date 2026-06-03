/**
 * components/waterfallChart.js
 * ────────────────────────────
 * Renders the Sector Waterfall SVG chart into #waterfall-svg.
 *
 * The waterfall chart breaks down the total lap delta into per-turn/sector
 * contributions. Bars above the centreline → Driver A gains there.
 * Bars below → Driver B gains there.
 *
 * This gives a spatial "profit/loss" view of the whole lap, complementing
 * the delta time chart which shows cumulative flow.
 */

import { htmlEscape } from '../js/api.js';

// ── PUBLIC API ────────────────────────────────────────────────────────────

/**
 * @param {object|null} charts - charts from AnalysisResult
 *   charts.waterfall = [{ label, delta, winner }]
 * @param {object}      A      - Driver A
 * @param {object}      B      - Driver B
 */
export function renderWaterfallChart(charts, A, B) {
  if (charts && charts.waterfall && charts.waterfall.length) {
    renderFromApiData(charts, A, B);
  } else {
    renderDemoData(A, B);
  }
}


// ── API DATA RENDERER ─────────────────────────────────────────────────────

function renderFromApiData(charts, A, B) {
  const svg = document.getElementById('waterfall-svg');
  if (!svg) return;

  const W = 700, H = 300, PAD = 50;
  const rows     = charts.waterfall;
  const barW     = (W - PAD * 2 - 20) / rows.length - 4;
  const maxDelta = Math.max(0.001, ...rows.map(s => Math.abs(s.delta)));
  const midY     = H / 2;
  const scaleH   = v => (Math.abs(v) / maxDelta) * (midY - PAD * 1.2);

  const bars = rows.map((s, i) => {
    const x    = PAD + 10 + i * (barW + 4);
    const bh   = scaleH(s.delta);
    const y    = s.delta > 0 ? midY - bh : midY;
    const col  = s.winner === 'A' ? A.color : B.color;
    const sign = s.delta > 0 ? '+' : '';
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${bh}" fill="${col}" opacity="0.85" rx="2"/>
      <text x="${x + barW / 2}" y="${H - 16}"
            text-anchor="middle" fill="#4A5568" font-family="DM Mono,monospace" font-size="8">
        ${htmlEscape(s.label)}
      </text>
      <text x="${x + barW / 2}" y="${s.delta > 0 ? y - 4 : y + bh + 12}"
            text-anchor="middle" fill="${col}" font-family="DM Mono,monospace" font-size="8">
        ${sign}${Number(s.delta).toFixed(3)}
      </text>
    `;
  });

  svg.innerHTML = `
    <line x1="${PAD}" y1="${midY}" x2="${W - PAD}" y2="${midY}"
          stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
    <text x="${W / 2}" y="20" text-anchor="middle"
          fill="#4A5568" font-family="DM Mono,monospace" font-size="9" letter-spacing="2">
      ${A.code} GAIN ↑ · ${B.code} GAIN ↓
    </text>
    ${bars.join('')}
  `;
}


// ── DEMO DATA RENDERER ────────────────────────────────────────────────────

function renderDemoData(A, B) {
  const svg = document.getElementById('waterfall-svg');
  if (!svg) return;

  // Realistic turn-by-turn breakdown for a 17-turn circuit
  const miniSectors = [
    { label:'T1',   delta: 0.025, w:'A' }, { label:'T2',   delta:-0.012, w:'B' },
    { label:'T3-4', delta: 0.078, w:'A' }, { label:'T5',   delta: 0.008, w:'A' },
    { label:'T6-7', delta:-0.031, w:'B' }, { label:'T8',   delta:-0.051, w:'B' },
    { label:'T9',   delta: 0.011, w:'A' }, { label:'T10',  delta:-0.009, w:'B' },
    { label:'T11',  delta: 0.034, w:'A' }, { label:'T12',  delta: 0.006, w:'A' },
    { label:'T13',  delta:-0.008, w:'B' }, { label:'T14',  delta:-0.012, w:'B' },
    { label:'T15',  delta: 0.028, w:'A' }, { label:'T16',  delta: 0.009, w:'A' },
    { label:'T17',  delta:-0.005, w:'B' },
  ];

  const W = 700, H = 300, PAD = 50;
  const barW     = (W - PAD * 2 - 20) / miniSectors.length - 4;
  const maxDelta = 0.09;
  const midY     = H / 2;
  const scaleH   = v => (v / maxDelta) * (midY - PAD * 1.2);

  const bars = miniSectors.map((s, i) => {
    const x   = PAD + 10 + i * (barW + 4);
    const bh  = scaleH(Math.abs(s.delta));
    const y   = s.delta > 0 ? midY - bh : midY;
    const col = s.delta > 0 ? A.color : B.color;
    const sign = s.delta > 0 ? '+' : '';
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${bh}" fill="${col}" opacity="0.85" rx="2"/>
      <text x="${x + barW / 2}" y="${H - 16}"
            text-anchor="middle" fill="#4A5568" font-family="DM Mono,monospace" font-size="8" letter-spacing="0.5">
        ${s.label}
      </text>
      <text x="${x + barW / 2}" y="${s.delta > 0 ? y - 4 : y + bh + 12}"
            text-anchor="middle" fill="${col}" font-family="DM Mono,monospace" font-size="8">
        ${sign}${s.delta.toFixed(3)}
      </text>
    `;
  });

  svg.innerHTML = `
    <line x1="${PAD}" y1="${midY}" x2="${W - PAD}" y2="${midY}"
          stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
    <text x="${PAD - 4}" y="${midY + 4}"
          text-anchor="end" fill="#4A5568" font-family="DM Mono,monospace" font-size="9">0</text>
    <text x="${PAD - 4}" y="${midY - scaleH(0.05) + 4}"
          text-anchor="end" fill="#4A5568" font-family="DM Mono,monospace" font-size="9">+0.05</text>
    <text x="${PAD - 4}" y="${midY + scaleH(0.05) + 4}"
          text-anchor="end" fill="#4A5568" font-family="DM Mono,monospace" font-size="9">-0.05</text>
    <text x="${W / 2}" y="20" text-anchor="middle"
          fill="#4A5568" font-family="DM Mono,monospace" font-size="9" letter-spacing="2">
      ${A.code} GAIN ↑  ·  ${B.code} GAIN ↓
    </text>
    ${bars.join('')}
  `;
}
