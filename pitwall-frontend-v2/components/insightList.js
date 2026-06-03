/**
 * components/insightList.js
 * ─────────────────────────
 * Renders insight pills in the left panel (#insight-list)
 * and populates the right panel drill-down (#drill-panel) when
 * the user clicks an insight.
 *
 * Also exports selectInsight() so analysis.js can re-trigger the
 * drill panel render when the casual/analyst mode changes.
 */

import { htmlEscape }          from '../js/api.js';
import { getState, setState }  from '../js/state.js';


// ── PUBLIC API ────────────────────────────────────────────────────────────

/**
 * Render all insight pills into #insight-list.
 *
 * @param {Array}  insights - insight[] from AnalysisResult
 * @param {object} A        - Driver A
 * @param {object} B        - Driver B
 */
export function renderInsightList(insights, A, B) {
  const el = document.getElementById('insight-list');
  if (!el) return;

  if (!insights || !insights.length) {
    el.innerHTML = '<div style="color:var(--text3); font-size:12px; padding:8px 0;">No insights available</div>';
    return;
  }

  const { activeInsight } = getState();

  el.innerHTML = insights.map((ins, idx) => {
    const id         = ins.id ?? idx;
    const gainColor  = resolveGainColor(ins.driverGain, A, B);
    const sign       = Number(ins.timeA) > 0 ? '+' : '';

    return `
      <div class="insight-pill ${activeInsight === id ? 'active' : ''}" data-insight-id="${id}">
        <div class="insight-cat">S${ins.sector} · ${htmlEscape(ins.corner)} · ${htmlEscape(ins.cat)}</div>
        <div class="insight-desc casual-text">${htmlEscape(ins.casual)}</div>
        <div class="insight-desc analyst-text" style="display:none">${htmlEscape(ins.detail)}</div>
        <div class="insight-gain" style="color:${gainColor}">
          ${sign}${Number(ins.timeA).toFixed(3)}s ${htmlEscape(ins.driverGain)}
        </div>
      </div>
    `;
  }).join('');

  // Bind click handlers via event delegation on the list container
  el.addEventListener('click', e => {
    const pill = e.target.closest('.insight-pill');
    if (!pill) return;
    const id = Number(pill.dataset.insightId);
    selectInsight(id, insights, A, B);
  });
}

/**
 * Select an insight by id — highlights its pill and renders the drill panel.
 * Exported so analysis.js can call it when mode changes.
 *
 * @param {number} id       - The insight id
 * @param {Array}  [insights] - Pass insights array if available; falls back to currentAnalysis
 * @param {object} [A]
 * @param {object} [B]
 */
export function selectInsight(id, insights, A, B) {
  setState({ activeInsight: id });

  // Highlight the correct pill
  document.querySelectorAll('.insight-pill').forEach(p => {
    p.classList.toggle('active', Number(p.dataset.insightId) === id);
  });

  // Resolve insight data
  const state   = getState();
  const allIns  = insights || state.currentAnalysis?.insights || [];
  const ins     = allIns.find(x => (x.id ?? allIns.indexOf(x)) === id);
  if (!ins) return;

  const driverA = A || state.selectedDriverA || { code: 'A', color: '#3B9EFF' };
  const driverB = B || state.selectedDriverB || { code: 'B', color: '#00C2A0' };

  renderDrillPanel(ins, driverA, driverB);
}


// ── DRILL PANEL ───────────────────────────────────────────────────────────

