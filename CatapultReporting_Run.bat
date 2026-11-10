@echo off
start "Backend" /min cmd /k "cd /d "%~dp0backend" && .venv\Scripts\activate && uvicorn app.main:app --reload --port 8000"
start "Frontend" /min cmd /k "cd /d "%~dp0frontend" && npm run dev"
