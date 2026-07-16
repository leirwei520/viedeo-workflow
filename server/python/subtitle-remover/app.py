"""
FastAPI wrapper for video-subtitle-remover (VSR).
Run with: python server/python/subtitle-remover/app.py
"""

from __future__ import annotations

import os
import sys
import uuid
import shutil
import threading
import tempfile
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel

PROJECT_ROOT = Path(__file__).resolve().parents[3]
VSR_ROOT = Path(os.environ.get("VSR_ROOT", PROJECT_ROOT / "tools" / "video-subtitle-remover"))
VSR_PORT = int(os.environ.get("VSR_PORT", "8101"))

if not VSR_ROOT.exists():
    print(f"[VSR] WARNING: VSR_ROOT not found: {VSR_ROOT}")
    print("[VSR] Run setup-vsr.bat (Windows) or setup-vsr.sh (Linux/macOS) first.")
else:
    sys.path.insert(0, str(VSR_ROOT))

app = FastAPI(
    title="Video Subtitle Remover API",
    description="Local wrapper around video-subtitle-remover",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class Job:
    id: str
    input_path: str
    output_path: str
    status: JobStatus = JobStatus.PENDING
    progress: int = 0
    error: Optional[str] = None
    work_dir: str = ""
    lock: threading.Lock = field(default_factory=threading.Lock)


jobs: dict[str, Job] = {}
jobs_lock = threading.Lock()


class HealthResponse(BaseModel):
    status: str
    vsr_root: str
    vsr_installed: bool


class JobResponse(BaseModel):
    job_id: str
    status: JobStatus
    progress: int
    error: Optional[str] = None


def _parse_inpaint_mode(mode: str):
    from backend.tools.constant import InpaintMode

    key = mode.replace("-", "_").upper()
    try:
        return InpaintMode[key]
    except KeyError as exc:
        valid = [m.name.lower().replace("_", "-") for m in InpaintMode]
        raise HTTPException(status_code=400, detail=f"Invalid inpaint_mode. Choose from: {valid}") from exc


# Default bottom subtitle band used by VSR GUI (relative ymin,ymax,xmin,xmax)
DEFAULT_SUBTITLE_AREA_REL = (0.82, 0.99, 0.05, 0.95)


def _parse_subtitle_area(raw: Optional[str]) -> list[list[int]]:
    if not raw or not raw.strip():
        return []
    areas: list[list[int]] = []
    for part in raw.split(";"):
        nums = [int(x.strip()) for x in part.split(",") if x.strip()]
        if len(nums) != 4:
            raise HTTPException(
                status_code=400,
                detail="subtitle_area must be 'ymin,ymax,xmin,xmax' or multiple areas separated by ';'",
            )
        areas.append(nums)
    return areas


def _default_bottom_subtitle_area(frame_height: int, frame_width: int) -> list[list[int]]:
    """Convert relative bottom band to absolute pixel coords (ymin,ymax,xmin,xmax)."""
    ymin_r, ymax_r, xmin_r, xmax_r = DEFAULT_SUBTITLE_AREA_REL
    return [[
        int(frame_height * ymin_r),
        int(frame_height * ymax_r),
        int(frame_width * xmin_r),
        int(frame_width * xmax_r),
    ]]


def _resolve_subtitle_areas(
    inpaint_mode: str,
    subtitle_areas: list[list[int]],
    frame_height: int,
    frame_width: int,
) -> list[list[int]]:
    """
    STTN Auto does NOT run OCR — it only erases the given region.
    If the user left the area empty, use the default bottom band instead of
    full-frame (which leaves Japanese/hard subs poorly removed).
    Detection-based modes (sttn-det / lama / propainter) can keep empty areas
    so OCR scans the whole frame.
    """
    if subtitle_areas:
        return subtitle_areas
    mode_key = inpaint_mode.replace("-", "_").lower()
    if mode_key in ("sttn_auto", "opencv"):
        return _default_bottom_subtitle_area(frame_height, frame_width)
    return []


def _run_job(job: Job, inpaint_mode: str, subtitle_areas: list[list[int]]) -> None:
    try:
        if not VSR_ROOT.exists():
            raise RuntimeError(
                f"VSR not installed at {VSR_ROOT}. Run setup-vsr.bat or setup-vsr.sh first."
            )

        import multiprocessing

        multiprocessing.set_start_method("spawn", force=True)

        from backend.config import config
        from backend.main import SubtitleRemover
        from backend.tools.common_tools import is_video_or_image

        # Keep UI language English; OCR TextDetection is language-agnostic (JP/CN/EN ok)
        config.set(config.interface, "en")
        config.inpaintMode.value = _parse_inpaint_mode(inpaint_mode)
        # Slightly enlarge detected boxes so Japanese glyph edges are less likely to remain
        try:
            config.subtitleAreaDeviationPixel.value = max(
                int(config.subtitleAreaDeviationPixel.value), 16
            )
        except Exception:
            pass

        with job.lock:
            job.status = JobStatus.RUNNING
            job.progress = 0

        remover = SubtitleRemover(job.input_path, gui_mode=False)
        if not is_video_or_image(job.input_path):
            raise ValueError("Input is not a supported video or image file")

        resolved_areas = _resolve_subtitle_areas(
            inpaint_mode,
            subtitle_areas,
            remover.frame_height,
            remover.frame_width,
        )
        remover.sub_areas = resolved_areas
        remover.video_out_path = job.output_path
        print(
            f"[VSR] job={job.id} mode={inpaint_mode} "
            f"areas={resolved_areas or 'full-frame OCR'} "
            f"size={remover.frame_width}x{remover.frame_height}"
        )

        def on_progress(progress_total: int, is_finished: bool) -> None:
            with job.lock:
                job.progress = min(100, max(0, int(progress_total)))
                if is_finished:
                    job.progress = 100

        remover.add_progress_listener(on_progress)
        remover.run()

        if not os.path.exists(job.output_path):
            raise RuntimeError("Processing finished but output file was not created")

        with job.lock:
            job.status = JobStatus.COMPLETED
            job.progress = 100
    except Exception as exc:  # noqa: BLE001
        import traceback

        traceback.print_exc()
        with job.lock:
            job.status = JobStatus.FAILED
            job.error = str(exc)
            job.progress = 0


def _cleanup_job(job: Job) -> None:
    if job.work_dir and os.path.isdir(job.work_dir):
        try:
            shutil.rmtree(job.work_dir, ignore_errors=True)
        except OSError:
            pass


@app.get("/", response_class=HTMLResponse)
async def index_page():
    """Browser landing page — 8101 is an API service; this page provides a simple UI."""
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>字幕去除服务</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0; min-height: 100vh; font-family: system-ui, -apple-system, sans-serif;
      background: linear-gradient(135deg, #0f0f14 0%, #1a1028 100%);
      color: #e8e8ec; display: flex; align-items: center; justify-content: center; padding: 24px;
    }}
    .card {{
      width: min(560px, 100%); background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 28px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    }}
    h1 {{ margin: 0 0 8px; font-size: 1.5rem; }}
    .sub {{ color: #9ca3af; font-size: 0.9rem; margin-bottom: 20px; }}
    .badge {{ display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px;
      background: rgba(34,197,94,0.15); color: #86efac; margin-bottom: 16px; }}
    label {{ display: block; font-size: 13px; color: #9ca3af; margin-bottom: 6px; }}
    select, input[type=file] {{ width: 100%; margin-bottom: 14px; }}
    select {{
      background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
      color: #fff; border-radius: 8px; padding: 10px 12px;
    }}
    .drop {{
      border: 2px dashed rgba(255,255,255,0.18); border-radius: 12px; padding: 32px 16px;
      text-align: center; cursor: pointer; transition: 0.2s; margin-bottom: 16px;
    }}
    .drop:hover, .drop.drag {{ border-color: #a855f7; background: rgba(168,85,247,0.08); }}
    button {{
      width: 100%; border: none; border-radius: 10px; padding: 12px; font-size: 15px;
      font-weight: 600; cursor: pointer; color: #fff;
      background: linear-gradient(90deg, #7c3aed, #db2777);
    }}
    button:disabled {{ opacity: 0.5; cursor: not-allowed; }}
    .bar {{ height: 8px; background: rgba(255,255,255,0.1); border-radius: 999px; overflow: hidden; margin: 16px 0 8px; display: none; }}
    .bar > div {{ height: 100%; width: 0%; background: linear-gradient(90deg, #7c3aed, #db2777); transition: width 0.3s; }}
    .msg {{ font-size: 13px; color: #9ca3af; min-height: 20px; }}
    .err {{ color: #f87171; }}
    video {{ width: 100%; border-radius: 10px; margin-top: 16px; display: none; background: #000; }}
    .links {{ margin-top: 20px; font-size: 12px; color: #6b7280; }}
    .links a {{ color: #c4b5fd; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="badge" id="statusBadge">服务运行中 · 端口 {VSR_PORT}</div>
    <h1>视频字幕去除</h1>
    <p class="sub">本地 AI 服务（video-subtitle-remover）。也可在出海帮画布左侧 <strong>工具 → 字幕去除</strong> 中使用。</p>

    <label for="mode">修复算法</label>
    <select id="mode">
      <option value="sttn-det" selected>STTN 检测（推荐，日语/中文硬字幕）</option>
      <option value="lama">LaMa（动画效果好）</option>
      <option value="sttn-auto">STTN 自动（仅擦底部区域，不做 OCR）</option>
      <option value="propainter">ProPainter（运动剧烈）</option>
      <option value="opencv">OpenCV（最快）</option>
    </select>
    <p class="sub" style="margin-top:-6px;margin-bottom:14px">日语字幕请用「STTN 检测」或「LaMa」。STTN 自动不会识别文字，只擦画面底部。</p>

    <div class="drop" id="dropZone">
      <div>点击或拖拽视频到此处</div>
      <div style="font-size:12px;color:#6b7280;margin-top:6px">支持 MP4 / MOV / AVI / MKV</div>
      <input type="file" id="fileInput" accept="video/*" hidden />
    </div>

    <button id="startBtn" disabled>开始去除字幕</button>
    <div class="bar" id="bar"><div id="barFill"></div></div>
    <div class="msg" id="msg"></div>
    <video id="resultVideo" controls></video>

    <div class="links">
      API 文档：<a href="/docs" target="_blank">/docs</a> ·
      健康检查：<a href="/health" target="_blank">/health</a>
    </div>
  </div>
  <script>
    const drop = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const startBtn = document.getElementById('startBtn');
    const bar = document.getElementById('bar');
    const barFill = document.getElementById('barFill');
    const msg = document.getElementById('msg');
    const video = document.getElementById('resultVideo');
    let selectedFile = null;

    drop.onclick = () => fileInput.click();
    drop.ondragover = e => {{ e.preventDefault(); drop.classList.add('drag'); }};
    drop.ondragleave = () => drop.classList.remove('drag');
    drop.ondrop = e => {{
      e.preventDefault(); drop.classList.remove('drag');
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('video/')) setFile(f);
    }};
    fileInput.onchange = () => {{ if (fileInput.files[0]) setFile(fileInput.files[0]); }};

    function setFile(f) {{
      selectedFile = f;
      startBtn.disabled = false;
      msg.textContent = '已选择：' + f.name;
      msg.className = 'msg';
      video.style.display = 'none';
    }}

    async function poll(jobId) {{
      while (true) {{
        const r = await fetch('/jobs/' + jobId);
        const d = await r.json();
        barFill.style.width = Math.max(d.progress || 0, 2) + '%';
        msg.textContent = '处理中… ' + (d.progress || 0) + '%';
        if (d.status === 'completed') return jobId;
        if (d.status === 'failed') throw new Error(d.error || '处理失败');
        await new Promise(r => setTimeout(r, 2000));
      }}
    }}

    startBtn.onclick = async () => {{
      if (!selectedFile) return;
      startBtn.disabled = true;
      bar.style.display = 'block';
      barFill.style.width = '2%';
      msg.textContent = '上传中…';
      msg.className = 'msg';
      video.style.display = 'none';

      const fd = new FormData();
      fd.append('file', selectedFile);
      fd.append('inpaint_mode', document.getElementById('mode').value);

      try {{
        const res = await fetch('/jobs', {{ method: 'POST', body: fd }});
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || '启动失败');
        const jobId = await poll(data.job_id);
        const url = '/jobs/' + jobId + '/download?t=' + Date.now();
        video.src = url;
        video.style.display = 'block';
        msg.textContent = '完成！可右键视频另存为。';
      }} catch (e) {{
        msg.textContent = e.message || String(e);
        msg.className = 'msg err';
      }} finally {{
        startBtn.disabled = false;
      }}
    }};
  </script>
</body>
</html>"""


@app.get("/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(
        status="ok",
        vsr_root=str(VSR_ROOT),
        vsr_installed=VSR_ROOT.exists() and (VSR_ROOT / "backend" / "main.py").exists(),
    )


@app.post("/jobs", response_model=JobResponse)
async def create_job(
    file: UploadFile = File(...),
    inpaint_mode: str = Form("sttn-det"),
    subtitle_area: Optional[str] = Form(None),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    subtitle_areas = _parse_subtitle_area(subtitle_area)
    job_id = uuid.uuid4().hex
    work_dir = tempfile.mkdtemp(prefix=f"vsr_{job_id}_")
    ext = Path(file.filename).suffix or ".mp4"
    input_path = os.path.join(work_dir, f"input{ext}")
    output_path = os.path.join(work_dir, f"output{ext}")

    content = await file.read()
    if not content:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    with open(input_path, "wb") as f:
        f.write(content)

    job = Job(
        id=job_id,
        input_path=input_path,
        output_path=output_path,
        work_dir=work_dir,
    )

    with jobs_lock:
        jobs[job_id] = job

    thread = threading.Thread(
        target=_run_job,
        args=(job, inpaint_mode, subtitle_areas),
        daemon=True,
    )
    thread.start()

    return JobResponse(job_id=job_id, status=job.status, progress=job.progress)


@app.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    with job.lock:
        return JobResponse(
            job_id=job.id,
            status=job.status,
            progress=job.progress,
            error=job.error,
        )


@app.get("/jobs/{job_id}/download")
async def download_result(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    with job.lock:
        if job.status != JobStatus.COMPLETED:
            raise HTTPException(status_code=409, detail=f"Job is {job.status.value}, not ready")
        if not os.path.exists(job.output_path):
            raise HTTPException(status_code=404, detail="Output file missing")

        output_path = job.output_path
        filename = Path(output_path).name

    # content_disposition_type=inline so <video> can stream/seek without forcing download
    return FileResponse(
        output_path,
        media_type="video/mp4",
        filename=filename,
        content_disposition_type="inline",
    )


@app.delete("/jobs/{job_id}")
async def delete_job(job_id: str):
    with jobs_lock:
        job = jobs.pop(job_id, None)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    _cleanup_job(job)
    return {"ok": True}


def _suppress_connection_reset(loop, context):
    """Browser video seeking aborts Range requests; ignore WinError 10054 noise."""
    exc = context.get("exception")
    if isinstance(exc, ConnectionResetError):
        return
    if isinstance(exc, OSError) and getattr(exc, "winerror", None) == 10054:
        return
    loop.default_exception_handler(context)


if __name__ == "__main__":
    import asyncio

    print("=" * 60)
    print("Video Subtitle Remover API")
    print(f"VSR_ROOT: {VSR_ROOT}")
    print(f"Server:   http://localhost:{VSR_PORT}")
    print(f"Web UI:   http://localhost:{VSR_PORT}/")
    print(f"API docs: http://localhost:{VSR_PORT}/docs")
    print("=" * 60)

    # Windows Proactor: video <video> seeking triggers ConnectionResetError spam
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    config = uvicorn.Config("app:app", host="0.0.0.0", port=VSR_PORT, reload=False, log_level="info")
    server = uvicorn.Server(config)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.set_exception_handler(_suppress_connection_reset)
    try:
        loop.run_until_complete(server.serve())
    finally:
        loop.close()
