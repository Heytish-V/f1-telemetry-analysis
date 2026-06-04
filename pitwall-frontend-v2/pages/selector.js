/**
 * pages/selector.js
 * ─────────────────
 * Session Selector page — owns ALL rendering and interaction for
 * the race grid, driver grid, sidebar filters, and search.
 *
 * RESPONSIBILITIES:
 * - Fetch races from /api/seasons/{year}/races (with filters)
 * - Render race cards with session pills
 * - Fetch drivers from /api/seasons/{year}/races/{round}/drivers
 * - Render driver cards with A/B selection
 * - Manage filter button states (year, session type, circuit type, search)
 * - Enable/disable "Run Analysis" button
 * - Hand off to loading.js when the user clicks "Run Analysis"
 *
 * NOT RESPONSIBLE FOR:
 * - Any chart rendering
 * - Any analysis result display
 * - Navigation (uses router.js)
 */

import { apiGet, htmlEscape }            from '../js/api.js';
import { getState, setState, resetSelection, RACES_2023, DRIVERS_2023 } from '../js/state.js';

// ── STATIC FILTER DEFINITIONS ────────────────────────────────────────────

const YEARS         = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018];

const CIRCUIT_TYPES = [
  { label: 'All circuits', value: 'all'       },
  { label: 'Street circuits', value: 'street'    },
  { label: 'High-speed',   value: 'high-speed' },
  { label: 'Technical',    value: 'technical'  },
];


// ── PUBLIC API ───────────────────────────────────────────────────────────

/**
 * Called by router.js every time the selector page is entered.
 * Builds the sidebar buttons once, then loads the race grid.
 */
export function initSelector() {
  buildSidebar();
  bindSearchInput();
  bindCompareButton();
  renderRaceGrid();
}

/**
 * Pre-load races without rendering — called from router.js on boot
 * so the grid appears instantly when the user first clicks "Sessions".
 */
export async function preloadRaces() {
  const { currentYear, currentCircuitFilter } = getState();
  const races = await fetchRaces(currentYear, currentCircuitFilter, '');
  setState({ currentRaces: races });
}


// ── SIDEBAR CONSTRUCTION ─────────────────────────────────────────────────
//
// The sidebar only needs to be built once. Subsequent initSelector() calls
// skip the build if the buttons already exist.

function buildSidebar() {
  buildFilterGroup('sidebar-years',         YEARS.map(y => ({ label: String(y), value: y })), 'year');

  buildFilterGroup('sidebar-circuit-types', CIRCUIT_TYPES, 'circuitType');
}

/**
 * Creates filter buttons inside a sidebar section.
 * The first button in each group starts as active (matches initial state).
 *
 * @param {string} sectionId  - DOM id of the sidebar-section container
 * @param {Array}  items      - [{ label, value }]
 * @param {string} filterKey  - 'year' | 'sessionType' | 'circuitType'
 */
function buildFilterGroup(sectionId, items, filterKey) {
  const section = document.getElementById(sectionId);
  if (!section || section.querySelector('.filter-btn')) return; // Already built

  const { currentYear, currentCircuitFilter } = getState();

  items.forEach((item, i) => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn';
    btn.textContent = item.label;

    // Mark initial active state
    const isActive =
      (filterKey === 'year'        && item.value === currentYear)          ||
      (filterKey === 'circuitType' && item.value === currentCircuitFilter) ||
      (filterKey === 'year'        && i === 0 && currentYear === 2026);
    if (isActive) btn.classList.add('active');

    btn.addEventListener('click', () => onFilterClick(btn, filterKey, item.value));
    section.appendChild(btn);
  });
}

/** Handler called when any filter button is clicked */
function onFilterClick(clickedBtn, filterKey, value) {
  // Update button active states within this group
  const group = clickedBtn.parentElement;
  group.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  clickedBtn.classList.add('active');

  // Update state
  if (filterKey === 'year') {
    setState({ currentYear: Number(value) });
    resetSelection();
    document.getElementById('driver-selector').style.display = 'none';
  } else if (filterKey === 'circuitType') {
    setState({ currentCircuitFilter: value });
  }

  renderRaceGrid();
}

function bindSearchInput() {
  const input = document.getElementById('race-search');
  if (!input || input._pitwallBound) return;
  input._pitwallBound = true;
  input.addEventListener('input', () => {
    setState({ currentSearch: input.value });
    renderRaceGrid();
  });
}


