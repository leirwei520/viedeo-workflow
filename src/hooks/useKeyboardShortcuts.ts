/**
 * useKeyboardShortcuts.ts
 * 
 * Handles keyboard shortcuts: undo/redo, copy/paste, delete, escape.
 * Uses refs for volatile state to avoid constant listener rebinding.
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { NodeData, NodeGroup, NodeType, NodeStatus, ContextMenuState, Viewport } from '../types';
import { isModKey } from '../utils/platform';
import { generateUUID } from '../utils/uuid';

interface UseKeyboardShortcutsOptions {
    nodes: NodeData[];
    selectedNodeIds: string[];
    selectedConnection: { parentId: string; childId: string } | null;
    setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>;
    setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
    setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
    deleteNodes: (ids: string[]) => void;
    deleteSelectedConnection: (setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>, nodes?: NodeData[]) => void;
    clearSelection: () => void;
    clearSelectionBox: () => void;
    undo: () => void;
    redo: () => void;
    groups: NodeGroup[];
    groupNodes: (nodeIds: string[], onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void, label?: string) => string;
    setGroups: React.Dispatch<React.SetStateAction<NodeGroup[]>>;
    getCommonGroup: (nodeIds: string[]) => NodeGroup | undefined;
    viewport: Viewport;
    setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
    onGenerate?: (nodeId: string) => void;
    onPasteImage?: (nodeId: string, imageDataUrl: string) => void;
    getNextNodeTitle?: (type: NodeType) => string;
    onSave?: () => void;
}

export const useKeyboardShortcuts = ({
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
    onGenerate,
    onPasteImage,
    getNextNodeTitle,
    onSave
}: UseKeyboardShortcutsOptions) => {
    const clipboardRef = useRef<NodeData[]>([]);
    const clipboardGroupRef = useRef<NodeGroup | null>(null);
    const nodeJustCopiedRef = useRef(false);

    // Refs for volatile values — read inside the handler, never in the dep array
    const nodesRef = useRef(nodes);
    nodesRef.current = nodes;
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    selectedNodeIdsRef.current = selectedNodeIds;
    const selectedConnectionRef = useRef(selectedConnection);
    selectedConnectionRef.current = selectedConnection;
    const viewportRef = useRef(viewport);
    viewportRef.current = viewport;
    const getCommonGroupRef = useRef(getCommonGroup);
    getCommonGroupRef.current = getCommonGroup;
    const deleteNodesRef = useRef(deleteNodes);
    deleteNodesRef.current = deleteNodes;
    const deleteSelectedConnectionRef = useRef(deleteSelectedConnection);
    deleteSelectedConnectionRef.current = deleteSelectedConnection;
    const undoRef = useRef(undo);
    undoRef.current = undo;
    const redoRef = useRef(redo);
    redoRef.current = redo;
    const groupNodesRef = useRef(groupNodes);
    groupNodesRef.current = groupNodes;
    const onGenerateRef = useRef(onGenerate);
    onGenerateRef.current = onGenerate;
    const onPasteImageRef = useRef(onPasteImage);
    onPasteImageRef.current = onPasteImage;
    const getNextNodeTitleRef = useRef(getNextNodeTitle);
    getNextNodeTitleRef.current = getNextNodeTitle;
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;

    const isSpaceDown = useRef(false);
    /** Last screen pointer position (window mousemove). Default = viewport center so Tab works before any move. */
    const mousePosRef = useRef<{ x: number; y: number }>({
        x: typeof window !== 'undefined' ? Math.floor(window.innerWidth / 2) : 0,
        y: typeof window !== 'undefined' ? Math.floor(window.innerHeight / 2) : 0
    });

    // ============================================================================
    // COPY / PASTE / DUPLICATE
    // ============================================================================

    const handleCopy = useCallback(() => {
        const sel = selectedNodeIdsRef.current;
        if (sel.length > 0) {
            const selectedNodes = nodesRef.current.filter(n => sel.includes(n.id));
            clipboardRef.current = JSON.parse(JSON.stringify(selectedNodes));
            const commonGroup = getCommonGroupRef.current(sel);
            clipboardGroupRef.current = commonGroup
                ? JSON.parse(JSON.stringify(commonGroup))
                : null;
            nodeJustCopiedRef.current = true;
        }
    }, []);

    const handlePaste = useCallback(() => {
        if (clipboardRef.current.length === 0) return;

        const vp = viewportRef.current;
        const canvasMouseX = (mousePosRef.current.x - vp.x) / vp.zoom;
        const canvasMouseY = (mousePosRef.current.y - vp.y) / vp.zoom;

        const srcNodes = clipboardRef.current;
        const centerX = srcNodes.reduce((s, n) => s + n.x, 0) / srcNodes.length;
        const centerY = srcNodes.reduce((s, n) => s + n.y, 0) / srcNodes.length;

        const accumulated = [...nodesRef.current];
        const newNodes: NodeData[] = srcNodes.map(node => {
            const title = getNextNodeTitleRef.current?.(node.type, accumulated) || node.title;
            const n = {
                ...node,
                id: generateUUID(),
                title,
                x: canvasMouseX + (node.x - centerX),
                y: canvasMouseY + (node.y - centerY),
                parentIds: undefined,
                groupId: undefined,
            };
            accumulated.push(n as NodeData);
            return n;
        });

        setNodes(prev => [...prev, ...newNodes]);
        setSelectedNodeIds(newNodes.map(n => n.id));

        if (clipboardGroupRef.current && newNodes.length > 1) {
            const srcGroup = clipboardGroupRef.current;
            const newGroupId = groupNodesRef.current(newNodes.map(n => n.id), setNodes, srcGroup.label);
            if (srcGroup.storyContext) {
                setGroups(prev => prev.map(g =>
                    g.id === newGroupId ? { ...g, storyContext: { ...srcGroup.storyContext! } } : g
                ));
            }
        }
    }, [setNodes, setSelectedNodeIds, setGroups]);

    const handleDuplicate = useCallback(() => {
        const sel = selectedNodeIdsRef.current;
        if (sel.length === 0) return;

        const selectedNodes = nodesRef.current.filter(n => sel.includes(n.id));
        const commonGroup = getCommonGroupRef.current(sel);

        const offset = 20;
        const accumulated = [...nodesRef.current];
        const newNodes: NodeData[] = selectedNodes.map(node => {
            const title = getNextNodeTitleRef.current?.(node.type, accumulated) || node.title;
            const n = {
                ...JSON.parse(JSON.stringify(node)),
                id: generateUUID(),
                title,
                x: node.x + offset,
                y: node.y + offset,
                parentIds: undefined,
                groupId: undefined,
            };
            accumulated.push(n as NodeData);
            return n;
        });

        setNodes(prev => [...prev, ...newNodes]);
        setSelectedNodeIds(newNodes.map(n => n.id));

        if (commonGroup && newNodes.length > 1) {
            const newGroupId = groupNodesRef.current(newNodes.map(n => n.id), setNodes, commonGroup.label);
            if (commonGroup.storyContext) {
                setGroups(prev => prev.map(g =>
                    g.id === newGroupId ? { ...g, storyContext: { ...commonGroup.storyContext! } } : g
                ));
            }
        }
    }, [setNodes, setSelectedNodeIds, setGroups]);

    // ============================================================================
    // KEYBOARD EVENT EFFECT — registered once
    // ============================================================================

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const active = document.activeElement;
            const activeTag = active?.tagName.toLowerCase();
            if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select'
                || (active as HTMLElement)?.isContentEditable) return;

            const mod = isModKey(e);

            const key = e.key.toLowerCase();

            if (mod && key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undoRef.current();
                return;
            }

            if ((mod && key === 'y') || (mod && e.shiftKey && key === 'z')) {
                e.preventDefault();
                redoRef.current();
                return;
            }

            if (mod && key === 's') {
                e.preventDefault();
                onSaveRef.current?.();
                return;
            }

            if (mod && key === 'a') {
                e.preventDefault();
                setSelectedNodeIds(nodesRef.current.map(n => n.id));
                return;
            }

            if (mod && key === 'c') {
                e.preventDefault();
                handleCopy();
                return;
            }

            if (mod && key === 'v') {
                // Let the native 'paste' event fire — handled by handleDocPaste below
                return;
            }

            if (mod && key === 'd') {
                e.preventDefault();
                handleDuplicate();
                return;
            }

            if (mod && key === '0') {
                e.preventDefault();
                const vp = viewportRef.current;
                const cx = window.innerWidth / 2;
                const cy = window.innerHeight / 2;
                const newX = cx - (cx - vp.x) * (1 / vp.zoom);
                const newY = cy - (cy - vp.y) * (1 / vp.zoom);
                setViewport({ x: newX, y: newY, zoom: 1 });
                return;
            }

            if (e.key === 'Tab') {
                e.preventDefault();
                const sel = selectedNodeIdsRef.current;
                if (sel.length === 1) {
                    const currentNode = nodesRef.current.find(n => n.id === sel[0]);
                    if (currentNode) {
                        const children = nodesRef.current.filter(n => n.parentIds?.includes(currentNode.id));
                        const parents = currentNode.parentIds?.map(pid => nodesRef.current.find(n => n.id === pid)).filter(Boolean) || [];
                        const neighbors = [...children, ...parents] as NodeData[];
                        if (neighbors.length > 0) {
                            setSelectedNodeIds([neighbors[0].id]);
                            return;
                        }
                    }
                }
                const p = mousePosRef.current;
                setContextMenu({
                    isOpen: true,
                    x: p.x,
                    y: p.y,
                    type: 'add-nodes',
                    placeAtCenter: false
                });
                return;
            }

            // G - Generate selected node
            if (key === 'g' && !mod) {
                const sel = selectedNodeIdsRef.current;
                if (sel.length === 1 && onGenerateRef.current) {
                    e.preventDefault();
                    onGenerateRef.current(sel[0]);
                    return;
                }
            }

            // Space - Enable pan mode
            if (e.code === 'Space' && !mod) {
                e.preventDefault();
                isSpaceDown.current = true;
                document.body.style.cursor = 'grab';
                return;
            }

            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                const sel = selectedNodeIdsRef.current;
                if (sel.length > 0) {
                    deleteNodesRef.current(sel);
                    setContextMenu(prev => ({ ...prev, isOpen: false }));
                } else if (selectedConnectionRef.current) {
                    deleteSelectedConnectionRef.current(setNodes, nodesRef.current);
                }
            } else if (e.key === 'Escape') {
                clearSelection();
                clearSelectionBox();
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                isSpaceDown.current = false;
                document.body.style.cursor = '';
            }
        };

        const handleDocPaste = (e: ClipboardEvent) => {
            const active = document.activeElement;
            const activeTag = active?.tagName.toLowerCase();
            if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select'
                || (active as HTMLElement)?.isContentEditable) return;

            const clipboard = e.clipboardData;
            if (!clipboard) { handlePaste(); return; }

            let imageFile: File | null = null;
            if (clipboard.items?.length) {
                for (const item of Array.from(clipboard.items)) {
                    if (item.type.startsWith('image/')) {
                        imageFile = item.getAsFile();
                        if (imageFile) break;
                    }
                }
            }
            if (!imageFile && clipboard.files?.length) {
                for (const f of Array.from(clipboard.files)) {
                    if (f.type.startsWith('image/')) { imageFile = f; break; }
                }
            }

            if (imageFile && nodeJustCopiedRef.current && clipboardRef.current.length > 0) {
                e.preventDefault();
                handlePaste();
                return;
            }

            if (imageFile) {
                const sel = selectedNodeIdsRef.current;
                const nodes = nodesRef.current;
                const imageTypes = [NodeType.IMAGE, NodeType.LOCAL_IMAGE_MODEL];
                const targetNode = sel.length === 1
                    ? nodes.find(n => n.id === sel[0] && imageTypes.includes(n.type))
                    : undefined;

                e.preventDefault();
                const reader = new FileReader();
                reader.onloadend = () => {
                    const imageDataUrl = reader.result as string;
                    if (targetNode && onPasteImageRef.current) {
                        onPasteImageRef.current(targetNode.id, imageDataUrl);
                    } else {
                        const vp = viewportRef.current;
                        const canvasX = (mousePosRef.current.x - vp.x) / vp.zoom - 170;
                        const canvasY = (mousePosRef.current.y - vp.y) / vp.zoom - 100;
                        const nodeId = generateUUID();
                        const newNode: NodeData = {
                            id: nodeId,
                            type: NodeType.IMAGE,
                            title: getNextNodeTitleRef.current?.(NodeType.IMAGE),
                            x: canvasX,
                            y: canvasY,
                            prompt: '',
                            status: NodeStatus.SUCCESS,
                            resultUrl: imageDataUrl,
                            model: 'GEM 3.0',
                            aspectRatio: '16:9',
                            resolution: 'Auto',
                            parentIds: [],
                        };
                        setNodes(prev => [...prev, newNode]);
                        setSelectedNodeIds([nodeId]);
                        const img = new Image();
                        img.onload = () => {
                            const ratio = img.naturalWidth / img.naturalHeight;
                            const ratios = [
                                { l: '1:1', v: 1 }, { l: '16:9', v: 16/9 }, { l: '9:16', v: 9/16 },
                                { l: '4:3', v: 4/3 }, { l: '3:4', v: 3/4 }, { l: '3:2', v: 3/2 },
                                { l: '2:3', v: 2/3 },
                            ];
                            let closest = ratios[0];
                            for (const r of ratios) {
                                if (Math.abs(ratio - r.v) < Math.abs(ratio - closest.v)) closest = r;
                            }
                            setNodes(prev => prev.map(n => n.id === nodeId ? {
                                ...n,
                                resultAspectRatio: `${img.naturalWidth}/${img.naturalHeight}`,
                                aspectRatio: closest.l,
                            } : n));
                        };
                        img.src = imageDataUrl;
                    }
                };
                reader.readAsDataURL(imageFile);
                return;
            }

            e.preventDefault();
            handlePaste();
        };

        const handleWindowFocus = () => { nodeJustCopiedRef.current = false; };
        const handleMouseMove = (e: MouseEvent) => { mousePosRef.current = { x: e.clientX, y: e.clientY }; };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('paste', handleDocPaste);
        window.addEventListener('focus', handleWindowFocus);
        window.addEventListener('mousemove', handleMouseMove);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('paste', handleDocPaste);
            window.removeEventListener('focus', handleWindowFocus);
            window.removeEventListener('mousemove', handleMouseMove);
        };
    }, [
        handleCopy,
        handlePaste,
        handleDuplicate,
        setNodes,
        setSelectedNodeIds,
        setContextMenu,
        setViewport,
        clearSelection,
        clearSelectionBox,
    ]);

    return {
        handleCopy,
        handlePaste,
        handleDuplicate,
        isSpaceDown
    };
};
