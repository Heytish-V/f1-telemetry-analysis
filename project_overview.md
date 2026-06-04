# Plan E F1 Telemetry Project Overview (In-Depth)

This document provides a comprehensive technical breakdown of the **Plan E** architecture. The project consists of a Python FastAPI/Celery backend for heavy data crunching and a Vanilla JavaScript Single Page Application (SPA) for the frontend visualization.

---

## 1. Backend (`PlanE-backend/`)

The backend is built around a decoupled architecture where the API server handles requests instantly, while heavy telemetry processing is offloaded to background workers.

### API & Routing Layer
- **`main.py`**
  The FastAPI entry point. It configures CORS and sets up the database connection on startup.
  - Exposes metadata endpoints: `/api/seasons`, `/api/seasons/{year}/races`, `/api/seasons/{year}/races/{round_num}/drivers`. These endpoints validate input parameters (using Pydantic `Field` bounds, e.g., year up to 2026) and query the SQLite database.
  - The `/api/analysis` endpoint takes an `AnalysisRequest`, generates a unique cache key, creates an `AnalysisJobORM` record with a `PENDING` status, and dispatches a Celery task (`run_analysis_task.delay()`). It immediately returns a `job_id` and a polling URL to the client.

- **`models.py`**
  The unified data definition layer.
  - **SQLAlchemy ORM**: Defines `RaceORM`, `DriverORM`, and `AnalysisJobORM` for SQLite storage. The `AnalysisJobORM` tracks the task lifecycle (`status`, `progress`, `error`) and stores the final JSON payload.
  - **Pydantic API Schemas**: Validates incoming data (e.g., ensuring `driver_a` and `driver_b` are different) and defines the rigorous structure for the final output (`AnalysisResult`, `ChartData`, `Insight`, `MiniTrace`).

### Data Acquisition Layer
- **`data_sources.py`**
  The bridge between external F1 APIs and the internal engine.
  - Uses the `FastF1` library to download official F1 telemetry, lap timings, and weather data. 
  - Interfaces with the `OpenF1` API as a fallback to resolve driver codes (e.g., "VER") to names, teams, and car numbers.
  - Handles caching: To avoid hitting FastF1's servers redundantly, it configures a local filesystem cache (sometimes leveraging Parquet/DuckDB structures).

### Analytics & Data Science Layer
- **`analysis_engine.py`**
  The core of the project. F1 telemetry is recorded chronologically, but cars traverse the track at different speeds. To compare two drivers, their data must be aligned spatially.
  - **Distance-Grid Alignment**: Uses `scipy.interpolate.interp1d` to resample both drivers' telemetry channels (Speed, Throttle, Brake, Gear, X/Y coordinates) onto a standardized 1,000-point track distance array.
  - **Cumulative Delta Time Calculation**: Reconstructs the time difference purely from spatial velocity. By calculating the time taken to cross each micro-segment `Δt = Σ(ds / v)`, it generates the exact cumulative delta array.
  - **Ensemble Lap Selection**: Filters out in-laps, out-laps, and anomalously slow laps. It selects 3–5 "representative laps" per driver and averages them to ensure the insights aren't skewed by a single lock-up or traffic.
  - **Heuristic Detectors**: Scans the aligned arrays to pinpoint areas where one driver gained significant time. 
    - *Late Braking*: Finds points where Brake > 0% and compares the distance of application.
    - *Exit Speed*: Looks at the minimum speed at the apex and the rate of acceleration out of the corner.
    - *Throttle Ramp*: Measures how aggressively a driver applies the throttle (e.g., 38% vs 30% per 100m).
  - Translates these statistical anomalies into structured `Insight` objects, complete with confidence scores and dual-audience text (casual narratives vs. hard statistical data).

### Background Processing & Infrastructure
- **`tasks.py`**
  The Celery worker module. It receives the `job_id`, updates the database status to `RUNNING`, fetches the data via `data_sources.py`, and feeds it into `analysis_engine.py`. Upon completion, it serializes the `AnalysisResult` Pydantic model into a JSON string and saves it back to the database, marking the job as `COMPLETED`.
