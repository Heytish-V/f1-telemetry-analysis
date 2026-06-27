@echo off
echo =========================================
echo      Starting Plan E - F1 Telemetry
echo =========================================

echo.
echo Starting Backend (FastAPI)...
start "PlanE Backend" cmd /k "cd PlanE-backend && if exist .venv\Scripts\python.exe (.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000) else (echo WARNING: No .venv found! Please set one up first. & pause & exit)"

echo.
echo Starting Frontend (Vanilla JS)...
start "PlanE Frontend" cmd /k "cd PlanE-frontend && python dev_server.py"

echo.
echo Both servers have been started in separate windows!
echo Wait a moment for the servers to initialize.
echo You can close this window now.
pause
