/**
 * components/gearChart.js
 * ───────────────────────
 * Renders the Gear Selection SVG chart into #gear-svg.
 * Analyst-mode only — the chart card is hidden in casual mode by analysis.js.
 *
 * The gear chart is a step chart (not a smooth curve) because gear values
 * are integers (1–8). Horizontal grid lines help read the gear number.
 * Rendered in amber to visually distinguish it from the speed/throttle traces.
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


// ── PUBLIC API ────────────────────────────────────────────────────────────

/**
 * @param {object|null} charts - charts from AnalysisResult
 */
export function renderGearChart(charts) {
  if (charts && charts.gear_a && charts.gear_a.length) {
    renderFromApiData(charts);
  } else {
    renderDemoData();
  }
}


// ── API DATA RENDERER ─────────────────────────────────────────────────────

function renderFromApiData(charts) {
  const svg = document.getElementById('gear-svg');
  if (!svg) return;

  const W = 700, H = 100, PAD = 30;
  const dataA = sampleSeries(charts.gear_a);
  const dataB = sampleSeries(charts.gear_b || []);
  
  const ptsSampledA = dataA.map((g, i) => ({
    x: PAD + (W - PAD * 2) * i / Math.max(1, dataA.length - 1),
    y: H - PAD - ((g - 1) / 7) * (H - PAD * 2),
  }));
  
  const ptsSampledB = dataB.map((g, i) => ({
    x: PAD + (W - PAD * 2) * i / Math.max(1, dataB.length - 1),
    y: H - PAD - ((g - 1) / 7) * (H - PAD * 2),
  }));

  // Cache 1000 point full coordinate arrays for scrubbing
  cachedPtsA = charts.gear_a.map((g, i) => ({
    x: PAD + (W - PAD * 2) * i / Math.max(1, charts.gear_a.length - 1),
    y: H - PAD - ((g - 1) / 7) * (H - PAD * 2),
  }));
  
  cachedPtsB = (charts.gear_b || []).map((g, i) => ({
    x: PAD + (W - PAD * 2) * i / Math.max(1, (charts.gear_b || []).length - 1),
    y: H - PAD - ((g - 1) / 7) * (H - PAD * 2),
  }));

  svg.innerHTML = `
    ${gearGridLines(W, H, PAD)}
    <path d="${pts2path(ptsSampledB)}" fill="none" stroke="var(--ham)" stroke-width="1.5"
          stroke-linecap="round" stroke-linejoin="round" opacity="0.65" stroke-dasharray="5 3"/>
    <path d="${pts2path(ptsSampledA)}" fill="none" stroke="var(--amber)" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"/>

    <!-- Dynamic scrubbing cursor -->
    <line id="gear-cursor-line" x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.4)" stroke-width="1" stroke-dasharray="3 3" opacity="0" pointer-events="none" />
    <circle id="gear-cursor-dot-a" r="4.5" fill="var(--amber)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
    <circle id="gear-cursor-dot-b" r="4.5" fill="var(--ham)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
  `;
}


// ── DEMO DATA RENDERER ────────────────────────────────────────────────────

function renderDemoData() {
  const svg = document.getElementById('gear-svg');
  if (!svg) return;

  const W = 700, H = 100, PAD = 30, N = 80;
  // Simulate gear changes with realistic F1 pattern (high gears on straights, low in corners)
  const genGears = (size, offset=0) => {
    return Array.from({ length: size }, (_, i) => {
      return Math.max(1, Math.min(8, Math.round(4.5 + Math.sin(i / size * Math.PI * 8 + offset) * 3 + Math.sin(i * 0.05) * 0.5)));
    });
  };

  const gearsSampledA = genGears(N, 0);
  const gearsSampledB = genGears(N, 0.2);
  
  const ptsSampledA = gearsSampledA.map((g, i) => ({
    x: PAD + (W - PAD * 2) * i / (N - 1),
    y: H - PAD - ((g - 1) / 7) * (H - PAD * 2),
  }));
  const ptsSampledB = gearsSampledB.map((g, i) => ({
    x: PAD + (W - PAD * 2) * i / (N - 1),
    y: H - PAD - ((g - 1) / 7) * (H - PAD * 2),
  }));

  // Generate 1000 point full coordinate grids for scrubbing
  const gearsFullA = genGears(1000, 0);
  const gearsFullB = genGears(1000, 0.2);
  
  cachedPtsA = gearsFullA.map((g, i) => ({
    x: PAD + (W - PAD * 2) * i / (1000 - 1),
    y: H - PAD - ((g - 1) / 7) * (H - PAD * 2),
  }));
  cachedPtsB = gearsFullB.map((g, i) => ({
    x: PAD + (W - PAD * 2) * i / (1000 - 1),
    y: H - PAD - ((g - 1) / 7) * (H - PAD * 2),
  }));

  svg.innerHTML = `
    ${gearGridLines(W, H, PAD)}
    <path d="${pts2path(ptsSampledB)}" fill="none" stroke="var(--ham)" stroke-width="1.5"
          stroke-linecap="round" stroke-linejoin="round" opacity="0.65" stroke-dasharray="5 3"/>
    <path d="${pts2path(ptsSampledA)}" fill="none" stroke="var(--amber)" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"/>

    <!-- Dynamic scrubbing cursor -->
    <line id="gear-cursor-line" x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="rgba(255,255,255,0.4)" stroke-width="1" stroke-dasharray="3 3" opacity="0" pointer-events="none" />
    <circle id="gear-cursor-dot-a" r="4.5" fill="var(--amber)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
    <circle id="gear-cursor-dot-b" r="4.5" fill="var(--ham)" stroke="var(--bg)" stroke-width="1.5" opacity="0" pointer-events="none" />
  `;
}


// ── GEAR GRID LINES ───────────────────────────────────────────────────────

function gearGridLines(W, H, PAD) {
  return [1, 2, 3, 4, 5, 6, 7, 8].map(g => {
    const y = H - PAD - ((g - 1) / 7) * (H - PAD * 2);
    return `
      <line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}"
            stroke="rgba(255,255,255,0.04)" stroke-width="0.5"/>
      <text x="${PAD - 4}" y="${y + 3}" text-anchor="end"
            fill="#4A5568" font-family="DM Mono,monospace" font-size="8">${g}</text>
    `;
  }).join('');
}


// ── CURSOR INTERACTION UPDATE ─────────────────────────────────────────────

/**
 * Fast direct-DOM update to move the gear cursor line and dot marker.
 *
 * @param {number} index - Active telemetry index (0–999)
 */
export function updateGearChartCursor(index) {
  const line = document.getElementById('gear-cursor-line');
  const dotA  = document.getElementById('gear-cursor-dot-a');
  const dotB  = document.getElementById('gear-cursor-dot-b');

  if (!line || !dotA || !dotB) return;

  const idx = Math.max(0, Math.min(index, cachedPtsA.length - 1));
  const pA   = cachedPtsA[idx];
  const pB   = cachedPtsB[idx];

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