// ── RACE GRID ────────────────────────────────────────────────────────────

/**
 * Fetch races from the API (with fallback to demo data) and render the grid.
 * This is called every time a filter changes or the page is entered.
 */
export async function renderRaceGrid() {
  const grid = document.getElementById('race-grid');
  if (!grid) return;

  // Show loading state
  grid.innerHTML = `
    <div style="grid-column:1/-1; color:var(--text3); font-family:var(--font-mono);
                font-size:12px; padding:20px;">loading sessions...</div>`;

  const { currentYear, currentCircuitFilter, currentSearch } = getState();

  const races = await fetchRaces(currentYear, currentCircuitFilter, currentSearch);
  setState({ currentRaces: races });

  // Update count label
  const countEl = document.getElementById('race-count-label');
  if (countEl) countEl.textContent = `${races.length} ROUNDS · ${currentYear} SEASON`;

  if (!races.length) {
    grid.innerHTML = `
      <div style="grid-column:1/-1; color:var(--text3); font-family:var(--font-mono);
                  font-size:12px; padding:20px;">no sessions found</div>`;
    return;
  }

  const { selectedRace, selectedSession } = getState();

  grid.innerHTML = races.map(r => `
    <div class="race-card ${selectedRace && selectedRace.round === r.round ? 'selected' : ''}"
         data-round="${r.round}" role="button" tabindex="0">
      <div class="race-round">RD ${String(r.round).padStart(2, '0')} · ${currentYear}</div>
      <div class="race-name">${htmlEscape(r.flag)} ${htmlEscape(r.name)}</div>
      <div class="race-circuit">${htmlEscape(r.circuit)}</div>
      <div class="race-date mono">${htmlEscape(r.date)}</div>
      <div class="race-sessions">
        ${(r.sessions || ['FP1','FP2','FP3','Q3','R']).map(s => `
          <span class="session-pill ${selectedRace && selectedRace.round === r.round && selectedSession === s ? 'active' : ''}"
                data-round="${r.round}" data-session="${s}">${s}</span>
        `).join('')}
      </div>
    </div>
  `).join('');

  // Attach race-card click handlers (event delegation on the grid)
  grid.querySelectorAll('.race-card').forEach(card => {
    card.addEventListener('click', () => onRaceCardClick(Number(card.dataset.round)));
  });

  // Attach session-pill click handlers (stopPropagation so card click doesn't also fire)
  grid.querySelectorAll('.session-pill').forEach(pill => {
    pill.addEventListener('click', e => {
      e.stopPropagation();
      onSessionPillClick(Number(pill.dataset.round), pill.dataset.session);
    });
  });
}


// ── RACE / SESSION SELECTION ─────────────────────────────────────────────

async function onRaceCardClick(round) {
  const { currentRaces, selectedRace } = getState();
  const race = currentRaces.find(r => r.round === round);
  if (!race) return;

  // Default to Q3 if available, otherwise first session
  const defaultSession =
    race.sessions?.includes('Q3') ? 'Q3' : (race.sessions?.[0] || 'Q3');

  setState({
    selectedRace:    race,
    selectedSession: defaultSession,
    selectedDriverA: null,
    selectedDriverB: null,
  });

  // Re-render grid to update selection visuals
  await renderRaceGrid();

  // Show and populate driver selector
  document.getElementById('driver-selector').style.display = 'block';
  await loadAndRenderDrivers();

  // Smooth scroll to driver selector
  document.getElementById('driver-selector')
    ?.scrollIntoView({ behavior: 'smooth' });
}

function onSessionPillClick(round, session) {
  const { selectedRace } = getState();
  setState({ selectedSession: session });

  // If clicking a session on a different race, also select that race
  if (!selectedRace || selectedRace.round !== round) {
    const { currentRaces } = getState();
    const race = currentRaces.find(r => r.round === round);
    if (race) {
      setState({ selectedRace: race, selectedDriverA: null, selectedDriverB: null });
      document.getElementById('driver-selector').style.display = 'block';
      loadAndRenderDrivers();
    }
  } else {
    // If clicking a new session on the currently selected race, reload drivers
    setState({ selectedDriverA: null, selectedDriverB: null });
    loadAndRenderDrivers();
  }

  renderRaceGrid();
}


// ── DRIVER GRID ──────────────────────────────────────────────────────────

