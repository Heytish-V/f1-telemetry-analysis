/**
 * components/throttleChart.js
 * ───────────────────────────
 * Renders TWO throttle SVG charts:
 *
 * 1. #throttle-svg  — Driver A throttle + brake overlay (Speed tab)
 *    Shows the combined throttle/brake signature of Driver A in a single chart.
 *
 * 2. #throttle2-svg — Driver A vs Driver B throttle comparison (Inputs tab)
 *    Shows both drivers' throttle traces overlaid for direct comparison.
 *    Driver B is dashed and slightly transparent.
 */

let cachedThA  = [];
let cachedBrA  = [];
let cachedThB  = [];
let cachedBrB  = [];
let cachedTh2A = [];
let cachedTh2B = [];

// ── HELPERS ───────────────────────────────────────────────────────────────

function pts2path(pts) {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function sampleSeries(values, maxPoints = 140) {
  if (!values || !values.length) return [];
  const step = Math.max(1, Math.floor(values.length / maxPoints));
  return values.filter((_, i) => i % step === 0);
}

function seriesPoints(values, W, H, PAD, lo = null, hi = null) {
  const data = sampleSeries(values);
  if (!data.length) return [];
  const min = lo ?? Math.min(...data);
  const max = hi ?? Math.max(...data);
  return data.map((v, i) => ({
    x: PAD + (W - PAD * 2) * i / Math.max(1, data.length - 1),
    y: H - PAD - ((v - min) / Math.max(0.001, max - min)) * (H - PAD * 2),
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
 * @param {object}      A      - Driver A
 * @param {object}      B      - Driver B
 */
export function renderThrottleChart(charts, A, B) {
  if (charts && charts.throttle_a && charts.throttle_a.length) {
    renderThrottleOverlayApi(charts);
    renderThrottleCompareApi(charts);
  } else {
    renderThrottleOverlayDemo();
    renderThrottleCompareDemo();
  }
}


// ── #throttle-svg — Throttle + Brake Overlay (Speed tab) ─────────────────

function renderThrottleOverlayApi(charts) {
  const svg = document.getElementById('throttle-svg');
  if (!svg) return;

  const W = 700, H = 120, PAD = 30;
  const thSampledA = seriesPoints(charts.throttle_a, W, H, PAD, 0, 100);
  const brSampledA = seriesPoints((charts.brake_a || []).map(v => Number(v) * 100), W, H, PAD, 0, 100);
  
  const thSampledB = seriesPoints(charts.throttle_b || [], W, H, PAD, 0, 100);
  const brSampledB = seriesPoints((charts.brake_b || []).map(v => Number(v) * 100), W, H, PAD, 0, 100);

  // Cache 1000-point lists for scrubbing
  cachedThA = fullPoints(charts.throttle_a, W, H, PAD, 0, 100);
  cachedBrA = fullPoints((charts.brake_a || []).map(v => Number(v) * 100), W, H, PAD, 0, 100);
  cachedThB = fullPoints(charts.throttle_b || [], W, H, PAD, 0, 100);
  cachedBrB = fullPoints((charts.brake_b || []).map(v => Number(v) * 100), W, H, PAD, 0, 100);

  svg.innerHTML = `
    <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
    <path d="${pts2path(thSampledB)}" fill="none" stroke="var(--ham)" stroke-width="1.5" stroke-linecap="round" opacity="0.65" stroke-dasharray="5 3"/>
    <path d="${pts2path(brSampledB)}" fill="none" stroke="var(--ham)" stroke-width="1.5" stroke-linecap="round" opacity="0.65" stroke-dasharray="5 3"/>
    <path d="${pts2path(thSampledA)}" fill="none" stroke="var(--ver)" stroke-width="1.5" stroke-linecap="round"/>
    <path d="${pts2path(brSampledA)}" fill="none" stroke="var(--red2)" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>

    <!-- Dynamic scrubbing cursor -->
    <line id="th1-cursor-line" x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.4)" stroke-width="1" stroke-dasharray="3 3" opacity="0" pointer-events="none" />
    <circle id="th1-cursor-dot-th-a" r="4.5" fill="var(--ver)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
    <circle id="th1-cursor-dot-br-a" r="4.5" fill="var(--red2)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
    <circle id="th1-cursor-dot-th-b" r="4.5" fill="var(--ham)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
    <circle id="th1-cursor-dot-br-b" r="4.5" fill="var(--ham)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
  `;
}

function renderThrottleOverlayDemo() {
  const svg = document.getElementById('throttle-svg');
  if (!svg) return;

  const W = 700, H = 120, PAD = 30, N = 80;
  const genSampled = (phase, chaos) => Array.from({ length: N }, (_, i) => {
    const v = Math.max(0, Math.min(1, 0.5 + Math.sin(i / N * Math.PI * 6 + phase) * 0.4 + Math.sin(i * 0.2) * chaos));
    return { x: PAD + (W - PAD * 2) * i / (N - 1), y: H - PAD - v * (H - PAD * 1.5) };
  });

  const thSampledA = genSampled(0, 0.05);
  const brSampledA = genSampled(Math.PI, 0.05);
  const thSampledB = genSampled(0.3, 0.05);
  const brSampledB = genSampled(Math.PI + 0.3, 0.05);

  // Generate 1000 point full coordinate grids for scrubbing
  const genFull = (phase, chaos) => Array.from({ length: 1000 }, (_, i) => {
    const v = Math.max(0, Math.min(1, 0.5 + Math.sin(i / 1000 * Math.PI * 6 + phase) * 0.4 + Math.sin(i * 0.2) * chaos));
    return { x: PAD + (W - PAD * 2) * i / (1000 - 1), y: H - PAD - v * (H - PAD * 1.5) };
  });
  cachedThA = genFull(0, 0.05);
  cachedBrA = genFull(Math.PI, 0.05);
  cachedThB = genFull(0.3, 0.05);
  cachedBrB = genFull(Math.PI + 0.3, 0.05);

  svg.innerHTML = `
    <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
    <path d="${pts2path(thSampledB)}" fill="none" stroke="var(--ham)" stroke-width="1.5" stroke-linecap="round" opacity="0.65" stroke-dasharray="5 3"/>
    <path d="${pts2path(brSampledB)}" fill="none" stroke="var(--ham)" stroke-width="1.5" stroke-linecap="round" opacity="0.65" stroke-dasharray="5 3"/>
    <path d="${pts2path(thSampledA)}" fill="none" stroke="var(--ver)"  stroke-width="1.5" stroke-linecap="round"/>
    <path d="${pts2path(brSampledA)}" fill="none" stroke="var(--red2)" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>

    <!-- Dynamic scrubbing cursor -->
    <line id="th1-cursor-line" x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.4)" stroke-width="1" stroke-dasharray="3 3" opacity="0" pointer-events="none" />
    <circle id="th1-cursor-dot-th-a" r="4.5" fill="var(--ver)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
    <circle id="th1-cursor-dot-br-a" r="4.5" fill="var(--red2)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
    <circle id="th1-cursor-dot-th-b" r="4.5" fill="var(--ham)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
    <circle id="th1-cursor-dot-br-b" r="4.5" fill="var(--ham)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
  `;
}


// ── #throttle2-svg — Driver A vs B Throttle Compare (Inputs tab) ──────────

function renderThrottleCompareApi(charts) {
  const svg = document.getElementById('throttle2-svg');
  if (!svg) return;

  const W = 700, H = 160, PAD = 30;
  const tASampled = seriesPoints(charts.throttle_a, W, H, PAD, 0, 100);
  const tBSampled = seriesPoints(charts.throttle_b || [], W, H, PAD, 0, 100);

  // Cache 1000 points coordinates
  cachedTh2A = fullPoints(charts.throttle_a, W, H, PAD, 0, 100);
  cachedTh2B = fullPoints(charts.throttle_b || [], W, H, PAD, 0, 100);

  svg.innerHTML = `
    <line x1="${PAD}" y1="${PAD}"     x2="${W - PAD}" y2="${PAD}"     stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>
    <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
    <text x="${PAD - 4}" y="${PAD + 4}"     text-anchor="end" fill="#4A5568" font-family="DM Mono,monospace" font-size="9">100%</text>
    <text x="${PAD - 4}" y="${H - PAD + 4}" text-anchor="end" fill="#4A5568" font-family="DM Mono,monospace" font-size="9">0%</text>
    <path d="${pts2path(tBSampled)}" fill="none" stroke="var(--ham)" stroke-width="1.5" stroke-linecap="round" opacity="0.65" stroke-dasharray="5 3"/>
    <path d="${pts2path(tASampled)}" fill="none" stroke="var(--ver)" stroke-width="2"   stroke-linecap="round"/>

    <!-- Dynamic scrubbing cursor -->
    <line id="th2-cursor-line" x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.4)" stroke-width="1" stroke-dasharray="3 3" opacity="0" pointer-events="none" />
    <circle id="th2-cursor-dot-a" r="4.5" fill="var(--ver)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
    <circle id="th2-cursor-dot-b" r="4.5" fill="var(--ham)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
  `;
}

function renderThrottleCompareDemo() {
  const svg = document.getElementById('throttle2-svg');
  if (!svg) return;

  const W = 700, H = 160, PAD = 30, N = 80;
  const genSampled = (offset, chaos) => Array.from({ length: N }, (_, i) => {
    const v = Math.max(0, Math.min(1, 0.5 + Math.sin(i / N * Math.PI * 6 + offset) * 0.45 + Math.sin(i * 0.3) * chaos));
    return { x: PAD + (W - PAD * 2) * i / (N - 1), y: H - PAD - v * (H - PAD * 1.8) };
  });
  const tASampled = genSampled(0, 0.05), tBSampled = genSampled(0.3, 0.05);

  // Generate 1000 point coordinate grids for scrubbing
  const genFull = (offset, chaos) => Array.from({ length: 1000 }, (_, i) => {
    const v = Math.max(0, Math.min(1, 0.5 + Math.sin(i / 1000 * Math.PI * 6 + offset) * 0.45 + Math.sin(i * 0.3) * chaos));
    return { x: PAD + (W - PAD * 2) * i / (1000 - 1), y: H - PAD - v * (H - PAD * 1.8) };
  });
  cachedTh2A = genFull(0, 0.05);
  cachedTh2B = genFull(0.3, 0.05);

  svg.innerHTML = `
    <line x1="${PAD}" y1="${PAD}"     x2="${W - PAD}" y2="${PAD}"     stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>
    <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
    <text x="${PAD - 4}" y="${PAD + 4}"     text-anchor="end" fill="#4A5568" font-family="DM Mono,monospace" font-size="9">100%</text>
    <text x="${PAD - 4}" y="${H - PAD + 4}" text-anchor="end" fill="#4A5568" font-family="DM Mono,monospace" font-size="9">0%</text>
    <path d="${pts2path(tBSampled)}" fill="none" stroke="var(--ham)" stroke-width="1.5" stroke-linecap="round" opacity="0.65" stroke-dasharray="5 3"/>
    <path d="${pts2path(tASampled)}" fill="none" stroke="var(--ver)" stroke-width="2"   stroke-linecap="round"/>

    <!-- Dynamic scrubbing cursor -->
    <line id="th2-cursor-line" x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.4)" stroke-width="1" stroke-dasharray="3 3" opacity="0" pointer-events="none" />
    <circle id="th2-cursor-dot-a" r="4.5" fill="var(--ver)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
    <circle id="th2-cursor-dot-b" r="4.5" fill="var(--ham)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
  `;
}


// ── CURSOR INTERACTION UPDATE ─────────────────────────────────────────────

/**
 * Fast direct-DOM update to move the cursor lines and dots on BOTH throttle SVGs.
 *
 * @param {number} index - Active telemetry index (0–999)
 */
export function updateThrottleChartCursor(index) {
  // Scrubber 1 (Overlay Speed tab)
  const line1   = document.getElementById('th1-cursor-line');
  const dotTh1A = document.getElementById('th1-cursor-dot-th-a');
  const dotBr1A = document.getElementById('th1-cursor-dot-br-a');
  const dotTh1B = document.getElementById('th1-cursor-dot-th-b');
  const dotBr1B = document.getElementById('th1-cursor-dot-br-b');

  // Scrubber 2 (Comparison Inputs tab)
  const line2  = document.getElementById('th2-cursor-line');
  const dotTh2 = document.getElementById('th2-cursor-dot-a');
  const dotTh2B= document.getElementById('th2-cursor-dot-b');

  const idx = Math.max(0, Math.min(index, cachedThA.length - 1));

  // Update Scrubber 1
  if (line1 && dotTh1A && dotBr1A && dotTh1B && dotBr1B) {
    const pTh1A = cachedThA[idx];
    const pBr1A = cachedBrA[idx];
    const pTh1B = cachedThB[idx];
    const pBr1B = cachedBrB[idx];
    
    if (pTh1A && pBr1A && pTh1B && pBr1B) {
      line1.setAttribute('x1', pTh1A.x.toFixed(1));
      line1.setAttribute('x2', pTh1A.x.toFixed(1));
      line1.setAttribute('opacity', '1');

      dotTh1A.setAttribute('cx', pTh1A.x.toFixed(1));
      dotTh1A.setAttribute('cy', pTh1A.y.toFixed(1));
      dotTh1A.setAttribute('opacity', '1');

      dotBr1A.setAttribute('cx', pBr1A.x.toFixed(1));
      dotBr1A.setAttribute('cy', pBr1A.y.toFixed(1));
      dotBr1A.setAttribute('opacity', '1');
      
      dotTh1B.setAttribute('cx', pTh1B.x.toFixed(1));
      dotTh1B.setAttribute('cy', pTh1B.y.toFixed(1));
      dotTh1B.setAttribute('opacity', '1');

      dotBr1B.setAttribute('cx', pBr1B.x.toFixed(1));
      dotBr1B.setAttribute('cy', pBr1B.y.toFixed(1));
      dotBr1B.setAttribute('opacity', '1');
    }
  }

  // Update Scrubber 2
  if (line2 && dotTh2 && dotTh2B) {
    const pA = cachedTh2A[idx];
    const pB = cachedTh2B[idx];
    if (pA && pB) {
      line2.setAttribute('x1', pA.x.toFixed(1));
      line2.setAttribute('x2', pA.x.toFixed(1));
      line2.setAttribute('opacity', '1');

      dotTh2.setAttribute('cx', pA.x.toFixed(1));
      dotTh2.setAttribute('cy', pA.y.toFixed(1));
      dotTh2.setAttribute('opacity', '1');

      dotTh2B.setAttribute('cx', pB.x.toFixed(1));
      dotTh2B.setAttribute('cy', pB.y.toFixed(1));
      dotTh2B.setAttribute('opacity', '1');
    }
  }
}
