import React, { useEffect, useRef, useState } from 'react';
import {
  Type,
  Image as ImageIcon,
  Video,
  Film,
  Music,
  PenTool,
  Layout,
  Upload,
  Trash2,
  Plus,
  Clipboard,
  Copy,
  Files,
  Layers,
  ChevronRight,
  HardDrive,
  Bookmark,
  BookmarkPlus,
  Sparkles,
  Box
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ContextMenuState, NodeType, NodeData } from '../types';
import { formatShortcut } from '../utils/platform';
import { useTheme } from '../hooks/useTheme';
import { HoverBorderGradient } from './ui/hover-border-gradient';

export interface NodeTemplate {
  id: string;
  name: string;
  type: NodeType;
  model: string;
  imageModel?: string;
  videoModel?: string;
  aspectRatio: string;
  resolution: string;
  videoDuration?: number;
  generateAudio?: boolean;
}

const TEMPLATES_KEY = 'chuhaibang_node_templates';

export function getNodeTemplates(): NodeTemplate[] {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '[]'); } catch { return []; }
}

export function saveNodeTemplate(tpl: NodeTemplate) {
  const list = getNodeTemplates();
  list.push(tpl);
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list));
}

export function deleteNodeTemplate(id: string) {
  const list = getNodeTemplates().filter(t => t.id !== id);
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list));
}

