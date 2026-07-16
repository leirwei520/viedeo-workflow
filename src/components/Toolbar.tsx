import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  LayoutGrid,
  Image as ImageIcon,
  MessageSquare,
  History,
  Wrench,
  MoreHorizontal,
  Plus,
  Film,
  AudioLines,
  Mic,
  Combine,
  Eraser,
  HelpCircle,
  X,
  Shield,
  Fingerprint,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { ossThumb } from '../config/api';
import { HoverBorderGradient } from './ui/hover-border-gradient';

// ============================================================================
// TYPES
// ============================================================================

interface ToolbarProps {
  onAddClick?: (e: React.MouseEvent) => void;
  onWorkflowsClick?: (e: React.MouseEvent) => void;
  onHistoryClick?: (e: React.MouseEvent) => void;
  onAssetsClick?: (e: React.MouseEvent) => void;
  onStoryboardClick?: (e: React.MouseEvent) => void;
  onAudioExtractorClick?: (e: React.MouseEvent) => void;
  onTTSClick?: (e: React.MouseEvent) => void;
  onIndexTTSClick?: (e: React.MouseEvent) => void;
  onVideoMergeClick?: (e: React.MouseEvent) => void;
  onSubtitleRemoverClick?: (e: React.MouseEvent) => void;
  onToolsOpen?: () => void;
  onProfileClick?: () => void;
}

// ============================================================================
// SHORTCUTS PANEL
// ============================================================================

const Kbd: React.FC<{ children: React.ReactNode; wide?: boolean; isDark?: boolean }> = ({ children, wide, isDark = true }) => (
  <span className={`inline-flex items-center justify-center h-[28px] rounded-[5px] text-[12px] font-mono font-medium leading-none ${isDark ? 'bg-white/5 text-white/70 border border-white/10 shadow-[0_2px_0_#04080e]' : 'bg-gray-100 text-gray-600 border border-gray-200 shadow-[0_2px_0_#e5e7eb]'} ${wide ? 'px-3' : 'min-w-[28px] px-1.5'}`}>
    {children}
  </span>
);

