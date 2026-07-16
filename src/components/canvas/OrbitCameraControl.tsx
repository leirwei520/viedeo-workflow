/**
 * OrbitCameraControl.tsx
 *
 * Camera angle control with:
 * - Preset angle quick-select buttons
 * - 3D wireframe sphere with draggable camera ball (Canvas 2D)
 * - Live CSS 3D preview of the camera perspective
 * - Fine-tune sliders for horizontal orbit, vertical tilt, and zoom
 */

import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

// ============================================================================
// TYPES
// ============================================================================

interface OrbitCameraControlProps {
    imageUrl: string;
    rotation: number;
    tilt: number;
    zoom: number;
    onRotationChange: (value: number) => void;
    onTiltChange: (value: number) => void;
    onZoomChange: (value: number) => void;
    isDark?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const PRESETS = [
    { icon: '◎', labelKey: 'front', label: '正面', az: 0, el: 0 },
    { icon: '↶', labelKey: 'left30', label: '左转30°', az: -30, el: 0 },
    { icon: '↷', labelKey: 'right30', label: '右转30°', az: 30, el: 0 },
    { icon: '↰', labelKey: 'left60', label: '左转60°', az: -60, el: 0 },
    { icon: '↱', labelKey: 'right60', label: '右转60°', az: 60, el: 0 },
    { icon: '⤓', labelKey: 'birdseye', label: '俯视', az: 0, el: 50 },
    { icon: '⊝', labelKey: 'level', label: '平视', az: 0, el: 0 },
    { icon: '⤒', labelKey: 'lowangle', label: '仰视', az: 0, el: -30 },
    { icon: '◈', labelKey: 'leftBird', label: '左俯视', az: -45, el: 50 },
    { icon: '◇', labelKey: 'rightBird', label: '右俯视', az: 45, el: 50 },
];

const LOGICAL_W = 200;
const LOGICAL_H = 200;
const CANVAS_SCALE = 2;
const SPHERE_R = 82;
const VIEW_TILT_RAD = 15 * Math.PI / 180;
const CX = LOGICAL_W / 2;
const CY = LOGICAL_H / 2 - 3;

// ============================================================================
// HELPERS
// ============================================================================

function sphereProject(azDeg: number, elDeg: number) {
    const a = azDeg * Math.PI / 180;
    const e = elDeg * Math.PI / 180;
    const x = SPHERE_R * Math.cos(e) * Math.sin(a);
    const y0 = -SPHERE_R * Math.sin(e);
    const z0 = SPHERE_R * Math.cos(e) * Math.cos(a);
    const y = y0 * Math.cos(VIEW_TILT_RAD) - z0 * Math.sin(VIEW_TILT_RAD);
    const z = y0 * Math.sin(VIEW_TILT_RAD) + z0 * Math.cos(VIEW_TILT_RAD);
    return { x: CX + x, y: CY + y, z };
}

function getDirectionName(az: number): string {
    const n = ((az % 360) + 360) % 360;
    const dirs = ['正面', '右前', '右侧', '右后', '背面', '左后', '左侧', '左前'];
    return dirs[Math.round(n / 45) % 8];
}

function getElevationName(el: number): string {
    if (el > 15) return '俯视';
    if (el < -15) return '仰视';
    return '平视';
}

function getZoomLabel(zoom: number): string {
    if (zoom >= 70) return '近景';
    if (zoom >= 30) return '中景';
    return '远景';
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// ============================================================================
// CANVAS DRAWING
// ============================================================================

function drawSphere(
    ctx: CanvasRenderingContext2D,
    rotation: number,
    tilt: number,
    img: HTMLImageElement | null,
    dark = true,
) {
    ctx.setTransform(CANVAS_SCALE, 0, 0, CANVAS_SCALE, 0, 0);
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

    // Background
    const bg = ctx.createRadialGradient(CX, CY, 0, CX, CY, SPHERE_R + 30);
    if (dark) {
        bg.addColorStop(0, '#0f172a');
        bg.addColorStop(1, '#060a10');
    } else {
        bg.addColorStop(0, '#f0f4f8');
        bg.addColorStop(1, '#e2e8f0');
    }
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

    // Sphere inner glow
    const glow = ctx.createRadialGradient(CX - 18, CY - 18, 0, CX, CY, SPHERE_R);
    if (dark) {
        glow.addColorStop(0, 'rgba(20,30,50,0.35)');
        glow.addColorStop(0.85, 'rgba(10,15,25,0.1)');
        glow.addColorStop(1, 'rgba(6,10,16,0)');
    } else {
        glow.addColorStop(0, 'rgba(200,210,230,0.4)');
        glow.addColorStop(0.85, 'rgba(220,225,235,0.15)');
        glow.addColorStop(1, 'rgba(240,244,248,0)');
    }
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(CX, CY, SPHERE_R, 0, Math.PI * 2); ctx.fill();

    // Sphere outline
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(CX, CY, SPHERE_R, 0, Math.PI * 2); ctx.stroke();

    // Latitude lines
    for (let lat = -60; lat <= 60; lat += 30) {
        ctx.strokeStyle = dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        let first = true;
        for (let lon = 0; lon <= 360; lon += 4) {
            const p = sphereProject(lon, lat);
            if (first) { ctx.moveTo(p.x, p.y); first = false; }
            else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
    }

    // Longitude lines
    for (let lon = 0; lon < 360; lon += 45) {
        ctx.strokeStyle = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        let first = true;
        for (let lat = -90; lat <= 90; lat += 4) {
            const p = sphereProject(lon, lat);
            if (p.z > -SPHERE_R * 0.2) {
                if (first) { ctx.moveTo(p.x, p.y); first = false; }
                else ctx.lineTo(p.x, p.y);
            } else { first = true; }
        }
        ctx.stroke();
    }

    // Subject image at center
    if (img && img.complete && img.naturalWidth > 0) {
        const iw = 26, ih = 35;
        const rx = CX - iw / 2, ry = CY - ih / 2;
        ctx.save();
        ctx.beginPath();
        roundedRect(ctx, rx, ry, iw, ih, 3);
        ctx.clip();
        ctx.drawImage(img, rx, ry, iw, ih);
        ctx.restore();
        ctx.strokeStyle = dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        roundedRect(ctx, rx, ry, iw, ih, 3);
        ctx.stroke();
    } else {
        ctx.fillStyle = dark ? '#334155' : '#94a3b8';
        ctx.beginPath(); ctx.arc(CX, CY - 6, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(CX - 5, CY, 10, 14);
    }

    // Camera ball
    const camP = sphereProject(rotation, tilt);
    const isFront = camP.z > 0;

    // Dashed line to center
    ctx.globalAlpha = isFront ? 0.4 : 0.1;
    ctx.strokeStyle = 'rgba(96,165,250,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(camP.x, camP.y); ctx.lineTo(CX, CY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Ball outer glow
    const ballAlpha = isFront ? 1 : 0.3;
    ctx.globalAlpha = ballAlpha;
    ctx.shadowColor = '#60a5fa';
    ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(96,165,250,0.2)';
    ctx.beginPath(); ctx.arc(camP.x, camP.y, 10, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // Ball gradient
    const ballGrad = ctx.createRadialGradient(camP.x - 1.5, camP.y - 2, 0, camP.x, camP.y, 7);
    ballGrad.addColorStop(0, '#bfdbfe');
    ballGrad.addColorStop(0.4, '#60a5fa');
    ballGrad.addColorStop(1, '#2563eb');
    ctx.fillStyle = ballGrad;
    ctx.beginPath(); ctx.arc(camP.x, camP.y, 7, 0, Math.PI * 2); ctx.fill();

    // Ball highlight
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath(); ctx.arc(camP.x - 2, camP.y - 2, 2, 0, Math.PI * 2); ctx.fill();

    // Ball border
    ctx.strokeStyle = 'rgba(96,165,250,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(camP.x, camP.y, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;

    // Arrow indicators
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('▲', CX, CY - SPHERE_R - 10);
    ctx.fillText('▼', CX, CY + SPHERE_R + 12);
    ctx.fillText('◀', CX - SPHERE_R - 10, CY);
    ctx.fillText('▶', CX + SPHERE_R + 10, CY);
    ctx.textBaseline = 'alphabetic';
}

// ============================================================================
// SLIDER CLASSES (reusable Tailwind string)
// ============================================================================

const sliderThumb = [
    '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3',
    '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-grab',
].join(' ');

function buildSliderClasses(dark: boolean) {
    const base = `flex-1 h-1 rounded-full appearance-none cursor-pointer ${dark ? 'bg-white/[0.06]' : 'bg-gray-200'} ${sliderThumb}`;
    return {
        green: `${base} accent-emerald-400 [&::-webkit-slider-thumb]:bg-emerald-400 [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(52,211,153,0.5)]`,
        pink: `${base} accent-pink-400 [&::-webkit-slider-thumb]:bg-pink-400 [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(244,114,182,0.5)]`,
        blue: `${base} accent-blue-400 [&::-webkit-slider-thumb]:bg-blue-400 [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(96,165,250,0.5)]`,
    };
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const OrbitCameraControl: React.FC<OrbitCameraControlProps> = ({
    imageUrl,
    rotation,
    tilt,
    zoom,
    onRotationChange,
    onTiltChange,
    onZoomChange,
    isDark = true,
}) => {
    const { t } = useTranslation();
    const sliders = useMemo(() => buildSliderClasses(isDark), [isDark]);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const isDraggingRef = useRef(false);
    const lastPosRef = useRef({ x: 0, y: 0 });
    const dragRotRef = useRef(0);
    const dragTiltRef = useRef(0);

    const [imgLoaded, setImgLoaded] = useState(false);
    const [activePreset, setActivePreset] = useState<number | null>(0);

    // --- Image preload ---
    useEffect(() => {
        if (!imageUrl) return;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => { imgRef.current = img; setImgLoaded(true); };
        img.src = imageUrl;
        return () => { img.onload = null; };
    }, [imageUrl]);

    // --- Canvas redraw ---
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        drawSphere(ctx, rotation, tilt, imgRef.current, isDark);
    }, [rotation, tilt, imgLoaded, isDark]);

    // --- Canvas drag ---
    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        isDraggingRef.current = true;
        dragRotRef.current = rotation;
        dragTiltRef.current = tilt;
        lastPosRef.current = { x: e.clientX, y: e.clientY };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }, [rotation, tilt]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!isDraggingRef.current) return;
        const dx = e.clientX - lastPosRef.current.x;
        const dy = e.clientY - lastPosRef.current.y;
        lastPosRef.current = { x: e.clientX, y: e.clientY };

        dragRotRef.current = Math.round(Math.max(-180, Math.min(180, dragRotRef.current + dx * 0.8)));
        dragTiltRef.current = Math.round(Math.max(-70, Math.min(70, dragTiltRef.current - dy * 0.7)));

        onRotationChange(dragRotRef.current);
        onTiltChange(dragTiltRef.current);
        setActivePreset(null);
    }, [onRotationChange, onTiltChange]);

