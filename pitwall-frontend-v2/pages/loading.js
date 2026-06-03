/**
 * pages/loading.js
 * ────────────────
 * Manages the analysis job lifecycle:
 *   1. Validate that a race + two drivers are selected
 *   2. Submit POST /api/analysis → receive job_id
 *   3. Poll GET /api/analysis/{job_id} until COMPLETED
 *   4. Store the result in state and navigate to the analysis page
 *
 * Also manages the full-screen loading overlay (show/hide/progress bar).
 *
 * NOT RESPONSIBLE FOR:
 * - Rendering any charts or panels
 * - Navigation logic (delegates to router.js)
 */

import { apiPost, pollAnalysis, API_BASE } from '../js/api.js';
import { getState, setState }              from '../js/state.js';
import { goTo }                            from '../js/router.js';

// ── LOADER DOM HELPERS ────────────────────────────────────────────────────

function getLoaderEls() {
  return {
    overlay: document.getElementById('loader'),
    bar:     document.getElementById('loader-bar'),
    msg:     document.getElementById('loader-msg'),
  };
}

/**
 * Show the loading overlay and reset its state.
 *
 * @param {string} [initialMsg] - First status message to display
 */
export function showLoader(initialMsg = 'initialising…') {
  const { overlay, bar, msg } = getLoaderEls();
  if (!overlay) return;

  overlay.classList.remove('hidden');
  overlay.style.opacity       = '1';
  overlay.style.pointerEvents = 'all';
  if (bar) bar.style.width    = '0%';
  if (msg) msg.textContent    = initialMsg;
}

/**
 * Update the loading overlay's progress bar and message.
 *
 * @param {number} pct   - Percentage 0–100
 * @param {string} label - Status message
 */
export function updateLoader(pct, label) {
  const { bar, msg } = getLoaderEls();
  if (bar) bar.style.width  = `${pct}%`;
  if (msg) msg.textContent  = label;
}

/**
 * Hide the loading overlay fully — fade it out, then set display:none so
 * it cannot sit as an invisible layer on top of the analysis page.
 *
 * @param {number} [delay=250]    - ms before the fade begins
 * @param {Function} [onDone]     - optional callback fired after fully hidden
 */
export function hideLoader(delay = 250, onDone) {
  const { overlay } = getLoaderEls();
  if (!overlay) return;

  setTimeout(() => {
    // 1. Kill pointer events immediately so nothing is blocked
    overlay.style.pointerEvents = 'none';
    // 2. Start the CSS opacity fade (0.4s transition defined in analysis.css)
    overlay.classList.add('hidden');
    // 3. After the fade completes, fully remove it from layout
    setTimeout(() => {
      overlay.style.display = 'none';
      if (onDone) onDone();
    }, 450); // Slightly longer than the 0.4s CSS transition
  }, delay);
}


// ── MAIN ANALYSIS RUNNER ─────────────────────────────────────────────────

/**
 * Entry point called by the "Run Analysis →" button in selector.js.
 *
 * Flow:
 *   showLoader → POST /api/analysis → pollAnalysis → setState → goTo('analysis')
 *
 * On error: falls back to demo data and shows an alert.
 */
export async function runAnalysis() {
  const { selectedDriverA, selectedDriverB, selectedRace, selectedSession, currentYear } = getState();

  // Guard: all three must be selected
  if (!selectedDriverA || !selectedDriverB || !selectedRace) {
    console.warn('[PITWALL] runAnalysis() aborted — missing selection', {
      selectedDriverA, selectedDriverB, selectedRace,
    });
    return;
  }

  // Clear any previous analysis result
  setState({ currentAnalysis: null, currentJobId: null });

  // Show loading overlay
  showLoader('submitting analysis job');
  updateLoader(8, 'submitting analysis job');

  // Build the POST body exactly as the backend expects
  const requestBody = {
    year:          currentYear,
    round:         selectedRace.round,
    session:       selectedSession,
    driver_a:      selectedDriverA.code,
    driver_b:      selectedDriverB.code,
    force_refresh: false,
  };

  console.log('[PITWALL] Analysis request:', JSON.stringify(requestBody));

  try {
    // ── Step 1: Submit the job ──────────────────────────────────────────
    const job = await apiPost('/analysis', requestBody);
    console.log('[PITWALL] Job submitted:', job);

    setState({ currentJobId: job.job_id, apiOnline: true });
    updateLoader(15, 'job accepted — polling for results');

    // ── Step 2: Poll until COMPLETED ───────────────────────────────────
    const result = await pollAnalysis(job.job_id, (pct, label) => {
      updateLoader(pct, label);
    });

    console.log('[PITWALL] Analysis complete');

    // ── Step 3: Extract the result payload ─────────────────────────────
    // The backend wraps the result inside { result: {...} } or { data: {...} }
    // depending on the status response shape; normalise here.
    const analysis = (result && (result.result || result.data)) ? (result.result || result.data) : result;

    setState({ currentAnalysis: analysis, apiOnline: true });

    // ── Step 4: Navigate to analysis page ──────────────────────────────
    updateLoader(100, 'ready');
    hideLoader(250);
    setTimeout(() => goTo('analysis'), 300);

  } catch (err) {
    console.error('[PITWALL] runAnalysis() failed:', err);
    setState({ apiOnline: false });

    // ── Show the error state inline in the overlay — NO alert() ──────────
    // alert() is synchronous and blocks the JS thread, which:
    //   1. Pauses the CSS opacity transition (overlay stays frozen on screen)
    //   2. Prevents the async goTo() import from resolving
    // Instead, we display the error in the loader itself, then navigate
    // only after the overlay is fully hidden (via the onDone callback).

    const { bar, msg } = getLoaderEls();
    if (bar) {
      bar.style.width      = '100%';
      bar.style.background = 'var(--red2)';
    }
    if (msg) {
      msg.style.color  = 'var(--red2)';
      msg.textContent  = `backend offline — showing demo data`;
    }

    // Show the error message briefly, then fade the overlay and navigate
    hideLoader(1200, () => {
      // This callback fires only AFTER display:none — the overlay is truly gone.
      setState({ currentAnalysis: null });
      goTo('analysis');
    });
  }
}
