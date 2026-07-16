/**
 * CanvasNode.tsx
 * 
 * Main canvas node component.
 * Orchestrates NodeContent, NodeControls, and NodeConnectors sub-components.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2 } from 'lucide-react';
import { NodeData, NodeStatus, NodeType } from '../../types';
import { NodeConnectors } from './NodeConnectors';
import { NodeContent } from './NodeContent';
import { NodeControls } from './NodeControls';
import { ChangeAnglePanel } from './ChangeAnglePanel';
import { assetUrl, ossResize, ossVideoPoster, API_URL, authFetch } from '../../config/api';
import { HoverBorderGradient } from '../ui/hover-border-gradient';
import { useTheme } from '../../hooks/useTheme';

function triggerBlobDownload(blob: Blob, filename: string) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(blobUrl);
}

const OSS_CUSTOM_DOMAIN = (import.meta.env.VITE_OSS_CUSTOM_DOMAIN as string) || '';

function isOssUrl(url: string): boolean {
  if (!url) return false;
  if (/\.oss[-.].*aliyuncs\.com\//.test(url)) return true;
  return !!OSS_CUSTOM_DOMAIN && url.includes(OSS_CUSTOM_DOMAIN);
}

async function downloadFile(url: string, filename: string) {
  if (url.startsWith('data:')) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return;
  }

  const cleanUrl = url.split('?')[0];

  // For OSS URLs, skip the direct CORS fetch (OSS typically blocks cross-origin)
  // and go straight to the server proxy which is much faster.
  if (!isOssUrl(cleanUrl)) {
    try {
      const res = await fetch(cleanUrl, { mode: 'cors', cache: 'no-store' });
      if (res.ok) {
        const blob = await res.blob();
        triggerBlobDownload(blob, filename);
        return;
      }
    } catch {}
  }

  try {
    const proxyRes = await authFetch(`${API_URL}/download?url=${encodeURIComponent(cleanUrl)}`);
    if (proxyRes.ok) {
      const blob = await proxyRes.blob();
      triggerBlobDownload(blob, filename);
      return;
    }
  } catch {}

  window.open(cleanUrl, '_blank');
}

interface CanvasNodeProps {
  data: NodeData;
  inputUrl?: string;
  connectedImageNodes?: { id: string; url: string; type?: NodeType }[]; // For frame-to-frame video mode and motion control
  allNodes?: NodeData[];
  onUpdate: (id: string, updates: Partial<NodeData>) => void;
  onGenerate: (id: string) => void;
  onAddNext: (id: string, type: 'left' | 'right', x?: number, y?: number) => void;
  selected: boolean;
  showControls?: boolean; // Only show controls when single node is selected (not in group selection)
  onSelect: (id: string) => void;
  onNodePointerDown: (e: React.PointerEvent, id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onConnectorDown: (e: React.PointerEvent, id: string, side: 'left' | 'right') => void;
  isHoveredForConnection?: boolean;
  onOpenEditor?: (nodeId: string) => void;
  onUpload?: (nodeId: string, imageDataUrl: string) => void;
  onExpand?: (imageUrl: string) => void;
  isMediaExpanded?: boolean;
  onDragStart?: (nodeId: string, hasContent: boolean) => void;
  onDragEnd?: () => void;
  // Text node callbacks
  onWriteContent?: (nodeId: string) => void;
  onTextToVideo?: (nodeId: string) => void;
  onTextToImage?: (nodeId: string) => void;
  // Image node callbacks
  onImageToImage?: (nodeId: string) => void;
  onImageToVideo?: (nodeId: string) => void;
  onChangeAngleGenerate?: (nodeId: string) => void;
  onThreeViewGenerate?: (nodeId: string) => void;
  zoom: number;
  // Mouse event callbacks for chat panel drag functionality
  onMouseEnter?: (nodeId: string) => void;
  onMouseLeave?: (nodeId: string) => void;
}

export const CanvasNode: React.FC<CanvasNodeProps> = React.memo(({
  data,
  inputUrl,
  connectedImageNodes,
  allNodes,
  onUpdate,
  onGenerate,
  onAddNext,
  selected,
  showControls = true, // Default to true for backward compatibility
  onSelect,
  onNodePointerDown,
  onContextMenu,
  onConnectorDown,
  isHoveredForConnection,
  onOpenEditor,
  onUpload,
  onExpand,
  isMediaExpanded,
  onDragStart,
  onDragEnd,
  onWriteContent,
  onTextToVideo,
  onTextToImage,
  onImageToImage,
  onImageToVideo,
  onChangeAngleGenerate,
  onThreeViewGenerate,
  zoom,
  onMouseEnter,
  onMouseLeave,
}) => {
  // ============================================================================
  // STATE
  // ============================================================================

  const { t } = useTranslation();
  const { isDark } = useTheme();

  const STALE_I18N_RE = /^(nodes|contextMenu|common)\./;
  const nodeTypeLabels: Record<string, string> = {
    'Image': t('nodes.image'),
    'Video': t('nodes.video'),
    'Text': t('nodes.text'),
    'Audio': t('nodes.audio'),
    'Image Editor': t('nodes.imageEditor'),
    'Video Editor': t('nodes.videoEditorNode'),
    'Camera Angle': t('nodes.cameraAngle'),
    'Local Image Model': t('contextMenu.localImageModel'),
    'Local Video Model': t('contextMenu.localVideoModel'),
    'Storyboard Manager': t('contextMenu.storyboardManager'),
  };
  const getDisplayTitle = () => {
    if (data.title && !STALE_I18N_RE.test(data.title)) return data.title;
    return nodeTypeLabels[data.type] || data.type;
  };

  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const [editedTitle, setEditedTitle] = React.useState(getDisplayTitle());
  const titleInputRef = React.useRef<HTMLInputElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const isIdle = data.status === NodeStatus.IDLE || data.status === NodeStatus.ERROR;
  const isLoading = data.status === NodeStatus.LOADING;
  const isSuccess = data.status === NodeStatus.SUCCESS;

  const hideOverlays = zoom < 0.45;

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Focus input when entering edit mode
  React.useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Update local state when data.title changes
  React.useEffect(() => {
    setEditedTitle(getDisplayTitle());
  }, [data.title, data.type, t]);

  // Auto-detect aspect ratio for legacy images/videos that don't have resultAspectRatio
  React.useEffect(() => {
    // Only detect if we have a result but no stored aspect ratio
    if (!isSuccess || !data.resultUrl || data.resultAspectRatio) return;

    if (data.type === NodeType.VIDEO) {
      // Detect video dimensions
      const video = document.createElement('video');
      video.onloadedmetadata = () => {
        if (video.videoWidth && video.videoHeight) {
          onUpdate(data.id, { resultAspectRatio: `${video.videoWidth}/${video.videoHeight}` });
        }
      };
      video.src = data.resultUrl;
    } else {
      // Detect image dimensions
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight) {
          onUpdate(data.id, { resultAspectRatio: `${img.naturalWidth}/${img.naturalHeight}` });
        }
      };
      img.src = data.resultUrl;
    }
  }, [isSuccess, data.resultUrl, data.resultAspectRatio, data.type, data.id, onUpdate]);

  // ============================================================================
  // HELPERS
  // ============================================================================

  const aspectRatioStyle = React.useMemo(() => {
    if (isSuccess && data.resultUrl) {
      if (data.resultAspectRatio) {
        return { aspectRatio: data.resultAspectRatio };
      }
      if (data.type === NodeType.VIDEO) {
        return { aspectRatio: '16/9' };
      }
      return { aspectRatio: '1/1' };
    }

    if (data.type === NodeType.VIDEO) {
      return { aspectRatio: '16/9' };
    }

    const ratio = data.aspectRatio || 'Auto';
    if (ratio === 'Auto') return { aspectRatio: '16/9' };

    const [w, h] = ratio.split(':');
    return { aspectRatio: `${w}/${h}` };
  }, [isSuccess, data.resultUrl, data.resultAspectRatio, data.type, data.aspectRatio]);

  const handleTitleSave = () => {
    setIsEditingTitle(false);
    const trimmed = editedTitle.trim();
    if (trimmed && trimmed !== data.type && !STALE_I18N_RE.test(trimmed)) {
      onUpdate(data.id, { title: trimmed });
    } else if (!trimmed || STALE_I18N_RE.test(trimmed)) {
      setEditedTitle(getDisplayTitle());
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  // Special rendering for Image Editor node
  if (data.type === NodeType.IMAGE_EDITOR) {
    return (
      <div
        className={`absolute flex items-center group/node touch-none pointer-events-auto canvas-node`}
        style={{
          transform: `translate(${data.x}px, ${data.y}px)`,
          transition: 'box-shadow 0.2s',
          zIndex: selected ? 50 : 10
        }}
        onPointerDown={(e) => onNodePointerDown(e, data.id)}
        onContextMenu={(e) => onContextMenu(e, data.id)}
      >
        <NodeConnectors nodeId={data.id} onConnectorDown={onConnectorDown} />

        {/* Image Editor Node Card */}
        <HoverBorderGradient
          containerClassName="rounded-xl"
          className={`rounded-[10px] ${isDark ? 'bg-[var(--sf-bg-card)]' : 'bg-white'}`}
          fillClassName={isDark ? undefined : 'bg-white'}
          duration={4}
          style={{
            width: inputUrl ? 'auto' : '340px',
            maxWidth: inputUrl ? '500px' : 'none'
          }}
        >
        <div
          className={`relative rounded-[10px] transition-all duration-200 flex flex-col ${isDark ? '' : 'lt-card'} ${selected ? (isDark ? 'shadow-[0_0_25px_rgba(192,132,252,0.2)]' : 'lt-card-selected') : ''}`}
          style={{
            width: inputUrl ? 'auto' : '336px',
            maxWidth: inputUrl ? '496px' : 'none'
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (onOpenEditor) {
              onOpenEditor(data.id);
            }
          }}
        >
          {/* Header */}
          <div className={`absolute -top-8 left-0 text-sm px-2 py-0.5 rounded font-medium ${isDark ? 'text-white/80' : 'text-gray-600'}`}>
            {t('nodes.imageEditor')}
          </div>

          {/* Content Area */}
          <div
            className={`flex flex-col items-center justify-center ${inputUrl || data.resultUrl ? 'p-0' : 'p-6'}`}
            style={{ minHeight: inputUrl || data.resultUrl ? 'auto' : '380px' }}
          >
            {inputUrl || data.resultUrl ? (
              <div
                className={`relative w-full bg-black group/image ${selected ? 'rounded-xl overflow-hidden' : ''}`}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (onExpand && (data.resultUrl || inputUrl)) onExpand((data.resultUrl || inputUrl)!);
                }}
              >
                <img
                  src={ossResize(assetUrl(data.resultUrl || inputUrl), 500)}
                  alt="Content"
                  className="w-full h-full object-cover pointer-events-none"
                  style={{ maxHeight: '500px' }}
                  draggable={false}
                />
                {onExpand && (data.resultUrl || inputUrl) && (
                  <button
                    className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black/80 rounded-lg text-white opacity-0 group-hover/image:opacity-100 transition-all z-10"
                    onClick={() => onExpand((data.resultUrl || inputUrl)!)}
                    onPointerDown={(e) => e.stopPropagation()}
                    title={t('nodes.viewFullSize')}
                  >
                    <Maximize2 size={14} />
                  </button>
                )}
              </div>
            ) : (
              <div className={`text-center text-sm ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>
                {t('nodes.doubleClickToOpenEditor')}
              </div>
            )}
          </div>

        </div>
        </HoverBorderGradient>
      </div>
    );
  }

  // Special rendering for Camera Angle node (result view)
  if (data.type === NodeType.CAMERA_ANGLE) {
    return (
      <div
        className={`absolute flex items-center group/node touch-none pointer-events-auto canvas-node`}
        style={{
          transform: `translate(${data.x}px, ${data.y}px)`,
          transition: 'box-shadow 0.2s',
          zIndex: selected ? 50 : 10
        }}
        onPointerDown={(e) => onNodePointerDown(e, data.id)}
        onContextMenu={(e) => onContextMenu(e, data.id)}
      >
        <NodeConnectors nodeId={data.id} onConnectorDown={onConnectorDown} />

        {/* Relative wrapper for the Card */}
        <div className="relative group/nodecard">
          {/* Unified Toolbar - Appears above the card on hover (hidden during multi-select or when in a group) */}
          {showControls && !hideOverlays && !data.groupId && data.resultUrl && (
            <div
              className="absolute -top-20 left-0 right-0 flex justify-center opacity-0 group-hover/nodecard:opacity-100 transition-opacity z-20"
            >
              <HoverBorderGradient
                containerClassName="rounded-lg"
                className={`rounded-md ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`}
                fillClassName={isDark ? undefined : 'bg-white'}
                duration={3}
              ><div className="flex items-center gap-1 px-2 py-1.5">
                {/* TODO: Re-enable "Change Angle" button once the angle model is deployed */}
                {/* Download Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (data.resultUrl) downloadFile(data.resultUrl, `image_${data.id}.png`);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={`p-1.5 rounded-full transition-colors ${isDark ? 'text-neutral-300 hover:bg-neutral-700 hover:text-white' : 'text-gray-500 hover:bg-neutral-100 hover:sf-rainbow-text'}`}
                  title={t('common.download')}
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
                {/* Drag to Chat Handle */}
                <div
                  draggable
                  onPointerDown={(e) => e.stopPropagation()}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/json', JSON.stringify({
                      nodeId: data.id,
                      url: data.resultUrl,
                      type: 'image'
                    }));
                    e.dataTransfer.effectAllowed = 'copy';
                    onDragStart?.(data.id, true);
                  }}
                  onDragEnd={() => onDragEnd?.()}
                  className={`p-1.5 rounded-full cursor-grab active:cursor-grabbing ${isDark ? 'sf-rainbow-btn' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  title={t('nodes.dragToChat')}
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="9" cy="5" r="1" fill="currentColor" />
                    <circle cx="9" cy="12" r="1" fill="currentColor" />
                    <circle cx="9" cy="19" r="1" fill="currentColor" />
                    <circle cx="15" cy="5" r="1" fill="currentColor" />
                    <circle cx="15" cy="12" r="1" fill="currentColor" />
                    <circle cx="15" cy="19" r="1" fill="currentColor" />
                  </svg>
                </div>
              </div>
              </HoverBorderGradient>
            </div>
          )}

          {/* Node Card */}
          <HoverBorderGradient
            containerClassName="w-[344px] rounded-xl"
            className={`rounded-[10px] ${isDark ? 'bg-[var(--sf-bg-card)]' : 'bg-white'}`}
            fillClassName={isDark ? undefined : 'bg-white'}
            duration={4}
          >
          <div
            className={`relative w-[340px] rounded-[10px] transition-all duration-200 flex flex-col ${isDark ? '' : 'lt-card'} ${selected ? (isDark ? 'shadow-[0_0_25px_rgba(192,132,252,0.2)]' : 'lt-card-selected') : ''}`}
          >
            {/* Header */}
            <div className={`absolute -top-8 left-0 text-sm px-2 py-0.5 rounded font-medium ${isDark ? 'text-white/80' : 'text-gray-600'}`}>
              {t('nodes.cameraAngle')}
            </div>

            {/* Content Area */}
            <div
              className={`flex flex-col items-center justify-center ${data.resultUrl ? 'p-0' : 'p-6'}`}
              style={{ minHeight: data.resultUrl ? 'auto' : '340px' }}
            >
              {data.resultUrl ? (
                <div
                  className={`relative w-full bg-black group/image ${selected ? 'rounded-xl overflow-hidden' : ''}`}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (onExpand && data.resultUrl) onExpand(data.resultUrl);
                  }}
                >
                  <img
                    src={ossResize(assetUrl(data.resultUrl), 400)}
                    alt="Content"
                    className="w-full h-auto object-cover pointer-events-none"
                    draggable={false}
                  />
                  {onExpand && (
                    <button
                      className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black/80 rounded-lg text-white opacity-0 group-hover/image:opacity-100 transition-all z-10"
                      onClick={() => onExpand(data.resultUrl!)}
                      onPointerDown={(e) => e.stopPropagation()}
                      title={t('nodes.viewFullSize')}
                    >
                      <Maximize2 size={14} />
                    </button>
                  )}
                </div>
              ) : (
                <div className={`flex flex-col items-center gap-3 ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>
                  <div className={`animate-spin rounded-full h-8 w-8 border-b-2 ${isDark ? 'border-white/60' : 'border-gray-400'}`}></div>
                  <span className="text-sm">{t('nodes.generatingNewAngle')}</span>
                </div>
              )}
            </div>
          </div>
          </HoverBorderGradient>

          {/* TODO: Re-enable ChangeAnglePanel once the angle model is deployed */}
        </div>
      </div>
    );
  }

  // Special rendering for Video Editor node
  if (data.type === NodeType.VIDEO_EDITOR) {
    // Get video URL from parent node or own resultUrl
    const videoUrl = inputUrl || data.resultUrl;

    return (
      <div
        className={`absolute flex items-center group/node touch-none pointer-events-auto canvas-node`}
        style={{
          transform: `translate(${data.x}px, ${data.y}px)`,
          transition: 'box-shadow 0.2s',
          zIndex: selected ? 50 : 10
        }}
        onPointerDown={(e) => onNodePointerDown(e, data.id)}
        onContextMenu={(e) => onContextMenu(e, data.id)}
      >
        <NodeConnectors nodeId={data.id} onConnectorDown={onConnectorDown} />

        {/* Video Editor Node Card */}
        <HoverBorderGradient
          containerClassName="rounded-xl"
          className={`rounded-[10px] ${isDark ? 'bg-[var(--sf-bg-card)]' : 'bg-white'}`}
          fillClassName={isDark ? undefined : 'bg-white'}
          duration={4}
          style={{
            width: videoUrl ? 'auto' : '340px',
            maxWidth: videoUrl ? '500px' : 'none'
          }}
        >
        <div
          className={`relative rounded-[10px] transition-all duration-200 flex flex-col ${isDark ? '' : 'lt-card'} ${selected ? (isDark ? 'shadow-[0_0_25px_rgba(192,132,252,0.2)]' : 'lt-card-selected') : ''}`}
          style={{
            width: videoUrl ? 'auto' : '336px',
            maxWidth: videoUrl ? '496px' : 'none'
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (onOpenEditor) {
              onOpenEditor(data.id);
            }
          }}
        >
          {/* Header */}
          <div className={`absolute -top-8 left-0 text-sm px-2 py-0.5 rounded font-medium ${isDark ? 'text-white/80' : 'text-gray-600'}`}>
            {t('nodes.videoEditorNode')}
          </div>

          {/* Content Area */}
          <div
            className={`flex flex-col items-center justify-center ${videoUrl ? 'p-0' : 'p-6'}`}
            style={{ minHeight: videoUrl ? 'auto' : '380px' }}
          >
            {videoUrl ? (
              <div className={`relative w-full bg-black group/image ${selected ? 'rounded-xl overflow-hidden' : ''}`}>
                <video
                  src={assetUrl(videoUrl)}
                  poster={ossVideoPoster(assetUrl(videoUrl), 500) || undefined}
                  className="w-full h-auto object-cover"
                  style={{ maxHeight: '500px', aspectRatio: '16/9' }}
                  muted
                  playsInline
                  preload="metadata"
                  onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play()}
                  onMouseLeave={(e) => {
                    const video = e.currentTarget as HTMLVideoElement;
                    video.pause();
                    video.currentTime = 0;
                  }}
                />
              </div>
            ) : (
              <div className={`text-center text-sm ${isDark ? 'text-neutral-500' : 'text-gray-400'}`}>
                <p>{t('nodes.connectVideoNode')}</p>
                <p className={`text-xs mt-1 ${isDark ? 'text-neutral-600' : 'text-gray-300'}`}>{t('nodes.doubleClickToOpenEditor')}</p>
              </div>
            )}
          </div>

        </div>
        </HoverBorderGradient>
      </div>
    );
  }

  return (
    <div
      className={`absolute group/node touch-none pointer-events-auto`}
      style={{
        transform: `translate(${data.x}px, ${data.y}px)`,
        transition: 'box-shadow 0.2s',
        zIndex: selected ? 50 : 10,
        transformOrigin: 'top left'
      }}
      onPointerDown={(e) => onNodePointerDown(e, data.id)}
      onContextMenu={(e) => onContextMenu(e, data.id)}
      onMouseEnter={() => onMouseEnter?.(data.id)}
      onMouseLeave={() => onMouseLeave?.(data.id)}
    >
      <NodeConnectors nodeId={data.id} onConnectorDown={onConnectorDown} />

      {/* Relative wrapper for the Image Card to allow absolute positioning of controls below it */}
      <div className="relative group/nodecard">
        {/* Unified Toolbar - Appears above the card for Image nodes on hover (hidden during multi-select or when in a group) */}
        {showControls && !hideOverlays && !data.groupId && data.type === NodeType.IMAGE && isSuccess && data.resultUrl && (
          <div
            className="absolute -top-12 left-0 right-0 flex justify-center opacity-0 group-hover/nodecard:opacity-100 transition-opacity z-20"
          >
            <HoverBorderGradient
              containerClassName="rounded-lg"
              className={`rounded-md ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`}
              fillClassName={isDark ? undefined : 'bg-white'}
              duration={3}
            ><div className="flex items-center gap-1 px-2 py-1.5">
              {/* TODO: Re-enable "Change Angle" button once the angle model is deployed */}
              {(
                <>
                  {/* Three-View Button — hide on three-view result nodes */}
                  {!data.hideControls && (
                  <button
                    onClick={() => onThreeViewGenerate?.(data.id)}
                    onPointerDown={(e) => e.stopPropagation()}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${isDark ? 'text-neutral-300 hover:bg-neutral-700 hover:text-white' : 'text-gray-500 hover:bg-neutral-100 hover:sf-rainbow-text'}`}
                  >
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="3" width="20" height="18" rx="2" />
                      <line x1="8.5" y1="3" x2="8.5" y2="21" />
                      <line x1="15.5" y1="3" x2="15.5" y2="21" />
                    </svg>
                    {t('threeView.title')}
                  </button>
                  )}
                  {/* Separator */}
                  <div className="w-px h-4 bg-neutral-600 mx-1" />
                  {/* Upload Button */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    onPointerDown={(e) => e.stopPropagation()}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-full transition-colors ${isDark ? 'text-neutral-300 hover:bg-neutral-700 hover:text-white' : 'text-gray-500 hover:bg-neutral-100 hover:sf-rainbow-text'}`}
                    title={t('nodes.uploadImage')}
                  >
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    {t('common.upload')}
                  </button>
                  {/* Hidden file input for upload */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file && onUpload) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          const dataUrl = ev.target?.result as string;
                          onUpload(data.id, dataUrl);
                        };
                        reader.readAsDataURL(file);
                      }
                      e.target.value = ''; // Reset for re-upload
                    }}
                  />
                </>
              )}
              {/* Download Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (data.resultUrl) downloadFile(data.resultUrl, `image_${data.id}.png`);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className={`p-1.5 rounded-full transition-colors ${isDark ? 'text-neutral-300 hover:bg-neutral-700 hover:text-white' : 'text-gray-500 hover:bg-neutral-100 hover:sf-rainbow-text'}`}
                title={t('common.download')}
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
              {/* Drag to Chat Handle */}
              <div
                draggable
                onPointerDown={(e) => e.stopPropagation()}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/json', JSON.stringify({
                    nodeId: data.id,
                    url: data.resultUrl,
                    type: 'image'
                  }));
                  e.dataTransfer.effectAllowed = 'copy';
                  onDragStart?.(data.id, true);
                }}
                onDragEnd={() => onDragEnd?.()}
                className={`p-1.5 rounded-full cursor-grab active:cursor-grabbing ${isDark ? 'sf-rainbow-btn' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                title={t('nodes.dragToChat')}
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="9" cy="5" r="1" fill="currentColor" />
                  <circle cx="9" cy="12" r="1" fill="currentColor" />
                  <circle cx="9" cy="19" r="1" fill="currentColor" />
                  <circle cx="15" cy="5" r="1" fill="currentColor" />
                  <circle cx="15" cy="12" r="1" fill="currentColor" />
                  <circle cx="15" cy="19" r="1" fill="currentColor" />
                </svg>
              </div>
            </div>
            </HoverBorderGradient>
          </div>
        )}

        {/* Video Toolbar - Appears above the card for Video nodes on hover (hidden during multi-select or when in a group) */}
        {showControls && !hideOverlays && !data.groupId && data.type === NodeType.VIDEO && isSuccess && data.resultUrl && (
          <div
            className="absolute -top-20 left-0 right-0 flex justify-center opacity-0 group-hover/nodecard:opacity-100 transition-opacity z-20"
          >
            <HoverBorderGradient
              containerClassName="rounded-lg"
              className={`rounded-md ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`}
              fillClassName={isDark ? undefined : 'bg-white'}
              duration={3}
            ><div className="flex items-center gap-1 px-2 py-1.5">
              {/* Download Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (data.resultUrl) downloadFile(data.resultUrl, `video_${data.id}.mp4`);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className={`p-1.5 rounded-full transition-colors ${isDark ? 'text-neutral-300 hover:bg-neutral-700 hover:text-white' : 'text-gray-500 hover:bg-neutral-100 hover:sf-rainbow-text'}`}
                title={t('common.download')}
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
              {/* Drag to Chat Handle */}
              <div
                draggable
                onPointerDown={(e) => e.stopPropagation()}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/json', JSON.stringify({
                    nodeId: data.id,
                    url: data.resultUrl,
                    type: 'video'
                  }));
                  e.dataTransfer.effectAllowed = 'copy';
                  onDragStart?.(data.id, true);
                }}
                onDragEnd={() => onDragEnd?.()}
                className={`p-1.5 rounded-full cursor-grab active:cursor-grabbing ${isDark ? 'sf-rainbow-btn' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                title={t('nodes.dragToChat')}
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="9" cy="5" r="1" fill="currentColor" />
                  <circle cx="9" cy="12" r="1" fill="currentColor" />
                  <circle cx="9" cy="19" r="1" fill="currentColor" />
                  <circle cx="15" cy="5" r="1" fill="currentColor" />
                  <circle cx="15" cy="12" r="1" fill="currentColor" />
                  <circle cx="15" cy="19" r="1" fill="currentColor" />
                </svg>
              </div>
            </div>
            </HoverBorderGradient>
          </div>
        )}

        {/* Main Node Card - wrapped in HoverBorderGradient */}
        <HoverBorderGradient
          containerClassName={`${data.type === NodeType.VIDEO ? 'w-[389px]' : 'w-[369px]'} rounded-xl`}
          className={`rounded-[10px] ${isDark ? 'bg-[var(--sf-bg-card)]' : 'bg-white'}`}
          fillClassName={isDark ? undefined : 'bg-white'}
          duration={4}
        >
        <div
          className={`relative ${data.type === NodeType.VIDEO ? 'w-[385px]' : 'w-[365px]'} transition-all duration-300 flex flex-col ${isDark ? '' : 'lt-card rounded-[10px]'} ${selected ? (isDark ? 'shadow-[0_0_25px_rgba(192,132,252,0.2)]' : 'lt-card-selected') : ''}`}
        >
          {/* Header (Editable Title) - Positioned horizontally on top-left side */}
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleTitleSave();
                } else if (e.key === 'Escape') {
                  setEditedTitle(getDisplayTitle());
                  setIsEditingTitle(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className={`absolute top-2 text-sm px-2 py-0.5 rounded font-medium outline-none whitespace-nowrap ${isDark ? 'font-mono bg-white/10 text-white/90 border border-white/20' : 'bg-neutral-100 text-gray-900 border border-neutral-200'}`}
              style={{ right: 'calc(100% + 8px)', minWidth: '60px' }}
            />
          ) : (
            <div
              className={`absolute top-2 text-sm px-2 py-0.5 rounded font-medium transition-colors cursor-text whitespace-nowrap ${selected ? (isDark ? 'font-mono bg-white/10 text-white/90' : 'bg-neutral-100 sf-rainbow-text border border-neutral-200') : isDark ? 'font-mono text-white/50' : 'text-gray-400'}`}
              style={{ right: 'calc(100% + 8px)' }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setIsEditingTitle(true);
              }}
              title={t('nodes.doubleClickToEdit')}
            >
              {getDisplayTitle()}
            </div>
          )}

          {/* Content Area */}
          <NodeContent
            data={data}
            inputUrl={inputUrl}
            selected={selected}
            isIdle={isIdle}
            isLoading={isLoading}
            isSuccess={isSuccess}
            aspectRatioStyle={aspectRatioStyle}
            onUpload={onUpload}
            onExpand={onExpand}
            isMediaExpanded={isMediaExpanded}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onWriteContent={onWriteContent}
            onTextToVideo={onTextToVideo}
            onTextToImage={onTextToImage}
            onImageToImage={onImageToImage}
            onImageToVideo={onImageToVideo}
            onUpdate={onUpdate}
          />
        </div>
        </HoverBorderGradient>

        {/* Control Panel - Only show when single node is selected (not in group selection) */}
        {selected && showControls && !hideOverlays && data.type !== NodeType.TEXT && (
          <div
            className={`absolute top-[calc(100%+12px)] left-1/2 -translate-x-1/2 flex justify-center z-[100] ${data.hideControls ? 'w-auto' : 'w-[600px]'}`}
          >
            <NodeControls
              data={data}
              inputUrl={inputUrl}
              isLoading={isLoading}
              isSuccess={isSuccess}
              connectedImageNodes={connectedImageNodes}
              allNodes={allNodes}
              onUpdate={onUpdate}
              onGenerate={onGenerate}
              onChangeAngleGenerate={onChangeAngleGenerate}
              onSelect={onSelect}
              zoom={zoom}
            />
          </div>
        )}
      </div>
    </div >
  );
}, (prev, next) => {
  if (prev.data !== next.data) return false;
  if (prev.inputUrl !== next.inputUrl) return false;
  if (prev.connectedImageNodes !== next.connectedImageNodes) return false;
  if (prev.allNodes !== next.allNodes) return false;
  if (prev.selected !== next.selected) return false;
  if (prev.showControls !== next.showControls) return false;
  if (prev.isHoveredForConnection !== next.isHoveredForConnection) return false;
  if (prev.isMediaExpanded !== next.isMediaExpanded) return false;
  if ((prev.zoom < 0.45) !== (next.zoom < 0.45)) return false;
  return true;
});