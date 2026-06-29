# 🏎️ Plan E: F1 Telemetry Analysis Engine

## Project Overview
**Plan E** is a high-performance telemetry analysis engine that answers a simple question: *exactly where and how did one F1 driver gain time over another?* 

Instead of just telling you who was faster, this tool compares telemetry lap-by-lap, isolating braking points, corner entry speeds, and throttle applications. Built with a decoupled Python backend and a lightning-fast Vanilla JS frontend, Plan E is designed to crunch heavy F1 datasets asynchronously and visualize the results instantly without locking up your browser. 

![Plan E Landing Page - Diagnose Every Tenth](./assets/landing.png)

---

## ✨ Key Features
- **Spatial Track Comparison:** F1 data is time-based, but to compare two drivers accurately, Plan E mathematically aligns their telemetry onto a standardized 1,000-point physical track distance array.
- **Asynchronous Heavy Lifting:** A decoupled architecture using FastAPI and Celery means the heavy number crunching happens in the background, keeping the UI snappy.
- **The Telemetry Scrubber:** A core UI interaction that lets you scrub across the track and instantaneously view Speed, Gear, Brake, and Throttle readouts for both drivers simultaneously.
- **Vanilla JS Performance:** The entire frontend is built without React, Vue, or heavy dependencies. It manipulates the DOM and SVGs directly for absolute maximum performance.
- **Heuristic Insights:** Plan E detects statistical anomalies (like late braking or early throttle application) and generates human-readable insights to explain the data.

---

## 🏗️ Architecture Overview

The system is split into three main pieces working in harmony:

1. **Root Scripts:** Convenience batch files to spin up the local environment painlessly.
2. **The Backend (`PlanE-backend/`):** The data acquisition and math engine. 
3. **The Frontend (`PlanE-frontend/`):** The visual dashboard.

**The Decoupled Job Queue Pattern:** 
Crunching F1 data takes time. If the backend processed this synchronously, your browser would hang waiting for an HTTP response. Instead, when the frontend asks for an analysis, the FastAPI server immediately returns a `job_id`. A background **Celery worker** picks up this job and does the heavy lifting (fetching FastF1 data, interpolating arrays via SciPy, calculating deltas). Meanwhile, the frontend polls the server for progress updates and only transitions to the dashboard when the JSON payload is ready. This means instant UI responsiveness and massive scalability!

---

## 📂 Project Structure

Here is how the codebase is organized:

### 0. Root Scripts
- `start.bat`: The main launch script! It opens two terminal windows—one boots the FastAPI backend, the other spins up the Vanilla JS dev server.
- `clear_cache.bat`: A handy utility to flush local caches if telemetry data gets corrupted.

### 1. The Backend (`PlanE-backend/`)
- **`main.py`**: The FastAPI entry point. It sets up routes and dispatches analysis requests to the Celery queue.
- **`models.py`**: SQLAlchemy ORM definitions (SQLite) and strict Pydantic schemas validating our API payloads.
- **`data_sources.py`**: The bridge to external F1 APIs. It fetches telemetry via `FastF1` and driver metadata via `OpenF1`, heavily caching data locally.
- **`preloader.py`**: An automated script that polls the F1 calendar and pre-downloads completed sessions to keep the cache warm.
- **`analysis_engine.py`**: The mathematical core! It uses `scipy` to interpolate time-based F1 data onto our 1,000-point spatial grid, calculates exact time deltas, filters out anomalous laps, and generates heuristic insights.
- **`tasks.py`**: The Celery worker. Listens for `job_id`s, executes the `analysis_engine.py` logic, and saves the final JSON payload to SQLite.
- **`database.py` & `config.py`**: SQLite connection pooling and environment variable management.

### 2. The Frontend (`PlanE-frontend/`)
- **`index.html`**: The static DOM shell containing hidden/visible page containers and raw SVG definitions.
- **`js/state.js`**: Home to the `AppState` singleton. This is our single source of truth, enforcing strict one-way data flow so components don't randomly scrape the DOM for state.
- **`js/api.js` & `js/router.js`**: Wrappers for standard `fetch()` calls and a minimal view controller for transitioning between UI states.
- **`pages/`**: 
  - `selector.js`: The setup wizard logic (Year -> Race -> Driver A vs Driver B).
  - `loading.js`: Handles the `/status` polling loop and animates the progress bar while Celery works.
  - `analysis.js`: The master dashboard controller managing the "Casual vs Analyst" toggle and the global Telemetry Scrubber.
