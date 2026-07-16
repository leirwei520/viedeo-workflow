/**
 * useCanvasTabs.ts
 *
 * Manages browser-like canvas tabs. Each tab holds a snapshot of canvas state
 * (nodes, groups, viewport, title, workflowId, dirty flag). Switching tabs
 * serialises the current tab and restores the target.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NodeData, NodeGroup, Viewport } from '../types';
import { generateUUID } from '../utils/uuid';

const TABS_SESSION_KEY = 'chuhaibang_canvas_tabs';
const ACTIVE_TAB_SESSION_KEY = 'chuhaibang_active_tab';

export interface CanvasTab {
  id: string;
  workflowId: string | null;
  title: string;
  nodes: NodeData[];
  groups: NodeGroup[];
  viewport: Viewport;
  isDirty: boolean;
}

interface UseCanvasTabsOptions {
  getTitle: () => string;
  getNodes: () => NodeData[];
  getGroups: () => NodeGroup[];
  getViewport: () => Viewport;
  getWorkflowId: () => string | null;
  getIsDirty: () => boolean;

  applyTitle: (title: string) => void;
  applyNodes: (nodes: NodeData[]) => void;
  applyGroups: (groups: NodeGroup[]) => void;
  applyViewport: (viewport: Viewport) => void;
  applyWorkflowId: (id: string | null) => void;
  applyIsDirty: (dirty: boolean) => void;
  applySelectedNodeIds: (ids: string[]) => void;
  onLoadWorkflow?: (workflowId: string) => void;
}

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

export const useCanvasTabs = (opts: UseCanvasTabsOptions) => {
  const { t } = useTranslation();
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const makeTab = useCallback((overrides?: Partial<CanvasTab>): CanvasTab => ({
    id: generateUUID(),
    workflowId: null,
    title: t('topBar.untitledCanvas'),
    nodes: [],
    groups: [],
    viewport: { ...DEFAULT_VIEWPORT },
    isDirty: false,
    ...overrides,
  }), [t]);

  const [tabs, setTabs] = useState<CanvasTab[]>(() => {
    try {
      const stored = sessionStorage.getItem(TABS_SESSION_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as CanvasTab[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(tab => ({
            ...tab,
            nodes: Array.isArray(tab.nodes) ? tab.nodes : [],
            groups: Array.isArray(tab.groups) ? tab.groups : [],
            isDirty: tab.isDirty ?? false,
            viewport: tab.viewport || { x: 0, y: 0, zoom: 1 },
          }));
        }
      }
    } catch { /* ignore */ }
    return [makeTab()];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    return sessionStorage.getItem(ACTIVE_TAB_SESSION_KEY) || tabs[0]?.id || '';
  });

  // Refs always hold latest values to avoid stale closures
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Persist tabs to sessionStorage on change (only metadata, not full node data)
  useEffect(() => {
    try {
      const lightweight = tabs.map(tab => ({
        ...tab,
        nodes: [],
        groups: [],
      }));
      sessionStorage.setItem(TABS_SESSION_KEY, JSON.stringify(lightweight));
      sessionStorage.setItem(ACTIVE_TAB_SESSION_KEY, activeTabId);
    } catch { /* quota exceeded, ignore */ }
  }, [tabs, activeTabId]);

  /** Restore a tab's state into live React state */
  const restoreTab = useCallback((tab: CanvasTab) => {
    const o = optsRef.current;
    o.applySelectedNodeIds([]);
    o.applyTitle(tab.title);
    o.applyViewport(tab.viewport);
    o.applyWorkflowId(tab.workflowId);

    const nodes = Array.isArray(tab.nodes) ? tab.nodes : [];
    const groups = Array.isArray(tab.groups) ? tab.groups : [];

    if (tab.workflowId && nodes.length === 0 && o.onLoadWorkflow) {
      o.applyNodes([]);
      o.applyGroups([]);
      o.applyIsDirty(false);
      o.onLoadWorkflow(tab.workflowId);
    } else {
      o.applyNodes(nodes);
      o.applyGroups(groups);
      o.applyIsDirty(tab.isDirty ?? false);
    }
  }, []);

  /** Snapshot live React state into the tab object for the current active tab */
  const snapshotCurrentTab = useCallback(() => {
    const o = optsRef.current;
    const currentId = activeTabIdRef.current;
    const snapshot: Partial<CanvasTab> = {
      title: o.getTitle(),
      nodes: o.getNodes(),
      groups: o.getGroups(),
      viewport: o.getViewport(),
      workflowId: o.getWorkflowId(),
      isDirty: o.getIsDirty(),
    };
    setTabs(prev => prev.map(tab => tab.id === currentId ? { ...tab, ...snapshot } : tab));
    return snapshot;
  }, []);

  /** Switch to an existing tab */
  const switchTab = useCallback((targetId: string) => {
    if (targetId === activeTabIdRef.current) return;
    snapshotCurrentTab();
    const target = tabsRef.current.find(t => t.id === targetId);
    if (!target) return;
    setActiveTabId(targetId);
    restoreTab(target);
  }, [snapshotCurrentTab, restoreTab]);

  /** Create a brand-new empty tab and switch to it.
   *  Pass skipRestore=true when you plan to load data immediately after (avoids race). */
  const addTab = useCallback((skipRestore = false) => {
    snapshotCurrentTab();
    const tab = makeTab();
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
    if (!skipRestore) {
      restoreTab(tab);
    }
    return tab.id;
  }, [snapshotCurrentTab, makeTab, restoreTab]);

  /** Close a tab. If it's the active one, switch to an adjacent tab.
   *  Returns false if this is the last tab (cannot close). */
  const closeTab = useCallback((targetId: string): boolean => {
    const currentTabs = tabsRef.current;
    if (currentTabs.length <= 1) return false;

    const idx = currentTabs.findIndex(t => t.id === targetId);
    if (idx === -1) return false;

    const remaining = currentTabs.filter(t => t.id !== targetId);
    setTabs(remaining);

    if (targetId === activeTabIdRef.current) {
      const newIdx = Math.min(idx, remaining.length - 1);
      const nextTab = remaining[newIdx];
      setActiveTabId(nextTab.id);
      restoreTab(nextTab);
    }

    return true;
  }, [restoreTab]);

  /** Update a field on the tab metadata without touching React canvas state
   *  (e.g. marking dirty, updating title as user types) */
  const updateTab = useCallback((tabId: string, patch: Partial<CanvasTab>) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, ...patch } : t));
  }, []);

  /** Open a workflow in a new tab (or switch to an existing tab that has that workflowId) */
  const openWorkflowInTab = useCallback((workflowId: string, title: string, nodes: NodeData[], groups: NodeGroup[], viewport: Viewport) => {
    const existing = tabsRef.current.find(t => t.workflowId === workflowId);
    if (existing) {
      switchTab(existing.id);
      return existing.id;
    }
    snapshotCurrentTab();
    const tab = makeTab({ workflowId, title, nodes, groups, viewport, isDirty: false });
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
    restoreTab(tab);
    return tab.id;
  }, [switchTab, snapshotCurrentTab, makeTab, restoreTab]);

  /** Reorder tabs by moving a tab from one index to another */
  const moveTab = useCallback((fromIndex: number, toIndex: number) => {
    setTabs(prev => {
      if (fromIndex === toIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  /** Close all tabs except one new empty tab */
  const closeAllTabs = useCallback(() => {
    const tab = makeTab();
    setTabs([tab]);
    setActiveTabId(tab.id);
    restoreTab(tab);
  }, [makeTab, restoreTab]);

  /** Close all tabs except the given one */
  const closeOtherTabs = useCallback((keepId: string) => {
    const keep = tabsRef.current.find(t => t.id === keepId);
    if (!keep) return;
    setTabs([keep]);
    if (activeTabIdRef.current !== keepId) {
      setActiveTabId(keepId);
      restoreTab(keep);
    }
  }, [restoreTab]);

  /** Close all tabs to the right of the given one */
  const closeTabsToRight = useCallback((tabId: string) => {
    const currentTabs = tabsRef.current;
    const idx = currentTabs.findIndex(t => t.id === tabId);
    if (idx === -1 || idx === currentTabs.length - 1) return;
    const remaining = currentTabs.slice(0, idx + 1);
    setTabs(remaining);
    if (!remaining.find(t => t.id === activeTabIdRef.current)) {
      const last = remaining[remaining.length - 1];
      setActiveTabId(last.id);
      restoreTab(last);
    }
  }, [restoreTab]);

  return {
    tabs,
    activeTabId,
    switchTab,
    addTab,
    closeTab,
    updateTab,
    snapshotCurrentTab,
    openWorkflowInTab,
    moveTab,
    closeAllTabs,
    closeOtherTabs,
    closeTabsToRight,
  };
};
