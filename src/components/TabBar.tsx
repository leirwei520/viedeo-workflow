/**
 * TabBar.tsx
 *
 * Browser-style tab strip with drag-to-reorder and right-click context menu.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CanvasTab } from '../hooks/useCanvasTabs';
import { useTheme } from '../hooks/useTheme';

interface TabBarProps {
  tabs: CanvasTab[];
  activeTabId: string;
  onSwitch: (tabId: string) => void;
  onAdd: () => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string, newTitle: string) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onCloseAll: () => void;
  onCloseOthers: (tabId: string) => void;
  onCloseToRight: (tabId: string) => void;
  isChatOpen?: boolean;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSwitch,
  onAdd,
  onClose,
  onRename,
  onMove,
  onCloseAll,
  onCloseOthers,
  onCloseToRight,
  isChatOpen = false,
}) => {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Rename ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (editingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTabId]);

  const commitRename = useCallback(() => {
    if (editingTabId && editValue.trim()) {
      onRename(editingTabId, editValue.trim());
    }
    setEditingTabId(null);
  }, [editingTabId, editValue, onRename]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitRename();
    else if (e.key === 'Escape') setEditingTabId(null);
  };

  const handleDoubleClick = (tab: CanvasTab) => {
    setEditingTabId(tab.id);
    setEditValue(tab.title);
  };

  const handleMiddleClick = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1 && tabs.length > 1) {
      e.preventDefault();
      onClose(tabId);
    }
  };

  // Scroll active tab into view
  useEffect(() => {
    if (!scrollRef.current) return;
    const activeEl = scrollRef.current.querySelector(`[data-tab-id="${activeTabId}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeTabId]);

  // ── Drag & Drop ─────────────────────────────────────────────────────────
  const dragIndexRef = useRef<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    // Make the drag ghost semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
    dragIndexRef.current = null;
    setDropTargetIndex(null);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragIndexRef.current !== null && dragIndexRef.current !== index) {
      setDropTargetIndex(index);
    }
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = dragIndexRef.current;
    if (fromIndex !== null && fromIndex !== toIndex) {
      onMove(fromIndex, toIndex);
    }
    dragIndexRef.current = null;
    setDropTargetIndex(null);
  };

  // ── Context Menu ────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string; tabIndex: number } | null>(null);

  const handleContextMenu = (e: React.MouseEvent, tabId: string, tabIndex: number) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId, tabIndex });
  };

  // Close context menu on any click or scroll
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <>
      <div
        className="fixed top-0 left-0 h-10 flex items-end z-[51] pointer-events-none transition-all duration-300"
        style={{ width: isChatOpen ? 'calc(100% - 400px)' : '100%' }}
      >
        <div className="flex items-end w-full pointer-events-auto pl-12">
          {/* Scrollable tab strip */}
          <div
            ref={scrollRef}
            className="flex items-end gap-0 overflow-x-auto scrollbar-hide flex-1 min-w-0"
            style={{ scrollbarWidth: 'none' }}
          >
            {tabs.map((tab, index) => {
              const isActive = tab.id === activeTabId;
              const isEditing = editingTabId === tab.id;
              const isDropTarget = dropTargetIndex === index;
              const prevTab = index > 0 ? tabs[index - 1] : null;
              const isPrevActive = prevTab ? prevTab.id === activeTabId : false;
              // Show a thin vertical divider between adjacent inactive tabs (Chrome/Edge style)
              const showLeftDivider = index > 0 && !isActive && !isPrevActive;

              return (
                <div
                  key={tab.id}
                  data-tab-id={tab.id}
                  draggable={!isEditing}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={() => setDropTargetIndex(null)}
                  onDrop={(e) => handleDrop(e, index)}
                  onMouseDown={(e) => {
                    if (e.button === 0) onSwitch(tab.id);
                    handleMiddleClick(e, tab.id);
                  }}
                  onDoubleClick={() => handleDoubleClick(tab)}
                  onContextMenu={(e) => handleContextMenu(e, tab.id, index)}
                  className={`
                    group relative flex items-center gap-1.5 min-w-[120px] max-w-[200px]
                    px-3 pt-1.5 cursor-pointer select-none transition-all duration-200
                    ${isActive
                      ? isDark
                        ? 'bg-[#1a1a2e]/95 text-white/90 z-10 shadow-[0_-1px_0_rgba(255,255,255,0.08)_inset]'
                        : 'bg-white text-gray-800 z-10 shadow-[0_-1px_0_rgba(0,0,0,0.04)_inset]'
                      : isDark
                        ? 'bg-[#0a0a15]/70 text-white/45 hover:text-white/75 hover:bg-[#13132c]/80'
                        : 'bg-gray-200/60 text-gray-500 hover:text-gray-700 hover:bg-gray-100/90'
                    }
                    ${isActive ? 'pb-2 rounded-t-lg' : 'pb-1.5 rounded-t-md mt-0.5'}
                  `}
                  style={{
                    borderTop: isActive
                      ? `1px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)'}`
                      : '1px solid transparent',
                    borderLeft: isDropTarget && dragIndexRef.current !== null && dragIndexRef.current > index
                      ? '2px solid rgba(99, 102, 241, 0.8)'
                      : isActive
                        ? `1px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)'}`
                        : '1px solid transparent',
                    borderRight: isDropTarget && dragIndexRef.current !== null && dragIndexRef.current < index
                      ? '2px solid rgba(99, 102, 241, 0.8)'
                      : isActive
                        ? `1px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)'}`
                        : '1px solid transparent',
                    borderBottom: isActive
                      ? isDark ? '2px solid rgba(99, 102, 241, 0.7)' : '2px solid rgba(99, 102, 241, 0.6)'
                      : '2px solid transparent',
                  }}
                >
                  {/* Vertical divider between adjacent inactive tabs */}
                  {showLeftDivider && (
                    <span
                      aria-hidden
                      className={`pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 w-px h-4 ${
                        isDark ? 'bg-white/15' : 'bg-gray-300'
                      } group-hover:opacity-0 transition-opacity duration-150`}
                    />
                  )}

                  {/* Dirty indicator */}
                  {tab.isDirty && (
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      isDark ? 'bg-amber-400/80' : 'bg-amber-500/70'
                    }`} />
                  )}

                  {/* Title */}
                  {isEditing ? (
                    <input
                      ref={inputRef}
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={handleKeyDown}
                      className={`text-xs font-medium bg-transparent outline-none w-full min-w-[60px] ${
                        isDark ? 'text-white border-b border-white/30' : 'text-gray-800 border-b border-gray-300'
                      }`}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="text-xs font-medium truncate flex-1">
                      {tab.title}
                    </span>
                  )}

                  {/* Close button */}
                  {tabs.length > 1 && (
                    <button
                      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                      onMouseUp={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        onClose(tab.id);
                      }}
                      className={`
                        flex-shrink-0 w-4 h-4 flex items-center justify-center rounded-sm
                        transition-all duration-150
                        ${isActive
                          ? 'opacity-60 hover:opacity-100'
                          : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
                        }
                        ${isDark
                          ? 'hover:bg-white/10 text-white/60 hover:text-white'
                          : 'hover:bg-gray-300/50 text-gray-400 hover:text-gray-700'
                        }
                      `}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* "+" new-tab button removed — TopBar already has a "新建" button that opens a new canvas tab. */}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className={`fixed z-[200] rounded-lg shadow-xl border py-1 min-w-[160px] text-xs ${
            isDark
              ? 'bg-[#1a1a2e] border-white/10 text-white/90'
              : 'bg-white border-gray-200 text-gray-700'
          }`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {tabs.length > 1 && (
            <button
              className={`w-full text-left px-3 py-1.5 ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
              onClick={() => { onClose(contextMenu.tabId); setContextMenu(null); }}
            >
              {t('tabs.close', '关闭标签页')}
            </button>
          )}
          {tabs.length > 1 && (
            <button
              className={`w-full text-left px-3 py-1.5 ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
              onClick={() => { onCloseOthers(contextMenu.tabId); setContextMenu(null); }}
            >
              {t('tabs.closeOthers', '关闭其他标签页')}
            </button>
          )}
          {contextMenu.tabIndex < tabs.length - 1 && (
            <button
              className={`w-full text-left px-3 py-1.5 ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
              onClick={() => { onCloseToRight(contextMenu.tabId); setContextMenu(null); }}
            >
              {t('tabs.closeToRight', '关闭右侧标签页')}
            </button>
          )}
          <div className={`my-1 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`} />
          <button
            className={`w-full text-left px-3 py-1.5 ${isDark ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
            onClick={() => { onCloseAll(); setContextMenu(null); }}
          >
            {t('tabs.closeAll', '关闭所有标签页')}
          </button>
        </div>
      )}
    </>
  );
};