    const handlePointerUp = useCallback(() => {
        isDraggingRef.current = false;
    }, []);

    // --- Preset click ---
    const handlePresetClick = useCallback((index: number) => {
        setActivePreset(index);
        onRotationChange(PRESETS[index].az);
        onTiltChange(PRESETS[index].el);
    }, [onRotationChange, onTiltChange]);

    // --- Preview CSS transform ---
    const previewTransform = useMemo(() => {
        const ry = Math.max(-50, Math.min(50, -rotation * 0.28));
        const rx = Math.max(-20, Math.min(20, tilt * 0.35));
        return `rotateY(${ry}deg) rotateX(${rx}deg)`;
    }, [rotation, tilt]);

    const previewShadow = useMemo(() => {
        return `${rotation * 0.12}px ${-tilt * 0.12}px 20px rgba(0,0,0,0.3)`;
    }, [rotation, tilt]);

    // --- Status text ---
    const hasChange = rotation !== 0 || tilt !== 0;
    const statusText = useMemo(() => {
        const parts: string[] = [];
        if (rotation !== 0) {
            const deg = Math.abs(rotation);
            parts.push(rotation > 0 ? t('nodes.rotateRight', { deg }) : t('nodes.rotateLeft', { deg }));
        }
        if (tilt > 10) parts.push(t('nodes.birdsEye'));
        else if (tilt < -10) parts.push(t('nodes.lowAngle'));
        return parts.length > 0 ? parts.join(' + ') : t('nodes.noCameraMovement');
    }, [rotation, tilt, t]);

