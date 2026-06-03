/**
 * components/deltaChart.js
 * ────────────────────────
 * Renders the Cumulative Delta Time SVG chart into #delta-svg.
 *
 * The delta chart is the primary output of the analysis engine.
 * It shows how the gap between Driver A and Driver B evolves over
 * the course of a lap, plotted against track distance.
 *
 * Positive values → Driver A is ahead.
 * Negative values → Driver B is ahead.
 *
 * Red/teal dots mark where insights were detected — clicking them
 * triggers the drill-down panel.
 */

import { htmlEscape }           from '../js/api.js';
import { DEMO_INSIGHTS }        from '../js/state.js';

let cachedPts = [];

// ── SVG GEOMETRY HELPERS ──────────────────────────────────────────────────

function pts2path(pts) {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function sampleSeries(values, maxPoints = 140) {
  if (!values || !values.length) return [];
  const step = Math.max(1, Math.floor(values.length / maxPoints));
  return values.filter((_, i) => i % step === 0);
}


// ── PUBLIC API ────────────────────────────────────────────────────────────

/**
 * Render the delta chart.
 *
 * @param {object|null} charts   - charts object from AnalysisResult (may be null for demo)
 * @param {Array}       insights - insight[] — used to place markers on the chart
 * @param {object}      A        - Driver A
 * @param {object}      B        - Driver B
 */
export function renderDeltaChart(charts, insights, A, B) {
  if (charts && charts.delta && charts.delta.length) {
    renderFromApiData(charts, insights, A, B);
  } else {
    renderDemoData(insights || DEMO_INSIGHTS, A, B);
  }
}


// ── API DATA RENDERER ─────────────────────────────────────────────────────

function renderFromApiData(charts, insights, A, B) {
  const svg = document.getElementById('delta-svg');
  if (!svg) return;

  const W = 700, H = 200, PAD = 40;
  const values = sampleSeries(charts.delta || []);
  if (!values.length) return renderDemoData(insights, A, B);

  // Cache the full 1000 points for scrubbing cursor
  const range = Math.max(0.001, ...charts.delta.map(v => Math.abs(v)));
  cachedPts = charts.delta.map((v, i) => ({
    x: PAD + (W - PAD * 2) * i / Math.max(1, charts.delta.length - 1),
    y: H / 2 - (v / range) * (H / 2 - PAD),
  }));

  const ptsSampled = values.map((v, i) => ({
    x: PAD + (W - PAD * 2) * i / Math.max(1, values.length - 1),
    y: H / 2 - (v / range) * (H / 2 - PAD),
  }));

  svg.innerHTML = `
    ${gridLines(W, H, PAD)}
    ${sectorDividers(W, H, PAD)}
    <path d="${pts2path(ptsSampled)}" fill="none" stroke="${A.color}" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"/>
    ${insightMarkers(ptsSampled, values.length, insights, A, B)}

    <!-- Dynamic scrubbing cursor -->
    <line id="delta-cursor-line" x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.4)" stroke-width="1" stroke-dasharray="3 3" opacity="0" pointer-events="none" />
    <circle id="delta-cursor-dot" r="4.5" fill="${A.color}" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
  `;
}


// ── DEMO DATA RENDERER ────────────────────────────────────────────────────

function renderDemoData(insights, A, B) {
  const svg = document.getElementById('delta-svg');
  if (!svg) return;

  const W = 700, H = 200, PAD = 40, N = 80;

  // Generate a smooth, realistic-looking random delta curve
  const raw = [];
  let acc = 0;
  for (let i = 0; i < N; i++) {
    const phase = i / N;
    acc += Math.sin(phase * Math.PI * 4) * 0.003 + (Math.random() - 0.5) * 0.002;
    raw.push(acc);
  }

  const absMax = Math.max(Math.abs(Math.min(...raw)), Math.abs(Math.max(...raw)));
  const scaleY = v => H / 2 - (v / absMax) * (H / 2 - PAD);
  const pts    = raw.map((v, i) => ({ x: PAD + (W - PAD * 2) * i / (N - 1), y: scaleY(v) }));

  // Generate 1000-point cached coordinate grid for scrubber
  const N_FULL = 1000;
  const rawFull = [];
  let accFull = 0;
  for (let i = 0; i < N_FULL; i++) {
    const phase = i / N_FULL;
    // Keep it fully consistent with the 80-point shape
    const noise = Math.sin(i * 0.05) * 0.0002;
    accFull += Math.sin(phase * Math.PI * 4) * 0.00024 + noise;
    rawFull.push(accFull);
  }
  const absMaxFull = Math.max(Math.abs(Math.min(...rawFull)), Math.abs(Math.max(...rawFull)), 0.001);
  cachedPts = rawFull.map((v, i) => ({
    x: PAD + (W - PAD * 2) * i / (N_FULL - 1),
    y: H / 2 - (v / absMaxFull) * (H / 2 - PAD)
  }));

  svg.innerHTML = `
    <defs>
      <linearGradient id="dg-a" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${A.color}" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="${A.color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${gridLines(W, H, PAD)}
    <text x="${PAD - 4}" y="${PAD + 4}"      text-anchor="end" fill="#4A5568" font-family="DM Mono,monospace" font-size="9">+0.2s</text>
    <text x="${PAD - 4}" y="${H / 2 + 4}"    text-anchor="end" fill="#4A5568" font-family="DM Mono,monospace" font-size="9">0</text>
    <text x="${PAD - 4}" y="${H - PAD + 4}"  text-anchor="end" fill="#4A5568" font-family="DM Mono,monospace" font-size="9">-0.2s</text>
    ${sectorDividers(W, H, PAD)}
    <path d="${pts2path(pts)}" fill="none" stroke="${A.color}" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"/>
    ${demoInsightMarkers(pts, N, insights || DEMO_INSIGHTS, A, B)}
    <text x="${W - PAD + 4}" y="${pts[N - 1].y + 4}"
          fill="${A.color}" font-family="DM Mono,monospace" font-size="10">${A.code}</text>

    <!-- Dynamic scrubbing cursor -->
    <line id="delta-cursor-line" x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.4)" stroke-width="1" stroke-dasharray="3 3" opacity="0" pointer-events="none" />
    <circle id="delta-cursor-dot" r="4.5" fill="${A.color}" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
  `;
}


// ── SVG SUB-RENDERERS ─────────────────────────────────────────────────────

function gridLines(W, H, PAD) {
  return `
    <line x1="${PAD}" y1="${PAD}"     x2="${W - PAD}" y2="${PAD}"     stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>
    <line x1="${PAD}" y1="${H / 2}"   x2="${W - PAD}" y2="${H / 2}"   stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
    <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>
  `;
}

function sectorDividers(W, H, PAD) {
  const positions = [0.33, 0.66];
  return positions.map((p, i) => {
    const x = PAD + (W - PAD * 2) * p;
    return `
      <line x1="${x}" y1="${PAD - 8}" x2="${x}" y2="${H - PAD + 12}"
            stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="4 4"/>
      <text x="${x}" y="${H - PAD + 24}" text-anchor="middle"
            fill="#4A5568" font-family="DM Mono,monospace" font-size="10">S${i + 2}</text>
    `;
  }).join('') +
  `<text x="${PAD + (W - PAD * 2) * 0.16}" y="${H - PAD + 24}" text-anchor="middle"
         fill="#4A5568" font-family="DM Mono,monospace" font-size="10">S1</text>
   <text x="${PAD + (W - PAD * 2) * 0.83}" y="${H - PAD + 24}" text-anchor="middle"
         fill="#4A5568" font-family="DM Mono,monospace" font-size="10">S3</text>`;
}

function insightMarkers(pts, totalPts, insights, A, B) {
  if (!insights || !insights.length) return '';
  return insights.map(ins => {
    const pos = Number(String(ins.dist).split(' ')[0]) || 0.5;
    const idx = Math.min(pts.length - 1, Math.max(0, Math.round(pos * pts.length)));
    const p   = pts[idx] || { x: 40, y: 100 };
    const c   = ins.driverGain === A.code ? A.color : B.color;
    const id  = ins.id ?? 0;
    return `
      <circle cx="${p.x}" cy="${p.y}" r="5" fill="${c}" opacity="0.9"
              style="cursor:pointer" data-insight-id="${id}" class="chart-insight-dot"/>
      <text x="${p.x}" y="${p.y - 10}" text-anchor="middle"
            fill="${c}" font-family="DM Mono,monospace" font-size="9">${htmlEscape(ins.corner)}</text>
    `;
  }).join('');
}

function demoInsightMarkers(pts, N, insights, A, B) {
  if (!insights || !insights.length) return '';
  return insights.map((ins, i) => {
    const xi = Math.floor(ins.id !== undefined ? ins.id * N / insights.length : i * N / insights.length);
    const p  = pts[Math.min(xi + 8, N - 1)];
    const c  = (ins.timeA || 0) > 0 ? A.color : B.color;
    const id = ins.id ?? i;
    return `
      <circle cx="${p.x}" cy="${p.y}" r="5" fill="${c}" opacity="0.9"
              style="cursor:pointer" data-insight-id="${id}" class="chart-insight-dot"/>
      <text x="${p.x}" y="${p.y - ((ins.timeA || 0) > 0 ? 10 : -18)}" text-anchor="middle"
            fill="${c}" font-family="DM Mono,monospace" font-size="9">${htmlEscape(ins.corner)}</text>
    `;
  }).join('');
}


// ── CURSOR INTERACTION UPDATE ─────────────────────────────────────────────

/**
 * Fast direct-DOM update to move the cursor line and delta point value circle.
 *
 * @param {number} index - Active telemetry index (0–999)
 */
export function updateDeltaChartCursor(index) {
  const line = document.getElementById('delta-cursor-line');
  const dot  = document.getElementById('delta-cursor-dot');
  if (!line || !dot) return;

  const idx = Math.max(0, Math.min(index, cachedPts.length - 1));
  const p   = cachedPts[idx];

  if (p) {
    line.setAttribute('x1', p.x.toFixed(1));
    line.setAttribute('x2', p.x.toFixed(1));
    line.setAttribute('opacity', '1');

    dot.setAttribute('cx', p.x.toFixed(1));
    dot.setAttribute('cy', p.y.toFixed(1));
    dot.setAttribute('opacity', '1');
  }
}
