@echo off
REM Start Video Subtitle Remover API (Windows)

echo ========================================
echo Video Subtitle Remover Server
echo ========================================

cd /d "%~dp0"

if not exist "tools\video-subtitle-remover\backend\main.py" (
    echo.
    echo ERROR: video-subtitle-remover is not installed.
    echo Please run setup-vsr.bat first.
    echo.
    pause
    exit /b 1
)

if not exist "vsr-env\Scripts\activate.bat" (
    echo.
    echo ERROR: vsr-env not found.
    echo Please run setup-vsr.bat first.
    echo.
    pause
    exit /b 1
)

set VSR_ROOT=%CD%\tools\video-subtitle-remover
set VSR_PORT=8101

echo Using VSR_ROOT: %VSR_ROOT%
echo Starting API on http://localhost:%VSR_PORT%
echo Press Ctrl+C to stop
echo.

call vsr-env\Scripts\activate.bat
python server\python\subtitle-remover\app.py
