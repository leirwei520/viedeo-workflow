#!/usr/bin/env bash
# ============================================================================
# Chuhai Bang - Video Subtitle Remover (VSR) Setup (Linux/macOS)
# ============================================================================

set -euo pipefail

cd "$(dirname "$0")"

echo ""
echo "========================================"
echo " Video Subtitle Remover Setup"
echo "========================================"
echo ""

command -v git >/dev/null 2>&1 || { echo "[ERROR] git is required"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "[ERROR] python3 is required"; exit 1; }

VSR_DIR="tools/video-subtitle-remover"

echo "[1/6] Cloning video-subtitle-remover..."
if [ -d "$VSR_DIR/.git" ]; then
  echo "      Repository already exists, pulling latest..."
  git -C "$VSR_DIR" pull --ff-only
else
  mkdir -p tools
  git clone --depth 1 https://github.com/YaoFANGUK/video-subtitle-remover.git "$VSR_DIR"
fi

echo "[2/6] Creating virtual environment vsr-env..."
if [ ! -d vsr-env ]; then
  python3 -m venv vsr-env
fi

echo "[3/6] Activating vsr-env..."
# shellcheck disable=SC1091
source vsr-env/bin/activate

echo "[4/6] Installing PyTorch..."
if pip install torch==2.7.0 torchvision==0.22.0 --index-url https://download.pytorch.org/whl/cu118; then
  echo "      CUDA PyTorch installed"
else
  echo "[WARNING] CUDA PyTorch failed, trying CPU..."
  pip install torch==2.7.0 torchvision==0.22.0 --index-url https://download.pytorch.org/whl/cpu
fi

echo "[5/6] Installing PaddlePaddle and VSR dependencies..."
if pip install paddlepaddle-gpu==3.0.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu118/; then
  echo "      Paddle GPU installed"
else
  echo "[WARNING] Paddle GPU failed, trying CPU..."
  pip install paddlepaddle==3.0.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
fi

pip install -r "$VSR_DIR/requirements.txt"

echo "[6/6] Installing API wrapper dependencies..."
pip install fastapi uvicorn python-multipart

echo ""
echo "========================================"
echo " VSR Setup Complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Start VSR server:  ./start-vsr-server.sh"
echo "  2. Start the app:     npm run dev"
echo ""