const PRESET_TEMPLATES: NodeTemplate[] = [
  { id: 'preset-cinema-video', name: '🎬 Cinematic Video', type: NodeType.VIDEO, model: 'kling', videoModel: 'kling-v2-6', aspectRatio: '16:9', resolution: '1080p', videoDuration: 5 },
  { id: 'preset-portrait-video', name: '📱 Short Video', type: NodeType.VIDEO, model: 'kling', videoModel: 'kling-v2-6', aspectRatio: '9:16', resolution: '1080p', videoDuration: 5 },
  { id: 'preset-hd-image', name: '🖼️ HD Image', type: NodeType.IMAGE, model: 'gem', imageModel: 'gem-3.1', aspectRatio: '16:9', resolution: '2K' },
  { id: 'preset-square-image', name: '📐 Square Image', type: NodeType.IMAGE, model: 'gem', imageModel: 'gem-3.1', aspectRatio: '1:1', resolution: '1K' },
  { id: 'preset-poster', name: '🎨 Poster', type: NodeType.IMAGE, model: 'gem', imageModel: 'gem-3.1', aspectRatio: '3:4', resolution: '2K' },
];

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onSelectType: (type: NodeType | 'DELETE') => void;
  onUpload: (file: File) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onPaste?: () => void;
  onCopy?: () => void;
  onDuplicate?: () => void;
  onCreateAsset?: () => void;
  onAddAssets?: () => void;
  onMergeVideos?: () => void;
  showMergeVideos?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  selectedNodes?: NodeData[];
  onSaveAsTemplate?: (node: NodeData) => void;
  onApplyTemplate?: (template: NodeTemplate) => void;
  onReversePrompt?: (node: NodeData) => void;
  onThreeViewGenerate?: (node: NodeData) => void;
  onNewCanvas?: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  state,
  onClose,
  onSelectType,
  onUpload,
  onUndo,
  onRedo,
  onPaste,
  onCopy,
  onDuplicate,
  onCreateAsset,
  onAddAssets,
  onMergeVideos,
  showMergeVideos = false,
  canUndo = false,
  canRedo = false,
  selectedNodes = [],
  onSaveAsTemplate,
  onApplyTemplate,
  onReversePrompt,
  onThreeViewGenerate,
  onNewCanvas,
}) => {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<'main' | 'add-nodes'>('main');

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Reset view when menu opens or re-opens (new state)
  useEffect(() => {
    if (state.isOpen && state.type === 'global') {
      setView('main');
    }
  }, [state]);

  // Clamp menu position so it stays within the viewport
  useEffect(() => {
    if (!state.isOpen || !menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = state.x;
    let y = state.y;
    if (x + rect.width > window.innerWidth - pad) x = window.innerWidth - rect.width - pad;
    if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
    if (x < pad) x = pad;
    if (y < pad) y = pad;
    if (x !== state.x || y !== state.y) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
  }, [state.isOpen, state.x, state.y, view]);

  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
      onClose();
    }
    // Reset value so same file can be selected again
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleUndo = () => {
    if (onUndo && canUndo) {
      onUndo();
      onClose();
    }
  };

  const handleRedo = () => {
    if (onRedo && canRedo) {
      onRedo();
      onClose();
    }
  };

  const handlePaste = () => {
    if (onPaste) {
      onPaste();
      onClose();
    }
  };


  if (!state.isOpen) return null;

  // 1. Right Click on Node
  if (state.type === 'node-options') {
    return (
      <div
        ref={menuRef}
        style={{ position: 'fixed', left: state.x, top: state.y, zIndex: 1000 }}
        className="inline-block"
      >
        <HoverBorderGradient
          containerClassName="rounded-xl w-48 animate-in fade-in zoom-in-95 duration-100"
          className={`rounded-[10px] ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`}
          fillClassName={isDark ? undefined : 'bg-white'}
          duration={3}
        >
          <div className="flex flex-col overflow-hidden">
        <div className="p-1.5 flex flex-col gap-0.5">
          {selectedNodes.length <= 1 && (
            <MenuItem
              icon={<ImageIcon size={16} />}
              label={t('contextMenu.createAsset')}
              onClick={() => {
                if (onCreateAsset) {
                  onCreateAsset();
                  onClose();
                }
              }}
              active={false}
            />
          )}

          {onReversePrompt && (() => {
            const reversible = selectedNodes.filter(
              n => n.resultUrl && [NodeType.IMAGE, NodeType.VIDEO].includes(n.type)
            );
            if (reversible.length === 0) return null;
            const allReversing = reversible.every(n => n.isReversingPrompt);
            const anyReversing = reversible.some(n => n.isReversingPrompt);
            return (
              <MenuItem
                icon={<Sparkles size={16} />}
                label={anyReversing
                  ? t('contextMenu.reversingPrompt')
                  : reversible.length > 1
                    ? `${t('contextMenu.reversePrompt')} (${reversible.length})`
                    : t('contextMenu.reversePrompt')
                }
                disabled={allReversing}
                onClick={() => {
                  reversible.filter(n => !n.isReversingPrompt).forEach(n => onReversePrompt!(n));
                  onClose();
                }}
              />
            );
          })()}

          {onThreeViewGenerate && selectedNodes.length === 1 && (() => {
            const node = selectedNodes[0];
            if (node.type !== NodeType.IMAGE || !node.resultUrl || node.hideControls) return null;
            return (
              <MenuItem
                icon={<Box size={16} />}
                label={t('contextMenu.threeViewGenerate')}
                onClick={() => {
                  onThreeViewGenerate(node);
                  onClose();
                }}
              />
            );
          })()}

          <div className={`my-1 border-t mx-1 ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`} />

          <MenuItem
            icon={<Copy size={16} />}
            label={t('common.copy')}
            shortcut={formatShortcut('C')}
            onClick={() => {
              if (onCopy) {
                onCopy();
                onClose();
              }
            }}
          />
          <MenuItem
            icon={<Clipboard size={16} />}
            label={t('common.paste')}
            shortcut={formatShortcut('V')}
            onClick={handlePaste}
            disabled={true}
          />
          <MenuItem
            icon={<Files size={16} />}
            label={t('common.duplicate')}
            onClick={() => {
              if (onDuplicate) {
                onDuplicate();
                onClose();
              }
            }}
          />

          {showMergeVideos && onMergeVideos && (() => {
            const videoCount = selectedNodes.filter(n => n.type === NodeType.VIDEO && n.resultUrl).length;
            return (
              <>
                <div className={`my-1 border-t mx-1 ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`} />
                <MenuItem
                  icon={<Film size={16} />}
                  label={videoCount > 1 ? `${t('videoMerge.title')} (${videoCount})` : t('videoMerge.title')}
                  onClick={() => {
                    onMergeVideos();
                    onClose();
                  }}
                />
              </>
            );
          })()}

          {onSaveAsTemplate && selectedNodes.length === 1 && (
            <>
              <div className={`my-1 border-t mx-1 ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`} />
              <MenuItem
                icon={<BookmarkPlus size={16} />}
                label={t('contextMenu.saveAsTemplate')}
                onClick={() => {
                  onSaveAsTemplate(selectedNodes[0]);
                  onClose();
                }}
              />
            </>
          )}

          <div className={`my-1 border-t mx-1 ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`} />

          <MenuItem
            icon={<Trash2 size={16} />}
            label={t('common.delete')}
            shortcut="⌫,del"
            onClick={() => onSelectType('DELETE')}
          />
        </div>
          </div>
        </HoverBorderGradient>
      </div>
    );
  }

  // 2. Connector Drag Drop (Add Next) — also handles group-connector
  const isConnector = state.type === 'node-connector' || state.type === 'group-connector';

  // If it's the Global Menu (Right Click on Blank), we show the specific options
  if (state.type === 'global' && view === 'main') {
    return (
      <div
        ref={menuRef}
        style={{ position: 'fixed', left: state.x, top: state.y, zIndex: 1000 }}
        className="inline-block"
      >
        <HoverBorderGradient
          containerClassName="rounded-xl w-64 animate-in fade-in zoom-in-95 duration-100"
          className={`rounded-[10px] ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`}
          fillClassName={isDark ? undefined : 'bg-white'}
          duration={3}
        >
          <div className="flex flex-col overflow-hidden">
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept="image/*,video/*"
          onChange={handleFileChange}
        />
        <div className="p-1.5 flex flex-col gap-0.5">
          <MenuItem
            icon={<Upload size={16} />}
            label={t('common.upload')}
            onClick={handleUploadClick}
          />
          <MenuItem
            icon={<Layers size={16} />}
            label={t('contextMenu.addAssets')}
            onClick={() => {
              if (onAddAssets) {
                onAddAssets();
                onClose();
              }
            }}
          />
          <div className={`my-1 border-t mx-1 ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`} />

          <MenuItem
            icon={<Plus size={16} />}
            label={t('contextMenu.addNodes')}
            rightSlot={<ChevronRight size={14} className={isDark ? 'text-neutral-500' : 'text-neutral-400'} />}
            onClick={() => setView('add-nodes')}
            active={false}
          />

          {onNewCanvas && (
            <>
              <div className={`my-1 border-t mx-1 ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`} />
              <MenuItem
                icon={<Plus size={16} />}
                label={t('common.newCanvas')}
                onClick={() => { onNewCanvas(); onClose(); }}
              />
            </>
          )}

          {showMergeVideos && onMergeVideos && (() => {
            const videoCount = selectedNodes.filter(n => n.type === NodeType.VIDEO && n.resultUrl).length;
            return (
              <>
                <div className={`my-1 border-t mx-1 ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`} />
                <MenuItem
                  icon={<Film size={16} />}
                  label={videoCount > 1 ? `${t('videoMerge.title')} (${videoCount})` : t('videoMerge.title')}
                  onClick={() => {
                    onMergeVideos();
                    onClose();
                  }}
                />
              </>
            );
          })()}
        </div>
          </div>
        </HoverBorderGradient>
      </div>
    );
  }

  // 3. Add Nodes Menu (Global Submenu OR Connector Default)
  const title = isConnector ? t('contextMenu.generateFromThisNode') : t('contextMenu.addNodes');

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: state.x,
        top: state.y,
        zIndex: 1000
      }}
      className="inline-block"
    >
      <HoverBorderGradient
        containerClassName="rounded-xl w-64 animate-in fade-in zoom-in-95 duration-100"
        className={`rounded-[10px] ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`}
        fillClassName={isDark ? undefined : 'bg-white'}
        duration={3}
      >
        <div className="flex flex-col overflow-hidden">
      <div className={`px-4 py-3 text-sm font-medium border-b ${isDark ? 'text-white/80 border-white/10' : 'text-gray-400 border-gray-100'
        }`}>
        {title}
      </div>

      <div className="p-2 flex flex-col gap-1 max-h-[400px] overflow-y-auto">
        <MenuItem
          icon={<Type size={18} />}
          label={isConnector ? t('contextMenu.textGeneration') : t('contextMenu.text')}
          desc={isConnector ? t('contextMenu.scriptAdCopyBrandText') : undefined}
          onClick={() => onSelectType(NodeType.TEXT)}
        />
        <MenuItem
          icon={<ImageIcon size={18} />}
          label={isConnector ? t('contextMenu.imageGeneration') : t('contextMenu.image')}
          desc={isConnector ? undefined : t('contextMenu.promotionalImagePosterCover')}
          active={false}
          onClick={() => onSelectType(NodeType.IMAGE)}
        />
        <MenuItem
          icon={<Video size={18} />}
          label={isConnector ? t('contextMenu.videoGeneration') : t('contextMenu.video')}
          onClick={() => onSelectType(NodeType.VIDEO)}
        />

        {!isConnector && (
          <MenuItem
            icon={<PenTool size={18} />}
            label={t('contextMenu.imageEditor')}
            onClick={() => onSelectType(NodeType.IMAGE_EDITOR)}
          />
        )}

        {!isConnector && (
          <MenuItem
            icon={<Film size={18} />}
            label={t('contextMenu.videoEditor')}
            onClick={() => onSelectType(NodeType.VIDEO_EDITOR)}
          />
        )}

        {/* --- Local Model Section --- */}
        <div className={`my-2 border-t mx-2 ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`} />
        <div className={`px-2 py-1 text-xs font-medium ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
          {t('contextMenu.localModels')}
        </div>

        <MenuItem
          icon={<HardDrive size={18} />}
          label={t('contextMenu.localImageModel')}
          desc={t('contextMenu.useDownloadedModels')}
          badge="NEW"
          onClick={() => onSelectType(NodeType.LOCAL_IMAGE_MODEL)}
        />
        <MenuItem
          icon={<HardDrive size={18} />}
          label={t('contextMenu.localVideoModel')}
          desc={t('contextMenu.animateDiffSVD')}
          badge="NEW"
          onClick={() => onSelectType(NodeType.LOCAL_VIDEO_MODEL)}
        />

        {/* --- Templates Section --- */}
        {onApplyTemplate && (() => {
          const userTemplates = getNodeTemplates();
          const allTemplates = [...PRESET_TEMPLATES, ...userTemplates];
          if (allTemplates.length === 0) return null;
          return (
            <>
              <div className={`my-2 border-t mx-2 ${isDark ? 'border-neutral-800' : 'border-neutral-100'}`} />
              <div className={`px-2 py-1 text-xs font-medium ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                {t('contextMenu.templates')}
              </div>
              {allTemplates.map(tpl => (
                <MenuItem
                  key={tpl.id}
                  icon={<Bookmark size={16} />}
                  label={tpl.name}
                  desc={`${tpl.type} · ${tpl.aspectRatio}`}
                  onClick={() => { onApplyTemplate(tpl); onClose(); }}
                />
              ))}
            </>
          );
        })()}
      </div>
        </div>
      </HoverBorderGradient>
    </div>
  );
};

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  desc?: string;
  badge?: string;
  shortcut?: string;
  active?: boolean;
  rightSlot?: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}

