/**
 * components/brakeChart.js
 * ────────────────────────
 * Renders the Brake Pressure SVG chart into #brake-svg.
 *
 * Shows both drivers' brake traces. Driver A rendered in red (braking colour),
 * Driver B as a dashed overlay at 65% opacity for easy comparison.
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

function seriesPoints(values, W, H, PAD, lo = 0, hi = 100) {
  const data = sampleSeries(values);
  if (!data.length) return [];
  return data.map((v, i) => ({
    x: PAD + (W - PAD * 2) * i / Math.max(1, data.length - 1),
    y: H - PAD - ((v - lo) / Math.max(0.001, hi - lo)) * (H - PAD * 2),
  }));
}

function fullPoints(values, W, H, PAD, lo = 0, hi = 100) {
  if (!values || !values.length) return [];
  return values.map((v, i) => ({
    x: PAD + (W - PAD * 2) * i / Math.max(1, values.length - 1),
    y: H - PAD - ((v - lo) / Math.max(0.001, hi - lo)) * (H - PAD * 2),
  }));
}


// ── PUBLIC API ────────────────────────────────────────────────────────────

/**
 * @param {object|null} charts - charts from AnalysisResult
 * @param {object}      A      - Driver A (unused visually but kept for consistency)
 * @param {object}      B      - Driver B
 */
export function renderBrakeChart(charts, A, B) {
  if (charts && charts.brake_a && charts.brake_a.length) {
    renderFromApiData(charts);
  } else {
    renderDemoData();
  }
}


// ── API DATA RENDERER ─────────────────────────────────────────────────────

function renderFromApiData(charts) {
  const svg = document.getElementById('brake-svg');
  if (!svg) return;

  const W = 700, H = 120, PAD = 30;
  const bA = (charts.brake_a || []).map(v => Number(v) * 100);
  const bB = (charts.brake_b || []).map(v => Number(v) * 100);

  const bASampled = seriesPoints(bA, W, H, PAD, 0, 100);
  const bBSampled = seriesPoints(bB, W, H, PAD, 0, 100);

  // Cache 1000 point full coordinate arrays for scrubbing
  cachedPtsA = fullPoints(bA, W, H, PAD, 0, 100);
  cachedPtsB = fullPoints(bB, W, H, PAD, 0, 100);

  svg.innerHTML = `
    <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
    <path d="${pts2path(bBSampled)}" fill="none" stroke="var(--ham)"  stroke-width="1.5" stroke-linecap="round" opacity="0.65" stroke-dasharray="5 3"/>
    <path d="${pts2path(bASampled)}" fill="none" stroke="var(--red2)" stroke-width="2"   stroke-linecap="round"/>

    <!-- Dynamic scrubbing cursor -->
    <line id="brake-cursor-line" x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.4)" stroke-width="1" stroke-dasharray="3 3" opacity="0" pointer-events="none" />
    <circle id="brake-cursor-dot-a" r="4.5" fill="var(--red2)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
    <circle id="brake-cursor-dot-b" r="4.5" fill="var(--ham)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
  `;
}


// ── DEMO DATA RENDERER ────────────────────────────────────────────────────

function renderDemoData() {
  const svg = document.getElementById('brake-svg');
  if (!svg) return;

  const W = 700, H = 120, PAD = 30, N = 80;
  // Realistic brake profile: spike during braking zones, 0 on straights
  const genSampled = (phase, chaos) => Array.from({ length: N }, (_, i) => {
    const t = i / N;
    const v = Math.max(0, Math.min(1, Math.pow(Math.max(0, Math.sin(t * Math.PI * 5 + phase)), 3) + Math.sin(i * 0.1) * chaos));
    return { x: PAD + (W - PAD * 2) * i / (N - 1), y: H - PAD - v * (H - PAD * 1.5) };
  });
  const bASampled = genSampled(0, 0.05);
  const bBSampled = genSampled(Math.PI * 0.5, 0.05);

  // Generate 1000 point full coordinate grids for scrubbing
  const genFull = (phase, chaos) => Array.from({ length: 1000 }, (_, i) => {
    const t = i / 1000;
    const v = Math.max(0, Math.min(1, Math.pow(Math.max(0, Math.sin(t * Math.PI * 5 + phase)), 3) + Math.sin(i * 0.1) * chaos));
    return { x: PAD + (W - PAD * 2) * i / (1000 - 1), y: H - PAD - v * (H - PAD * 1.5) };
  });
  cachedPtsA = genFull(0, 0.05);
  cachedPtsB = genFull(Math.PI * 0.5, 0.05);

  svg.innerHTML = `
    <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
    <path d="${pts2path(bBSampled)}" fill="none" stroke="var(--ham)"  stroke-width="1.5" stroke-linecap="round" opacity="0.65" stroke-dasharray="5 3"/>
    <path d="${pts2path(bASampled)}" fill="none" stroke="var(--red2)" stroke-width="2"   stroke-linecap="round"/>

    <!-- Dynamic scrubbing cursor -->
    <line id="brake-cursor-line" x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.4)" stroke-width="1" stroke-dasharray="3 3" opacity="0" pointer-events="none" />
    <circle id="brake-cursor-dot-a" r="4.5" fill="var(--red2)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
    <circle id="brake-cursor-dot-b" r="4.5" fill="var(--ham)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
  `;
}


// ── CURSOR INTERACTION UPDATE ─────────────────────────────────────────────

/**
 * Fast direct-DOM update to move the brake cursor line and dot markers.
 *
 * @param {number} index - Active telemetry index (0–999)
 */
export function updateBrakeChartCursor(index) {
  const line = document.getElementById('brake-cursor-line');
  const dotA = document.getElementById('brake-cursor-dot-a');
  const dotB = document.getElementById('brake-cursor-dot-b');

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
