/**
 * router.js
 * ─────────
 * SPA navigation: switches between pages, syncs nav active states,
 * and calls page lifecycle hooks when entering a new page.
 *
 * This file is the entry point for the entire app — it's the only
 * <script type="module"> loaded from index.html.
 *
 * DESIGN: Pages are HTML divs with class="page". The router adds/removes
 * the "active" class to show/hide them. This is identical to the original
 * f1-telemetry.html navigation — only the event binding is different
 * (addEventListener instead of inline onclick=).
 *
 * DYNAMIC IMPORTS: Page modules (selector.js, loading.js, analysis.js)
 * are loaded on-demand via import() the first time a page is visited.
 * This keeps the initial bundle small and pages decoupled.
 */

import { getState, setState } from './state.js';

// ── PAGE DEFINITIONS ─────────────────────────────────────────────────────
//
// Each entry maps a page name → the DOM id of the page container.
// onEnter is called every time the page becomes active.
//
const PAGES = {
  landing:  { id: 'page-landing' },
  selector: { id: 'page-selector', onEnter: enterSelector },
  analysis: { id: 'page-analysis', onEnter: enterAnalysis },
};


// ── MAIN NAVIGATION FUNCTION ─────────────────────────────────────────────

/**
 * Navigate to a named page.
 * Hides all other pages, shows the target, syncs the nav bar,
 * scrolls to top, and calls the page's onEnter hook.
 *
 * @param {string} pageName - One of: 'landing', 'selector', 'analysis'
 */
export function goTo(pageName) {
  const route = PAGES[pageName];
  if (!route) {
    console.error('[ROUTER] Unknown page:', pageName);
    return;
  }

  // Enforce single active page — remove active from all, add to target
  enforceSingleActivePage(route.id);

  // Update state
  setState({ currentPage: pageName });

  // Sync nav bar highlight
  syncNavLinks(pageName);

  // Scroll to top
  window.scrollTo(0, 0);

  // Run the page's entry hook if it has one
  if (route.onEnter) route.onEnter();
}


// ── ENFORCE SINGLE ACTIVE PAGE ───────────────────────────────────────────

/**
 * Guarantee exactly one page has class="page active" at any time.
 * Mirrors the original enforceSingleActivePage() logic exactly.
 *
 * @param {string} targetId - The id of the page element to activate
 */
function enforceSingleActivePage(targetId) {
  const pages  = Array.from(document.querySelectorAll('.page'));
  let   chosen = null;

  pages.forEach(p => {
    const shouldBeActive = p.id === targetId;
    p.classList.toggle('active', shouldBeActive);
    if (shouldBeActive) chosen = p;
  });

  if (!chosen) {
    console.error('[ROUTER] Target page element not found:', targetId);
    return;
  }

  // Safety: if multiple pages somehow ended up active, correct it
  const activePages = pages.filter(p => p.classList.contains('active'));
  if (activePages.length !== 1) {
    console.warn('[ROUTER] Multiple active pages detected — correcting');
    pages.forEach(p => p.classList.remove('active'));
    chosen.classList.add('active');
  }
}


// ── NAV SYNC ─────────────────────────────────────────────────────────────

function syncNavLinks(pageName) {
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  const map = {
    landing:  'nav-overview',
    selector: 'nav-sessions',
    analysis: 'nav-analysis',
  };
  const activeId = map[pageName];
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) el.classList.add('active');
  }

  // Reveal the Analysis nav link once the user reaches the analysis page
  if (pageName === 'analysis') {
    const analysisLink = document.getElementById('nav-analysis');
    if (analysisLink) analysisLink.style.display = 'block';
  }
}


// ── PAGE ENTRY HOOKS ─────────────────────────────────────────────────────

// Lazy-import selector.js and call initSelector() on first (and every) visit.
// initSelector() is safe to call multiple times — it re-renders the race grid.
async function enterSelector() {
  const { initSelector } = await import('../pages/selector.js');
  initSelector();
}

// Lazy-import analysis.js and call renderAnalysis() on every visit.
async function enterAnalysis() {
  const { renderAnalysis } = await import('../pages/analysis.js');
  renderAnalysis();
}


// ── DEMO MODE ────────────────────────────────────────────────────────────

/**
 * Load the demo analysis (Monaco GP 2023, VER vs HAM) and jump straight
 * to the analysis dashboard without running a real job.
 */
async function demoAnalysis() {
  const { RACES_2023, DRIVERS_2023, setState: _setState } = await import('./state.js');
  setState({
    selectedRace:    RACES_2023[5], // Monaco
    selectedSession: 'Q3',
    selectedDriverA: DRIVERS_2023[0], // VER
    selectedDriverB: DRIVERS_2023[2], // HAM
    currentAnalysis: null,
  });
  goTo('analysis');
}


// ── BOOT ─────────────────────────────────────────────────────────────────

/**
 * Wire up all nav button event listeners.
 * Called once when this module first loads (which is on DOMContentLoaded
 * because <script type="module"> is deferred by default).
 */
function initNav() {
  // Logo → landing
  document.getElementById('nav-logo')
    ?.addEventListener('click', () => goTo('landing'));

  // Nav links
  document.getElementById('nav-overview')
    ?.addEventListener('click', () => goTo('landing'));
  document.getElementById('nav-sessions')
    ?.addEventListener('click', () => goTo('selector'));
  document.getElementById('nav-analysis')
    ?.addEventListener('click', () => goTo('analysis'));

  // Top-right CTA
  document.getElementById('nav-cta')
    ?.addEventListener('click', () => goTo('selector'));

  // Landing page hero buttons
  document.getElementById('hero-analyse-btn')
    ?.addEventListener('click', () => goTo('selector'));
  document.getElementById('hero-demo-btn')
    ?.addEventListener('click', demoAnalysis);
  document.getElementById('landing-cta-btn')
    ?.addEventListener('click', () => goTo('selector'));
}

/**
 * Initial page load handler.
 * Shows the landing page, hides the boot loader, and loads the race grid
 * in the background so the selector is instant when the user clicks through.
 */
window.addEventListener('load', () => {
  // Hide the boot loader after a brief moment
  const loader = document.getElementById('loader');
  const bar    = document.getElementById('loader-bar');
  const msg    = document.getElementById('loader-msg');

  if (bar) bar.style.width = '100%';
  if (msg) msg.textContent  = 'ready';
  setTimeout(() => {
    if (loader) {
      loader.classList.add('hidden');
      loader.style.pointerEvents = 'none';
      loader.style.opacity = '0';
    }
  }, 600);

  // Wire up nav buttons
  initNav();

  // Pre-warm the race grid (runs quietly in the background)
  import('../pages/selector.js')
    .then(m => m.preloadRaces())
    .catch(() => {}); // Silently ignore if backend is offline on boot
});
