/**
 * imageEditor.types.ts
 * 
 * Shared types and constants for the Image Editor modal.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Arrow element for annotations
 */
export interface ArrowElement {
    id: string;
    type: 'arrow';
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    color: string;
    lineWidth: number;
}

/**
 * Text element for annotations
 */
export interface TextElement {
    id: string;
    type: 'text';
    x: number;
    y: number;
    text: string;
    fontSize: number;
    color: string;
    fontFamily: string;
}

/**
 * Union type for all drawable elements
 */
export type EditorElement = ArrowElement | TextElement;

/**
 * Snapshot of editor state for undo/redo
 */
export interface HistoryState {
    canvasData: string | null; // Base64 image data of brush canvas
    elements: EditorElement[];
    imageUrl?: string; // Current image URL (for crop undo/redo)
}

/**
 * Props for the main ImageEditorModal component
 */
export interface ImageEditorModalProps {
    isOpen: boolean;
    nodeId: string;
    imageUrl?: string;
    initialPrompt?: string;
    initialModel?: string;
    initialAspectRatio?: string;
    initialResolution?: string;
    initialElements?: EditorElement[];
    initialCanvasData?: string;
    initialCanvasSize?: { width: number; height: number };
    initialBackgroundUrl?: string; // Original/clean image for editing
    onClose: () => void;
    onGenerate: (id: string, prompt: string, count: number) => void;
    onUpdate: (id: string, updates: any) => void;
}

/**
 * Image model configuration
 */
export interface ImageModel {
    id: string;
    name: string;
    provider: string;
    group?: string;
    label?: string;
    supportsImageToImage: boolean;
    supportsMultiImage: boolean;
    recommended?: boolean;
    resolutions: string[];
    aspectRatios: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const IMAGE_MODELS: ImageModel[] = [
    // ── Google (GEM/Nano) ──
    { id: 'gem-3.0', name: 'Nano Banana Pro', group: 'Google', provider: 'tencent', recommended: true, supportsImageToImage: true, supportsMultiImage: true, resolutions: ["1K", "2K", "4K"], aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] },
    { id: 'gem-3.1', name: 'Nano2', group: 'Google', provider: 'tencent', supportsImageToImage: true, supportsMultiImage: true, resolutions: ["512", "1K", "2K", "4K"], aspectRatios: ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"] },
    { id: 'gem-2.5', name: 'Nano Banana', group: 'Google', provider: 'tencent', supportsImageToImage: true, supportsMultiImage: true, resolutions: ["1K", "2K", "4K"], aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] },
    // ── 可灵 Kling ──
    { id: 'kling-img-3.0', name: '可灵 3.0', group: '可灵 Kling', provider: 'tencent', recommended: true, supportsImageToImage: true, supportsMultiImage: false, resolutions: ["1K", "2K"], aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"] },
    { id: 'kling-img-3.0-omni', name: '可灵 3.0-Omni', group: '可灵 Kling', provider: 'tencent', supportsImageToImage: true, supportsMultiImage: true, resolutions: ["1K", "2K", "4K"], aspectRatios: ["Auto", "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"] },
    { id: 'kling-img-2.1', name: '可灵 2.1', group: '可灵 Kling', provider: 'tencent', supportsImageToImage: true, supportsMultiImage: true, resolutions: ["1K", "2K"], aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"] },
    // ── Vidu (生数) ──
    { id: 'vidu-q2', name: '生数 Vidu q2', group: 'Vidu', provider: 'tencent', supportsImageToImage: true, supportsMultiImage: true, resolutions: ["1080P", "2K", "4K"], aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"] },
    // ── 豆包 Seedream ──
    { id: 'si-4.0', name: '豆包 Seedream 4.0', group: '豆包 Seedream', provider: 'tencent', supportsImageToImage: true, supportsMultiImage: true, resolutions: ["1K", "2K", "4K"], aspectRatios: [] },
    { id: 'si-4.5', name: '豆包 Seedream 4.5', group: '豆包 Seedream', provider: 'tencent', supportsImageToImage: true, supportsMultiImage: true, resolutions: ["2K", "4K"], aspectRatios: [] },
    { id: 'si-5.0-lite', name: '豆包 Seedream 5.0-lite', group: '豆包 Seedream', provider: 'tencent', supportsImageToImage: true, supportsMultiImage: true, resolutions: ["2K", "3K"], aspectRatios: [] },
    // ── 即梦 Jimeng ──
    { id: 'jimeng-4.0', name: '即梦 4.0', group: '即梦 Jimeng', provider: 'tencent', supportsImageToImage: true, supportsMultiImage: true, resolutions: [], aspectRatios: [] },
    // ── 混元 Hunyuan ──
    { id: 'hunyuan-3.0', name: '混元 3.0', group: '混元 Hunyuan', provider: 'tencent', supportsImageToImage: true, supportsMultiImage: true, resolutions: [], aspectRatios: [] },
    // ── 千问 Qwen ──
    { id: 'qwen-0925', name: '千问 0925', group: '千问 Qwen', provider: 'tencent', supportsImageToImage: false, supportsMultiImage: false, resolutions: [], aspectRatios: [] },
    // ── ChuHaiBang ──
    { id: 'chuhaibang', name: 'ChuHaiBang', group: 'ChuHaiBang', provider: 'chuhaibang', supportsImageToImage: true, supportsMultiImage: true, resolutions: [], aspectRatios: ["1:1", "3:4", "9:16", "4:3", "16:9"] },
    // ── 腾讯 Image 2 (OG) ──
    { id: 'og-image2-high', name: 'Image 2 高质量', group: '腾讯 Image 2', provider: 'tencent', recommended: true, supportsImageToImage: true, supportsMultiImage: true, resolutions: ["1K", "2K", "4K"], aspectRatios: ["1:1", "3:2", "2:3", "3:4", "4:3", "16:9", "9:16", "21:9", "9:21"] },
    { id: 'og-image2-medium', name: 'Image 2 标准', group: '腾讯 Image 2', provider: 'tencent', supportsImageToImage: true, supportsMultiImage: true, resolutions: ["1K", "2K", "4K"], aspectRatios: ["1:1", "3:2", "2:3", "3:4", "4:3", "16:9", "9:16", "21:9", "9:21"] },
    { id: 'og-image2-low', name: 'Image 2 快速', group: '腾讯 Image 2', provider: 'tencent', supportsImageToImage: true, supportsMultiImage: true, resolutions: ["1K", "2K", "4K"], aspectRatios: ["1:1", "3:2", "2:3", "3:4", "4:3", "16:9", "9:16", "21:9", "9:21"] },
];

/**
 * Preset brush colors
 */
export const PRESET_COLORS = ['#ff0000', '#3b82f6', '#22c55e', '#eab308', '#ec4899', '#8b5cf6'];
