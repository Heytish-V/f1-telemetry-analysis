/**
 * pages/analysis.js
 * ─────────────────
 * Analysis Dashboard orchestrator.
 *
 * This module is the conductor — it reads the analysis result from state,
 * sets the breadcrumb labels, and calls each component module to render
 * its piece of the UI. It does NOT contain any chart math or SVG logic.
 *
 * RESPONSIBILITIES:
 * - Populate breadcrumb (race name / session / driver codes)
 * - Set CSS custom properties --ver and --ham (driver colours)
 * - Update legend labels with real driver codes
 * - Call renderLapSummary(), renderInsightList(), and all chart renderers
 * - Manage the casual/analyst mode toggle
 * - Manage the tab switcher
 * - Handle the export button
 *
 * NOT RESPONSIBLE FOR:
 * - SVG chart math (in individual component files)
 * - Insight drill-down panel (in insightList.js)
 * - API calls or polling (in loading.js)
 */

import { getState, setState, RACES_2023, DRIVERS_2023, DEMO_INSIGHTS, DEMO_SECTORS }
  from '../js/state.js';
import { normalizeSessionLabel, API_BASE } from '../js/api.js';

import { renderLapSummary }      from '../components/lapSummary.js';
import { renderInsightList }     from '../components/insightList.js';
import { renderDeltaChart, updateDeltaChartCursor }      from '../components/deltaChart.js';
import { renderSpeedChart, updateSpeedChartCursor }      from '../components/speedChart.js';
import { renderThrottleChart, updateThrottleChartCursor }   from '../components/throttleChart.js';
import { renderBrakeChart, updateBrakeChartCursor }      from '../components/brakeChart.js';
import { renderGearChart, updateGearChartCursor }       from '../components/gearChart.js';
import { renderWaterfallChart }  from '../components/waterfallChart.js';
import { renderTrackMap, updateTrackDriverPositions } from '../components/trackMap.js';


// ── ENTRY POINT ───────────────────────────────────────────────────────────

/**
 * Called by router.js every time the analysis page becomes active.
 * Reads current state and orchestrates all sub-renders.
 */
export function renderAnalysis() {
  const state = getState();

  // Resolve driver A, B, and race — use demo data as fallback
  const A    = (state.currentAnalysis && state.currentAnalysis.driver_a) || state.selectedDriverA || DRIVERS_2023[0];
  const B    = (state.currentAnalysis && state.currentAnalysis.driver_b) || state.selectedDriverB || DRIVERS_2023[2];
  const race = (state.currentAnalysis && state.currentAnalysis.race)     || state.selectedRace    || RACES_2023[5];

  // ── Update breadcrumb ──────────────────────────────────────────────
  const raceLabel    = document.getElementById('analysis-race-label');
  const sessionLabel = document.getElementById('analysis-session-label');
  const driversLabel = document.getElementById('analysis-drivers-label');

  if (raceLabel)    raceLabel.textContent    = `${race.name} ${state.currentYear}`;
  if (sessionLabel) sessionLabel.textContent = normalizeSessionLabel(state.selectedSession);
  if (driversLabel) driversLabel.textContent = `${A.code} vs ${B.code}`;

  // ── Update legend text ─────────────────────────────────────────────
  const legendA      = document.getElementById('legend-a');
  const legendB      = document.getElementById('legend-b');
  const speedLegendA = document.getElementById('speed-legend-a');
  const speedLegendB = document.getElementById('speed-legend-b');

  if (legendA)      legendA.textContent      = `${A.code} ahead`;
  if (legendB)      legendB.textContent      = `${B.code} ahead`;
  if (speedLegendA) speedLegendA.textContent = A.code;
  if (speedLegendB) speedLegendB.textContent = B.code;

  // ── Apply dynamic driver colours ───────────────────────────────────
  // This overrides the CSS :root defaults with the actual team colours
  document.documentElement.style.setProperty('--ver', A.color || '#3B9EFF');
  document.documentElement.style.setProperty('--ham', B.color || '#00C2A0');

  // ── Representative laps metadata (analyst mode) ────────────────────
  if (state.currentAnalysis?.lap_summary) {
    const { representative_laps_a, representative_laps_b } = state.currentAnalysis.lap_summary;
    const repA = document.getElementById('rep-laps-a');
    const repB = document.getElementById('rep-laps-b');
    if (repA && representative_laps_a) repA.textContent = representative_laps_a.join(',');
    if (repB && representative_laps_b) repB.textContent = representative_laps_b.join(',');
  }

  // ── Resolve data sources — API result or demo ──────────────────────
  const result   = state.currentAnalysis;
  const lap      = result?.lap_summary   || buildDemoLap(A, B);
  const sectors  = result?.sectors       || DEMO_SECTORS;
  const insights = result?.insights      || DEMO_INSIGHTS;
  const charts   = result?.charts        || null;

  // ── Sector count label ─────────────────────────────────────────────
  const sectorCountEl = document.getElementById('sector-count-label');
  if (sectorCountEl) sectorCountEl.textContent = `${sectors.length || 3} SECTORS`;

  // ── Render components ──────────────────────────────────────────────
  renderLapSummary(lap, sectors, A, B);
  renderInsightList(insights, A, B);
  renderDeltaChart(charts, insights, A, B);
  renderSpeedChart(charts, A, B);
  renderThrottleChart(charts, A, B);
  renderBrakeChart(charts, A, B);
  renderGearChart(charts);
  renderWaterfallChart(charts, A, B);
  renderTrackMap(charts, A, B);

  // ── Apply current mode (casual/analyst) ───────────────────────────
  applyMode();

  // ── Bind one-time UI controls ─────────────────────────────────────
  bindModeToggle();
  bindTabs();
  bindBreadcrumbBack();
  bindExportButton();
  bindTelemetryScrubber(charts);
}


