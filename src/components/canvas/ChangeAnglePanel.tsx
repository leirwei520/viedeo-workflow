/**
 * ChangeAnglePanel.tsx
 * 
 * Panel for adjusting image viewing angle with 3D orbit camera control.
 * Users drag balls on arcs to adjust rotation, tilt, and zoom.
 */

import React, { useCallback, useRef } from 'react';
import { X, RotateCcw, Camera, Sparkles, Move3D } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { OrbitCameraControl } from './OrbitCameraControl';
import { HoverBorderGradient } from '../ui/hover-border-gradient';
import { useTheme } from '../../hooks/useTheme';

// ============================================================================
// TYPES
// ============================================================================

interface AngleSettings {
    rotation: number;  // -180 to 180 degrees
    tilt: number;      // -90 to 90 degrees
    scale: number;     // 0 to 100
    wideAngle: boolean;
}

interface ChangeAnglePanelProps {
    imageUrl: string;
    settings: AngleSettings;
    onSettingsChange: (settings: AngleSettings) => void;
    onClose: () => void;
    onGenerate: () => void;
    isLoading?: boolean;
}

// ============================================================================
// DEFAULT SETTINGS
// ============================================================================

const DEFAULT_SETTINGS: AngleSettings = {
    rotation: 0,
    tilt: 0,
    scale: 0,
    wideAngle: false
};

// ============================================================================
// COMPONENT
// ============================================================================

export const ChangeAnglePanel: React.FC<ChangeAnglePanelProps> = ({
    imageUrl,
    settings,
    onSettingsChange,
    onClose,
    onGenerate,
    isLoading = false,
}) => {
    const { isDark } = useTheme();
    const { t } = useTranslation();
    const hasAngleChange = settings.rotation !== 0 || settings.tilt !== 0 || settings.scale !== 0;

    // Write-through ref so sequential calls within the same event don't clobber each other
    const settingsRef = useRef(settings);
    settingsRef.current = settings;

    // --- Event Handlers ---
    const handleRotationChange = useCallback((value: number) => {
        const next = { ...settingsRef.current, rotation: value };
        settingsRef.current = next;
        onSettingsChange(next);
    }, [onSettingsChange]);

    const handleTiltChange = useCallback((value: number) => {
        const next = { ...settingsRef.current, tilt: value };
        settingsRef.current = next;
        onSettingsChange(next);
    }, [onSettingsChange]);

    const handleScaleChange = useCallback((value: number) => {
        const next = { ...settingsRef.current, scale: value };
        settingsRef.current = next;
        onSettingsChange(next);
    }, [onSettingsChange]);

    const handleReset = useCallback(() => {
        onSettingsChange(DEFAULT_SETTINGS);
    }, [onSettingsChange]);

    // --- Render ---
    const panelInner = (
        <>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/20 flex items-center justify-center">
                        <Move3D size={16} className="text-purple-400" />
                    </div>
                    <div>
                        <span className={`text-sm font-semibold tracking-wide ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                            {t('nodes.cameraControl3D')}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-1.5">
                    <button
                        onClick={handleReset}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-all duration-200 ${isDark
                            ? 'bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white border border-white/5 hover:border-white/10'
                            : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-500 hover:text-neutral-900'
                        }`}
                    >
                        <RotateCcw size={12} />
                        {t('nodes.reset')}
                    </button>
                    <button
                        onClick={onClose}
                        className={`p-1.5 rounded-lg transition-all duration-200 ${isDark
                            ? 'hover:bg-white/10 text-neutral-500 hover:text-white'
                            : 'hover:bg-neutral-100 text-neutral-500 hover:text-neutral-900'
                        }`}
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* 3D Orbit Camera Control */}
            <OrbitCameraControl
                imageUrl={imageUrl}
                rotation={settings.rotation}
                tilt={settings.tilt}
                zoom={settings.scale}
                isDark={isDark}
                onRotationChange={handleRotationChange}
                onTiltChange={handleTiltChange}
                onZoomChange={handleScaleChange}
            />

            {/* Generate Button */}
            <button
                onClick={onGenerate}
                disabled={isLoading || !hasAngleChange}
                className={`group w-full mt-4 py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2.5 transition-all duration-300 ${isLoading || !hasAngleChange
                    ? isDark
                        ? 'bg-white/[0.03] text-neutral-600 cursor-not-allowed border border-white/5'
                        : 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
                    : 'sf-rainbow-btn active:scale-[0.98] hover:shadow-lg hover:shadow-purple-500/10'
                }`}
            >
                {isLoading ? (
                    <>
                        <div className="w-4 h-4 border-2 border-neutral-400 border-t-purple-400 rounded-full animate-spin" />
                        {t('nodes.generatingAngle')}
                    </>
                ) : !hasAngleChange ? (
                    <>
                        <Move3D size={15} className="opacity-40" />
                        {t('nodes.dragToAdjust', '拖动圆球调整角度')}
                    </>
                ) : (
                    <>
                        <Sparkles size={15} className="transition-transform duration-300 group-hover:scale-110" />
                        {t('nodes.generateNewAngle')}
                    </>
                )}
            </button>
        </>
    );

    return (
        <HoverBorderGradient
            containerClassName="rounded-xl w-[480px]"
            className={
                isDark
                    ? 'rounded-[10px] bg-[var(--sf-bg-panel)]'
                    : 'rounded-[10px] bg-white'
            }
            fillClassName={isDark ? undefined : 'bg-white'}
            duration={3}
            onPointerDown={(e) => e.stopPropagation()}
        >
            <div className="p-5 rounded-xl cursor-default w-full transition-colors duration-300">
                {panelInner}
            </div>
        </HoverBorderGradient>
    );
};

export default ChangeAnglePanel;

