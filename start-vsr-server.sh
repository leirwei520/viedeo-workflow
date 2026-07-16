#!/usr/bin/env bash
# Start Video Subtitle Remover API (Linux/macOS)

set -euo pipefail
cd "$(dirname "$0")"

echo "========================================"
echo "Video Subtitle Remover Server"
echo "========================================"

if [ ! -f "tools/video-subtitle-remover/backend/main.py" ]; then
  echo ""
  echo "ERROR: video-subtitle-remover is not installed."
  echo "Please run ./setup-vsr.sh first."
  exit 1
fi

if [ ! -f "vsr-env/bin/activate" ]; then
  echo ""
  echo "ERROR: vsr-env not found."
  echo "Please run ./setup-vsr.sh first."
  exit 1
fi

export VSR_ROOT="$(pwd)/tools/video-subtitle-remover"
export VSR_PORT=8101

echo "Using VSR_ROOT: $VSR_ROOT"
echo "Starting API on http://localhost:$VSR_PORT"
echo "Press Ctrl+C to stop"
echo ""

# shellcheck disable=SC1091
source vsr-env/bin/activate
python server/python/subtitle-remover/app.py
