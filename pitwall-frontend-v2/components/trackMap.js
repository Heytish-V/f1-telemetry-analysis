/**
 * components/trackMap.js
 * ──────────────────────
 * Renders the aligned spatial Track Position Map SVG into #track-svg.
 * Handles spatial normalization, bounding box fitting, and real-time
 * 60fps driver circle repositioning.
 */

let cachedPtsA = [];
let cachedPtsB = [];

// ── HELPERS ───────────────────────────────────────────────────────────────

function generateDemoCoordinates() {
  const N = 1000;
  const x_a = [];
  const y_a = [];
  const x_b = [];
  const y_b = [];

  for (let i = 0; i < N; i++) {
    const phase = i / (N - 1);
    const angle = phase * 2 * Math.PI;

    // Sleek closed-loop parametric track equation
    const x_base = 600 * Math.sin(angle) + 180 * Math.sin(2 * angle) + 50 * Math.cos(3 * angle);
    const y_base = 400 * Math.cos(angle) + 100 * Math.sin(2 * angle) + 40 * Math.sin(4 * angle);

    x_a.push(x_base);
    y_a.push(y_base);
    x_b.push(x_base + 6 * Math.sin(angle));
    y_b.push(y_base + 6 * Math.cos(angle));
  }

  return { x_a, y_a, x_b, y_b };
}

function pts2path(pts) {
  if (!pts || !pts.length) return '';
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';
}


// ── PUBLIC API ────────────────────────────────────────────────────────────

/**
 * Renders the track map and stores normalized points for quick updates.
 *
 * @param {object|null} charts - Charts from AnalysisResult containing coordinates
 * @param {object}      A      - Driver A
 * @param {object}      B      - Driver B
 */
export function renderTrackMap(charts, A, B) {
  const svg = document.getElementById('track-svg');
  if (!svg) return;

  // Use API coordinates if present, otherwise fall back to synthetic loop
  const coords = (charts && charts.x_a && charts.x_a.length) 
    ? { x_a: charts.x_a, y_a: charts.y_a, x_b: charts.x_b, y_b: charts.y_b } 
    : generateDemoCoordinates();

  const { x_a, y_a, x_b, y_b } = coords;

  // 1. Calculate bounding box enclosing both paths
  const allX = [...x_a, ...x_b];
  const allY = [...y_a, ...y_b];
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);

  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  const maxRange = Math.max(rangeX, rangeY, 0.001);

  // 2. Map coordinates into 300x240 SVG viewbox with standard padding
  const W = 300;
  const H = 200;
  const PAD = 20;
  const scale = Math.min((W - PAD * 2) / rangeX, (H - PAD * 2) / rangeY);

  // Centre layout
  const offsetX = (W - rangeX * scale) / 2;
  const offsetY = (H - rangeY * scale) / 2;

  // Invert Y coordinate so real-world F1 layouts are mapped with correct spatial orientation
  cachedPtsA = x_a.map((x, i) => ({
    x: offsetX + (x - minX) * scale,
    y: H - (offsetY + (y_a[i] - minY) * scale)
  }));

  cachedPtsB = x_b.map((x, i) => ({
    x: offsetX + (x - minX) * scale,
    y: H - (offsetY + (y_b[i] - minY) * scale)
  }));

  // 3. Inject path elements and driver circles
  svg.innerHTML = `
    <!-- Background grid texture -->
    <defs>
      <pattern id="track-grid" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.015)" stroke-width="1"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#track-grid)" />

    <!-- Aligned Track path overlay (gray track border/guideline) -->
    <path d="${pts2path(cachedPtsA)}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="12" stroke-linejoin="round" stroke-linecap="round" />
    <path d="${pts2path(cachedPtsA)}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />

    <!-- Active Driver Circles ( VER/HAM etc. ) -->
    <circle id="track-dot-b" r="6.5" fill="${B.color || 'var(--ham)'}" stroke="var(--bg)" stroke-width="1.5" opacity="0.85" style="transition: cx 0.05s ease, cy 0.05s ease;" />
    <circle id="track-dot-a" r="6.5" fill="${A.color || 'var(--ver)'}" stroke="var(--bg)" stroke-width="1.5" style="transition: cx 0.05s ease, cy 0.05s ease;" />
  `;

  // Start circles at index 0
  updateTrackDriverPositions(0);
}

/**
 * Fast direct-DOM update to move the driver dots to the selected index.
 * Achieves 60fps scrubbing with no layout reflows.
 *
 * @param {number} index - Telemetry index (0–999)
 */
export function updateTrackDriverPositions(index) {
  const dotA = document.getElementById('track-dot-a');
  const dotB = document.getElementById('track-dot-b');

  if (!dotA || !dotB) return;

  const idx = Math.max(0, Math.min(index, cachedPtsA.length - 1));
  const pA = cachedPtsA[idx];
  const pB = cachedPtsB[idx];

  if (pA) {
    dotA.setAttribute('cx', pA.x.toFixed(1));
    dotA.setAttribute('cy', pA.y.toFixed(1));
  }
  if (pB) {
    dotB.setAttribute('cx', pB.x.toFixed(1));
    dotB.setAttribute('cy', pB.y.toFixed(1));
  }
}
