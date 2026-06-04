# Plan E - F1 Telemetry Analytics

**Plan E** (formerly PitWall) is a full-stack web application designed for deep, lap-by-lap Formula 1 driver telemetry comparisons. It isolates exactly where and how time is gained or lost across braking, corner entry, apex, and exit using official FastF1 data.

This project consists of two main components:
1. **PlanE-backend**: A Python FastAPI backend with a Celery worker pool for heavy data crunching and telemetry alignment.
2. **PlanE-frontend**: A highly optimized, dependency-free Vanilla JS Single Page Application (SPA) for dynamic SVG-based data visualization.

---

## 🚀 Quick Start

### 1. Start the Backend
The backend requires Python 3.10+ and a local Redis server (if using Celery).

```bash
cd PlanE-backend
python -m venv .venv
# Activate the virtual environment:
# Windows: .\.venv\Scripts\activate
# Mac/Linux: source .venv/bin/activate
pip install -r requirements.txt

# Start the FastAPI server
python -m uvicorn main:app --reload --port 8000
```

### 2. Start the Frontend
The frontend requires no build steps (no npm, no Webpack). Just serve it!

```bash
cd PlanE-frontend
python dev_server.py
# Or use any local web server: npx http-server, python -m http.server 8080, etc.
```

Visit `http://localhost:8080` in your browser.

---

## 🏗️ Architecture Overview

### Backend (`PlanE-backend/`)
Built on FastAPI and Celery to handle heavy telemetry processing asynchronously.

- **Data Acquisition (`data_sources.py`)**: Fetches raw data from the official `FastF1` and `OpenF1` APIs. Heavily caches data using DuckDB/Parquet to prevent redundant network requests.
- **Analysis Engine (`analysis_engine.py`)**: 
  - **Distance-Grid Alignment**: Uses `scipy.interpolate.interp1d` to spatially align two different drivers onto a standardized 1,000-point track array.
  - **Cumulative Delta**: Reconstructs the exact time difference purely from spatial velocity (`Δt = Σ(ds / v)`).
  - **Heuristic Detectors**: Programmatically identifies "Insights" (e.g., late braking, early throttle application, exit speed advantages) by mathematically comparing the aligned arrays.

### Frontend (`PlanE-frontend/`)
A bespoke Vanilla JS architecture designed for maximum performance and direct DOM control.

- **State Management (`js/state.js`)**: A centralized mutable singleton that holds the UI state, enforcing a strict one-way data flow.
- **Routing & API (`js/router.js`, `js/api.js`)**: Handles DOM swapping between hidden containers and manages the API polling for asynchronous background jobs.
- **Visualization Components (`components/`)**:
  - **`deltaChart.js` & `trackMap.js`**: Renders the cumulative delta path and draws the 2D circuit map. Synchronizes with a global Telemetry Scrubber to pinpoint the exact location on track.
  - **Overlay Charts**: Dynamically scales and plots Speed, Throttle, Brake, and Gear arrays for both drivers.
  - **Insight Drill-Down**: Interactive panels that switch between "Casual" narratives and "Analyst" statistical tables based on the user's preference mode.

---

## 📅 Supported Seasons
**2018 through 2026**
The backend dynamically fetches session calendars and driver lists. Note that historical data availability is dependent on the FastF1 / Ergast upstream APIs.

---

## 📜 License
MIT License. Data is provided for non-commercial, analytical purposes via the FastF1 library.