// ── MODE TOGGLE ───────────────────────────────────────────────────────────

function bindModeToggle() {
  const casual  = document.getElementById('mode-casual');
  const analyst = document.getElementById('mode-analyst');
  if (!casual || casual._pitwallBound) return;
  casual._pitwallBound = true;

  casual.addEventListener('click',  () => setMode('casual'));
  analyst.addEventListener('click', () => setMode('analyst'));
}

function setMode(m) {
  setState({ analysisMode: m });
  document.getElementById('mode-casual') ?.classList.toggle('active', m === 'casual');
  document.getElementById('mode-analyst')?.classList.toggle('active', m === 'analyst');
  applyMode();

  // Re-render the active insight drill panel so narrative text swaps
  const { activeInsight } = getState();
  if (activeInsight !== null) {
    import('../components/insightList.js').then(({ selectInsight }) => {
      selectInsight(activeInsight);
    });
  }
}

/**
 * Toggle visibility of analyst-only elements and casual/analyst text blocks.
 * Matches the original applyMode() behaviour exactly.
 */
function applyMode() {
  const { analysisMode } = getState();
  const isAnalyst = analysisMode === 'analyst';

  document.querySelectorAll('.analyst-only').forEach(el => {
    el.classList.toggle('hidden', !isAnalyst);
  });
  document.querySelectorAll('.casual-text').forEach(el => {
    el.style.display = isAnalyst ? 'none' : 'block';
  });
  document.querySelectorAll('.analyst-text').forEach(el => {
    el.style.display = isAnalyst ? 'block' : 'none';
  });

  // Gear chart card is analyst-only but uses display directly
  const gearCard = document.getElementById('analyst-gear-card');
  if (gearCard) gearCard.style.display = isAnalyst ? 'block' : 'none';
}


// ── TABS ──────────────────────────────────────────────────────────────────

function bindTabs() {
  const tabBar = document.querySelector('.tab-bar');
  if (!tabBar || tabBar._pitwallBound) return;
  tabBar._pitwallBound = true;

  tabBar.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    switchTab(tab.dataset.tab, tab);
  });
}

function switchTab(tabName, activeBtn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  activeBtn.classList.add('active');
  document.getElementById('tab-' + tabName)?.classList.add('active');
}


// ── BREADCRUMB BACK ───────────────────────────────────────────────────────

function bindBreadcrumbBack() {
  const back = document.getElementById('breadcrumb-sessions');
  if (!back || back._pitwallBound) return;
  back._pitwallBound = true;
  back.addEventListener('click', async () => {
    const { goTo } = await import('../js/router.js');
    goTo('selector');
  });
}


// ── EXPORT ────────────────────────────────────────────────────────────────

function bindExportButton() {
  const btn = document.getElementById('export-btn');
  if (!btn || btn._pitwallBound) return;
  btn._pitwallBound = true;
  btn.addEventListener('click', handleExport);
}