function renderDrillPanel(ins, A, B) {
  const panel = document.getElementById('drill-panel');
  if (!panel) return;

  const { analysisMode } = getState();
  const isAnalyst       = analysisMode === 'analyst';

  const gainColor = resolveGainColor(ins.driverGain, A, B);
  const miniSvg   = ins.mini_trace ? miniTraceFromData(ins.mini_trace) : miniTraceFallback();

  panel.innerHTML = `
    <div class="drill-header">
      <div class="drill-zone">${htmlEscape(ins.corner)} — ${htmlEscape(ins.catFull || ins.cat)}</div>
      <div class="drill-loc">dist: ${htmlEscape(String(ins.dist))} · sector ${ins.sector}</div>
    </div>

    <div class="panel-label">CHANNEL STATS</div>
    <div class="stat-table">
      ${(ins.stats || []).map(s => `
        <div class="stat-tr">
          <span class="stat-key">${htmlEscape(s[0])}</span>
          <span class="stat-val" style="color:${statColor(s[1], ins.driverGain, A, B, gainColor)}">${htmlEscape(s[1])}</span>
        </div>
      `).join('')}
    </div>

    <div class="panel-label analyst-only ${isAnalyst ? '' : 'hidden'}">CONFIDENCE</div>
    <div class="conf-section analyst-only ${isAnalyst ? '' : 'hidden'}">
      <div style="display:flex; justify-content:space-between; align-items:baseline;">
        <span style="font-size:13px; color:var(--text2)">Confidence score</span>
        <span class="mono" style="font-size:16px; font-weight:500; color:var(--teal)">${Number(ins.conf).toFixed(2)}</span>
      </div>
      <div class="conf-track"><div class="conf-fill" style="width:${Number(ins.conf) * 100}%"></div></div>
      <div class="conf-meta">
        <span>Laps consistent: ${htmlEscape(String(ins.laps))}</span>
        <span>Method: ensemble</span>
      </div>
    </div>

    <div class="panel-label analyst-only ${isAnalyst ? '' : 'hidden'}" style="margin-top:16px">
      MINI TRACE — ${htmlEscape(ins.corner)}
    </div>
    <div class="analyst-only ${isAnalyst ? '' : 'hidden'}">
      <svg viewBox="0 0 260 80" width="100%">${miniSvg}</svg>
    </div>

    <div style="margin-top:16px;">
      <span style="font-family:var(--font-mono); font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:var(--text3);">NARRATIVE</span>
      <p style="margin-top:8px; font-size:13px; color:var(--text2); line-height:1.6;">
        ${htmlEscape(isAnalyst ? ins.detail : ins.casual)}
      </p>
    </div>
  `;
}


// ── MINI TRACE HELPERS ────────────────────────────────────────────────────

/** Build mini trace SVG from real backend data */
function miniTraceFromData(trace) {
  const a = trace.driver_a || [];
  const b = trace.driver_b || [];
  if (!a.length || !b.length) return miniTraceFallback();

  const min    = Math.min(...a, ...b);
  const max    = Math.max(...a, ...b);
  const scaleX = i => 10 + i * (240 / Math.max(1, a.length - 1));
  const scaleY = v => 70 - ((v - min) / Math.max(0.001, max - min)) * 55;
  const toPath = vals => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${scaleX(i).toFixed(1)},${scaleY(v).toFixed(1)}`).join(' ');

  return `
    <line x1="10" y1="70" x2="250" y2="70" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
    <path d="${toPath(a)}" fill="none" stroke="var(--ver)" stroke-width="1.5" stroke-linecap="round"/>
    <path d="${toPath(b)}" fill="none" stroke="var(--ham)" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>
    <text x="10" y="12" font-family="DM Mono,monospace" font-size="8" fill="rgba(255,255,255,0.3)" letter-spacing="1">
      ${htmlEscape(trace.channel || 'trace')} / distance
    </text>
  `;
}

/** Procedurally generated mini trace used as a fallback */
function miniTraceFallback() {
  const n = 20;
  const verPts = Array.from({ length: n }, (_, i) => ({
    x: 10 + i * 12,
    y: 60 - Math.sin(i / n * Math.PI) * 40 - Math.random() * 4,
  }));
  const hamPts = Array.from({ length: n }, (_, i) => ({
    x: 10 + i * 12,
    y: 60 - Math.sin((i + 1) / n * Math.PI) * 36 - Math.random() * 4,
  }));
  const toPath = pts => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');

  return `
    <line x1="10" y1="70" x2="250" y2="70" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
    <path d="${toPath(verPts)}" fill="none" stroke="var(--ver)" stroke-width="1.5" stroke-linecap="round"/>
    <path d="${toPath(hamPts)}" fill="none" stroke="var(--ham)" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>
    <text x="10" y="12" font-family="DM Mono,monospace" font-size="8" fill="rgba(255,255,255,0.3)" letter-spacing="1">throttle / distance</text>
  `;
}


// ── COLOUR HELPERS ────────────────────────────────────────────────────────

function resolveGainColor(driverGain, A, B) {
  if (!driverGain) return 'var(--text)';
  if (driverGain === A.code || driverGain === 'VER') return 'var(--ver)';
  if (driverGain === B.code || driverGain === 'HAM') return 'var(--ham)';
  return 'var(--text)';
}

/**
 * Colour a stat value if it mentions the gaining driver's code.
 * Otherwise returns the default text colour.
 */
function statColor(value, driverGain, A, B, gainColor) {
  const v = String(value);
  if (v.includes(A.code) || v.includes(B.code) || v.includes(driverGain)) {
    return gainColor;
  }
  return 'var(--text)';
}
