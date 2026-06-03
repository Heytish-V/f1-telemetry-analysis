/**
 * components/lapSummary.js
 * ────────────────────────
 * Renders the Lap Summary card (#lap-summary-card) and the
 * Sector Breakdown list (#sector-breakdown) in the left panel.
 *
 * Both are simple HTML-injection components — no SVG, no canvas.
 *
 * @param {object} lap     - lap_summary from AnalysisResult
 *   { lap_a, lap_b, delta, total_delta_seconds }
 * @param {Array}  sectors - sectors[] from AnalysisResult
 *   [{ label, delta, winner }]  winner = 'A' | 'B'
 * @param {object} A       - Driver A  { code, color, … }
 * @param {object} B       - Driver B  { code, color, … }
 */

import { htmlEscape } from '../js/api.js';

/**
 * Render the lap summary card and sector breakdown.
 * Safe to call multiple times (innerHTML is always fully replaced).
 */
export function renderLapSummary(lap, sectors, A, B) {
  renderLapCard(lap, A, B);
  renderSectorBreakdown(sectors, A, B);
}


// ── LAP CARD ─────────────────────────────────────────────────────────────

function renderLapCard(lap, A, B) {
  const el = document.getElementById('lap-summary-card');
  if (!el) return;

  // Determine which driver is ahead based on the sign of total_delta_seconds
  // Negative means A is faster (A leads), positive means B is faster.
  const deltaNum    = Number(lap.total_delta_seconds ?? lap.delta ?? 0);
  const leaderColor = deltaNum <= 0 ? 'var(--ver)' : 'var(--ham)';
  const deltaLabel  = htmlEscape(lap.delta || '0.000');

  el.innerHTML = `
    <div class="lap-driver-row">
      <span class="lap-driver-name" style="color:var(--ver)">${htmlEscape(A.code)}</span>
      <span class="lap-time mono"   style="color:var(--text)">${htmlEscape(lap.lap_a || '—')}</span>
    </div>
    <div class="lap-driver-row" style="margin-bottom:0">
      <span class="lap-driver-name" style="color:var(--ham)">${htmlEscape(B.code)}</span>
      <span class="lap-time mono"   style="color:var(--text2)">${htmlEscape(lap.lap_b || '—')}</span>
    </div>
    <div class="lap-delta-row">
      <span class="lap-delta-label">LAP DELTA</span>
      <span class="lap-delta-val" style="color:${leaderColor}">${deltaLabel}s</span>
    </div>
  `;
}


// ── SECTOR BREAKDOWN ─────────────────────────────────────────────────────

function renderSectorBreakdown(sectors, A, B) {
  const el = document.getElementById('sector-breakdown');
  if (!el) return;

  if (!sectors || !sectors.length) {
    el.innerHTML = '<div style="color:var(--text3); font-size:12px; padding:8px 0;">No sector data</div>';
    return;
  }

  el.innerHTML = sectors.map(s => {
    const delta      = Number(s.delta);
    const winnerCode = s.winner === 'A' ? A.code : B.code;
    const colour     = s.winner === 'A' ? 'var(--ver)' : 'var(--ham)';
    // Bar width: scale delta to a max of ~100px; cap at 100
    const barWidth   = Math.min(100, Math.abs(delta) * 300);
    const sign       = delta > 0 ? '+' : '';

    return `
      <div class="sector-row">
        <span class="sector-num">${htmlEscape(s.label)}</span>
        <div class="sector-bar-wrap">
          <div class="sector-bar" style="width:${barWidth}px; background:${colour}"></div>
        </div>
        <span class="sector-delta" style="color:${colour}">
          ${sign}${delta.toFixed(3)}s ${htmlEscape(winnerCode)}
        </span>
      </div>
    `;
  }).join('');
}
