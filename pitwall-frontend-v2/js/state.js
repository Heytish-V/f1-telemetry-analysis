/**
 * state.js
 * ────────
 * Single source of truth for the entire application.
 *
 * DESIGN PRINCIPLES:
 * 1. No DOM access here — this module knows nothing about HTML elements.
 * 2. No fetch calls here — api.js handles all network requests.
 * 3. All state is stored in ONE object (AppState) so any module can
 *    import getState() and read what it needs.
 * 4. All writes go through setState() — one place to add debugging.
 *
 * HOW TO USE:
 *   import { getState, setState } from '../js/state.js';
 *   const { selectedRace } = getState();
 *   setState({ selectedSession: 'Q3' });
 */

// ── FALLBACK DEMO DATA ───────────────────────────────────────────────────
//
// These constants are used when the backend is unreachable.
// They mirror the original f1-telemetry.html demo data exactly.
// Exported so selector.js and analysis.js can use them as fallbacks.

export const RACES_2023 = [
  { round:1,  name:'Bahrain GP',       circuit:'Bahrain Intl Circuit',     date:'5 Mar',  type:'high-speed', flag:'🇧🇭', sessions:['FP1','FP2','FP3','Q3','R'] },
  { round:2,  name:'Saudi Arabian GP', circuit:'Jeddah Corniche',          date:'19 Mar', type:'street',     flag:'🇸🇦', sessions:['FP1','FP2','FP3','Q3','R'] },
  { round:3,  name:'Australian GP',   circuit:'Albert Park',              date:'2 Apr',  type:'street',     flag:'🇦🇺', sessions:['FP1','FP2','FP3','Q3','R'] },
  { round:4,  name:'Azerbaijan GP',   circuit:'Baku City Circuit',        date:'30 Apr', type:'street',     flag:'🇦🇿', sessions:['FP1','FP2','FP3','Q3','R'] },
  { round:5,  name:'Miami GP',        circuit:'Miami Intl Autodrome',     date:'7 May',  type:'street',     flag:'🇺🇸', sessions:['FP1','FP2','FP3','Q3','R'] },
  { round:6,  name:'Monaco GP',       circuit:'Circuit de Monaco',        date:'28 May', type:'street',     flag:'🇲🇨', sessions:['FP1','FP2','FP3','Q3','R'] },
  { round:7,  name:'Spanish GP',      circuit:'Circuit de Barcelona',     date:'4 Jun',  type:'technical',  flag:'🇪🇸', sessions:['FP1','FP2','FP3','Q3','R'] },
  { round:8,  name:'Canadian GP',     circuit:'Circuit Gilles Villeneuve',date:'18 Jun', type:'street',     flag:'🇨🇦', sessions:['FP1','FP2','FP3','Q3','R'] },
  { round:9,  name:'Austrian GP',     circuit:'Red Bull Ring',            date:'2 Jul',  type:'high-speed', flag:'🇦🇹', sessions:['FP1','FP2','FP3','Q3','R'] },
  { round:10, name:'British GP',      circuit:'Silverstone',              date:'9 Jul',  type:'high-speed', flag:'🇬🇧', sessions:['FP1','FP2','FP3','Q3','R'] },
  { round:11, name:'Hungarian GP',    circuit:'Hungaroring',              date:'23 Jul', type:'technical',  flag:'🇭🇺', sessions:['FP1','FP2','FP3','Q3','R'] },
  { round:12, name:'Belgian GP',      circuit:'Spa-Francorchamps',        date:'30 Jul', type:'high-speed', flag:'🇧🇪', sessions:['FP1','FP2','FP3','Q3','R'] },
];

export const DRIVERS_2023 = [
  { code:'VER', num:1,  name:'Max Verstappen',    team:'Red Bull Racing', color:'#3B9EFF' },
  { code:'PER', num:11, name:'Sergio Perez',       team:'Red Bull Racing', color:'#3B9EFF' },
  { code:'HAM', num:44, name:'Lewis Hamilton',     team:'Mercedes',        color:'#00C2A0' },
  { code:'RUS', num:63, name:'George Russell',     team:'Mercedes',        color:'#00C2A0' },
  { code:'LEC', num:16, name:'Charles Leclerc',    team:'Ferrari',         color:'#E8331A' },
  { code:'SAI', num:55, name:'Carlos Sainz',       team:'Ferrari',         color:'#E8331A' },
  { code:'NOR', num:4,  name:'Lando Norris',       team:'McLaren',         color:'#F0A818' },
  { code:'PIA', num:81, name:'Oscar Piastri',      team:'McLaren',         color:'#F0A818' },
  { code:'ALO', num:14, name:'Fernando Alonso',    team:'Aston Martin',    color:'#38A169' },
  { code:'STR', num:18, name:'Lance Stroll',       team:'Aston Martin',    color:'#38A169' },
];

