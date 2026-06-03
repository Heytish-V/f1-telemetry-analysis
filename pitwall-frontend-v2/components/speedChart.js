/**
 * components/speedChart.js
 * ────────────────────────
 * Renders the Speed Trace Overlay SVG into #speed-svg.
 *
 * Both drivers' speed traces are plotted on the same axis using a
 * shared min/max scale so the comparison is visually accurate.
 * Driver A is rendered on top (higher z-order) at full opacity;
 * Driver B is slightly transparent to avoid occlusion.
 */

let cachedPtsA = [];
let cachedPtsB = [];

// ── HELPERS ───────────────────────────────────────────────────────────────

function pts2path(pts) {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function sampleSeries(values, maxPoints = 140) {
  if (!values || !values.length) return [];
  const step = Math.max(1, Math.floor(values.length / maxPoints));
  return values.filter((_, i) => i % step === 0);
}

/**
 * Map a values array to SVG points using a shared global min/max.
 *
 * @param {number[]} values
 * @param {number}   W, H, PAD - SVG dimensions and padding
 * @param {number}   lo, hi    - shared scale bounds
 */
function seriesPoints(values, W, H, PAD, lo, hi) {
  const data = sampleSeries(values);
  if (!data.length) return [];
  return data.map((v, i) => ({
    x: PAD + (W - PAD * 2) * i / Math.max(1, data.length - 1),
    y: H - PAD - ((v - lo) / Math.max(0.001, hi - lo)) * (H - PAD * 2),
  }));
}


// ── PUBLIC API ────────────────────────────────────────────────────────────

/**
 * @param {object|null} charts - charts from AnalysisResult
 * @param {object}      A      - Driver A
 * @param {object}      B      - Driver B
 */
export function renderSpeedChart(charts, A, B) {
  if (charts && charts.speed_a && charts.speed_a.length) {
    renderFromApiData(charts, A, B);
  } else {
    renderDemoData(A, B);
  }
}


// ── API DATA RENDERER ─────────────────────────────────────────────────────

function renderFromApiData(charts, A, B) {
  const svg = document.getElementById('speed-svg');
  if (!svg) return;

  const W = 700, H = 200, PAD = 40;
  const allValues = [...charts.speed_a, ...charts.speed_b];
  const lo        = Math.min(...allValues);
  const hi        = Math.max(...allValues);

  // Store 1000 points coordinates cache for live scrubbing
  cachedPtsA = charts.speed_a.map((v, i) => ({
    x: PAD + (W - PAD * 2) * i / Math.max(1, charts.speed_a.length - 1),
    y: H - PAD - ((v - lo) / Math.max(0.001, hi - lo)) * (H - PAD * 2),
  }));

  cachedPtsB = charts.speed_b.map((v, i) => ({
    x: PAD + (W - PAD * 2) * i / Math.max(1, charts.speed_b.length - 1),
    y: H - PAD - ((v - lo) / Math.max(0.001, hi - lo)) * (H - PAD * 2),
  }));

  const ptsASampled = seriesPoints(charts.speed_a, W, H, PAD, lo, hi);
  const ptsBSampled = seriesPoints(charts.speed_b, W, H, PAD, lo, hi);

  svg.innerHTML = `
    <line x1="${PAD}" y1="${PAD}"     x2="${W - PAD}" y2="${PAD}"     stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>
    <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
    <path d="${pts2path(ptsBSampled)}" fill="none" stroke="${B.color}" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>
    <path d="${pts2path(ptsASampled)}" fill="none" stroke="${A.color}" stroke-width="2"   stroke-linecap="round"/>

    <!-- Dynamic scrubbing cursor -->
    <line id="speed-cursor-line" x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.4)" stroke-width="1" stroke-dasharray="3 3" opacity="0" pointer-events="none" />
    <circle id="speed-cursor-dot-a" r="4.5" fill="${A.color}" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
    <circle id="speed-cursor-dot-b" r="4.5" fill="${B.color}" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
  `;
}


// ── DEMO DATA RENDERER ────────────────────────────────────────────────────

function renderDemoData(A, B) {
  const svg = document.getElementById('speed-svg');
  if (!svg) return;

  const W = 700, H = 200, PAD = 40, N = 80;

  // Approximate real F1 speed profile: straights + braking + cornering
  const BASE = [0.55, 0.6, 0.9, 1.0, 0.7, 0.5, 0.8, 0.95, 0.6, 0.45, 0.85, 0.98, 0.55, 0.4, 0.82, 0.99];
  const genPts = (offset, size) => Array.from({ length: size }, (_, i) => {
    const idx = Math.floor(i / size * BASE.length);
    // Use trigonometric noise to keep paths perfectly stable and smooth on scrubs
    const noise = Math.sin(i * 0.1) * 0.05 + Math.cos(i * 0.3) * 0.02;
    const v   = Math.min(1, Math.max(0.3, BASE[idx] + noise + offset));
    return { x: PAD + (W - PAD * 2) * i / (size - 1), y: H - PAD - v * (H - PAD * 2) };
  });

  const ptsASampled = genPts(0,     N);
  const ptsBSampled = genPts(-0.02, N);

  // Cache 1000 coordinates for scrubbing
  cachedPtsA = genPts(0,     1000);
  cachedPtsB = genPts(-0.02, 1000);

  svg.innerHTML = `
    <line x1="${PAD}" y1="${PAD}"             x2="${W - PAD}" y2="${PAD}"             stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>
    <line x1="${PAD}" y1="${PAD + (H-PAD*2)*0.5}" x2="${W-PAD}" y2="${PAD+(H-PAD*2)*0.5}" stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>
    <line x1="${PAD}" y1="${H - PAD}"         x2="${W - PAD}" y2="${H - PAD}"         stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
    <text x="${PAD - 4}" y="${PAD + 4}"            text-anchor="end" fill="#4A5568" font-family="DM Mono,monospace" font-size="9">350</text>
    <text x="${PAD - 4}" y="${PAD+(H-PAD*2)*0.5+4}" text-anchor="end" fill="#4A5568" font-family="DM Mono,monospace" font-size="9">200</text>
    <text x="${PAD - 4}" y="${H - PAD + 4}"        text-anchor="end" fill="#4A5568" font-family="DM Mono,monospace" font-size="9">50</text>
    <path d="${pts2path(ptsBSampled)}" fill="none" stroke="${B.color}" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>
    <path d="${pts2path(ptsASampled)}" fill="none" stroke="${A.color}" stroke-width="2"   stroke-linecap="round"/>

    <!-- Dynamic scrubbing cursor -->
    <line id="speed-cursor-line" x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.4)" stroke-width="1" stroke-dasharray="3 3" opacity="0" pointer-events="none" />
    <circle id="speed-cursor-dot-a" r="4.5" fill="${A.color}" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
    <circle id="speed-cursor-dot-b" r="4.5" fill="${B.color}" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
  `;
}


// ── CURSOR INTERACTION UPDATE ─────────────────────────────────────────────

/**
 * Fast direct-DOM update to move the speed cursor line and driver dot markers.
 *
 * @param {number} index - Active telemetry index (0–999)
 */
export function updateSpeedChartCursor(index) {
  const line = document.getElementById('speed-cursor-line');
  const dotA = document.getElementById('speed-cursor-dot-a');
  const dotB = document.getElementById('speed-cursor-dot-b');

  if (!line || !dotA || !dotB) return;

  const idx = Math.max(0, Math.min(index, cachedPtsA.length - 1));
  const pA  = cachedPtsA[idx];
  const pB  = cachedPtsB[idx];

  if (pA && pB) {
    line.setAttribute('x1', pA.x.toFixed(1));
    line.setAttribute('x2', pA.x.toFixed(1));
    line.setAttribute('opacity', '1');

    dotA.setAttribute('cx', pA.x.toFixed(1));
    dotA.setAttribute('cy', pA.y.toFixed(1));
    dotA.setAttribute('opacity', '1');

    dotB.setAttribute('cx', pB.x.toFixed(1));
    dotB.setAttribute('cy', pB.y.toFixed(1));
    dotB.setAttribute('opacity', '1');
  }
}
