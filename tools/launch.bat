@echo off
rem Starts the tracker without a console window (same as the desktop shortcut).
start "" /D "%~dp0..\backend" "%~dp0..\backend\.venv\Scripts\pythonw.exe" -m app
