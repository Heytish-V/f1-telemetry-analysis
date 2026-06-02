# PitWall Backend

FastAPI backend for `f1-telemetry.html`. It serves race/session filters, driver lists, async telemetry analysis jobs, insight drill-downs, and CSV/JSON/PDF exports.

## Setup

```powershell
cd pitwall-backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Start Redis locally, then run:

```powershell
uvicorn main:app --reload --port 8000
celery -A tasks.celery_app worker --loglevel=info --pool=solo
```

The database is initialized at startup. FASTF1 uses `FASTF1_CACHE_DIR`; OpenF1 and Ergast/Jolpica do not require API keys. Set `USE_LIVE_DATA=false` for deterministic local fallback data.

## Frontend Mapping

`filterYear`, `filterSession`, `filterCircuit`, and search:
`GET /api/seasons/{year}/races?session_type=all|FP|Q|R|S&circuit_type=all|street|high-speed|technical&search=monaco`

`selectRace` session pills:
`GET /api/seasons/{year}/races/{round_num}/sessions`

`renderDriverGrid`:
`GET /api/seasons/{year}/races/{round_num}/drivers?session=Q3`

`runAnalysis` compare button:
`POST /api/analysis`

Loader polling:
`GET /api/analysis/{job_id}`

`selectInsight` drill-down:
`GET /api/analysis/{job_id}/insights/{insight_id}`

`showExport`:
`GET /api/analysis/{job_id}/exports/csv`
`GET /api/analysis/{job_id}/exports/json`
`GET /api/analysis/{job_id}/exports/pdf?mode=casual|analyst`

## API Contract

### `GET /api/seasons`

Response `200`:

```json
[2018, 2019, 2020, 2021, 2022, 2023, 2024]
```

### `GET /api/seasons/{year}/races`

Query parameters:

```json
{
  "session_type": "all",
  "circuit_type": "street",
  "search": "Monaco"
}
```

Response `200`:

```json
[
  {
    "round": 6,
    "name": "Monaco GP",
    "circuit": "Circuit de Monaco",
    "date": "28 May",
    "type": "street",
    "flag": "MC",
    "sessions": ["FP1", "FP2", "FP3", "Q3", "R"]
  }
]
```

Errors: `422` unsupported year/filter.

### `GET /api/seasons/{year}/races/{round_num}/sessions`

Response `200`:

```json
["FP1", "FP2", "FP3", "Q3", "R"]
```

Errors: `404` race not found.

### `GET /api/seasons/{year}/drivers`

Response `200`:

```json
[
  {"code": "VER", "num": 1, "name": "Max Verstappen", "team": "Red Bull Racing", "color": "#3B9EFF"}
]
```

### `GET /api/seasons/{year}/races/{round_num}/drivers`

Query parameters:

```json
{"session": "Q3"}
```

Response is the same driver-card list as `/drivers`.

### `POST /api/analysis`

Request:

```json
{
  "year": 2023,
  "round": 6,
  "session": "Q3",
  "driver_a": "VER",
  "driver_b": "HAM",
  "force_refresh": false
}
```

Response `202`:

```json
{
  "job_id": "uuid",
  "status": "PENDING",
  "cached": false,
  "poll_url": "/api/analysis/uuid"
}
```

Errors: `400` unavailable session, `404` race/driver not found, `422` invalid body.

### `GET /api/analysis/{job_id}`

Response while running:

```json
{
  "job_id": "uuid",
  "status": "RUNNING",
  "request": {"year": 2023, "round": 6, "session": "Q3", "driver_a": "VER", "driver_b": "HAM", "force_refresh": false},
  "sectors": [],
  "insights": [],
  "error": null
}
```

Response when complete:

```json
{
  "job_id": "uuid",
  "status": "COMPLETED",
  "race": {"round": 6, "name": "Monaco GP", "circuit": "Circuit de Monaco", "date": "28 May", "type": "street", "flag": "MC", "sessions": ["FP1", "FP2", "FP3", "Q3", "R"]},
  "driver_a": {"code": "VER", "num": 1, "name": "Max Verstappen", "team": "Red Bull Racing", "color": "#3B9EFF"},
  "driver_b": {"code": "HAM", "num": 44, "name": "Lewis Hamilton", "team": "Mercedes", "color": "#00C2A0"},
  "lap_summary": {
    "lap_a": "1:11.365",
    "lap_b": "1:11.449",
    "delta": "+0.084",
    "representative_laps_a": [3, 5, 7],
    "representative_laps_b": [2, 4, 6],
    "total_delta_seconds": 0.084
  },
  "sectors": [{"label": "S1", "delta": 0.08, "winner": "A"}],
  "insights": [
    {
      "id": 0,
      "sector": 1,
      "corner": "T4",
      "cat": "Braking",
      "catFull": "Late braking point",
      "timeA": 0.083,
      "driverGain": "VER",
      "casual": "VER braked 8.3m later into Turn 4",
      "detail": "Brake point delta 8.3m...",
      "dist": "0.200 - 0.250",
      "conf": 0.87,
      "laps": "4/5",
      "stats": [["Brake point delta", "8.3m VER"]],
      "mini_trace": {"distance": [0], "driver_a": [1], "driver_b": [0], "channel": "brake"},
      "channel_stats": {"mean_delta": 0.02}
    }
  ],
  "charts": {
    "distance": [0.0],
    "delta": [0.0],
    "speed_a": [250.0],
    "speed_b": [248.0],
    "throttle_a": [80.0],
    "throttle_b": [77.0],
    "brake_a": [0.0],
    "brake_b": [0.0],
    "gear_a": [6.0],
    "gear_b": [6.0],
    "waterfall": [{"label": "T1", "delta": 0.012, "winner": "A", "start_distance": 0.0, "end_distance": 300.0}]
  }
}
```

Errors: `404` job not found.

### `GET /api/analysis/{job_id}/insights/{insight_id}`

Response `200`: one insight object from the completed result. Errors: `404`.

### `GET /api/analysis/{job_id}/exports/{csv|json|pdf}`

Headers: no auth headers required.

Responses:

`csv`: `text/csv` telemetry columns.
`json`: `application/json` full insight bundle.
`pdf`: `application/pdf` report, `mode=casual|analyst`.

Errors: `404` job/artifact not found, `409` analysis incomplete.

### `DELETE /api/analysis/{job_id}`

Deletes the parquet artifact and marks the job deleted. Response `204`.