async function loadAndRenderDrivers() {
  const { currentYear, selectedRace, selectedSession } = getState();
  if (!selectedRace) return;

  try {
    const drivers = await apiGet(
      `/seasons/${currentYear}/races/${selectedRace.round}/drivers?session=${encodeURIComponent(selectedSession)}`
    );
    setState({ currentDrivers: drivers, apiOnline: true });
  } catch {
    // Backend offline — fall back to demo drivers
    setState({ currentDrivers: DRIVERS_2023.slice(), apiOnline: false });
  }

  renderDriverGrid();
}

function renderDriverGrid() {
  const { currentDrivers, selectedDriverA, selectedDriverB } = getState();
  const grid = document.getElementById('driver-grid');
  if (!grid) return;

  grid.innerHTML = currentDrivers.map(d => `
    <div class="driver-card
      ${selectedDriverA && selectedDriverA.code === d.code ? 'sel-a' : ''}
      ${selectedDriverB && selectedDriverB.code === d.code ? 'sel-b' : ''}"
         data-code="${d.code}">
      <div class="driver-num" style="color:${htmlEscape(d.color)}">${d.num}</div>
      <div class="driver-info">
        <div class="driver-name">${htmlEscape((d.name || d.code).split(' ').slice(-1)[0])}</div>
        <div class="driver-team">${htmlEscape(d.team)}</div>
      </div>
    </div>
  `).join('');

  // Attach click handlers
  grid.querySelectorAll('.driver-card').forEach(card => {
    card.addEventListener('click', () => onDriverCardClick(card.dataset.code));
  });

  updateCompareButton();
}

function onDriverCardClick(code) {
  const { currentDrivers, selectedDriverA, selectedDriverB } = getState();
  const driver = currentDrivers.find(d => d.code === code);
  if (!driver) return;

  // Selection logic:
  // - No A selected → select as A
  // - A selected, different driver → select as B
  // - Clicking A → deselect A
  // - Clicking B → deselect B
  // - Both selected, clicking new driver → replace A, clear B
  if (!selectedDriverA) {
    setState({ selectedDriverA: driver });
  } else if (!selectedDriverB && driver.code !== selectedDriverA.code) {
    setState({ selectedDriverB: driver });
  } else if (driver.code === selectedDriverA.code) {
    setState({ selectedDriverA: null });
  } else if (selectedDriverB && driver.code === selectedDriverB.code) {
    setState({ selectedDriverB: null });
  } else {
    setState({ selectedDriverA: driver, selectedDriverB: null });
  }

  renderDriverGrid();
}


// ── COMPARE BUTTON ───────────────────────────────────────────────────────

function updateCompareButton() {
  const { selectedDriverA, selectedDriverB } = getState();
  const btn   = document.getElementById('compare-btn');
  const nameA = document.getElementById('sel-a-name');
  const nameB = document.getElementById('sel-b-name');

  if (nameA) nameA.textContent = selectedDriverA ? selectedDriverA.code : '—';
  if (nameB) nameB.textContent = selectedDriverB ? selectedDriverB.code : '—';

  if (btn) {
    const ready = !!(selectedDriverA && selectedDriverB);
    btn.disabled      = !ready;
    btn.style.opacity = ready ? '1' : '0.4';
  }
}

function bindCompareButton() {
  const btn = document.getElementById('compare-btn');
  if (!btn || btn._pitwallBound) return;
  btn._pitwallBound = true;

  btn.addEventListener('click', async () => {
    // Dynamically import loading.js and trigger the analysis
    const { runAnalysis } = await import('./loading.js');
    runAnalysis();
  });
}


// ── DATA FETCHING ────────────────────────────────────────────────────────

/**
 * Fetch races from the API. Falls back to filtered RACES_2023 demo data
 * if the backend is unreachable.
 */
async function fetchRaces(year, circuitType, search) {
  try {
    const query = new URLSearchParams({
      circuit_type: circuitType,
      search:       search,
    });
    const races = await apiGet(`/seasons/${year}/races?${query}`);
    setState({ apiOnline: true });
    return races;
  } catch {
    setState({ apiOnline: false });
    // Filter demo data to match active filters
    return RACES_2023.filter(r => {
      if (circuitType !== 'all' && r.type !== circuitType) return false;
      if (search && !r.name.toLowerCase().includes(search.toLowerCase()) &&
                    !r.circuit.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    }).map(r => ({ ...r, sessions: ['FP1','FP2','FP3','Q3','R'] }));
  }
}
