@echo off
rem Starts the tracker without a console window (same as the desktop shortcut).
start "" /D "%~dp0backend" "%~dp0backend\.venv\Scripts\pythonw.exe" -m app
