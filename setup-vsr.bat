@echo off
REM ============================================================================
REM Chuhai Bang - Video Subtitle Remover (VSR) Setup (Windows)
REM Clones video-subtitle-remover and installs dependencies into vsr-env
REM ============================================================================

echo.
echo ========================================
echo  Video Subtitle Remover Setup
echo ========================================
echo.

cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git is not installed or not in PATH.
    echo Install Git from https://git-scm.com/download/win
    pause
    exit /b 1
)

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH.
    echo Please install Python 3.12+ from https://python.org
    pause
    exit /b 1
)

set VSR_DIR=tools\video-subtitle-remover

echo [1/6] Cloning video-subtitle-remover...
if exist "%VSR_DIR%\.git" (
    echo       Repository already exists, pulling latest...
    pushd "%VSR_DIR%"
    git pull --ff-only
    popd
) else (
    if not exist tools mkdir tools
    git clone --depth 1 https://github.com/YaoFANGUK/video-subtitle-remover.git "%VSR_DIR%"
    if errorlevel 1 (
        echo [ERROR] Failed to clone repository.
        pause
        exit /b 1
    )
)

echo [2/6] Creating virtual environment vsr-env...
if exist vsr-env (
    echo       vsr-env already exists, skipping...
) else (
    python -m venv vsr-env
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
)

echo [3/6] Activating vsr-env...
call vsr-env\Scripts\activate.bat

echo [4/6] Installing PyTorch...
pip install torch==2.7.0 torchvision==0.22.0 --index-url https://download.pytorch.org/whl/cu118
if errorlevel 1 (
    echo [WARNING] CUDA PyTorch failed, trying CPU version...
    pip install torch==2.7.0 torchvision==0.22.0 --index-url https://download.pytorch.org/whl/cpu
)

echo [5/6] Installing PaddlePaddle and VSR dependencies...
pip install paddlepaddle-gpu==3.0.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu118/
if errorlevel 1 (
    echo [WARNING] Paddle GPU failed, trying CPU version...
    pip install paddlepaddle==3.0.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
)

pip install -r "%VSR_DIR%\requirements.txt"
if errorlevel 1 (
    echo [ERROR] Failed to install VSR requirements.
    pause
    exit /b 1
)

echo [6/6] Installing API wrapper dependencies...
pip install fastapi uvicorn python-multipart
if errorlevel 1 (
    echo [ERROR] Failed to install API dependencies.
    pause
    exit /b 1
)

echo.
echo ========================================
echo  VSR Setup Complete!
echo ========================================
echo.
echo Next steps:
echo   1. Start VSR server:  start-vsr-server.bat
echo   2. Start the app:     npm run dev
echo   3. Open Tools ^> Subtitle Remover in the canvas toolbar
echo.
echo Note: First run may download AI models (~1GB+).
echo.
pause