function handleExport() {
  const { currentJobId } = getState();

  if (!currentJobId) {
    alert('Run an analysis first, then exports will be available.');
    return;
  }

  const choice = prompt(
    'Export format: csv, json, pdf-casual, or pdf-analyst', 'json'
  );
  if (!choice) return;

  const fmt = choice.toLowerCase().trim();
  let url;

  if      (fmt === 'csv')         url = `${API_BASE}/analysis/${currentJobId}/exports/csv`;
  else if (fmt === 'json')        url = `${API_BASE}/analysis/${currentJobId}/exports/json`;
  else if (fmt === 'pdf-casual')  url = `${API_BASE}/analysis/${currentJobId}/exports/pdf?mode=casual`;
  else if (fmt === 'pdf-analyst' || fmt === 'pdf')
                                  url = `${API_BASE}/analysis/${currentJobId}/exports/pdf?mode=analyst`;
  else { alert('Unknown export format.'); return; }

  window.open(url, '_blank');
}


// ── TELEMETRY SCRUBBER BINDING ────────────────────────────────────────────

function bindTelemetryScrubber(charts) {
  const slider = document.getElementById('telemetry-slider');
  const distEl = document.getElementById('scrubber-distance');
  const idxEl  = document.getElementById('scrubber-index');

  if (!slider) return;

  // Both API and demo generate exactly 1000 aligned telemetry points (0 to 999 indices)
  slider.min = '0';
  slider.max = '999';

  // Read distances if available, else approximate a typical 5.2km lap
  const distances = (charts && charts.distance) ? charts.distance : null;
  const totalDist = distances ? distances[distances.length - 1] : 5200;

  const handleInput = () => {
    const idx = parseInt(slider.value, 10);

    // Update readouts
    if (idxEl) idxEl.textContent = idx;
    if (distEl) {
      const d = distances ? distances[idx] : idx * (totalDist / 999);
      distEl.textContent = `${d.toFixed(1)} m`;
    }
    
    // Update live telemetry readout
    if (charts) {
      const el = (id) => document.getElementById(id);
      if (el('scrubber-delta')) el('scrubber-delta').textContent = charts.delta && charts.delta[idx] !== undefined ? `${charts.delta[idx].toFixed(3)}s` : '0.000s';
      
      if (el('readout-spd-a')) el('readout-spd-a').textContent = charts.speed_a ? `${Math.round(charts.speed_a[idx])} km/h` : '0 km/h';
      if (el('readout-thr-a')) el('readout-thr-a').textContent = charts.throttle_a ? `${Math.round(charts.throttle_a[idx])} %` : '0 %';
      if (el('readout-brk-a')) el('readout-brk-a').textContent = charts.brake_a ? `${Math.round(charts.brake_a[idx] * 100)} %` : '0 %';
      if (el('readout-gear-a')) el('readout-gear-a').textContent = charts.gear_a ? charts.gear_a[idx] : '0';
      
      if (el('readout-spd-b')) el('readout-spd-b').textContent = charts.speed_b ? `${Math.round(charts.speed_b[idx])} km/h` : '0 km/h';
      if (el('readout-thr-b')) el('readout-thr-b').textContent = charts.throttle_b ? `${Math.round(charts.throttle_b[idx])} %` : '0 %';
      if (el('readout-brk-b')) el('readout-brk-b').textContent = charts.brake_b ? `${Math.round(charts.brake_b[idx] * 100)} %` : '0 %';
      if (el('readout-gear-b')) el('readout-gear-b').textContent = charts.gear_b ? charts.gear_b[idx] : '0';
    }

    // Trigger fast 60fps cursor movements on all SVG visual layers
    updateTrackDriverPositions(idx);
    updateDeltaChartCursor(idx);
    updateSpeedChartCursor(idx);
    updateThrottleChartCursor(idx);
    updateBrakeChartCursor(idx);
    updateGearChartCursor(idx);
  };

  // Bind listener (ensure only once)
  if (!slider._pitwallBound) {
    slider._pitwallBound = true;
    slider.addEventListener('input', handleInput);
  }

  // Trigger initial paint at index 0
  slider.value = '0';
  handleInput();
}


// ── DEMO LAP BUILDER ─────────────────────────────────────────────────────

/**
 * Generate plausible-looking demo lap data when the backend is offline.
 * Mirrors the random generation in the original f1-telemetry.html.
 */
function buildDemoLap(A, B) {
  const lapA  = `1:${10 + Math.floor(Math.random() * 2)}.${200 + Math.floor(Math.random() * 200)}`;
  const lapB  = `1:${10 + Math.floor(Math.random() * 2)}.${300 + Math.floor(Math.random() * 200)}`;
  const delta = (Math.random() * 0.4 + 0.1).toFixed(3);
  return {
    lap_a:  lapA,
    lap_b:  lapB,
    delta:  delta,
    total_delta_seconds: -Number(delta),
  };
}
