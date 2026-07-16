/**
 * App.tsx
 * 
 * Main application component for Chuhai Bang.
 * Orchestrates canvas, nodes, connections, and user interactions.
 * Uses custom hooks for state management and logic separation.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from './hooks/useTheme';
import { LocateFixed, Hand } from 'lucide-react';
import { Toolbar } from './components/Toolbar';
import { ProfileModal } from './components/modals/ProfileModal';
import { TopBar } from './components/TopBar';
import { CanvasNode } from './components/canvas/CanvasNode';
import { ConnectionsLayer } from './components/canvas/ConnectionsLayer';
import { AlignmentGuides } from './components/canvas/AlignmentGuides';
import { ContextMenu } from './components/ContextMenu';
import { ContextMenuState, NodeData, NodeGroup, NodeStatus, NodeType } from './types';
import { API_URL, authFetch, assetUrl } from './config/api';
import { generateImage, generateVideo } from './services/generationService';
import { useCanvasNavigation } from './hooks/useCanvasNavigation';
import { useNodeManagement } from './hooks/useNodeManagement';
import { useConnectionDragging } from './hooks/useConnectionDragging';
import { useNodeDragging } from './hooks/useNodeDragging';
import { useGeneration } from './hooks/useGeneration';
import { useSelectionBox } from './hooks/useSelectionBox';
import { useGroupManagement } from './hooks/useGroupManagement';
import { useHistory } from './hooks/useHistory';
import { useCanvasTitle } from './hooks/useCanvasTitle';
import { useWorkflow } from './hooks/useWorkflow';
import { useImageEditor } from './hooks/useImageEditor';
import { useVideoEditor } from './hooks/useVideoEditor';
import { usePanelState } from './hooks/usePanelState';
import { useAssetHandlers } from './hooks/useAssetHandlers';
import { useTextNodeHandlers } from './hooks/useTextNodeHandlers';
import { useImageNodeHandlers } from './hooks/useImageNodeHandlers';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useContextMenuHandlers } from './hooks/useContextMenuHandlers';
import { useAutoSave } from './hooks/useAutoSave';
import { useGenerationRecovery } from './hooks/useGenerationRecovery';
import { useVideoFrameExtraction } from './hooks/useVideoFrameExtraction';
import { extractVideoLastFrame } from './utils/videoHelpers';
import { generateUUID } from './utils/uuid';
import { SelectionBoundingBox } from './components/canvas/SelectionBoundingBox';
import { WorkflowPanel } from './components/WorkflowPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { ChatPanel, ChatBubble } from './components/ChatPanel';
import type { CreateImageFromPrompt } from './components/ChatMessage';
import { useAgentActions } from './hooks/useAgentActions';
import type { AgentAction } from './hooks/useAgentChat';
import type { MediaItem } from './components/modals/ExpandedMediaModal';
import type { ThreeViewOptions } from './components/modals/ThreeViewOptionsModal';

const ImageEditorModal = React.lazy(() => import('./components/modals/ImageEditorModal').then(m => ({ default: m.ImageEditorModal })));
const VideoEditorModal = React.lazy(() => import('./components/modals/VideoEditorModal').then(m => ({ default: m.VideoEditorModal })));
const ExpandedMediaModal = React.lazy(() => import('./components/modals/ExpandedMediaModal').then(m => ({ default: m.ExpandedMediaModal })));
const CreateAssetModal = React.lazy(() => import('./components/modals/CreateAssetModal').then(m => ({ default: m.CreateAssetModal })));
const ThreeViewOptionsModal = React.lazy(() => import('./components/modals/ThreeViewOptionsModal').then(m => ({ default: m.ThreeViewOptionsModal })));
import { AssetLibraryPanel } from './components/AssetLibraryPanel';
import { useStoryboardGenerator } from './hooks/useStoryboardGenerator';
import type { SubtitleTrack, SubtitleCue, PendingAudioTrack } from './components/modals/VideoMergeModal';

const StoryboardGeneratorModal = React.lazy(() => import('./components/modals/StoryboardGeneratorModal').then(m => ({ default: m.StoryboardGeneratorModal })));
const StoryboardVideoModal = React.lazy(() => import('./components/modals/StoryboardVideoModal').then(m => ({ default: m.StoryboardVideoModal })));
const VideoMergeModal = React.lazy(() => import('./components/modals/VideoMergeModal').then(m => ({ default: m.VideoMergeModal })));
const AudioExtractorModal = React.lazy(() => import('./components/modals/AudioExtractorModal').then(m => ({ default: m.AudioExtractorModal })));
const TTSModal = React.lazy(() => import('./components/modals/TTSModal').then(m => ({ default: m.TTSModal })));
const IndexTTSModal = React.lazy(() => import('./components/modals/IndexTTSModal').then(m => ({ default: m.IndexTTSModal })));
const SubtitleRemoverModal = React.lazy(() => import('./components/modals/SubtitleRemoverModal').then(m => ({ default: m.SubtitleRemoverModal })));
import { HoverBorderGradient } from './components/ui/hover-border-gradient';
import { useCanvasTabs } from './hooks/useCanvasTabs';
import { TabBar } from './components/TabBar';
import { CanvasBackground } from './components/canvas/CanvasBackground';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

// Helper to convert URL/Blob to Base64
const urlToBase64 = async (url: string): Promise<string> => {
  if (url.startsWith('data:image')) return url;

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error("Error converting URL to base64:", e);
    return "";
  }
};

class CanvasErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[CanvasErrorBoundary]', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: '#ff6b6b', background: '#1a1a2e', minHeight: '100vh', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>页面渲染出错</h2>
          <p style={{ fontSize: 14, color: '#aaa', marginBottom: 24 }}>请点击下方按钮重试，如果问题持续请刷新页面。</p>
          <button onClick={() => this.setState({ error: null })} style={{ padding: '10px 24px', background: 'linear-gradient(135deg, #ff6b9d, #c084fc, #60a5fa)', color: '#fff', border: 'none', borderRadius: 20, cursor: 'pointer', fontSize: 14, fontWeight: 500 }}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  // ============================================================================
  // STATE
  // ============================================================================

  const { t } = useTranslation();
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    type: 'global'
  });

  const { isDark } = useTheme();
  const [libraryRefreshTrigger, setLibraryRefreshTrigger] = useState(0);

  // Panel state management (history, chat, asset library, expand)
  const {
    isHistoryPanelOpen,
    historyPanelY,
    handleHistoryClick: panelHistoryClick,
    closeHistoryPanel,
    expandedImageUrl,
    handleExpandImage,
    handleCloseExpand,
    isChatOpen,
    toggleChat,
    closeChat,
    isAssetLibraryOpen,
    assetLibraryY,
    assetLibraryVariant,
    handleAssetsClick: panelAssetsClick,
    closeAssetLibrary,
    openAssetLibraryModal,
    isDraggingNodeToChat,
    handleNodeDragStart,
    handleNodeDragEnd
  } = usePanelState();

  const [canvasHoveredNodeId, setCanvasHoveredNodeId] = useState<string | null>(null);


  // Read stored tab title from sessionStorage to avoid "未命名" flash on load
  const storedTabTitle = useMemo(() => {
    try {
      const stored = sessionStorage.getItem('chuhaibang_canvas_tabs');
      const activeId = sessionStorage.getItem('chuhaibang_active_tab');
      if (stored && activeId) {
        const tabs = JSON.parse(stored);
        const active = tabs.find((t: { id: string }) => t.id === activeId);
        if (active?.title) return active.title;
      }
    } catch { /* ignore */ }
    return '';
  }, []);

  // Canvas title state (via hook)
  const {
    canvasTitle,
    setCanvasTitle,
    isEditingTitle,
    setIsEditingTitle,
    editingTitleValue,
    setEditingTitleValue,
    canvasTitleInputRef
  } = useCanvasTitle(storedTabTitle);

  const {
    viewport,
    setViewport,
    canvasRef,
    handleWheel: baseHandleWheel,
    handleSliderZoom
  } = useCanvasNavigation();

  // Wrap handleWheel to pass hovered node for zoom-to-center
  const handleWheel = (e: React.WheelEvent) => {
    const hoveredNode = canvasHoveredNodeId ? nodeMap.get(canvasHoveredNodeId) : undefined;
    baseHandleWheel(e, hoveredNode);
  };

  const {
    nodes,
    setNodes,
    selectedNodeIds,
    setSelectedNodeIds,
    addNode,
    updateNode,
    deleteNode,
    deleteNodes,
    clearSelection,
    handleSelectTypeFromMenu,
    getNextNodeTitle
  } = useNodeManagement();

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const selectedNodeIdsRef = useRef(selectedNodeIds);
  selectedNodeIdsRef.current = selectedNodeIds;

  // Topology fingerprint: only changes when connections, results, or node list change — NOT on x/y moves
  const topologyKey = useMemo(() => {
    const parts: string[] = [];
    for (const n of nodes) {
      parts.push(n.id, n.type, n.status, (n.parentIds || []).join(','), n.resultUrl || '', n.lastFrame || '');
    }
    return parts.join('|');
  }, [nodes]);

  const nodeInputUrls = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const node of nodes) {
      if (!node.parentIds || node.parentIds.length === 0) { map.set(node.id, undefined); continue; }
      const parent = nodeMap.get(node.parentIds[0]);
      if (node.type === NodeType.VIDEO_EDITOR && parent?.type === NodeType.VIDEO) {
        map.set(node.id, parent.resultUrl); continue;
      }
      if (parent?.type === NodeType.VIDEO && parent.lastFrame) {
        map.set(node.id, parent.lastFrame); continue;
      }
      map.set(node.id, parent?.resultUrl);
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyKey]);

  const nodeConnectedImages = useMemo(() => {
    const map = new Map<string, { id: string; url: string; type?: NodeType }[]>();
    for (const node of nodes) {
      if (!node.parentIds || node.parentIds.length === 0) { map.set(node.id, []); continue; }
      map.set(node.id, node.parentIds
        .map(pid => nodeMap.get(pid))
        .filter(p => p && (p.type === NodeType.IMAGE || p.type === NodeType.VIDEO))
        .map(p => ({ id: p!.id, url: (p!.type === NodeType.VIDEO ? p!.lastFrame : p!.resultUrl) || p!.resultUrl || '', type: p!.type })));
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyKey]);

  const handleFitToNodes = useCallback(() => {
    if (nodes.length === 0) {
      setViewport({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const NODE_W = 365;
    const NODE_H = 400;
    const PAD = 80;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + NODE_W > maxX) maxX = n.x + NODE_W;
      if (n.y + NODE_H > maxY) maxY = n.y + NODE_H;
    }
    const bw = maxX - minX;
    const bh = maxY - minY;
    const vw = window.innerWidth - PAD * 2;
    const vh = window.innerHeight - PAD * 2;
    const zoom = Math.min(Math.max(Math.min(vw / bw, vh / bh), 0.1), 1);
    const cx = minX + bw / 2;
    const cy = minY + bh / 2;
    setViewport({
      x: window.innerWidth / 2 - cx * zoom,
      y: window.innerHeight / 2 - cy * zoom,
      zoom
    });
  }, [nodes, setViewport]);

  const {
    isDraggingConnection,
    connectionStart,
    tempConnectionEnd,
    hoveredNodeId: connectionHoveredNodeId,
    selectedConnection,
    setSelectedConnection,
    handleConnectorPointerDown,
    handleGroupConnectorPointerDown,
    updateConnectionDrag,
    completeConnectionDrag,
    handleEdgeClick,
    deleteSelectedConnection,
    showDragLine,
    connectionSourceGroup,
    groupBBoxOrigin,
    pendingGroupMenuLine,
    pendingMenuLine,
    clearPendingLine
  } = useConnectionDragging();

  const {
    handleNodePointerDown,
    updateNodeDrag,
    endNodeDrag,
    startPanning,
    updatePanning,
    endPanning,
    isDragging,
    isPanning,
    wasPanning,
    releasePointerCapture,
    alignGuides
  } = useNodeDragging();

  /** Space-held pan mode (Figma-style). Pointer-down on canvas with space held → pan instead of selection box. */
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const spaceHeldRef = useRef(false);
  useEffect(() => {
    const isEditableTarget = (el: EventTarget | null): boolean => {
      const t = el as HTMLElement | null;
      if (!t) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      if (!spaceHeldRef.current) {
        spaceHeldRef.current = true;
        setIsSpaceHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (spaceHeldRef.current) {
        spaceHeldRef.current = false;
        setIsSpaceHeld(false);
      }
    };
    const onBlur = () => {
      if (spaceHeldRef.current) {
        spaceHeldRef.current = false;
        setIsSpaceHeld(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const {
    selectionBox,
    isSelecting,
    startSelection,
    updateSelection,
    endSelection,
    clearSelectionBox
  } = useSelectionBox();

  const {
    groups,
    setGroups, // For workflow loading
    groupNodes,
    ungroupNodes,
    cleanupInvalidGroups,
    getCommonGroup,
    sortGroupNodes,
    renameGroup
  } = useGroupManagement();

  // History for undo/redo
  const {
    undo,
    redo,
    pushHistory,
    canUndo,
    canRedo
  } = useHistory({
    initialState: { nodes, groups },
    maxHistorySize: 50,
    onApply: (state: { nodes: NodeData[]; groups: typeof groups }) => {
      setNodes(state.nodes);
      setGroups(state.groups);
    }
  });

  // Workflow management
  const {
    workflowId,
    setWorkflowId,
    isWorkflowPanelOpen,
    workflowPanelY,
    handleSaveWorkflow,
    handleLoadWorkflow,
    handleWorkflowsClick,
    closeWorkflowPanel,
    resetWorkflowId
  } = useWorkflow({
    nodes,
    groups,
    viewport,
    canvasTitle,
    setNodes,
    setGroups,
    setSelectedNodeIds,
    setViewport,
    setCanvasTitle,
    setEditingTitleValue,
    onPanelOpen: () => {
      closeHistoryPanel();
      closeAssetLibrary();
    }
  });

  // Simple dirty flag for unsaved changes tracking
  const [isDirty, setIsDirty] = React.useState(false);
  const hasUnsavedChanges = isDirty && nodes.length > 0;

  // Mark as dirty when nodes or title change
  const isInitialMount = React.useRef(true);
  const lastLoadingCountRef = React.useRef(0);
  const ignoreNextChange = React.useRef(false);

  React.useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (ignoreNextChange.current) {
      ignoreNextChange.current = false;
      return;
    }

    setIsDirty(true);

    // Trigger immediate save if any node JUST entered LOADING state
    const currentLoadingCount = nodes.filter(n => n.status === NodeStatus.LOADING).length;
    if (currentLoadingCount > lastLoadingCountRef.current) {
      console.log('[App] New loading node detected, triggering immediate save for recovery protection');
      handleSaveWithTracking();
    }
    lastLoadingCountRef.current = currentLoadingCount;
  }, [nodes, groups, canvasTitle]);

  const handleSaveWithTracking = async (): Promise<boolean> => {
    const saved = await handleSaveWorkflow();
    if (saved) setIsDirty(false);
    return saved;
  };

  // Load workflow and update tracking
  const handleLoadWithTracking = async (id: string) => {
    // If the workflow is already open in another tab, just switch to it
    const existingTab = canvasTabs.tabs.find(t => t.workflowId === id);
    if (existingTab) {
      canvasTabs.switchTab(existingTab.id);
      return;
    }

    // If current tab has content, open in a new tab (skip empty-tab restore to avoid race)
    const isCurrentTabEmpty = nodes.length === 0 && !isDirty;
    if (!isCurrentTabEmpty) {
      canvasTabs.addTab(true);
    }

    ignoreNextChange.current = true;
    try {
      await handleLoadWorkflow(id);
    } catch (err) {
      console.error('Failed to load workflow:', err);
    }
    setIsDirty(false);
  };

  // ---- Tab management ----
  const workflowIdRef = useRef<string | null>(null);
  workflowIdRef.current = workflowId;
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;

  const canvasTabs = useCanvasTabs({
    getTitle: () => canvasTitle,
    getNodes: () => nodes,
    getGroups: () => groups,
    getViewport: () => viewport,
    getWorkflowId: () => workflowIdRef.current,
    getIsDirty: () => isDirtyRef.current,
    applyTitle: (title) => { setCanvasTitle(title); setEditingTitleValue(title); },
    applyNodes: (n) => { ignoreNextChange.current = true; setNodes(n); },
    applyGroups: setGroups,
    applyViewport: setViewport,
    applyWorkflowId: (id) => { setWorkflowId(id); },
    applyIsDirty: setIsDirty,
    applySelectedNodeIds: setSelectedNodeIds,
    onLoadWorkflow: (id) => {
      ignoreNextChange.current = true;
      handleLoadWorkflow(id)
        .then(() => { setIsDirty(false); })
        .catch(() => {});
    },
  });

  // Sync visual tab metadata (title, dirty indicator) to the active tab.
  // workflowId is synced only via snapshotCurrentTab / explicit updateTab calls.
  useEffect(() => {
    canvasTabs.updateTab(canvasTabs.activeTabId, { title: canvasTitle, isDirty });
  }, [canvasTitle, isDirty, canvasTabs.activeTabId]);

  // On mount: load the active tab's workflow from server.
  // Replaces the old useWorkflow mount effect — now coordinated with the tab system.
  const didMountRestoreRef = useRef(false);
  const needsInitialFitRef = useRef(false);
  useEffect(() => {
    if (didMountRestoreRef.current) return;
    didMountRestoreRef.current = true;
    const activeTab = canvasTabs.tabs.find(t => t.id === canvasTabs.activeTabId);
    const wfId = activeTab?.workflowId || workflowId;
    if (wfId) {
      needsInitialFitRef.current = true;
      ignoreNextChange.current = true;
      handleLoadWorkflow(wfId)
        .then(() => { setIsDirty(false); })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After initial load: always fit-to-nodes to guarantee canvas is usable
  useEffect(() => {
    if (!needsInitialFitRef.current || nodes.length === 0) return;
    needsInitialFitRef.current = false;
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      document.documentElement.scrollLeft = 0;
      document.documentElement.scrollTop = 0;
      handleFitToNodes();
    });
  }, [nodes, handleFitToNodes]);

  // Prevent accidental page-level scroll that breaks canvas event coordinates
  useEffect(() => {
    const resetScroll = () => {
      if (document.documentElement.scrollLeft !== 0 || document.documentElement.scrollTop !== 0) {
        document.documentElement.scrollLeft = 0;
        document.documentElement.scrollTop = 0;
      }
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };
    window.addEventListener('scroll', resetScroll, { passive: true });
    document.addEventListener('scroll', resetScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', resetScroll);
      document.removeEventListener('scroll', resetScroll);
    };
  }, []);

  const handleTabClose = useCallback((tabId: string) => {
    canvasTabs.closeTab(tabId);
  }, [canvasTabs]);

  const handleTabRename = useCallback((tabId: string, newTitle: string) => {
    canvasTabs.updateTab(tabId, { title: newTitle });
    if (tabId === canvasTabs.activeTabId) {
      setCanvasTitle(newTitle);
      setEditingTitleValue(newTitle);
    }
  }, [canvasTabs, setCanvasTitle, setEditingTitleValue]);

  const { handleGenerate: handleGenerateSingle } = useGeneration({
    nodes,
    updateNode
  });

  // Queue for batch-generated clone nodes that need generation triggered after state settles
  const pendingBatchIdsRef = React.useRef<string[]>([]);

  React.useEffect(() => {
    if (pendingBatchIdsRef.current.length === 0) return;
    const pending = [...pendingBatchIdsRef.current];
    pendingBatchIdsRef.current = [];
    pending.forEach(id => {
      if (nodeMap.has(id)) {
        handleGenerateSingle(id);
      }
    });
  }, [nodes, handleGenerateSingle]);

  const handleGenerate = React.useCallback((id: string) => {
    const node = nodesRef.current.find(n => n.id === id);
    if (!node) return;

    const count = node.generateCount || 1;

    if (count <= 1) {
      handleGenerateSingle(id);
      return;
    }

    handleGenerateSingle(id);

    const NODE_HEIGHT = 420;
    const GAP = 80;
    const cloneNodes: NodeData[] = [];
    const accumulated = [...nodesRef.current];

    for (let i = 1; i < count; i++) {
      const clone: NodeData = {
        id: generateUUID(),
        type: node.type,
        title: getNextNodeTitle(node.type, accumulated),
        x: node.x,
        y: node.y + i * (NODE_HEIGHT + GAP),
        prompt: node.prompt,
        status: NodeStatus.LOADING,
        model: node.model,
        aspectRatio: node.aspectRatio,
        resolution: node.resolution,
        parentIds: node.parentIds ? [...node.parentIds] : [],
        generateCount: 1,
        generationStartTime: Date.now(),
      };
      accumulated.push(clone);

      if (node.type === NodeType.VIDEO) {
        clone.videoModel = node.videoModel;
        clone.videoDuration = node.videoDuration;
        clone.generateAudio = node.generateAudio;
        clone.videoMode = node.videoMode;
        clone.frameInputs = node.frameInputs;
      } else {
        clone.imageModel = node.imageModel;
        clone.klingReferenceMode = node.klingReferenceMode;
        clone.klingFaceIntensity = node.klingFaceIntensity;
        clone.klingSubjectIntensity = node.klingSubjectIntensity;
        clone.characterReferenceUrls = node.characterReferenceUrls;
        clone.assetMentions = node.assetMentions;
      }

      cloneNodes.push(clone);
    }

    pendingBatchIdsRef.current = cloneNodes.map(n => n.id);
    setNodes(prev => [...prev, ...cloneNodes]);
  }, [handleGenerateSingle, setNodes]);

  // Keep a ref to handleGenerate so setTimeout callbacks can access the latest version
  const handleGenerateRef = React.useRef(handleGenerate);
  handleGenerateRef.current = handleGenerate;

  const handleCreateImageFromChat = React.useCallback((data: CreateImageFromPrompt) => {
    const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom - 170;
    const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom - 100;

    const newNode: NodeData = {
      id: generateUUID(),
      type: NodeType.IMAGE,
      title: data.title || getNextNodeTitle(NodeType.IMAGE),
      x: centerX,
      y: centerY,
      prompt: data.prompt,
      status: NodeStatus.IDLE,
      model: 'ChuHaiBang',
      imageModel: data.imageModel,
      aspectRatio: data.aspectRatio || '16:9',
      resolution: 'Auto',
      parentIds: [],
    };

    setNodes(prev => [...prev, newNode]);
    setSelectedNodeIds([newNode.id]);

    setTimeout(() => {
      handleGenerateRef.current(newNode.id);
    }, 100);
  }, [viewport, setNodes, setSelectedNodeIds, getNextNodeTitle]);

  const handleCreateAllImagesFromChat = React.useCallback((batch: CreateImageFromPrompt[]) => {
    if (batch.length === 0) return;

    const NODE_W = 380;
    const NODE_H = 300;
    const GAP = 40;
    const COLS = 4;

    const startX = (window.innerWidth / 2 - viewport.x) / viewport.zoom - ((Math.min(batch.length, COLS) * (NODE_W + GAP)) / 2);
    const startY = (window.innerHeight / 2 - viewport.y) / viewport.zoom - 150;

    const newNodes: NodeData[] = batch.map((data, i) => ({
      id: generateUUID(),
      type: NodeType.IMAGE,
      title: data.title || `镜头 ${i + 1}`,
      x: startX + (i % COLS) * (NODE_W + GAP),
      y: startY + Math.floor(i / COLS) * (NODE_H + GAP),
      prompt: data.prompt,
      status: NodeStatus.IDLE,
      model: 'ChuHaiBang',
      imageModel: data.imageModel,
      aspectRatio: data.aspectRatio || '16:9',
      resolution: 'Auto',
      parentIds: [],
    }));

    setNodes(prev => [...prev, ...newNodes]);
    setSelectedNodeIds(newNodes.map(n => n.id));

    newNodes.forEach((node, i) => {
      setTimeout(() => {
        handleGenerateRef.current(node.id);
      }, 200 + i * 300);
    });
  }, [viewport, setNodes, setSelectedNodeIds]);

  // Canvas state getter for Agent (defined early, used by ChatPanel)
  const getCanvasStateForAgent = React.useCallback(() => ({
    nodes: nodes.map(n => ({
      id: n.id,
      type: n.type,
      title: n.title,
      prompt: n.prompt?.substring(0, 100),
      status: n.status,
      resultUrl: n.resultUrl?.startsWith('data:') ? undefined : n.resultUrl,
      model: n.model,
      imageModel: n.imageModel,
      videoModel: n.videoModel,
      parentIds: n.parentIds,
    })),
    groups: groups.map(g => ({
      id: g.id,
      label: g.label,
      nodeIds: g.nodeIds,
    })),
  }), [nodes, groups]);

  // Refs for agent actions (populated later when openVideoMerge and setIsTTSOpen exist)
  const openVideoMergeRef = React.useRef<((items: Array<{ id: string; url: string; name: string }>) => void) | null>(null);
  const openTTSRef = React.useRef<((text?: string) => void) | null>(null);

  // Agent actions hook — executes canvas actions from the AI agent
  const agentActions = useAgentActions({
    nodes,
    setNodes,
    setSelectedNodeIds,
    groups,
    setGroups,
    viewport,
    handleGenerateRef,
    getNextNodeTitle,
    openVideoMergeModal: (nodeIds: string[]) => {
      const items = nodes.filter(n => nodeIds.includes(n.id) && n.resultUrl).map(n => ({
        id: n.id,
        url: n.resultUrl!,
        name: n.title || n.prompt || `Video ${n.id.slice(0, 6)}`,
      }));
      if (items.length >= 2) openVideoMergeRef.current?.(items);
    },
    openTTSModal: (text?: string) => {
      openTTSRef.current?.(text);
    },
  });

  const handleAgentActions = React.useCallback((actions: AgentAction[]) => {
    agentActions.executeActions(actions);
  }, [agentActions]);

  // Create new canvas — opens in a new tab
  const handleNewCanvas = () => {
    canvasTabs.addTab();
    ignoreNextChange.current = true;
    resetWorkflowId();
  };

  // Image editor modal
  const {
    editorModal,
    handleOpenImageEditor,
    handleCloseImageEditor,
    handleUpload
  } = useImageEditor({ nodes, updateNode });

  // Video editor modal
  const {
    videoEditorModal,
    handleOpenVideoEditor,
    handleCloseVideoEditor,
    handleExportTrimmedVideo
  } = useVideoEditor({ nodes, updateNode });

  const editorNode = useMemo(() => editorModal.nodeId ? nodeMap.get(editorModal.nodeId) : undefined, [nodeMap, editorModal.nodeId]);
  const videoEditorNode = useMemo(() => videoEditorModal.nodeId ? nodeMap.get(videoEditorModal.nodeId) : undefined, [nodeMap, videoEditorModal.nodeId]);

  /**
   * Routes editor open to the correct handler based on node type
   */
  const handleOpenEditor = React.useCallback((nodeId: string) => {
    const node = nodeMap.get(nodeId);
    if (!node) return;

    if (node.type === NodeType.VIDEO_EDITOR) {
      handleOpenVideoEditor(nodeId);
    } else {
      handleOpenImageEditor(nodeId);
    }
  }, [nodeMap, handleOpenVideoEditor, handleOpenImageEditor]);

  // Text node handlers
  const {
    handleWriteContent,
    handleTextToVideo,
    handleTextToImage
  } = useTextNodeHandlers({ nodes, updateNode, setNodes, setSelectedNodeIds });

  // Image node handlers
  const {
    handleImageToImage,
    handleImageToVideo,
    handleChangeAngleGenerate,
    handleThreeViewGenerate
  } = useImageNodeHandlers({ nodes, setNodes, setSelectedNodeIds, onGenerateNode: handleGenerate });

  // Asset handlers (create asset modal)
  const {
    isCreateAssetModalOpen,
    setIsCreateAssetModalOpen,
    nodeToSnapshot,
    handleOpenCreateAsset,
    handleSaveAssetToLibrary,
    handleBatchSaveToLibrary: rawBatchSaveToLibrary,
    handleBatchDownload,
    handleContextUpload
  } = useAssetHandlers({ nodes, viewport, contextMenu, setNodes });

  const handleBatchSaveToLibrary = useCallback(async (targetNodes: NodeData[]) => {
    const result = await rawBatchSaveToLibrary(targetNodes);
    if (result.success > 0) {
      setLibraryRefreshTrigger(prev => prev + 1);
    }
    return result;
  }, [rawBatchSaveToLibrary]);

  const handleDuplicateToNewCanvas = useCallback(async () => {
    const targetIds = selectedNodeIds;
    if (targetIds.length === 0) return;

    const targetNodes = nodes.filter(n => targetIds.includes(n.id));
    const commonGroup = getCommonGroup(targetIds);

    // Snapshot the nodes and group info before we switch canvases
    const clonedNodes: NodeData[] = targetNodes.map(node => ({
      ...JSON.parse(JSON.stringify(node)),
      id: generateUUID(),
      parentIds: undefined,
      groupId: undefined,
    }));

    // Normalize positions: center the cloned nodes starting from a reasonable origin
    const minX = Math.min(...clonedNodes.map(n => n.x));
    const minY = Math.min(...clonedNodes.map(n => n.y));
    const startX = 100;
    const startY = 100;
    clonedNodes.forEach(n => {
      n.x = n.x - minX + startX;
      n.y = n.y - minY + startY;
    });

    const groupLabel = commonGroup
      ? (commonGroup.label === 'New Group' ? t('selection.newGroup') : commonGroup.label) + ' ' + t('selection.copy')
      : null;
    const groupStoryContext = commonGroup?.storyContext ? { ...commonGroup.storyContext } : null;

    // Save current canvas first
    await handleSaveWithTracking();

    // Open duplicate in a new tab (skipRestore to avoid deferred empty-tab wipe)
    canvasTabs.addTab(true);
    ignoreNextChange.current = true;
    resetWorkflowId();

    const newTitle = groupLabel || (canvasTitle + ' ' + t('selection.copy'));
    setCanvasTitle(newTitle);
    setEditingTitleValue(newTitle);

    // Set the cloned nodes into the new canvas
    setNodes(clonedNodes);

    // If the original was a group, recreate it in the new canvas
    if (groupLabel && clonedNodes.length > 1) {
      const newGroupId = groupNodes(clonedNodes.map(n => n.id), setNodes, groupLabel);
      if (groupStoryContext) {
        setGroups(prev => prev.map(g =>
          g.id === newGroupId ? { ...g, storyContext: groupStoryContext } : g
        ));
      }
    }

    setSelectedNodeIds(clonedNodes.map(n => n.id));
  }, [nodes, selectedNodeIds, getCommonGroup, groupNodes, setNodes, setSelectedNodeIds, setGroups, t, canvasTitle, handleSaveWithTracking, resetWorkflowId, canvasTabs]);

  // Keyboard shortcuts (copy/paste/delete/undo/redo)
  const {
    handleCopy,
    handlePaste,
    handleDuplicate
  } = useKeyboardShortcuts({
    nodes,
    selectedNodeIds,
    selectedConnection,
    setNodes,
    setSelectedNodeIds,
    setContextMenu,
    deleteNodes,
    deleteSelectedConnection,
    clearSelection,
    clearSelectionBox,
    undo,
    redo,
    groups,
    groupNodes,
    setGroups,
    getCommonGroup,
    viewport,
    setViewport,
    onPasteImage: handleUpload,
    getNextNodeTitle,
    onSave: handleSaveWithTracking
  });

  // Auto-Save Management
  const { lastSaveTime: lastAutoSaveTime } = useAutoSave({
    isDirty,
    nodes,
    onSave: handleSaveWithTracking,
    interval: 60000 // Save every 60 seconds
  });

  // Generation Recovery Management
  useGenerationRecovery({
    nodes,
    updateNode
  });

  // Video Frame Extraction (auto-extract lastFrame for videos missing thumbnails)
  useVideoFrameExtraction({
    nodes,
    updateNode
  });

  // Storyboard Generator Tool
  const handleCreateStoryboardNodes = React.useCallback((
    newNodeData: Partial<NodeData>[],
    groupInfo?: { groupId: string; groupLabel: string; storyContext?: NodeGroup['storyContext'] }
  ) => {
    console.log('[Storyboard] handleCreateStoryboardNodes called with', newNodeData.length, 'nodes, groupInfo:', !!groupInfo);
    const newNodes: NodeData[] = newNodeData.map(data => ({
      id: data.id || generateUUID(),
      type: data.type || NodeType.IMAGE,
      x: data.x || 0,
      y: data.y || 0,
      prompt: data.prompt || '',
      status: data.status || NodeStatus.IDLE,
      model: data.model || 'chuhaibang',
      imageModel: data.imageModel,
      aspectRatio: data.aspectRatio || '16:9',
      resolution: data.resolution || '1K',
      title: data.title,
      parentIds: data.parentIds || [],
      groupId: data.groupId,
      characterReferenceUrls: data.characterReferenceUrls,
      assetMentions: data.assetMentions
    }));

    setNodes(prev => [...prev, ...newNodes]);

    // Auto-group the storyboard nodes
    if (groupInfo && newNodes.length > 0) {
      const newGroup = {
        id: groupInfo.groupId,
        nodeIds: newNodes.map(n => n.id),
        label: groupInfo.groupLabel,
        // Save story context if available to help AI understand the full narrative later
        storyContext: groupInfo.storyContext
      };
      setGroups(prev => [...prev, newGroup]);
    }

    if (newNodes.length > 0) {
      setSelectedNodeIds(newNodes.map(n => n.id));
    }

    // Auto-trigger generation for each storyboard node with a small delay
    // to ensure state is updated before generation starts
    if (groupInfo) {
      setTimeout(() => {
        console.log('[Storyboard] Auto-triggering generation for', newNodes.length, 'nodes');
        newNodes.forEach((node, index) => {
          // Stagger generation calls slightly to avoid overwhelming the API
          setTimeout(() => {
            console.log(`[Storyboard] Starting generation for node ${index + 1}:`, node.id);
            // Use ref to get the latest handleGenerate function
            handleGenerateRef.current(node.id);
          }, index * 500); // 500ms delay between each node
        });
      }, 100); // Initial delay to let state settle
    }
  }, [setNodes, setSelectedNodeIds, setGroups]);

  const storyboardGenerator = useStoryboardGenerator({
    onCreateNodes: handleCreateStoryboardNodes,
    viewport
  });

  const handleEditStoryboard = React.useCallback((groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (group?.storyContext) {
      console.log('[App] Editing storyboard:', groupId);
      storyboardGenerator.editStoryboard(group.storyContext);
    }
  }, [groups, storyboardGenerator]);

  // Storyboard Video Modal State
  const [storyboardVideoModal, setStoryboardVideoModal] = useState<{
    isOpen: boolean;
    nodes: NodeData[];
    storyContext?: { story: string; scripts: any[] };
  }>({ isOpen: false, nodes: [] });

  const handleCreateStoryboardVideo = React.useCallback((targetNodeIds?: string[]) => {
    const nodeIdsToCheck = targetNodeIds || selectedNodeIds;

    const selectedImageNodes = nodes.filter(n => nodeIdsToCheck.includes(n.id) && n.type === NodeType.IMAGE);

    if (selectedImageNodes.length === 0) {
      console.warn("[App] No image nodes selected for video generation.");
      return;
    }

    // Check if nodes belong to a group with story context
    const firstNode = selectedImageNodes[0];
    const group = firstNode.groupId ? groups.find(g => g.id === firstNode.groupId) : undefined;
    const storyContext = group?.storyContext;

    if (storyContext) {
      console.log('[App] Found Story Context for Video Modal:', {
        storyLength: storyContext.story.length,
        scriptsCount: storyContext.scripts.length
      });
    }

    setStoryboardVideoModal({
      isOpen: true,
      nodes: selectedImageNodes,
      storyContext
    });
  }, [nodes, selectedNodeIds, groups]);

  const handleGenerateStoryVideos = React.useCallback((
    prompts: Record<string, string>,
    settings: { model: string; duration: number; resolution: string; },
    activeNodeIds?: string[]
  ) => {
    // Close modal
    setStoryboardVideoModal(prev => ({ ...prev, isOpen: false }));

    const newNodes: NodeData[] = [];
    // Use activeNodeIds to filter source nodes if provided, otherwise use all
    const sourceNodes = activeNodeIds
      ? storyboardVideoModal.nodes.filter(n => activeNodeIds.includes(n.id))
      : storyboardVideoModal.nodes;

    // Calculate layout bounds of the ENTIRE storyboard to position videos to the RIGHT
    // Use all storyboard nodes to properly calculate the bounding box
    const allStoryboardNodes = storyboardVideoModal.nodes;

    // Assume a default width if not present (though images usually have it)
    const DEFAULT_WIDTH = 400;

    // Find the rightmost edge of the entire group
    const groupMaxX = Math.max(...allStoryboardNodes.map(n => n.x + DEFAULT_WIDTH));

    // Calculate the left edge of the group to maintain relative offsets
    const groupMinX = Math.min(...allStoryboardNodes.map(n => n.x));

    // Shift Amount: Move everything to the right of the group with a gap
    const GAP_X = 100;
    const xOffset = groupMaxX + GAP_X - groupMinX;

    sourceNodes.forEach((sourceNode) => {
      // Create a new Video node for each image
      const newNodeId = generateUUID();
      const PROMPT = prompts[sourceNode.id] || sourceNode.prompt || 'Animated video';

      const newVideoNode: NodeData = {
        id: newNodeId,
        type: NodeType.VIDEO,
        // Clone the layout pattern but shifted to the right
        x: sourceNode.x + xOffset,
        y: sourceNode.y,
        prompt: PROMPT,
        status: NodeStatus.IDLE, // Will switch to LOADING when generated
        model: settings.model,
        videoModel: settings.model, // Explicitly set video model
        videoDuration: settings.duration,
        aspectRatio: sourceNode.aspectRatio || '16:9',
        resolution: settings.resolution,
        parentIds: [sourceNode.id], // Connect to source image
        // groupId: undefined, // Explicitly NOT in the group
        videoMode: 'frame-to-frame', // Important for image-to-video
        inputUrl: sourceNode.resultUrl, // Pass image as input
      };

      newNodes.push(newVideoNode);
    });

    // added new nodes to state
    setNodes(prev => [...prev, ...newNodes]);

    // Auto-trigger generation (staggered)
    setTimeout(() => {
      newNodes.forEach((node, index) => {
        setTimeout(() => {
          handleGenerateRef.current(node.id);
        }, index * 1000); // 1s delay between each to avoid rate limits
      });
    }, 500);

  }, [storyboardVideoModal.nodes, setNodes]);

  // Video Merge Modal State
  const [videoMergeModalOpen, setVideoMergeModalOpen] = useState(false);

  // Profile Modal State
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // Audio Extractor Modal State
  const [isAudioExtractorOpen, setIsAudioExtractorOpen] = useState(false);

  // TTS Modal State
  const [isTTSOpen, setIsTTSOpen] = useState(false);
  const [ttsInitialText, setTtsInitialText] = useState<string | undefined>();
  const [isIndexTTSOpen, setIsIndexTTSOpen] = useState(false);
  const [isSubtitleRemoverOpen, setIsSubtitleRemoverOpen] = useState(false);
  const [pendingSubtitleTracks, setPendingSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [pendingAudioTracks, setPendingAudioTracks] = useState<PendingAudioTrack[]>([]);

  // Three-View Modal State
  const [threeViewModalNodeId, setThreeViewModalNodeId] = useState<string | null>(null);
  const [videoMergeItems, setVideoMergeItems] = useState<Array<{ id: string; url: string; name: string; thumbnail?: string }>>([]);

  const openVideoMerge = useCallback((items?: Array<{ id: string; url: string; name: string; thumbnail?: string }>) => {
    if (items && items.length >= 2) {
      setVideoMergeItems(items);
    } else {
      // Prioritize selected video nodes if 2+ are selected, otherwise use all video nodes
      const selectedVideoNodes = nodes.filter(n =>
        selectedNodeIds.includes(n.id) && n.type === NodeType.VIDEO && n.resultUrl
      );
      const candidateNodes = selectedVideoNodes.length >= 2
        ? selectedVideoNodes
        : nodes.filter(n => n.type === NodeType.VIDEO && n.resultUrl);
      setVideoMergeItems(candidateNodes.map(n => ({
        id: n.id,
        url: n.resultUrl!,
        name: n.title || n.prompt || `Video ${n.id.slice(0, 6)}`,
      })));
    }
    setVideoMergeModalOpen(true);
  }, [nodes, selectedNodeIds]);

  // Wire refs for agent actions (now that openVideoMerge exists)
  openVideoMergeRef.current = openVideoMerge;
  openTTSRef.current = (text?: string) => {
    setTtsInitialText(text);
    setIsTTSOpen(true);
  };

  const handleVideoMerged = useCallback((videoUrl: string, sourceIds: string[]) => {
    const newId = generateUUID();

    // Position: to the right of the rightmost source node, centered vertically
    const sourceNodes = nodes.filter(n => sourceIds.includes(n.id));
    let newX: number, newY: number;
    if (sourceNodes.length > 0) {
      const maxX = Math.max(...sourceNodes.map(n => n.x + 365));
      const minY = Math.min(...sourceNodes.map(n => n.y));
      const maxY = Math.max(...sourceNodes.map(n => n.y));
      newX = maxX + 360;
      newY = (minY + maxY) / 2;
    } else {
      newX = (viewport.x * -1 + window.innerWidth / 2) / viewport.zoom - 182;
      newY = (viewport.y * -1 + window.innerHeight / 2) / viewport.zoom - 120;
    }

    const newNode: NodeData = {
      id: newId,
      type: NodeType.VIDEO,
      x: newX,
      y: newY,
      prompt: t('videoMerge.mergedNodeTitle'),
      status: NodeStatus.SUCCESS,
      resultUrl: videoUrl,
      model: 'video-merge',
      videoModel: 'video-merge',
      aspectRatio: '16:9',
      resolution: '1920x1080',
      title: t('videoMerge.mergedNodeTitle'),
      parentIds: sourceIds
    };
    setNodes(prev => [...prev, newNode]);
  }, [viewport, nodes, t]);

  const handleTTSAddToTimeline = useCallback((
    audio: { url: string; filename: string },
    subtitles: Array<{ text: string; words: Array<{ word: string; startTime: number; endTime: number; confidence: number }> }> | null
  ) => {
    const cues: SubtitleCue[] = [];
    if (subtitles && subtitles.length > 0) {
      const isLatin = (s: string) => /^[a-zA-Z]/.test(s);
      for (const seg of subtitles) {
        if (!seg.words || seg.words.length === 0) continue;
        let buf = '';
        let bufStart = seg.words[0].startTime;
        let bufEnd = seg.words[0].endTime;
        for (const w of seg.words) {
          const gap = w.startTime - bufEnd;
          if (buf && (gap > 0.6 || buf.length >= 30)) {
            cues.push({
              id: `cue_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              startTime: bufStart,
              endTime: bufEnd,
              text: buf.trim(),
            });
            buf = w.word;
            bufStart = w.startTime;
            bufEnd = w.endTime;
          } else {
            const needSpace = buf && isLatin(w.word) && isLatin(buf.slice(-1));
            buf += (needSpace ? ' ' : '') + w.word;
            bufEnd = w.endTime;
          }
        }
        if (buf.trim()) {
          cues.push({
            id: `cue_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            startTime: bufStart,
            endTime: bufEnd,
            text: buf.trim(),
          });
        }
      }
    }

    const track: SubtitleTrack = {
      id: `sub_${Date.now()}`,
      name: audio.filename.replace(/\.[^.]+$/, ''),
      cues,
      style: {
        fontFamily: 'Noto Sans SC',
        fontSize: 48,
        primaryColor: '#FFFFFF',
        outlineColor: '#000000',
        outlineWidth: 2,
        bold: true,
        position: 'bottom',
      },
    };

    setPendingSubtitleTracks(prev => [...prev, track]);
    setPendingAudioTracks(prev => [...prev, { url: audio.url, name: audio.filename }]);
    if (!videoMergeModalOpen) {
      openVideoMerge();
    }
  }, [videoMergeModalOpen, openVideoMerge]);

  // Context menu handlers
  const {
    handleDoubleClick,
    handleGlobalContextMenu: baseHandleGlobalContextMenu,
    handleAddNext,
    handleGroupAddNext,
    handleNodeContextMenu,
    handleContextMenuCreateAsset,
    handleContextMenuSelect,
    handleToolbarAdd
  } = useContextMenuHandlers({
    nodes,
    viewport,
    contextMenu,
    setContextMenu,
    handleOpenCreateAsset,
    handleSelectTypeFromMenu,
    onMenuClose: clearPendingLine
  });

  // Suppress context menu if canvas was just panned (right-click drag)
  const handleGlobalContextMenu = useCallback((e: React.MouseEvent) => {
    if (wasPanning.current) {
      e.preventDefault();
      wasPanning.current = false;
      return;
    }
    baseHandleGlobalContextMenu(e);
  }, [baseHandleGlobalContextMenu, wasPanning]);

  const handleReversePrompt = useCallback(async (node: NodeData) => {
    if (!node.resultUrl || node.isReversingPrompt) return;

    updateNode(node.id, { isReversingPrompt: true });

    try {
      const fullUrl = assetUrl(node.resultUrl);
      const res = await authFetch(`${API_URL}/reverse-prompt`, {
        method: 'POST',
        body: JSON.stringify({ imageUrl: fullUrl }),
      });
      if (!res.ok) throw new Error('API error');
      const { prompt } = await res.json();
      updateNode(node.id, { prompt, isReversingPrompt: false });
    } catch {
      updateNode(node.id, { isReversingPrompt: false });
    }
  }, [updateNode]);

  // Wrapper functions that pass closeWorkflowPanel to panel handlers
  const handleHistoryClick = (e: React.MouseEvent) => {
    panelHistoryClick(e, closeWorkflowPanel);
  };

  const handleAssetsClick = (e: React.MouseEvent) => {
    panelAssetsClick(e, closeWorkflowPanel);
  };

  const handleContextMenuAddAssets = () => {
    openAssetLibraryModal(contextMenu.y, closeWorkflowPanel);
  };

  /**
   * Convert pixel dimensions to closest standard aspect ratio
   */
  const getClosestAspectRatio = (width: number, height: number): string => {
    const ratio = width / height;
    const standardRatios = [
      { label: '1:1', value: 1 },
      { label: '16:9', value: 16 / 9 },
      { label: '9:16', value: 9 / 16 },
      { label: '4:3', value: 4 / 3 },
      { label: '3:4', value: 3 / 4 },
      { label: '3:2', value: 3 / 2 },
      { label: '2:3', value: 2 / 3 },
      { label: '5:4', value: 5 / 4 },
      { label: '4:5', value: 4 / 5 },
      { label: '21:9', value: 21 / 9 }
    ];

    let closest = standardRatios[0];
    let minDiff = Math.abs(ratio - closest.value);

    for (const r of standardRatios) {
      const diff = Math.abs(ratio - r.value);
      if (diff < minDiff) {
        minDiff = diff;
        closest = r;
      }
    }

    return closest.label;
  };

  /**
   * Convert pixel dimensions to closest video aspect ratio (only 16:9 or 9:16)
   */
  const getClosestVideoAspectRatio = (width: number, height: number): string => {
    const ratio = width / height;
    // Video models only support 16:9 (1.78) and 9:16 (0.56)
    // If wider than 1:1 (ratio > 1), use 16:9; otherwise use 9:16
    return ratio >= 1 ? '16:9' : '9:16';
  };

  /**
   * Handle selecting an asset from history - creates new node with the image/video
   */
  const handleSelectAsset = (type: 'images' | 'videos', url: string, prompt: string, model?: string) => {
    // Calculate position at center of canvas
    const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom - 170;
    const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom - 150;

    // Create node with detected aspect ratio
    const createNode = (resultAspectRatio?: string, aspectRatio?: string) => {
      const isVideo = type === 'videos';
      // Use the original model from asset metadata, or fall back to defaults
      const defaultModel = isVideo ? 'veo-3.1' : 'imagen-3.0-generate-002';
      const nodeModel = model || defaultModel;

      const isThreeView = !isVideo && prompt.startsWith('根据这张图片生成三视图参考图');
      const nodeType = isVideo ? NodeType.VIDEO : NodeType.IMAGE;
      const newNode: NodeData = {
        id: generateUUID(),
        type: nodeType,
        title: isThreeView ? '三视图' : getNextNodeTitle(nodeType),
        x: centerX,
        y: centerY,
        prompt: prompt,
        status: NodeStatus.SUCCESS,
        resultUrl: url,
        resultAspectRatio,
        model: nodeModel,
        videoModel: isVideo ? nodeModel : undefined,
        imageModel: !isVideo ? nodeModel : undefined,
        aspectRatio: aspectRatio || '16:9',
        resolution: isVideo ? 'Auto' : '1K',
        hideControls: isThreeView || undefined,
      };

      setNodes(prev => [...prev, newNode]);
      closeHistoryPanel();
      closeAssetLibrary();
    };

    if (type === 'images') {
      // Detect image dimensions
      const img = new Image();
      img.onload = () => {
        const resultAspectRatio = `${img.naturalWidth}/${img.naturalHeight}`;
        const aspectRatio = getClosestAspectRatio(img.naturalWidth, img.naturalHeight);
        console.log(`[App] Image loaded: ${img.naturalWidth}x${img.naturalHeight} -> ${aspectRatio}`);
        createNode(resultAspectRatio, aspectRatio);
      };
      img.onerror = () => {
        console.log('[App] Image load error, using default 16:9');
        createNode(undefined, '16:9');
      };
      img.src = url;
    } else {
      // Detect video dimensions
      const video = document.createElement('video');
      video.onloadedmetadata = () => {
        const resultAspectRatio = `${video.videoWidth}/${video.videoHeight}`;
        // Use video-specific function that only returns 16:9 or 9:16
        const aspectRatio = getClosestVideoAspectRatio(video.videoWidth, video.videoHeight);
        console.log(`[App] Video loaded: ${video.videoWidth}x${video.videoHeight} -> ${aspectRatio}`);
        createNode(resultAspectRatio, aspectRatio);
      };
      video.onerror = () => {
        console.log('[App] Video load error, using default 16:9');
        createNode(undefined, '16:9');
      };
      video.src = url;
    }
  };

  const handleLibrarySelect = (url: string, type: 'image' | 'video') => {
    handleSelectAsset(type === 'image' ? 'images' : 'videos', url, 'Asset Library Item');
    closeAssetLibrary();
  };

  // Create asset modal (isCreateAssetModalOpen, handleOpenCreateAsset, handleSaveAssetToLibrary) provided by useAssetHandlers hook

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Prevent default zoom behavior
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleNativeWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };

    canvas.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleNativeWheel);
  }, []);

  // Globally suppress browser native context menu
  useEffect(() => {
    const block = (e: MouseEvent) => e.preventDefault();
    document.addEventListener('contextmenu', block, true);
    return () => document.removeEventListener('contextmenu', block, true);
  }, []);

  // Keyboard shortcuts (handleCopy, handlePaste, handleDuplicate) provided by useKeyboardShortcuts hook

  // Cleanup invalid groups (groups with less than 2 nodes)
  useEffect(() => {
    cleanupInvalidGroups(nodes, setNodes);
  }, [nodes, cleanupInvalidGroups]);

  // Push state to history when nodes or groups change (skip during drag)
  // pushHistory is internally debounced (50ms) to batch cascading effects
  useEffect(() => {
    if (isDragging) return;
    pushHistory({ nodes, groups });
  }, [nodes, groups, isDragging]);


  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  /**
   * Right-click long-press tracking.
   * Right-click no longer pans immediately — user must either hold for
   * RIGHT_PRESS_HOLD_MS or drag at least RIGHT_PRESS_DRAG_PX before pan
   * activates. A quick right-click + release falls through to the native
   * contextmenu event so the right-click menu still opens.
   */
  const RIGHT_PRESS_HOLD_MS = 200;
  const RIGHT_PRESS_DRAG_PX = 5;
  const rightPressRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    target: EventTarget | null;
    timer: number | null;
    activated: boolean;
  } | null>(null);

  const activateRightPressPan = useCallback(() => {
    const rp = rightPressRef.current;
    if (!rp || rp.activated) return;
    rp.activated = true;
    if (rp.timer != null) {
      window.clearTimeout(rp.timer);
      rp.timer = null;
    }
    startPanning({ target: rp.target, pointerId: rp.pointerId });
    // User committed to pan — suppress the contextmenu event that fires on pointerup
    wasPanning.current = true;
    setSelectedConnection(null);
    setContextMenu(prev => ({ ...prev, isOpen: false }));
    clearPendingLine();
  }, [startPanning, wasPanning, clearPendingLine]);

  const cancelRightPress = useCallback(() => {
    const rp = rightPressRef.current;
    if (!rp) return;
    if (rp.timer != null) window.clearTimeout(rp.timer);
    rightPressRef.current = null;
  }, []);

  // Cleanup any pending right-press timer on unmount
  useEffect(() => {
    return () => {
      const rp = rightPressRef.current;
      if (rp?.timer != null) window.clearTimeout(rp.timer);
      rightPressRef.current = null;
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    const isCanvasArea = target.id === 'canvas-background' || target.closest('#canvas-background');
    if (!isCanvasArea || target.closest('.canvas-node')) return;

    /* ─── Left-click without space → selection box (multi-select) ─── */
    if (e.button === 0 && !spaceHeldRef.current) {
      startSelection(e);
      clearSelection();
      setSelectedConnection(null);
      setContextMenu(prev => ({ ...prev, isOpen: false }));
      clearPendingLine();
      closeWorkflowPanel();
      closeHistoryPanel();
      closeAssetLibrary();
      return;
    }

    /* ─── Middle-click OR (left-click + space held) → pan immediately ─── */
    if (e.button === 1 || (e.button === 0 && spaceHeldRef.current)) {
      startPanning(e);
      setSelectedConnection(null);
      setContextMenu(prev => ({ ...prev, isOpen: false }));
      clearPendingLine();
      return;
    }

    /* ─── Right-click → defer pan, require long-press OR drag-distance ─── */
    if (e.button === 2) {
      cancelRightPress();
      const press = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        target: e.target,
        timer: null as number | null,
        activated: false,
      };
      rightPressRef.current = press;
      press.timer = window.setTimeout(() => {
        if (rightPressRef.current === press) activateRightPressPan();
      }, RIGHT_PRESS_HOLD_MS);
      return;
    }

    /* Any other button (e.g. browser back/forward) → ignore */
  };

  const handleGlobalPointerMove = (e: React.PointerEvent) => {
    // Right-press: enter pan early once user drags far enough
    const rp = rightPressRef.current;
    if (rp && !rp.activated) {
      const dx = e.clientX - rp.startX;
      const dy = e.clientY - rp.startY;
      if (Math.hypot(dx, dy) >= RIGHT_PRESS_DRAG_PX) {
        activateRightPressPan();
      }
    }

    // 1. Handle Selection Box Update
    if (updateSelection(e)) return;

    // 2. Handle Node Dragging
    if (updateNodeDrag(e, viewport, setNodes, selectedNodeIds, nodes)) return;

    // 3. Handle Connection Dragging
    if (updateConnectionDrag(e, nodes, viewport)) return;

    // 4. Handle Canvas Panning (disabled when selection box is active)
    if (!isSelecting) {
      updatePanning(e, setViewport);
    }
  };

  /**
   * Handle when a connection is made between nodes
   * Syncs prompt if parent is a Text node
   */
  const handleConnectionMade = React.useCallback((parentId: string, childId: string) => {
    const parentNode = nodeMap.get(parentId);
    if (!parentNode) return;

    if (parentNode.type === NodeType.TEXT && parentNode.prompt) {
      updateNode(childId, { prompt: parentNode.prompt });
    }
  }, [nodeMap, updateNode]);

  const handleGlobalPointerUp = (e: React.PointerEvent) => {
    // 0. Clear pending right-press timer if user released before pan activated
    //    → falls through to the native contextmenu event (right-click menu opens).
    cancelRightPress();

    // 1. Handle Selection Box End
    if (isSelecting) {
      const selectedIds = endSelection(nodes, viewport);
      setSelectedNodeIds(selectedIds);
      releasePointerCapture(e);
      return;
    }

    // 2. Handle Connection Drop
    const getGroupMemberIds = (nodeId: string): string[] | undefined => {
      const node = nodes.find(n => n.id === nodeId);
      if (!node?.groupId) return undefined;
      const members = nodes.filter(n => n.groupId === node.groupId).map(n => n.id);
      return members.length > 1 ? members : undefined;
    };
    if (completeConnectionDrag(handleAddNext, setNodes, nodes, handleConnectionMade, handleGroupAddNext, getGroupMemberIds)) {
      releasePointerCapture(e);
      return;
    }

    // 3. Stop Panning
    endPanning();

    // 4. Stop Node Dragging
    endNodeDrag();

    // 5. Release capture
    releasePointerCapture(e);
  };

  // Stable callbacks for CanvasNode — use refs so identity never changes
  const stableOnNodePointerDown = useCallback((e: React.PointerEvent, nodeId: string) => {
    const sel = selectedNodeIdsRef.current;
    if (e.shiftKey) {
      if (!sel.includes(nodeId)) setSelectedNodeIds(prev => [...prev, nodeId]);
      handleNodePointerDown(e, nodeId, undefined);
    } else if (sel.includes(nodeId) && sel.length > 1) {
      handleNodePointerDown(e, nodeId, undefined);
    } else {
      setSelectedNodeIds([nodeId]);
      handleNodePointerDown(e, nodeId, undefined);
    }
  }, [handleNodePointerDown, setSelectedNodeIds]);

  const stableOnSelect = useCallback((id: string) => setSelectedNodeIds([id]), [setSelectedNodeIds]);
  const stableOnMouseEnter = useCallback((id: string) => setCanvasHoveredNodeId(id), []);
  const stableOnMouseLeave = useCallback(() => setCanvasHoveredNodeId(null), []);

  const stableOnGenerate = useCallback((id: string) => handleGenerateRef.current(id), []);

  const handleNodeContextMenuRef = React.useRef(handleNodeContextMenu);
  handleNodeContextMenuRef.current = handleNodeContextMenu;
  const stableOnContextMenu = useCallback((e: React.MouseEvent, id: string) => handleNodeContextMenuRef.current(e, id), []);

  const handleConnectorPointerDownRef = React.useRef(handleConnectorPointerDown);
  handleConnectorPointerDownRef.current = handleConnectorPointerDown;
  const stableOnConnectorDown = useCallback((e: React.PointerEvent, id: string, side: 'left' | 'right') => handleConnectorPointerDownRef.current(e, id, side), []);

  const handleOpenEditorRef = React.useRef(handleOpenEditor);
  handleOpenEditorRef.current = handleOpenEditor;
  const stableOnOpenEditor = useCallback((id: string) => handleOpenEditorRef.current(id), []);

  const handleAddNextRef = React.useRef(handleAddNext);
  handleAddNextRef.current = handleAddNext;
  const stableOnAddNext = useCallback((id: string, dir: 'left' | 'right', x?: number, y?: number) => handleAddNextRef.current(id, dir, x, y), []);


  return (
    <CanvasErrorBoundary>
    <div className={`w-screen h-screen bg-t-base text-t-primary overflow-hidden select-none font-sans transition-colors duration-300`}>
      {/* Window drag region for frameless Electron */}
      {window.electronAPI && (
        <div className="fixed top-0 left-0 w-full h-9 z-[9999]" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
      )}


      {!storyboardGenerator.isModalOpen && (
        <Toolbar
          onAddClick={handleToolbarAdd}
          onWorkflowsClick={handleWorkflowsClick}
          onHistoryClick={handleHistoryClick}
          onAssetsClick={handleAssetsClick}
          onStoryboardClick={storyboardGenerator.openModal}
          onAudioExtractorClick={() => setIsAudioExtractorOpen(true)}
          onTTSClick={() => setIsTTSOpen(true)}
          onIndexTTSClick={() => setIsIndexTTSOpen(true)}
          onVideoMergeClick={() => openVideoMerge()}
          onSubtitleRemoverClick={() => setIsSubtitleRemoverOpen(true)}
          onToolsOpen={() => {
            closeWorkflowPanel();
            closeHistoryPanel();
            closeAssetLibrary();
          }}
          onProfileClick={() => setIsProfileModalOpen(true)}
        />
      )}

      {/* Tab Bar */}
      {!storyboardGenerator.isModalOpen && (
        <TabBar
          tabs={canvasTabs.tabs}
          activeTabId={canvasTabs.activeTabId}
          onSwitch={canvasTabs.switchTab}
          onAdd={handleNewCanvas}
          onClose={handleTabClose}
          onRename={handleTabRename}
          onMove={canvasTabs.moveTab}
          onCloseAll={canvasTabs.closeAllTabs}
          onCloseOthers={canvasTabs.closeOtherTabs}
          onCloseToRight={canvasTabs.closeTabsToRight}
          isChatOpen={isChatOpen}
        />
      )}

      {/* Workflow Panel */}
      <WorkflowPanel
        isOpen={isWorkflowPanelOpen}
        onClose={closeWorkflowPanel}
        onLoadWorkflow={handleLoadWithTracking}
        onTitleChange={(wfId, newTitle) => {
          if (wfId === workflowId) {
            setCanvasTitle(newTitle);
            setEditingTitleValue(newTitle);
          }
        }}
        currentWorkflowId={workflowId || undefined}
        panelY={workflowPanelY}
      />

      {/* History Panel */}
      <HistoryPanel
        isOpen={isHistoryPanelOpen}
        onClose={closeHistoryPanel}
        onSelectAsset={handleSelectAsset}
        panelY={historyPanelY}
      />

      <AssetLibraryPanel
        isOpen={isAssetLibraryOpen}
        onClose={closeAssetLibrary}
        onSelectAsset={handleLibrarySelect}
        panelY={assetLibraryY}
        variant={assetLibraryVariant}
        refreshTrigger={libraryRefreshTrigger}
      />

      <React.Suspense fallback={null}>
      <CreateAssetModal
        isOpen={isCreateAssetModalOpen}
        onClose={() => setIsCreateAssetModalOpen(false)}
        nodeToSnapshot={nodeToSnapshot}
        onSave={handleSaveAssetToLibrary}
      />
      </React.Suspense>

      <React.Suspense fallback={null}>
      <ThreeViewOptionsModal
        isOpen={!!threeViewModalNodeId}
        onClose={() => setThreeViewModalNodeId(null)}
        onConfirm={(options: ThreeViewOptions) => {
          if (threeViewModalNodeId) {
            handleThreeViewGenerate(threeViewModalNodeId, options);
          }
        }}
        previewUrl={threeViewModalNodeId ? nodes.find(n => n.id === threeViewModalNodeId)?.resultUrl : undefined}
      />
      </React.Suspense>

      {/* Video Merge Modal */}
      <React.Suspense fallback={null}>
      <VideoMergeModal
        isOpen={videoMergeModalOpen}
        onClose={() => { setVideoMergeModalOpen(false); setPendingSubtitleTracks([]); setPendingAudioTracks([]); }}
        initialVideos={videoMergeItems}
        allVideos={useMemo(() =>
          nodes.filter(n => n.type === NodeType.VIDEO && n.resultUrl).map(n => ({
            id: n.id,
            url: n.resultUrl!,
            name: n.title || n.prompt || `Video ${n.id.slice(0, 6)}`,
          })), [nodes])}
        onMerged={handleVideoMerged}
        initialSubtitleTracks={pendingSubtitleTracks}
        initialAudioTracks={pendingAudioTracks}
      />
      </React.Suspense>

      {/* Profile Modal */}
      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />

      {/* Audio Extractor Modal */}
      <React.Suspense fallback={null}>
      <AudioExtractorModal
        isOpen={isAudioExtractorOpen}
        onClose={() => setIsAudioExtractorOpen(false)}
        onAddToTimeline={handleTTSAddToTimeline}
      />
      </React.Suspense>

      {/* TTS Modal */}
      <React.Suspense fallback={null}>
      <TTSModal
        isOpen={isTTSOpen}
        onClose={() => { setIsTTSOpen(false); setTtsInitialText(undefined); }}
        onAddToTimeline={handleTTSAddToTimeline}
        initialText={ttsInitialText}
      />
      </React.Suspense>

      <React.Suspense fallback={null}>
      <IndexTTSModal
        isOpen={isIndexTTSOpen}
        onClose={() => setIsIndexTTSOpen(false)}
        onAddToTimeline={handleTTSAddToTimeline}
      />
      </React.Suspense>

      <React.Suspense fallback={null}>
      <SubtitleRemoverModal
        isOpen={isSubtitleRemoverOpen}
        onClose={() => setIsSubtitleRemoverOpen(false)}
      />
      </React.Suspense>

      {/* Storyboard Generator Modal */}
      <React.Suspense fallback={null}>
      <StoryboardGeneratorModal
        isOpen={storyboardGenerator.isModalOpen}
        onClose={storyboardGenerator.closeModal}
        state={storyboardGenerator.state}
        onSetStep={storyboardGenerator.setStep}
        onToggleCharacter={storyboardGenerator.toggleCharacter}
        onSetSceneCount={storyboardGenerator.setSceneCount}
        onSetStory={storyboardGenerator.setStory}
        onUpdateScript={storyboardGenerator.updateScript}
        onGenerateScripts={storyboardGenerator.generateScripts}
        onBrainstormStory={storyboardGenerator.brainstormStory}
        onOptimizeStory={storyboardGenerator.optimizeStory}
        onGenerateComposite={storyboardGenerator.generateComposite}
        onRegenerateComposite={storyboardGenerator.regenerateComposite}
        onCreateNodes={storyboardGenerator.createStoryboardNodes}
      />
      </React.Suspense>

      {/* Agent Chat */}
      {!storyboardGenerator.isModalOpen && (
        <>
          <ChatBubble onClick={toggleChat} isOpen={isChatOpen} />
          <ChatPanel isOpen={isChatOpen} onClose={closeChat} isDraggingNode={isDraggingNodeToChat} onCreateImage={handleCreateImageFromChat} onCreateAllImages={handleCreateAllImagesFromChat} onAgentActions={handleAgentActions} getCanvasState={getCanvasStateForAgent} />
        </>
      )}

      {/* Top Bar */}
      {!storyboardGenerator.isModalOpen && (
        <TopBar
          canvasTitle={canvasTitle}
          isEditingTitle={isEditingTitle}
          editingTitleValue={editingTitleValue}
          canvasTitleInputRef={canvasTitleInputRef}
          setCanvasTitle={setCanvasTitle}
          setIsEditingTitle={setIsEditingTitle}
          setEditingTitleValue={setEditingTitleValue}
          onSave={handleSaveWithTracking}
          onNew={handleNewCanvas}
          hasUnsavedChanges={hasUnsavedChanges}
          isChatOpen={isChatOpen}
          lastAutoSaveTime={lastAutoSaveTime}
        />
      )}

      {/* Canvas */}
      <div
        ref={canvasRef}
        id="canvas-background"
        className={`absolute inset-0 ${isPanning ? 'cursor-grabbing' : isSpaceHeld ? 'cursor-grab' : 'cursor-default'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handleGlobalPointerMove}
        onPointerUp={handleGlobalPointerUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleGlobalContextMenu}
      >
        <CanvasBackground viewport={viewport} />
        <div
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            transformOrigin: '0 0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none'
          }}
        >
          {/* Pure solid background — no grid */}

          {/* SVG Layer for Connections */}
          <svg className="absolute top-0 left-0 w-full h-full overflow-visible pointer-events-none z-0">
            <ConnectionsLayer
              nodes={nodes}
              nodeMap={nodeMap}
              viewport={viewport}
              isDraggingConnection={isDraggingConnection}
              showDragLine={showDragLine}
              connectionStart={connectionStart}
              tempConnectionEnd={tempConnectionEnd}
              selectedConnection={selectedConnection}
              onEdgeClick={handleEdgeClick}
              pendingMenuLine={pendingMenuLine}
              connectionSourceGroup={connectionSourceGroup}
              groupBBoxOrigin={groupBBoxOrigin}
              pendingGroupMenuLine={pendingGroupMenuLine}
            />
          </svg>

          {/* Alignment Guide Lines */}
          <AlignmentGuides guides={alignGuides} />

          {/* Nodes Layer (viewport-virtualized for 50+ nodes) */}
          <div className="pointer-events-auto">
            {(nodes.length > 50 ? nodes.filter(node => {
              const nodeW = 400, nodeH = 500;
              const screenX = node.x * viewport.zoom + viewport.x;
              const screenY = node.y * viewport.zoom + viewport.y;
              const screenR = (node.x + nodeW) * viewport.zoom + viewport.x;
              const screenB = (node.y + nodeH) * viewport.zoom + viewport.y;
              const margin = 200;
              return screenR > -margin && screenX < window.innerWidth + margin
                  && screenB > -margin && screenY < window.innerHeight + margin;
            }) : nodes).map(node => (
              <CanvasNode
                key={node.id}
                data={node}
                inputUrl={nodeInputUrls.get(node.id)}
                connectedImageNodes={nodeConnectedImages.get(node.id)}
                allNodes={nodes}
                onUpdate={updateNode}
                onGenerate={stableOnGenerate}
                onAddNext={stableOnAddNext}
                selected={selectedNodeIds.includes(node.id)}
                showControls={selectedNodeIds.length === 1 && selectedNodeIds.includes(node.id)}
                onNodePointerDown={stableOnNodePointerDown}
                onContextMenu={stableOnContextMenu}
                onSelect={stableOnSelect}
                onConnectorDown={stableOnConnectorDown}
                isHoveredForConnection={connectionHoveredNodeId === node.id}
                onOpenEditor={stableOnOpenEditor}
                onUpload={handleUpload}
                onExpand={handleExpandImage}
                isMediaExpanded={!!expandedImageUrl && expandedImageUrl === node.resultUrl}
                onDragStart={handleNodeDragStart}
                onDragEnd={handleNodeDragEnd}
                onWriteContent={handleWriteContent}
                onTextToVideo={handleTextToVideo}
                onTextToImage={handleTextToImage}
                onImageToImage={handleImageToImage}
                onImageToVideo={handleImageToVideo}
                onChangeAngleGenerate={handleChangeAngleGenerate}
                onThreeViewGenerate={(nodeId) => setThreeViewModalNodeId(nodeId)}
                zoom={viewport.zoom}
                onMouseEnter={stableOnMouseEnter}
                onMouseLeave={stableOnMouseLeave}
              />
            ))}
          </div>



          {/* Selection Bounding Box - for selected nodes (2 or more) */}
          {selectedNodeIds.length > 1 && !selectionBox.isActive && (
            <SelectionBoundingBox
              selectedNodes={nodes.filter(n => selectedNodeIds.includes(n.id))}
              group={getCommonGroup(selectedNodeIds)}
              viewport={viewport}
              isDraggingConnection={isDraggingConnection}
              onGroup={() => groupNodes(selectedNodeIds, setNodes, t('selection.newGroup'))}
              onUngroup={() => {
                const group = getCommonGroup(selectedNodeIds);
                if (group) ungroupNodes(group.id, setNodes);
              }}
              onBoundingBoxPointerDown={(e) => {
                e.stopPropagation();
                if (selectedNodeIds.length > 0) {
                  handleNodePointerDown(e, selectedNodeIds[0], undefined);
                  // Re-capture on canvas element so pointermove/up handlers fire correctly
                  if (canvasRef.current) {
                    canvasRef.current.setPointerCapture(e.pointerId);
                  }
                }
              }}
              onRenameGroup={renameGroup}
              onSortNodes={(direction) => {
                const group = getCommonGroup(selectedNodeIds);
                if (group) sortGroupNodes(group.id, direction, nodes, setNodes);
              }}
              onCreateVideo={() => {
                handleCreateStoryboardVideo(selectedNodeIds);
              }}
              onEditStoryboard={handleEditStoryboard}
              onBatchSave={handleBatchSaveToLibrary}
              onBatchDownload={handleBatchDownload}
              onGroupSelect={getCommonGroup(selectedNodeIds) ? () => {
                setSelectedNodeIds([...selectedNodeIds]);
              } : undefined}
              onDuplicateNodes={handleDuplicateToNewCanvas}
              onBatchRegenerate={(nodeIds) => {
                nodeIds.forEach((id, i) => {
                  setTimeout(() => handleGenerateRef.current(id), i * 500);
                });
              }}
              onGroupConnectorDown={(e, groupNodeIds, side, bboxEdge) => {
                const existingGroup = getCommonGroup(selectedNodeIds);
                if (!existingGroup) {
                  groupNodes(selectedNodeIds, setNodes, t('selection.newGroup'));
                }
                handleGroupConnectorPointerDown(e, groupNodeIds, side, bboxEdge);
                if (canvasRef.current) {
                  canvasRef.current.setPointerCapture(e.pointerId);
                }
              }}
              onContextMenu={(e) => {
                setContextMenu({
                  isOpen: true,
                  x: e.clientX,
                  y: e.clientY,
                  type: 'node-options',
                  sourceNodeId: undefined,
                });
              }}
            />
          )}

          {/* Group Bounding Boxes - for all groups (even when not selected) */}
          {groups.map(group => {
            const groupNodes = nodes.filter(n => n.groupId === group.id);

            // Don't render if group has less than 2 nodes
            if (groupNodes.length < 2) return null;

            const isSelected = groupNodes.every(n => selectedNodeIds.includes(n.id)) && groupNodes.length > 0;

            // Don't render if this group is already shown above (when selected)
            if (isSelected) return null;

            return (
              <SelectionBoundingBox
                key={group.id}
                selectedNodes={groupNodes}
                group={group}
                viewport={viewport}
                isDraggingConnection={isDraggingConnection}
                onGroup={() => { }} // Already grouped
                onUngroup={() => ungroupNodes(group.id, setNodes)}
                onBoundingBoxPointerDown={(e) => {
                  e.stopPropagation();
                  const nodeIds = groupNodes.map(n => n.id);
                  setSelectedNodeIds(nodeIds);
                  if (nodeIds.length > 0) {
                    handleNodePointerDown(e, nodeIds[0], undefined);
                    if (canvasRef.current) {
                      canvasRef.current.setPointerCapture(e.pointerId);
                    }
                  }
                }}
                onRenameGroup={renameGroup}
                onSortNodes={(direction) => sortGroupNodes(group.id, direction, nodes, setNodes)}
                onCreateVideo={() => {
                  const groupNodeIds = nodes.filter(n => n.groupId === group.id).map(n => n.id);
                  handleCreateStoryboardVideo(groupNodeIds);
                }}
                onEditStoryboard={handleEditStoryboard}
                onBatchSave={handleBatchSaveToLibrary}
                onBatchDownload={handleBatchDownload}
                showToolbar={false}
                onGroupSelect={() => {
                  const nodeIds = groupNodes.map(n => n.id);
                  setSelectedNodeIds(nodeIds);
                }}
                onDuplicateNodes={handleDuplicateToNewCanvas}
                onBatchRegenerate={(nodeIds) => {
                  nodeIds.forEach((id, i) => {
                    setTimeout(() => handleGenerateRef.current(id), i * 500);
                  });
                }}
                onContextMenu={(e) => {
                  const nodeIds = groupNodes.map(n => n.id);
                  setSelectedNodeIds(nodeIds);
                  setContextMenu({
                    isOpen: true,
                    x: e.clientX,
                    y: e.clientY,
                    type: 'node-options',
                    sourceNodeId: undefined,
                  });
                }}
                onGroupConnectorDown={(e, groupNodeIds, side, bboxEdge) => {
                  handleGroupConnectorPointerDown(e, groupNodeIds, side, bboxEdge);
                  if (canvasRef.current) {
                    canvasRef.current.setPointerCapture(e.pointerId);
                  }
                }}
              />
            );
          })}
        </div>
      </div >

      {/* Selection Box Overlay - Outside transformed canvas for screen-space coordinates */}
      {selectionBox.isActive && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: Math.min(selectionBox.startX, selectionBox.endX),
            top: Math.min(selectionBox.startY, selectionBox.endY),
            width: Math.abs(selectionBox.endX - selectionBox.startX),
            height: Math.abs(selectionBox.endY - selectionBox.startY),
            border: '1.5px dashed rgba(255,255,255,0.5)',
            zIndex: 1000
          }}
        />
      )}

      {/* Context Menu */}
      <ContextMenu
        state={contextMenu}
        onClose={() => { setContextMenu(prev => ({ ...prev, isOpen: false })); clearPendingLine(); }}
        onSelectType={handleContextMenuSelect}
        onUpload={handleContextUpload}
        onUndo={undo}
        onRedo={redo}
        onPaste={handlePaste}
        onCopy={handleCopy}
        onDuplicate={handleDuplicate}
        onCreateAsset={handleContextMenuCreateAsset}
        onAddAssets={handleContextMenuAddAssets}
        onMergeVideos={() => openVideoMerge()}
        showMergeVideos={
          nodes.filter(n => n.type === NodeType.VIDEO && n.resultUrl).length >= 2
        }
        canUndo={canUndo}
        canRedo={canRedo}
        selectedNodes={contextMenu.sourceNodeId
          ? nodes.filter(n => n.id === contextMenu.sourceNodeId)
          : (selectedNodeIds.length > 1 ? nodes.filter(n => selectedNodeIds.includes(n.id)) : [])
        }
        onReversePrompt={handleReversePrompt}
        onThreeViewGenerate={(node) => setThreeViewModalNodeId(node.id)}
        onNewCanvas={handleNewCanvas}
      />

      {/* Zoom Slider */}
      {!storyboardGenerator.isModalOpen && (
        <HoverBorderGradient
          containerClassName="fixed bottom-6 left-16 rounded-lg z-50"
          className={`rounded-md ${isDark ? 'bg-[var(--sf-bg-panel)]' : 'bg-white'}`}
          fillClassName={isDark ? undefined : 'bg-white'}
          duration={4}
        >
        <div className={`rounded-md px-4 py-2 flex items-center gap-3 transition-colors duration-300 ${isDark ? '' : 'lt-panel rounded-xl'}`} >
          {/* Pan-mode indicator: lights up while panning canvas (Space + drag, or middle-click drag). */}
          <div
            className={`flex items-center justify-center w-6 h-6 rounded transition-colors ${
              isPanning
                ? (isDark ? 'sf-rainbow-text drop-shadow-[0_0_6px_rgba(192,132,252,0.55)]' : 'sf-rainbow-text')
                : isSpaceHeld
                    ? (isDark ? 'text-white/70' : 'text-gray-600')
                    : (isDark ? 'text-neutral-500' : 'text-gray-400')
            }`}
            title={t('common.panHint')}
          >
            <Hand size={14} />
          </div>
          <span className={`text-xs tracking-wider uppercase ${isDark ? 'font-mono text-neutral-400' : 'text-gray-400 font-medium'}`}>{t('common.zoom')}</span>
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.1"
            value={viewport.zoom}
            onChange={handleSliderZoom}
            className="w-32"
          />
          <span className={`text-xs w-10 ${isDark ? 'font-mono text-white' : 'sf-rainbow-text font-semibold'}`}>{Math.round(viewport.zoom * 100)}%</span>
          <div className={`w-px h-4 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          <button
            onClick={handleFitToNodes}
            className={`p-0.5 rounded transition-colors ${isDark ? 'text-neutral-400 hover:sf-rainbow-text' : 'text-gray-400 hover:sf-rainbow-text'}`}
            title={t('common.fitToNodes')}
          >
            <LocateFixed size={16} />
          </button>
        </div>
        </HoverBorderGradient>
      )}

      <React.Suspense fallback={null}>
      <ImageEditorModal
        isOpen={editorModal.isOpen}
        nodeId={editorModal.nodeId || ''}
        imageUrl={editorModal.imageUrl}
        initialPrompt={editorNode?.prompt}
        initialModel={editorNode?.imageModel || 'chuhaibang'}
        initialAspectRatio={editorNode?.aspectRatio || 'Auto'}
        initialResolution={editorNode?.resolution || '1K'}
        initialElements={editorNode?.editorElements as any}
        initialCanvasData={editorNode?.editorCanvasData}
        initialCanvasSize={editorNode?.editorCanvasSize}
        initialBackgroundUrl={editorNode?.editorBackgroundUrl}
        onClose={handleCloseImageEditor}
        onGenerate={async (sourceId, prompt, count) => {
          handleCloseImageEditor();

          const sourceNode = nodeMap.get(sourceId);
          if (!sourceNode) return;

          // Get settings from source node (which were updated by the modal)
          const imageModel = sourceNode.imageModel || 'chuhaibang';
          const aspectRatio = sourceNode.aspectRatio || 'Auto';
          const resolution = sourceNode.resolution || '1K';

          const startX = sourceNode.x + 360; // Source width + gap
          const startY = sourceNode.y;

          const newNodes: NodeData[] = [];

          const yStep = 500;
          const totalHeight = (count - 1) * yStep;
          const startYOffset = -totalHeight / 2;

          // Create N nodes with inherited settings
          for (let i = 0; i < count; i++) {
            newNodes.push({
              id: generateUUID(),
              type: NodeType.IMAGE,
              x: startX,
              y: startY + startYOffset + (i * yStep),
              prompt: prompt,
              status: NodeStatus.LOADING,
              model: 'GEM 3.0',
              imageModel: imageModel,
              aspectRatio: aspectRatio,
              resolution: resolution,
              parentIds: [sourceId]
            });
          }

          // Add new nodes and edges immediately
          // Note: State updates might be batched
          setNodes(prev => [...prev, ...newNodes]);

          // Convert editor image to base64 for generation reference
          let imageBase64: string | undefined = undefined;
          if (editorModal.imageUrl) {
            imageBase64 = await urlToBase64(editorModal.imageUrl);
          }

          newNodes.forEach(async (node) => {
            try {
              const resultUrl = await generateImage({
                prompt: node.prompt || '',
                imageBase64: imageBase64,
                imageModel: imageModel,
                aspectRatio: aspectRatio,
                resolution: resolution
              });
              updateNode(node.id, { status: NodeStatus.SUCCESS, resultUrl });
            } catch (error: any) {
              updateNode(node.id, { status: NodeStatus.ERROR, errorMessage: error.message });
            }
          });
        }}
        onUpdate={updateNode}
      />
      </React.Suspense>

      {/* Storyboard Video Generation Modal */}
      <React.Suspense fallback={null}>
      <StoryboardVideoModal
        isOpen={storyboardVideoModal.isOpen}
        onClose={() => setStoryboardVideoModal(prev => ({ ...prev, isOpen: false }))}
        scenes={storyboardVideoModal.nodes}
        storyContext={storyboardVideoModal.storyContext}
        onCreateVideos={handleGenerateStoryVideos}
      />
      </React.Suspense>

      {/* Video Editor Modal */}
      <React.Suspense fallback={null}>
      <VideoEditorModal
        isOpen={videoEditorModal.isOpen}
        nodeId={videoEditorModal.nodeId}
        videoUrl={videoEditorModal.videoUrl}
        initialTrimStart={videoEditorNode?.trimStart}
        initialTrimEnd={videoEditorNode?.trimEnd}
        onClose={handleCloseVideoEditor}
        onExport={handleExportTrimmedVideo}
      />
      </React.Suspense>

      {/* Fullscreen Media Preview Modal */}
      <React.Suspense fallback={null}>
      <ExpandedMediaModal
        key={expandedImageUrl || ''}
        mediaUrl={expandedImageUrl}
        mediaList={useMemo(() => {
          const imageTypes = [NodeType.IMAGE, NodeType.IMAGE_EDITOR, NodeType.LOCAL_IMAGE_MODEL, NodeType.CAMERA_ANGLE];
          const videoTypes = [NodeType.VIDEO, NodeType.VIDEO_EDITOR, NodeType.LOCAL_VIDEO_MODEL];
          const mediaTypes = [...imageTypes, ...videoTypes];
          return nodes
            .filter(n => n.resultUrl && n.status === NodeStatus.SUCCESS && mediaTypes.includes(n.type))
            .map(n => ({
              url: n.resultUrl!,
              label: n.title || n.prompt || undefined,
              isVideo: videoTypes.includes(n.type)
            } as MediaItem));
        }, [nodes])}
        onClose={handleCloseExpand}
      />
      </React.Suspense>

    </div>
    </CanvasErrorBoundary>
  );
}