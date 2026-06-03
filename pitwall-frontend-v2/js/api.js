/**
 * api.js
 * ──────
 * All network communication with the FastAPI backend lives here.
 * No DOM access, no state writes — pure fetch logic.
 *
 * DESIGN PRINCIPLE: Every other module imports from this file when it
 * needs to talk to the backend. This means the API base URL, error
 * handling strategy, and JSON parsing logic are all in ONE place.
 * If the backend URL changes, you only update one line.
 *
 * BACKEND ROUTES (for reference):
 *   GET  /api/seasons/{year}/races?session_type=&circuit_type=&search=
 *   GET  /api/seasons/{year}/races/{round}/drivers?session=
 *   POST /api/analysis  { year, round, session, driver_a, driver_b, force_refresh }
 *   GET  /api/analysis/{job_id}
 *   GET  /api/analysis/{job_id}/exports/{format}
 */

// ── API BASE URL ─────────────────────────────────────────────────────────
//
// Reads from localStorage so developers can override it in the browser
// console without touching code:
//   localStorage.setItem('PITWALL_API_BASE', 'http://my-server:8000/api')
//
export const API_BASE =
  localStorage.getItem('PITWALL_API_BASE') || 'http://localhost:8000/api';


// ── CORE FETCH HELPERS ───────────────────────────────────────────────────

/**
 * Perform a GET request and return the parsed JSON body.
 * Throws an Error (with a human-readable message) if the response is not 2xx.
 *
 * @param {string} path - Path relative to API_BASE, e.g. '/seasons/2023/races'
 * @returns {Promise<any>}
 */
export async function apiGet(path) {
  const url = `${API_BASE}${path}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(await apiErrorText(res));
  return res.json();
}

/**
 * Perform a POST request with a JSON body and return the parsed JSON response.
 * Includes console logging to help debug analysis job submissions.
 *
 * @param {string} path - Path relative to API_BASE, e.g. '/analysis'
 * @param {object} body - Plain object — will be JSON-serialised
 * @returns {Promise<any>}
 */
export async function apiPost(path, body) {
  const url = `${API_BASE}${path}`;
  console.log('[PITWALL] POST', url, body);

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  console.log('[PITWALL] POST', url, '→', res.status);
  if (!res.ok) throw new Error(await apiErrorText(res));

  const data = await res.json();
  console.log('[PITWALL] POST response:', data);
  return data;
}

/**
 * Extract a human-readable error message from a failed Response.
 * FastAPI returns { detail: "…" } for validation errors.
 *
 * @param {Response} res
 * @returns {Promise<string>}
 */
export async function apiErrorText(res) {
  try {
    const payload = await res.json();
    return payload.detail || `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}


// ── STRING HELPERS ───────────────────────────────────────────────────────

/**
 * Escape HTML special characters before injecting user-provided strings
 * into innerHTML. Prevents XSS from malicious race/driver names.
 *
 * @param {*} value - Any value (will be coerced to string)
 * @returns {string}
 */
export function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

/**
 * Convert backend session codes to readable labels.
 * e.g. 'FP1' → 'Practice FP1', 'Q3' → 'Qualifying Q3', 'R' → 'Race'
 *
 * @param {string} session
 * @returns {string}
 */
export function normalizeSessionLabel(session) {
  if (!session) return 'Session';
  if (session.startsWith('FP')) return 'Practice '   + session;
  if (session.startsWith('Q'))  return 'Qualifying '  + session;
  if (session === 'R')          return 'Race';
  if (session === 'S' || session === 'SQ') return 'Sprint';
  return session;
}


// ── ANALYSIS POLLING ─────────────────────────────────────────────────────

/**
 * Poll GET /api/analysis/{jobId} until status is COMPLETED or FAILED.
 * Calls onProgress(percentage, statusLabel) on every poll tick so the
 * loading screen can update its progress bar and message.
 *
 * @param {string}   jobId      - The job_id from POST /api/analysis
 * @param {Function} onProgress - (pct: number, label: string) => void
 * @returns {Promise<object>}   - The full AnalysisResult when COMPLETED
 */
export async function pollAnalysis(jobId, onProgress) {
  // Human-readable labels for each backend status code
  const STATUS_LABELS = {
    PENDING:   'queued in telemetry worker',
    RUNNING:   'processing telemetry bundle',
    STARTED:   'processing telemetry bundle',
    COMPLETED: 'generating charts',
  };

  // Poll up to 120 times (~2 minutes at 1s interval)
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = await apiGet(`/analysis/${jobId}`);
    const status = result.status;

    // Progress: start at 15%, advance by ~4% per second, cap at 95%
    const pct   = Math.min(95, 15 + attempt * 4);
    const label = STATUS_LABELS[status] || status.toLowerCase();
    onProgress(pct, label);

    if (status === 'COMPLETED') return result;
    if (status === 'FAILED')    throw new Error(result.error || 'analysis failed');

    // Wait 1 second before next poll
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error('analysis timed out after 2 minutes');
}
