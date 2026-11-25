@echo off
rem Starts Divine Pulse from the source checkout on Windows, after tools\setup.bat (the same checks as tools/launch.sh).
rem Without a console window, as the desktop shortcut starts it.
if not exist "%~dp0..\backend\.venv\Scripts\pythonw.exe" (
    echo Divine Pulse isn't set up yet: run tools\setup.bat first.
    pause
    exit /b 1
)
if not exist "%~dp0..\frontend\dist\index.html" (
    echo The frontend isn't built: run tools\setup.bat again.
    pause
    exit /b 1
)
start "" /D "%~dp0..\backend" "%~dp0..\backend\.venv\Scripts\pythonw.exe" -m app %*
