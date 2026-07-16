import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { NodeData, NodeType } from '../../types';
import { assetUrl, ossResize, ossVideoPoster } from '../../config/api';
import { useTheme } from '../../hooks/useTheme';
import { Image as ImageIcon, Video, Type, Scissors, Film, LibraryBig } from 'lucide-react';

export interface LibraryAssetItem {
    id: string;
    name: string;
    category: string;
    url: string;
    type: 'image' | 'video';
}

const NODE_TYPE_LABELS: Record<string, string> = {
    [NodeType.IMAGE]: '图片',
    [NodeType.VIDEO]: '视频',
    [NodeType.TEXT]: '文本',
    [NodeType.AUDIO]: '音频',
    [NodeType.IMAGE_EDITOR]: '图片编辑',
    [NodeType.VIDEO_EDITOR]: '视频编辑',
    [NodeType.STORYBOARD]: '分镜',
    [NodeType.CAMERA_ANGLE]: '机位',
    [NodeType.LOCAL_IMAGE_MODEL]: '本地图片',
    [NodeType.LOCAL_VIDEO_MODEL]: '本地视频',
};

const NODE_TYPE_ICONS: Record<string, React.FC<{ size?: number; className?: string }>> = {
    [NodeType.IMAGE]: ImageIcon,
    [NodeType.VIDEO]: Video,
    [NodeType.TEXT]: Type,
    [NodeType.IMAGE_EDITOR]: Scissors,
    [NodeType.VIDEO_EDITOR]: Film,
    [NodeType.LOCAL_IMAGE_MODEL]: ImageIcon,
    [NodeType.LOCAL_VIDEO_MODEL]: Video,
};

export function getNodeDisplayTitle(node: NodeData): string {
    if (node.title) return node.title;
    return NODE_TYPE_LABELS[node.type] || node.type;
}

/** Thumbnail for @ mention list and inline chips. Video URLs need OSS snapshot, not image resize. */
export function getNodeMentionThumbUrl(node: NodeData, size: number): string | undefined {
    const isVideoLike =
        node.type === NodeType.VIDEO ||
        node.type === NodeType.VIDEO_EDITOR ||
        node.type === NodeType.LOCAL_VIDEO_MODEL;

    if (node.resultUrl) {
        const u = assetUrl(node.resultUrl);
        if (isVideoLike) {
            const poster = ossVideoPoster(u, size);
            if (poster) return poster;
        } else {
            return ossResize(u, size);
        }
    }

    if (node.lastFrame) {
        const lf =
            node.lastFrame.startsWith('data:') || node.lastFrame.startsWith('blob:') || node.lastFrame.startsWith('http')
                ? node.lastFrame
                : assetUrl(node.lastFrame);
        if (lf.startsWith('data:') || lf.startsWith('blob:')) return lf;
        return ossResize(lf, size) || lf;
    }

    return undefined;
}

function getLibraryAssetMentionThumbUrl(asset: LibraryAssetItem, size: number): string | undefined {
    const u = assetUrl(asset.url);
    if (asset.type === 'video') {
        const poster = ossVideoPoster(u, size);
        return poster || undefined;
    }
    return ossResize(u, size);
}

export function getMentionCandidates(
    allNodes: NodeData[],
    currentNodeId: string,
    _currentNodeType: NodeType,
    _currentParentIds: string[],
    filter: string
): NodeData[] {
    return allNodes.filter(node => {
        if (node.id === currentNodeId) return false;
        if (filter) {
            const title = getNodeDisplayTitle(node).toLowerCase();
            if (!title.includes(filter.toLowerCase())) return false;
        }
        return true;
    });
}

export function getLibraryAssetCandidates(
    assets: LibraryAssetItem[],
    existingMentions: { name: string; url: string }[],
    filter: string
): LibraryAssetItem[] {
    const mentionedUrls = new Set(existingMentions.map(m => m.url));
    return assets.filter(asset => {
        if (mentionedUrls.has(asset.url)) return false;
        if (filter) {
            return asset.name.toLowerCase().includes(filter.toLowerCase());
        }
        return true;
    });
}

const ASSET_CATEGORY_LABELS: Record<string, string> = {
    'Character': '角色',
    'Scene': '场景',
    'Item': '道具',
    'Style': '风格',
    'Sound Effect': '音效',
    'Others': '其他',
};

interface NodeMentionDropdownProps {
    candidates: NodeData[];
    libraryAssets?: LibraryAssetItem[];
    selectedIndex: number;
    onSelect: (node: NodeData) => void;
    onSelectAsset?: (asset: LibraryAssetItem) => void;
    anchorRect: DOMRect | null;
}