const Or: React.FC<{ isDark?: boolean; isZh?: boolean }> = ({ isDark = true, isZh = true }) => (
  <span className={`text-[11px] mx-0.5 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>{isZh ? '或' : 'or'}</span>
);

const GestureIcon: React.FC<{ type: 'pinch' | 'scroll' | 'two-finger' | 'middle-click' | 'backspace'; isDark?: boolean }> = ({ type, isDark = true }) => {
  const cls = `w-[28px] h-[28px] rounded-[5px] flex items-center justify-center ${isDark ? 'bg-[var(--sf-bg-card)] border border-[var(--sf-border)] shadow-[0_2px_0_#04080e]' : 'bg-gray-100 border border-gray-200 shadow-[0_2px_0_#e5e7eb]'}`;
  const iconCls = isDark ? 'text-white/80' : 'text-gray-500';
  switch (type) {
    case 'pinch':
      return (
        <span className={cls}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={iconCls}>
            <path d="M6 6l4 4M18 6l-4 4" /><circle cx="12" cy="14" r="3" /><path d="M12 11V6" />
          </svg>
        </span>
      );
    case 'scroll':
      return (
        <span className={cls}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={iconCls}>
            <rect x="7" y="4" width="10" height="16" rx="5" /><line x1="12" y1="8" x2="12" y2="12" /><path d="M12 2v2M12 20v2" />
          </svg>
        </span>
      );
    case 'two-finger':
      return (
        <span className={cls}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={iconCls}>
            <path d="M9 4v10M15 4v10" /><path d="M6 18h12" /><path d="M9 18l-3 3M15 18l3 3" />
          </svg>
        </span>
      );
    case 'middle-click':
      return (
        <span className={cls}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={iconCls}>
            <rect x="6" y="3" width="12" height="18" rx="6" /><rect x="10" y="6" width="4" height="5" rx="2" fill="currentColor" opacity="0.5" /><line x1="12" y1="11" x2="12" y2="14" />
          </svg>
        </span>
      );
    case 'backspace':
      return (
        <span className={cls}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={iconCls}>
            <path d="M9 4h9a2 2 0 012 2v12a2 2 0 01-2 2H9l-6-8 6-8z" /><line x1="15" y1="9" x2="12" y2="15" /><line x1="12" y1="9" x2="15" y2="15" />
          </svg>
        </span>
      );
  }
};

const ModKbd: React.FC<{ isDark: boolean }> = ({ isDark }) => (
  <Kbd isDark={isDark}>⌘ / Ctrl</Kbd>
);

const ShortcutsPanel: React.FC<{ isDark: boolean; onClose: () => void }> = ({ isDark, onClose }) => {
  const { t, i18n } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const isZh = i18n.language?.startsWith('zh');

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="flex items-start justify-between gap-6 min-h-[40px] py-1">
      <span className={`text-[13px] shrink-0 max-w-[38%] leading-relaxed ${isDark ? 'text-white/80' : 'text-gray-600'}`}>
        {label}
      </span>
      <span className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 min-w-0 flex-1">
        {children}
      </span>
    </div>
  );

  return createPortal(
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[200] animate-in fade-in slide-in-from-bottom-3 duration-150">
      <HoverBorderGradient
        containerClassName="relative rounded-xl w-max max-w-[min(100vw-2rem,1520px)]"
        className={`rounded-xl ${isDark ? 'bg-[var(--sf-bg-panel)] border border-white/10' : 'bg-white border border-gray-200/80'}`}
        fillClassName={isDark ? undefined : 'bg-white'}
        duration={4}
      >
        <div ref={panelRef} className="flex items-start gap-x-12 md:gap-x-14 px-8 md:px-10 py-6 rounded-[inherit] overflow-x-auto overscroll-x-contain">
          {/* Column 1: Edit */}
          <div className="w-[268px] shrink-0">
            <div className={`text-[13px] font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('shortcuts.edit')}</div>
            <Row label={t('shortcuts.copy')}><ModKbd isDark={isDark} /><Kbd isDark={isDark}>C</Kbd></Row>
            <Row label={t('shortcuts.paste')}><ModKbd isDark={isDark} /><Kbd isDark={isDark}>V</Kbd></Row>
            <Row label={t('shortcuts.selectAll')}><ModKbd isDark={isDark} /><Kbd isDark={isDark}>A</Kbd></Row>
            <Row label={t('shortcuts.duplicate')}><ModKbd isDark={isDark} /><Kbd isDark={isDark}>D</Kbd></Row>
            <Row label={t('shortcuts.generate')}><Kbd isDark={isDark}>G</Kbd></Row>
            <Row label={t('shortcuts.connect')}><Kbd isDark={isDark} wide>{isZh ? '拖拽连接点' : 'Drag connector'}</Kbd></Row>
          </div>

          {/* Column 2: Zoom */}
          <div className="w-[268px] shrink-0">
            <div className={`text-[13px] font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('shortcuts.zoom')}</div>
            <Row label={t('shortcuts.keyboard')}><ModKbd isDark={isDark} /><Kbd isDark={isDark}>+</Kbd><Or isDark={isDark} /><Kbd isDark={isDark}>−</Kbd></Row>
            <Row label={isZh ? '重置 100%' : 'Reset 100%'}><ModKbd isDark={isDark} /><Kbd isDark={isDark}>0</Kbd></Row>
            <Row label={isZh ? '触控板' : 'Trackpad'}><GestureIcon type="pinch" isDark={isDark} /></Row>
            <Row label={t('shortcuts.mouse')}><ModKbd isDark={isDark} /><GestureIcon type="scroll" isDark={isDark} /></Row>
          </div>

          {/* Column 3: Move Canvas */}
          <div className="w-[238px] shrink-0">
            <div className={`text-[13px] font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('shortcuts.moveCanvas')}</div>
            <Row label={t('shortcuts.keyboard')}><Kbd isDark={isDark} wide>Space</Kbd><span className={`text-[11px] mx-0.5 ${isDark ? 'text-white/40' : 'text-gray-400'}`}>+</span><Kbd isDark={isDark} wide>{isZh ? '拖拽' : 'Drag'}</Kbd></Row>
            <Row label={isZh ? '触控板' : 'Trackpad'}><GestureIcon type="two-finger" isDark={isDark} /></Row>
            <Row label={t('shortcuts.mouse')}><GestureIcon type="middle-click" isDark={isDark} /></Row>
          </div>

          {/* Column 4: Other */}
          <div className="w-[380px] shrink-0">
            <div className="flex items-center justify-between mb-2">
              <span className={`text-[13px] font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{t('shortcuts.other')}</span>
              <button
                onClick={onClose}
                className={`p-0.5 rounded transition-colors ${isDark ? 'text-neutral-500 hover:text-white' : 'text-gray-400 hover:text-gray-700'}`}
              >
                <X size={16} />
              </button>
            </div>
            <Row label={t('shortcuts.save')}><ModKbd isDark={isDark} /><Kbd isDark={isDark}>S</Kbd></Row>
            <Row label={t('shortcuts.delete')}><Kbd isDark={isDark}>Delete</Kbd><Or isDark={isDark} isZh={isZh} /><Kbd isDark={isDark}>⌫</Kbd></Row>
            <Row label={t('shortcuts.undo')}><ModKbd isDark={isDark} /><Kbd isDark={isDark}>Z</Kbd></Row>
            <Row label={t('shortcuts.redo')}>
              <ModKbd isDark={isDark} /><Kbd isDark={isDark}>⇧ Shift</Kbd><Kbd isDark={isDark}>Z</Kbd>
              <Or isDark={isDark} isZh={isZh} />
              <ModKbd isDark={isDark} /><Kbd isDark={isDark}>Y</Kbd>
            </Row>
            <Row label={t('shortcuts.deselect')}><Kbd isDark={isDark} wide>Esc</Kbd></Row>
            <Row label={t('shortcuts.jumpToConnected')}><Kbd isDark={isDark} wide>Tab</Kbd></Row>
          </div>
        </div>
      </HoverBorderGradient>
    </div>,
    document.body
  );
};

// ============================================================================
// COMPONENT
// ============================================================================

export const Toolbar: React.FC<ToolbarProps> = ({
  onAddClick,
  onWorkflowsClick,
  onHistoryClick,
  onAssetsClick,
  onStoryboardClick,
  onAudioExtractorClick,
  onTTSClick,
  onIndexTTSClick,
  onVideoMergeClick,
  onSubtitleRemoverClick,
  onToolsOpen,
  onProfileClick,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) {
        setIsToolsOpen(false);
      }
    };

    if (isToolsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isToolsOpen]);

  /** Global `?` shortcut → open the shortcut panel anywhere on the canvas (skip while typing). */
  useEffect(() => {
    const isEditableTarget = (el: EventTarget | null): boolean => {
      const t = el as HTMLElement | null;
      if (!t) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      setIsShortcutsOpen(prev => !prev);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleToolClick = (callback?: (e: React.MouseEvent) => void) => (e: React.MouseEvent) => {
    setIsToolsOpen(false);
    callback?.(e);
  };

  const { isDark } = useTheme();

  return (
    <HoverBorderGradient
      containerClassName="fixed left-4 top-1/2 -translate-y-1/2 rounded-xl z-50"
      className={`rounded-[10px] ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`}
      fillClassName={isDark ? undefined : 'bg-white'}
      duration={4}
    >
    <div className="flex flex-col items-center gap-2 p-1.5 rounded-[10px] transition-colors duration-300">
      {isDark ? (
        <HoverBorderGradient
          as="button"
          containerClassName="rounded-xl mb-2"
          className="w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200 hover:scale-110 bg-transparent"
          duration={2}
          onClick={onAddClick}
        >
          <Plus size={20} />
        </HoverBorderGradient>
      ) : (
        <button
          className="lt-btn-primary text-white w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200 hover:scale-110 mb-2"
          onClick={onAddClick}
        >
          <Plus size={20} />
        </button>
      )}

      <div className="flex flex-col gap-4 py-2 px-1">
        <button
          className={`hover:scale-125 transition-all duration-200 ${isDark ? 'text-neutral-400 hover:sf-rainbow-text hover:drop-shadow-[0_0_6px_rgba(192,132,252,0.4)]' : 'text-gray-400 hover:sf-rainbow-text'
            }`}
          onClick={onWorkflowsClick}
          title={t('toolbar.myWorkflows')}
        >
          <LayoutGrid size={20} />
        </button>
        <button
          className={`hover:scale-125 transition-all duration-200 ${isDark ? 'text-neutral-400 hover:sf-rainbow-text hover:drop-shadow-[0_0_6px_rgba(192,132,252,0.4)]' : 'text-gray-400 hover:sf-rainbow-text'
            }`}
          title={t('toolbar.assets')}
          onClick={onAssetsClick}
        >
          <ImageIcon size={20} />
        </button>
        <button
          className={`hover:scale-125 transition-all duration-200 ${isDark ? 'text-neutral-400 hover:sf-rainbow-text hover:drop-shadow-[0_0_6px_rgba(192,132,252,0.4)]' : 'text-gray-400 hover:sf-rainbow-text'
            }`}
          onClick={onHistoryClick}
          title={t('toolbar.history')}
        >
          <History size={20} />
        </button>

        {/* Tools Dropdown */}
        <div className="relative" ref={toolsRef}>
          <button
            className={`hover:scale-125 transition-all duration-200 ${isDark
              ? `text-neutral-400 hover:sf-rainbow-text hover:drop-shadow-[0_0_6px_rgba(192,132,252,0.4)] ${isToolsOpen ? 'sf-rainbow-text' : ''}`
              : `text-gray-400 hover:sf-rainbow-text ${isToolsOpen ? 'sf-rainbow-text' : ''}`
              }`}
            onClick={() => {
              if (!isToolsOpen) {
                onToolsOpen?.();
              }
              setIsToolsOpen(!isToolsOpen);
            }}
            title={t('toolbar.tools')}
          >
            <Wrench size={20} />
          </button>

          {/* Dropdown Menu */}
          {isToolsOpen && (
            <HoverBorderGradient
              containerClassName="absolute left-12 top-0 rounded-xl min-w-[240px] z-50"
              className={`rounded-[10px] min-w-[240px] ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`}
              fillClassName={isDark ? undefined : 'bg-white'}
              duration={4}
            >
              <div className="rounded-xl py-2 min-w-[240px]">
                <button
                  onClick={handleToolClick(onStoryboardClick)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-all group ${isDark ? 'hover:bg-white/5' : 'hover:bg-neutral-100'}`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDark ? 'bg-white/5 border border-white/10' : 'bg-neutral-100 border border-neutral-200'}`}
                  >
                    <Film size={16} className={isDark ? 'text-white/70' : 'sf-rainbow-text'} />
                  </div>
                  <div className="text-left">
                    <p className={isDark ? 'text-sm text-white/90 group-hover:text-white' : 'text-sm text-gray-700 group-hover:sf-rainbow-text'}>{t('toolbar.storyboardGenerator')}</p>
                    <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-400'}`}>{t('toolbar.createScenesWithAI')}</p>
                  </div>
                </button>
                <button
                  onClick={handleToolClick(onAudioExtractorClick)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-all group ${isDark ? 'hover:bg-white/5' : 'hover:bg-neutral-100'}`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDark ? 'bg-white/5 border border-white/10' : 'bg-neutral-100 border border-neutral-200'}`}
                  >
                    <AudioLines size={16} className={isDark ? 'text-white/70' : 'sf-rainbow-text'} />
                  </div>
                  <div className="text-left">
                    <p className={isDark ? 'text-sm text-white/90 group-hover:text-white' : 'text-sm text-gray-700 group-hover:sf-rainbow-text'}>{t('toolbar.audioExtractor')}</p>
                    <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-400'}`}>{t('toolbar.extractAudioFromMedia')}</p>
                  </div>
                </button>
                <button
                  onClick={handleToolClick(onTTSClick)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-all group ${isDark ? 'hover:bg-white/5' : 'hover:bg-neutral-100'}`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDark ? 'bg-white/5 border border-white/10' : 'bg-neutral-100 border border-neutral-200'}`}
                  >
                    <Mic size={16} className={isDark ? 'text-white/70' : 'sf-rainbow-text'} />
                  </div>
                  <div className="text-left">
                    <p className={isDark ? 'text-sm text-white/90 group-hover:text-white' : 'text-sm text-gray-700 group-hover:sf-rainbow-text'}>{t('toolbar.tts')}</p>
                    <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-400'}`}>{t('toolbar.ttsDesc')}</p>
                  </div>
                </button>
                <button
                  onClick={handleToolClick(onIndexTTSClick)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-all group ${isDark ? 'hover:bg-white/5' : 'hover:bg-neutral-100'}`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDark ? 'bg-white/5 border border-white/10' : 'bg-neutral-100 border border-neutral-200'}`}
                  >
                    <Fingerprint size={16} className={isDark ? 'text-white/70' : 'sf-rainbow-text'} />
                  </div>
                  <div className="text-left">
                    <p className={isDark ? 'text-sm text-white/90 group-hover:text-white' : 'text-sm text-gray-700 group-hover:sf-rainbow-text'}>{t('toolbar.indexTts')}</p>
                    <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-400'}`}>{t('toolbar.indexTtsDesc')}</p>
                  </div>
                </button>
                <button
                  onClick={handleToolClick(onVideoMergeClick)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-all group ${isDark ? 'hover:bg-white/5' : 'hover:bg-neutral-100'}`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDark ? 'bg-white/5 border border-white/10' : 'bg-neutral-100 border border-neutral-200'}`}
                  >
                    <Combine size={16} className={isDark ? 'text-white/70' : 'sf-rainbow-text'} />
                  </div>
                  <div className="text-left">
                    <p className={isDark ? 'text-sm text-white/90 group-hover:text-white' : 'text-sm text-gray-700 group-hover:sf-rainbow-text'}>{t('toolbar.videoMerge')}</p>
                    <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-400'}`}>{t('toolbar.videoMergeDesc')}</p>
                  </div>
                </button>
                <button
                  onClick={handleToolClick(onSubtitleRemoverClick)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-all group ${isDark ? 'hover:bg-white/5' : 'hover:bg-neutral-100'}`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDark ? 'bg-white/5 border border-white/10' : 'bg-neutral-100 border border-neutral-200'}`}
                  >
                    <Eraser size={16} className={isDark ? 'text-white/70' : 'sf-rainbow-text'} />
                  </div>
                  <div className="text-left">
                    <p className={isDark ? 'text-sm text-white/90 group-hover:text-white' : 'text-sm text-gray-700 group-hover:sf-rainbow-text'}>{t('toolbar.subtitleRemover')}</p>
                    <p className={`text-xs ${isDark ? 'text-white/40' : 'text-gray-400'}`}>{t('toolbar.subtitleRemoverDesc')}</p>
                  </div>
                </button>
              </div>
            </HoverBorderGradient>
          )}
        </div>

        <button
          className={`hover:scale-125 transition-all duration-200 ${isDark ? 'text-neutral-400 hover:sf-rainbow-text hover:drop-shadow-[0_0_6px_rgba(192,132,252,0.4)]' : 'text-gray-400 hover:sf-rainbow-text'} ${isShortcutsOpen ? 'sf-rainbow-text' : ''}`}
          onClick={() => setIsShortcutsOpen(!isShortcutsOpen)}
          title={`${t('toolbar.shortcuts')} (?)`}
        >
          <HelpCircle size={18} />
        </button>
      </div>

      <div className={`w-8 h-[1px] my-1 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}></div>

      {user?.role === 'admin' && (
        <button
          className={`hover:scale-125 transition-all duration-200 mb-2 ${isDark ? 'text-amber-500/60 hover:text-amber-400 hover:drop-shadow-[0_0_6px_rgba(245,158,11,0.4)]' : 'text-amber-500/60 hover:text-amber-500'}`}
          onClick={() => navigate('/admin')}
          title={t('admin.title')}
        >
          <Shield size={18} />
        </button>
      )}

      <button
        className={`w-9 h-9 rounded-full overflow-hidden mb-1 hover:scale-110 transition-all duration-200 ${isDark ? 'border border-white/10 hover:border-white/40 hover:shadow-[0_0_8px_rgba(192,132,252,0.3)]' : 'border border-gray-200 shadow-sm hover:border-white/40'
        }`}
        onClick={onProfileClick}
        title={t('profile.title')}
      >
        <img
          src={ossThumb(user?.avatar_url, 36) || 'https://api.dicebear.com/7.x/initials/svg?seed=' + (user?.nickname || user?.username || 'U')}
          alt="Profile"
          className="w-full h-full object-cover"
        />
      </button>

      {isShortcutsOpen && <ShortcutsPanel isDark={isDark} onClose={() => setIsShortcutsOpen(false)} />}
    </div>
    </HoverBorderGradient>
  );
};