    return (
        <div className="w-full flex flex-col gap-3">
            {/* Preset buttons */}
            <div className="grid grid-cols-5 gap-1.5">
                {PRESETS.map((preset, i) => (
                    <button
                        key={preset.labelKey}
                        onClick={() => handlePresetClick(i)}
                        className={`flex flex-col items-center gap-0.5 py-2 px-1 rounded-lg border text-center transition-all duration-200 ${
                            activePreset === i
                                ? 'border-purple-500/40 bg-purple-500/10 shadow-[0_0_10px_rgba(124,58,237,0.15)]'
                                : isDark
                                    ? 'border-white/[0.06] bg-white/[0.02] hover:border-purple-500/20 hover:bg-purple-500/[0.04]'
                                    : 'border-gray-200 bg-gray-50 hover:border-purple-300 hover:bg-purple-50'
                        }`}
                    >
                        <span className="text-base leading-none">{preset.icon}</span>
                        <span className={`text-[9px] whitespace-nowrap ${
                            activePreset === i ? 'text-purple-300' : (isDark ? 'text-neutral-500' : 'text-gray-500')
                        }`}>{preset.label}</span>
                    </button>
                ))}
            </div>

            {/* Sphere + Preview */}
            <div className="grid grid-cols-2 gap-3">
                {/* Canvas sphere */}
                <div
                    className={`relative rounded-xl overflow-hidden border ${isDark ? 'border-white/[0.06] bg-[#080c14]' : 'border-gray-200 bg-[#e8ecf0]'}`}
                    style={{ aspectRatio: '1' }}
                >
                    <canvas
                        ref={canvasRef}
                        width={LOGICAL_W * CANVAS_SCALE}
                        height={LOGICAL_H * CANVAS_SCALE}
                        className="w-full h-full cursor-grab active:cursor-grabbing"
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerLeave={handlePointerUp}
                    />
                </div>

                {/* Live preview */}
                <div className="flex flex-col gap-2">
                    <span className={`text-[11px] ${isDark ? 'text-neutral-500' : 'text-gray-500'}`}>📷 摄像机视角预览</span>
                    <div
                        className={`flex-1 flex items-center justify-center rounded-xl border overflow-hidden relative ${isDark ? 'border-white/[0.06]' : 'border-gray-200'}`}
                        style={{
                            perspective: '500px',
                            perspectiveOrigin: '50% 45%',
                            background: isDark
                                ? 'radial-gradient(ellipse at 50% 55%, #0f172a, #060a10)'
                                : 'radial-gradient(ellipse at 50% 55%, #e8ecf2, #dde3eb)',
                        }}
                    >
                        <div className={`absolute inset-0 rounded-xl pointer-events-none z-10 ${isDark ? 'shadow-[inset_0_0_30px_rgba(0,0,0,0.4)]' : 'shadow-[inset_0_0_20px_rgba(0,0,0,0.06)]'}`} />
                        <div
                            className="rounded-lg border border-purple-500/15 overflow-hidden transition-transform duration-100 ease-out"
                            style={{
                                transform: previewTransform,
                                width: '70%',
                                aspectRatio: '3 / 4',
                                boxShadow: previewShadow,
                            }}
                        >
                            {imageUrl ? (
                                <img
                                    src={imageUrl}
                                    alt=""
                                    className="w-full h-full object-cover object-top"
                                    draggable={false}
                                />
                            ) : (
                                <div className={`w-full h-full ${isDark ? 'bg-gradient-to-br from-[#1a1a2e] to-[#16213e]' : 'bg-gradient-to-br from-gray-200 to-gray-300'}`} />
                            )}
                        </div>
                    </div>
                    <div className="flex gap-4 text-[11px]">
                        <div>
                            <span className="text-emerald-400">方位 </span>
                            <span className={`font-mono ${isDark ? 'text-neutral-200' : 'text-gray-700'}`}>
                                {getDirectionName(rotation)} {Math.round(rotation)}°
                            </span>
                        </div>
                        <div>
                            <span className="text-pink-400">仰角 </span>
                            <span className={`font-mono ${isDark ? 'text-neutral-200' : 'text-gray-700'}`}>
                                {getElevationName(tilt)} {Math.round(tilt)}°
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Fine-tune sliders */}
            <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2.5">
                    <span className="text-[11px] text-emerald-400 w-14 text-right shrink-0">水平环绕</span>
                    <input
                        type="range" min="-180" max="180" value={rotation}
                        onChange={(e) => { onRotationChange(parseInt(e.target.value)); setActivePreset(null); }}
                        className={sliders.green}
                    />
                    <span className={`text-[11px] font-mono w-10 text-center shrink-0 ${isDark ? 'text-neutral-300' : 'text-gray-600'}`}>{rotation}°</span>
                </div>
                <div className="flex items-center gap-2.5">
                    <span className="text-[11px] text-pink-400 w-14 text-right shrink-0">垂直俯仰</span>
                    <input
                        type="range" min="-70" max="70" value={tilt}
                        onChange={(e) => { onTiltChange(parseInt(e.target.value)); setActivePreset(null); }}
                        className={sliders.pink}
                    />
                    <span className={`text-[11px] font-mono w-10 text-center shrink-0 ${isDark ? 'text-neutral-300' : 'text-gray-600'}`}>{tilt}°</span>
                </div>
                <div className="flex items-center gap-2.5">
                    <span className="text-[11px] text-blue-400 w-14 text-right shrink-0">景别缩放</span>
                    <input
                        type="range" min="0" max="100" value={zoom}
                        onChange={(e) => onZoomChange(parseInt(e.target.value))}
                        className={sliders.blue}
                    />
                    <span className={`text-[11px] font-mono w-10 text-center shrink-0 ${isDark ? 'text-neutral-300' : 'text-gray-600'}`}>{getZoomLabel(zoom)}</span>
                </div>
            </div>

            {/* Status bar */}
            <div className="flex justify-center">
                <div className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 ${
                    hasChange
                        ? isDark ? 'sf-rainbow-text bg-white/[0.03] border border-white/10' : 'sf-rainbow-text bg-gray-50 border border-gray-200'
                        : isDark ? 'text-neutral-500 bg-white/[0.02] border border-white/5' : 'text-gray-400 bg-gray-50 border border-gray-200'
                }`}>
                    {statusText}
                </div>
            </div>
        </div>
    );
};
