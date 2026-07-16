/**
 * TopBar.tsx
 * 
 * Top navigation bar component with canvas title, save button, and other controls.
 */

import React, { useState } from 'react';
import { Plus, Save, Loader2, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher';
import { SettingsModal } from './modals/SettingsModal';
import { CloudSyncIndicator } from './CloudSyncIndicator';
import { HoverBorderGradient } from './ui/hover-border-gradient';
import { useTheme } from '../hooks/useTheme';

interface TopBarProps {
    // Title
    canvasTitle: string;
    isEditingTitle: boolean;
    editingTitleValue: string;
    canvasTitleInputRef: React.RefObject<HTMLInputElement>;
    setCanvasTitle: (title: string) => void;
    setIsEditingTitle: (editing: boolean) => void;
    setEditingTitleValue: (value: string) => void;
    // Actions
    onSave: () => void | Promise<void>;
    onNew: () => void;
    hasUnsavedChanges: boolean;
    lastAutoSaveTime?: number;
    // Layout
    isChatOpen?: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
    canvasTitle,
    isEditingTitle,
    editingTitleValue,
    canvasTitleInputRef,
    setCanvasTitle,
    setIsEditingTitle,
    setEditingTitleValue,
    onSave,
    onNew,
    hasUnsavedChanges,
    lastAutoSaveTime,
    isChatOpen = false,
}) => {
    const { isDark, toggle } = useTheme();
    const { t } = useTranslation();
    const [showNewConfirm, setShowNewConfirm] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    const handleTitleBlur = () => {
        if (editingTitleValue.trim()) {
            const newTitle = editingTitleValue.trim();
            if (newTitle !== canvasTitle) {
                setCanvasTitle(newTitle);
                // Use requestAnimationFrame to ensure state is committed before saving
                requestAnimationFrame(() => onSave());
            }
        } else {
            setEditingTitleValue(canvasTitle);
        }
        setIsEditingTitle(false);
    };

    const handleTitleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            if (editingTitleValue.trim()) {
                const newTitle = editingTitleValue.trim();
                if (newTitle !== canvasTitle) {
                    setCanvasTitle(newTitle);
                    requestAnimationFrame(() => onSave());
                }
            }
            setIsEditingTitle(false);
        } else if (e.key === 'Escape') {
            setEditingTitleValue(canvasTitle);
            setIsEditingTitle(false);
        }
    };

    const handleTitleDoubleClick = () => {
        setEditingTitleValue(canvasTitle);
        setIsEditingTitle(true);
    };

    const handleNewClick = () => {
        if (hasUnsavedChanges) {
            setShowNewConfirm(true);
        } else {
            onNew();
        }
    };

    const handleSaveAndNew = async () => {
        try {
            setIsSaving(true);
            await onSave();
            setShowNewConfirm(false);
            onNew();
        } catch (error) {
            console.error("Failed to save and new:", error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDiscardAndNew = () => {
        setShowNewConfirm(false);
        onNew();
    };

    const newConfirmModalBody = (
        <>
            <h3 className={`text-lg font-semibold mb-2 tracking-wide ${isDark ? 'text-[var(--sf-cyan)] sf-text-glow' : 'text-gray-800'}`}>{t('topBar.unsavedChanges')}</h3>
            <p className={`text-sm mb-6 ${isDark ? 'text-[var(--sf-text-dim)]' : 'text-gray-500'}`}>
                {t('topBar.unsavedChangesMessage')}
            </p>
            <div className="flex gap-3 justify-end">
                <HoverBorderGradient
                    as="button"
                    containerClassName="rounded-lg"
                    className={`rounded-md px-4 py-2 text-sm ${isSaving ? 'opacity-50 cursor-not-allowed' : ''} ${
                        isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white text-gray-800'
                    }`}
                    fillClassName={!isDark ? 'bg-white' : undefined}
                    duration={2}
                    disabled={isSaving}
                    onClick={() => {
                        if (!isSaving) setShowNewConfirm(false);
                    }}
                >
                    {t('common.cancel')}
                </HoverBorderGradient>
                <button
                    onClick={handleDiscardAndNew}
                    disabled={isSaving}
                    className={`px-4 py-2 rounded-lg text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? 'bg-red-900/50 border border-red-700 hover:border-red-500 hover:shadow-[0_0_12px_rgba(255,0,80,0.3)] text-red-300' : 'bg-red-50 border border-red-200 hover:border-red-400 text-red-600'}`}
                >
                    {t('common.discard')}
                </button>
                <HoverBorderGradient
                    as="button"
                    containerClassName="rounded-lg"
                    className={`px-4 py-2 rounded-lg text-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-medium ${
                        !isDark ? 'text-gray-800' : 'text-white'
                    }`}
                    fillClassName={!isDark ? 'bg-white' : undefined}
                    duration={2}
                    onClick={handleSaveAndNew}
                    disabled={isSaving}
                >
                    {isSaving ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {t('common.saving')}
                        </>
                    ) : (
                        t('topBar.saveAndNew')
                    )}
                </HoverBorderGradient>
            </div>
        </>
    );

    return (
        <>
            <div
                className="fixed top-10 left-0 h-14 flex items-center justify-between px-6 z-50 pointer-events-none transition-all duration-300"
                style={{ width: isChatOpen ? 'calc(100% - 400px)' : '100%' }}
            >
                {/* Left: Logo & Title */}
                <div className="flex items-center gap-3 pointer-events-auto">
                    <img src="./logo.png" alt="Logo" className="w-8 h-8 rounded-lg object-contain" />
                    {isEditingTitle ? (
                        <input
                            ref={canvasTitleInputRef as React.RefObject<HTMLInputElement>}
                            type="text"
                            value={editingTitleValue}
                            onChange={(e) => setEditingTitleValue(e.target.value)}
                            onBlur={handleTitleBlur}
                            onKeyDown={handleTitleKeyDown}
                            className={`font-semibold bg-transparent outline-none min-w-[100px] ${isDark ? 'sf-rainbow-text border-b border-white/40' : 'text-gray-800 border-b-2 border-white/30'}`}
                        />
                    ) : (
                        <span
                            className={`font-semibold cursor-pointer transition-colors tracking-wide ${isDark ? 'text-white/80 hover:sf-rainbow-text' : 'text-gray-700 hover:sf-rainbow-text'}`}
                            onDoubleClick={handleTitleDoubleClick}
                            title={t('topBar.doubleClickToRename')}
                        >
                            {canvasTitle}
                        </span>
                    )}
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-3 pointer-events-auto">
                    {lastAutoSaveTime && !hasUnsavedChanges && (
                        <div className={`text-[11px] font-mono leading-none tracking-wide px-2.5 py-1.5 rounded-md border animate-in fade-in duration-500 ${isDark
                            ? 'text-white/50 border-white/10 bg-white/5'
                            : 'text-gray-400 border-gray-200 bg-white/60'
                            }`}>
                            {t('topBar.autoSaved')} {new Date(lastAutoSaveTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    )}
                    {isDark ? (
                        <HoverBorderGradient
                            as="button"
                            containerClassName="rounded-full"
                            className="flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium bg-[var(--sf-bg-deep)] text-white"
                            duration={2}
                            onClick={() => onSave()}
                        >
                            <Save size={16} />
                            {t('common.save')}
                        </HoverBorderGradient>
                    ) : (
                        <button className="lt-btn-primary text-white flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium" onClick={() => onSave()}>
                            <Save size={16} />
                            {t('common.save')}
                        </button>
                    )}
                    {isDark ? (
                        <HoverBorderGradient
                            as="button"
                            containerClassName="rounded-full"
                            className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-[var(--sf-bg-deep)] text-white"
                            duration={2}
                            onClick={handleNewClick}
                        >
                            <Plus size={16} />
                            {t('common.new')}
                        </HoverBorderGradient>
                    ) : (
                        <button className="lt-btn-primary text-white flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium" onClick={handleNewClick}>
                            <Plus size={16} />
                            {t('common.new')}
                        </button>
                    )}
                    <CloudSyncIndicator />
                    <HoverBorderGradient
                        as="button"
                        containerClassName={isDark ? 'rounded-full' : 'rounded-lg'}
                        className={`w-10 h-10 flex items-center justify-center transition-all ${
                            isDark
                                ? 'rounded-full bg-[var(--sf-bg-deep)] text-white'
                                : 'rounded-lg bg-white text-gray-800'
                        }`}
                        fillClassName={!isDark ? 'bg-white' : undefined}
                        duration={isDark ? 3 : 2}
                        onClick={() => setShowSettings(true)}
                        title={t('common.settings')}
                    >
                        <Settings size={18} />
                    </HoverBorderGradient>
                    <LanguageSwitcher />
                    <HoverBorderGradient
                        as="button"
                        containerClassName={isDark ? 'rounded-full' : 'rounded-lg'}
                        className={`w-10 h-10 flex items-center justify-center transition-all ${
                            isDark
                                ? 'rounded-full bg-[var(--sf-bg-deep)] sf-rainbow-text'
                                : 'rounded-lg bg-white !text-amber-500 hover:!text-amber-600'
                        }`}
                        fillClassName={!isDark ? 'bg-white' : undefined}
                        duration={isDark ? 3 : 2}
                        onClick={toggle}
                        title={isDark ? t('topBar.switchToDayMode') : t('topBar.switchToNightMode')}
                    >
                        {isDark ? (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
                        ) : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                        )}
                    </HoverBorderGradient>
                </div>
            </div>

            <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />

            {/* Unsaved Changes Confirmation Modal */}
            {showNewConfirm && (
                <div className={`fixed inset-0 ${isDark ? 'bg-black/70' : 'bg-black/30'} backdrop-blur-sm flex items-center justify-center z-[100]`}>
                    <HoverBorderGradient
                        containerClassName="rounded-xl w-[400px]"
                        className={`rounded-[10px] ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`}
                        fillClassName={!isDark ? 'bg-white' : undefined}
                        duration={isDark ? 3 : 4}
                    >
                        <div className="rounded-xl p-6 w-full">
                            {newConfirmModalBody}
                        </div>
                    </HoverBorderGradient>
                </div>
            )}
        </>
    );
};