- **`components/`**: 
  - Visualizations like `deltaChart.js`, `trackMap.js`, `speedChart.js`, and `waterfallChart.js`. These scripts pull directly from the `AppState` and manipulate SVGs to draw the charts.

---

## 🛠️ Tech Stack

- **FastAPI:** High-performance async Python web framework for routing.
- **Celery & Redis:** Background task queue and message broker for offloading heavy math.
- **SQLite & SQLAlchemy:** Local database and ORM for tracking job statuses and caching.
- **SciPy:** Used for 1-D mathematical interpolation of telemetry arrays.
- **FastF1 & OpenF1:** External data sources for official F1 lap times and telemetry.
- **Vanilla JavaScript:** Dependency-free frontend for extreme DOM performance.

---

## 🚀 Getting Started

Setting up Plan E locally is super straightforward. 

1. **Clone the repository.**
2. **Install Python dependencies** in a virtual environment inside `PlanE-backend/`.
3. **Set up your environment variables** by copying `.env.example` to `.env` (make sure you have a Redis instance running if you're testing Celery locally!).
4. **Run `start.bat`** (Windows). This script does the magic for you: it launches the FastAPI server on port 8000 and the frontend Python `dev_server.py` simultaneously. 

*Need to wipe your data? Just run `clear_cache.bat` to flush the FastF1 cache.*

---

## 🏎️ How It Works: A User's Journey

![Driver Selection Wizard](./assets/driver-selection.png)

1. **Selecting the Combatants:** You start at the Selector page. When you pick a year and race, `pages/selector.js` hits our FastAPI metadata endpoints. Once you pick a session, it fetches the drivers that participated. 
2. **Submitting the Job:** You click "Run Analysis". The frontend POSTs to `/api/analysis`. The backend immediately returns a `job_id`, and `pages/loading.js` starts a polling loop to track progress. 
3. **The Heavy Lifting:** In the background, `tasks.py` (Celery) picks up the job. It asks `data_sources.py` for the telemetry, and feeds it to `analysis_engine.py` which aligns the data to our 1,000-point spatial grid.
4. **The Dashboard:** Once the backend marks the job as `COMPLETED`, the frontend transitions to the Analysis view. `pages/analysis.js` takes the massive JSON payload, saves it to the `AppState` singleton (`js/state.js`), and distributes the arrays to components like `deltaChart.js` and `trackMap.js`.
5. **Scrubbing the Data:** You grab the Telemetry Scrubber at the bottom of the screen. As you drag, `analysis.js` updates the global index (0-999), instantly updating the live speed and gear readouts for both drivers at that exact meter on the track!

![Analysis Dashboard and Telemetry Scrubber](./assets/dashboard.png)

---

## 👨‍💻 Development & Contribution

Want to add features? Here are a few architectural rules of thumb:
- **Keep it Decoupled:** Never make the FastAPI server wait for data processing. Always dispatch to Celery and poll.
- **Respect the Grid:** If you add new data channels (like steering angle) in `analysis_engine.py`, ensure they are properly interpolated across the 1,000-point spatial array using `scipy.interpolate.interp1d`. Time-based arrays will break the frontend charts!
- **State is Sacred:** On the frontend, never read data from a DOM element (e.g., `document.getElementById('driver').innerText`). Always get it from `AppState.getState()` in `js/state.js`.

## 🔮 Future Improvements
- **Live Timing Integration:** Hooking into live race webhooks instead of just historical sessions.
- **Dockerization:** Adding a `docker-compose.yml` to spin up Redis, the backend, and the frontend in one command without needing `start.bat`.
- **More Telemetry Channels:** Integrating tire wear models or steering angle data if they become available via FastF1.

---
*Built for the love of data and racing.*