- **`database.py`** & **`config.py`**
  Manages the synchronous SQLite engine (`pitwall.db`) connection pool and loads environment variables (like the Redis broker URL for Celery).

---

## 2. Frontend (`PlanE-frontend/`)

The frontend is a bespoke, dependency-free Vanilla JS architecture designed for maximum performance and explicit DOM control.

### Core Architecture
- **`index.html`**
  The static DOM shell. Instead of loading new pages, the application transitions between hidden/visible `<div>` containers (`#page-landing`, `#page-selector`, `#page-analysis`). It contains the raw SVG definitions for the landing page teaser and all the chart containers.
- **`js/state.js`**
  A centralized, mutable singleton (`AppState`) that holds the entire UI state (e.g., `currentYear`, `selectedDriverA`, `currentAnalysis` JSON payload). It exposes `getState()` and `setState()` functions. This strictly enforces a one-way data flow and prevents components from querying the DOM for state.
- **`js/api.js`**
  Provides `apiGet` and `apiPost`. It prefixes logs with `[PLAN E]`, handles `fetch()` execution, throws detailed errors for non-200 responses, and reads the API Base URL from `localStorage` to allow easy local debugging.
- **`js/router.js`**
  A minimal routing engine that listens to UI events and toggles the `.active` class on the top-level page containers.

### Orchestration & Polling
- **`pages/selector.js`**
  Manages the multi-step selection funnel. When the user selects a year (e.g., 2026), it fetches the races. Clicking a session pill triggers a dynamic fetch of the drivers who actually participated in *that specific session*. It handles the complex logic of allowing the user to pick exactly two drivers before enabling the "Run Analysis" button.
- **`pages/loading.js`**
  Takes over when "Run Analysis" is clicked. It sends the POST request to `/api/analysis` and begins a recursive `setTimeout` loop, polling the returned `/api/analysis/{job_id}/status` URL. It parses the `progress` float from the backend to animate the loading bar, finally triggering the router to switch to the dashboard when status is `COMPLETED`.
- **`pages/analysis.js`**
  The master controller for the dashboard. It receives the massive JSON payload and distributes it. It also manages the global **"Casual vs Analyst" mode toggle** (showing/hiding advanced metrics) and binds the global **Telemetry Scrubber**. When the user drags the scrubber, this module reads the 0-999 index and simultaneously updates the readouts (SPD, THR, BRK, GEAR) for both drivers by looking up the arrays in `ChartData`.

### Visualization Components (`components/`)
These modules consume arrays from the `ChartData` object and manipulate the DOM/SVG elements directly.
- **`deltaChart.js`**
  Draws the primary Cumulative Delta line. It maps the 1,000-point delta array onto an SVG path, applying gradient fills based on whether the delta is positive (Driver A ahead) or negative (Driver B ahead). It also parses the `Insight` objects and overlays clickable dots at the exact distance where an insight occurred.
- **`trackMap.js`**
  Renders the 2D layout of the circuit using the `x_a` and `y_a` coordinate arrays. It places a moving indicator dot that subscribes to the Telemetry Scrubber index, allowing the user to see exactly where on the track a specific delta was gained.
- **`speedChart.js`, `throttleChart.js`, `brakeChart.js`, `gearChart.js`**
  These components generate overlay line charts comparing Driver A and Driver B. They calculate the min/max bounds of the data to dynamically scale the Y-axis (e.g., 0-350 km/h for speed, 0-8 for gear) and plot the arrays across the X-axis (track distance).
- **`waterfallChart.js`**
  Visualizes the sector-by-sector time differences as a classic waterfall chart, making it easy to see which sector contributed most to the overall lap time gap.
- **`lapSummary.js` & `insightList.js`**
  Dynamically generates HTML fragments to display text data. `insightList.js` populates the right-hand "Drill-Down" panel when an insight is clicked, formatting the statistical arrays (`conf`, `laps`, `stats`) into clean tables or casual sentences based on the active UI mode.
