@echo off
start "Backend Install" cmd /c "cd /d "%~dp0..\backend" && python -m venv .venv && .venv\Scripts\activate.bat && pip install -r requirements.txt"
start "Frontend Install" cmd /c "cd /d "%~dp0..\frontend" && npm install"