const MenuItem: React.FC<MenuItemProps> = ({ icon, label, desc, badge, shortcut, active, rightSlot, disabled, onClick }) => {
  const { isDark } = useTheme();
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`group flex items-center gap-3 w-full p-2 rounded-lg text-left transition-colors 
        ${disabled
          ? (isDark ? 'opacity-30' : 'opacity-25')
          : active
            ? (isDark ? 'bg-[#2a2a2a] text-white' : 'bg-neutral-100 text-neutral-900')
            : (isDark ? 'text-neutral-300 hover:bg-[#2a2a2a] hover:text-white' : 'text-gray-600 hover:bg-neutral-100 hover:sf-rainbow-text')}
      `}
    >
      <div className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors
        ${active
          ? (isDark ? 'bg-[#3a3a3a]' : 'bg-white')
          : (isDark ? 'bg-[#151515] group-hover:bg-[#3a3a3a]' : 'bg-neutral-100 group-hover:bg-white border border-transparent group-hover:border-neutral-200')}
        ${disabled ? 'bg-transparent' : ''}
      `}>
        {icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={`font-medium text-sm truncate ${disabled && !isDark ? 'text-neutral-400' : ''}`}>{label}</span>
          <div className="flex items-center gap-2">
            {badge && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${isDark ? 'bg-neutral-800 text-neutral-400 border-neutral-700' : 'bg-neutral-100 text-neutral-500 border-neutral-200'
                }`}>
                {badge}
              </span>
            )}
            {shortcut && (
              <span className={`text-xs font-sans ${isDark ? 'text-neutral-500' : 'text-neutral-400'
                }`}>{shortcut}</span>
            )}
            {rightSlot}
          </div>
        </div>
        {desc && (
          <p className={`text-xs mt-0.5 truncate ${isDark ? 'text-neutral-500' : 'text-neutral-400'
            }`}>{desc}</p>
        )}
      </div>
    </button>
  );
};