// Demo insight data — used when no live analysis result is available
export const DEMO_INSIGHTS = [
  { id:0, sector:1, corner:'T4',  cat:'Braking',    catFull:'Late braking point',
    timeA: 0.083, driverGain:'VER',
    casual:'Braked 8m later — sharp gain into Turn 4',
    detail:'Brake point delta 8.3m · Peak decel 5.1g vs 4.8g · Min speed 178 vs 181 km/h',
    dist:'0.213 – 0.241', conf:0.87, laps:'4/5',
    stats:[['Brake point delta','+8.3m VER'],['Min speed','178 vs 181 km/h'],['Peak decel','5.1g vs 4.8g'],['Δt contribution','+0.083s VER']] },
  { id:1, sector:2, corner:'T8',  cat:'Exit Speed',  catFull:'Corner exit speed',
    timeA:-0.051, driverGain:'HAM',
    casual:'Higher corner exit speed through Turn 8',
    detail:'Exit speed +4.2 km/h HAM · Throttle 5.1m earlier · Traction zone 22 vs 28m',
    dist:'0.428 – 0.461', conf:0.82, laps:'4/5',
    stats:[['Exit speed delta','+4.2 km/h HAM'],['Throttle point','+5.1m HAM earlier'],['Traction zone','22m vs 28m'],['Δt contribution','+0.051s HAM']] },
  { id:2, sector:2, corner:'T11', cat:'Trail Brake', catFull:'Trail braking overlap',
    timeA: 0.034, driverGain:'VER',
    casual:'Sharper trail braking maintained steering angle',
    detail:'Trail brake overlap +18m · Steering at brake 28° vs 21° · Min speed 142 vs 138',
    dist:'0.541 – 0.573', conf:0.74, laps:'3/5',
    stats:[['Trail brake overlap','+18m VER'],['Steering at brake','28° vs 21°'],['Min speed','142 vs 138 km/h'],['Δt contribution','+0.034s VER']] },
  { id:3, sector:3, corner:'T15', cat:'Traction',    catFull:'Traction zone ramp rate',
    timeA: 0.028, driverGain:'VER',
    casual:'Earlier full throttle application after T15 apex',
    detail:'Full throttle +6.1m earlier · Exit speed +3.1 km/h · Ramp rate 38%/100m vs 30%',
    dist:'0.761 – 0.789', conf:0.79, laps:'4/5',
    stats:[['Full throttle pt','+6.1m VER earlier'],['Exit speed','+3.1 km/h VER'],['Ramp rate','38% vs 30%/100m'],['Δt contribution','+0.028s VER']] },
  { id:4, sector:2, corner:'DRS', cat:'DRS',         catFull:'DRS efficiency zone',
    timeA:-0.018, driverGain:'HAM',
    casual:'DRS activation yielded higher top speed for HAM',
    detail:'Top speed +1.8 km/h HAM · Activation point identical · Low sample variation',
    dist:'0.332 – 0.378', conf:0.91, laps:'5/5',
    stats:[['Top speed delta','+1.8 km/h HAM'],['DRS activation','Identical point'],['Straight gain','+0.018s HAM'],['Sample quality','High (5/5 laps)']] },
];

export const DEMO_SECTORS = [
  { label:'S1', delta: 0.08, winner:'A' },
  { label:'S2', delta:-0.15, winner:'B' },
  { label:'S3', delta: 0.05, winner:'A' },
];


// ── APPLICATION STATE ────────────────────────────────────────────────────

/**
 * AppState — the single source of truth.
 *
 * This object is private to this module. External code always reads
 * a snapshot via getState() and writes via setState(patch).
 *
 * Keeping it private prevents accidental direct mutation from other modules,
 * which would make bugs very hard to track.
 */
const AppState = {
  // ── Navigation ──────────────────────────────────────────────────────
  currentPage: 'landing',

  // ── Session Selector filters ─────────────────────────────────────────
  currentYear:          2026,
  currentCircuitFilter: 'all',
  currentSearch:        '',

  // ── Data from API ────────────────────────────────────────────────────
  currentRaces:   [],   // Race[] as returned by /api/seasons/{year}/races
  currentDrivers: [],   // Driver[] as returned by /api/seasons/{year}/races/{round}/drivers

  // ── User Selection ───────────────────────────────────────────────────
  selectedRace:    null,   // { round, name, circuit, date, sessions[], flag, type }
  selectedSession: 'Q3',
  selectedDriverA: null,   // { code, num, name, team, color }
  selectedDriverB: null,

  // ── Analysis Job ─────────────────────────────────────────────────────
  currentJobId:    null,   // string job_id from POST /api/analysis
  currentAnalysis: null,   // Full AnalysisResult object from GET /api/analysis/{job_id}

  // ── UI State ─────────────────────────────────────────────────────────
  analysisMode:  'casual', // 'casual' | 'analyst'
  activeInsight: null,     // insight id (number) or null

  // ── API health ───────────────────────────────────────────────────────
  apiOnline: true,
};


// ── STATE ACCESSORS ──────────────────────────────────────────────────────

/**
 * Returns a shallow copy of the current state.
 * Shallow copy prevents accidental mutation of nested objects — for deep
 * state like currentAnalysis, treat the object as read-only.
 */
export function getState() {
  return { ...AppState };
}

/**
 * Merge a partial update into AppState.
 * Only the keys present in `patch` are updated.
 *
 * Example:
 *   setState({ selectedRace: raceObj, selectedSession: 'Q3' });
 */
export function setState(patch) {
  Object.assign(AppState, patch);
}

/**
 * Reset all selection state (used when the user changes the year filter
 * or navigates back to the selector).
 */
export function resetSelection() {
  setState({
    selectedRace:    null,
    selectedSession: 'Q3',
    selectedDriverA: null,
    selectedDriverB: null,
  });
}