export const NodeMentionDropdown: React.FC<NodeMentionDropdownProps> = ({
    candidates,
    libraryAssets = [],
    selectedIndex,
    onSelect,
    onSelectAsset,
    anchorRect,
}) => {
    const { isDark } = useTheme();
    const listRef = useRef<HTMLDivElement>(null);
    const totalCount = candidates.length + libraryAssets.length;

    useEffect(() => {
        if (listRef.current) {
            const active = listRef.current.querySelector('[data-active="true"]');
            active?.scrollIntoView({ block: 'nearest' });
        }
    }, [selectedIndex]);

    if (totalCount === 0 || !anchorRect) return null;

    const safeIndex = selectedIndex % totalCount;

    const style: React.CSSProperties = {
        position: 'fixed',
        left: anchorRect.left,
        bottom: window.innerHeight - anchorRect.top + 6,
        width: 280,
        zIndex: 99999,
    };

    const dropdown = (
        <div
            ref={listRef}
            className={`max-h-64 overflow-y-auto rounded-lg shadow-xl animate-in fade-in zoom-in-95 duration-100 ${
                isDark
                    ? 'bg-[#252525] border border-neutral-700'
                    : 'bg-white border border-gray-200 shadow-lg'
            }`}
            style={style}
            onWheel={(e) => e.stopPropagation()}
        >
            {/* Library assets section */}
            {libraryAssets.length > 0 && (
                <>
                    <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider sticky top-0 z-10 flex items-center gap-1.5 ${
                        isDark ? 'text-violet-400 bg-[#1f1f1f]' : 'text-violet-600 bg-violet-50'
                    }`}>
                        <LibraryBig size={10} />
                        素材库
                    </div>
                    {libraryAssets.map((asset, i) => {
                        const isActive = i === safeIndex;
                        const categoryLabel = ASSET_CATEGORY_LABELS[asset.category] || asset.category;

                        return (
                            <div
                                key={`asset-${asset.id}`}
                                data-active={isActive}
                                className={`flex items-center gap-2 w-full px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                                    isActive
                                        ? isDark ? 'bg-violet-500/20 text-white' : 'bg-violet-50 text-gray-900'
                                        : isDark ? 'text-neutral-300 hover:bg-neutral-700/50' : 'text-gray-700 hover:bg-gray-50'
                                }`}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onSelectAsset?.(asset);
                                }}
                            >
                                {(() => {
                                    const libThumb = getLibraryAssetMentionThumbUrl(asset, 48);
                                    return libThumb ? (
                                        <img
                                            src={libThumb}
                                            className="w-6 h-6 rounded object-cover flex-shrink-0"
                                            alt=""
                                        />
                                    ) : (
                                        <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${
                                            isDark ? 'bg-neutral-600' : 'bg-gray-200'
                                        }`}>
                                            {asset.type === 'video' ? <Video size={12} /> : <ImageIcon size={12} />}
                                        </div>
                                    );
                                })()}
                                <span className="truncate font-medium">{asset.name}</span>
                                <span className={`ml-auto text-[10px] flex-shrink-0 ${
                                    isDark ? 'text-violet-400/60' : 'text-violet-400'
                                }`}>{categoryLabel}</span>
                            </div>
                        );
                    })}
                </>
            )}
            {/* Canvas nodes section */}
            {candidates.length > 0 && (
                <>
                    <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider sticky top-0 z-10 ${
                        isDark ? 'text-neutral-500 bg-[#1f1f1f]' : 'text-gray-500 bg-gray-50'
                    }`}>
                        引用节点
                    </div>
                    {candidates.map((node, i) => {
                        const globalIndex = libraryAssets.length + i;
                        const isActive = globalIndex === safeIndex;
                        const Icon = NODE_TYPE_ICONS[node.type];
                        const title = getNodeDisplayTitle(node);
                        const typeLabel = NODE_TYPE_LABELS[node.type] || node.type;

                        return (
                            <div
                                key={node.id}
                                data-active={isActive}
                                className={`flex items-center gap-2 w-full px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                                    isActive
                                        ? isDark ? 'bg-neutral-700 text-white' : 'bg-blue-50 text-gray-900'
                                        : isDark ? 'text-neutral-300 hover:bg-neutral-700/50' : 'text-gray-700 hover:bg-gray-50'
                                }`}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onSelect(node);
                                }}
                            >
                                {(() => {
                                    const thumbSrc = getNodeMentionThumbUrl(node, 48);
                                    if (thumbSrc) {
                                        return (
                                            <img
                                                src={thumbSrc}
                                                className="w-6 h-6 rounded object-cover flex-shrink-0"
                                                alt=""
                                            />
                                        );
                                    }
                                    if (Icon) {
                                        return (
                                            <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${
                                                isDark ? 'bg-neutral-600' : 'bg-gray-200'
                                            }`}>
                                                <Icon size={12} />
                                            </div>
                                        );
                                    }
                                    return (
                                        <div className={`w-6 h-6 rounded flex-shrink-0 ${
                                            isDark ? 'bg-neutral-600' : 'bg-gray-200'
                                        }`} />
                                    );
                                })()}
                                <span className="truncate font-medium">{title}</span>
                                <span className={`ml-auto text-[10px] flex-shrink-0 ${
                                    isDark ? 'text-neutral-500' : 'text-gray-400'
                                }`}>{typeLabel}</span>
                            </div>
                        );
                    })}
                </>
            )}
        </div>
    );

    return createPortal(dropdown, document.body);
};
