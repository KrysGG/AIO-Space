import { newId } from '../util/id';
import { findLeaf, listLeaves, mapTree, newInstanceId } from './tree';
import { MAX_TABS, type BrowserTab, type LayoutNode, type LeafNode, type SplitDirection } from './types';

/**
 * Browser tabs (D-049). A Browser tile can hold several tabs; each is its own running instance (web
 * view) and the tile's `instanceId` is the one on screen. The others keep running hidden, like apps
 * in other spaces. Pure functions: they return a new tree and never mutate the input.
 */

/** A tile's tabs; a tile without a `tabs` list has one tab, its current instance. */
export function tabsOf(leaf: LeafNode): BrowserTab[] {
  if (leaf.tabs?.length) return leaf.tabs;
  return leaf.instanceId ? [{ instanceId: leaf.instanceId }] : [];
}

/** Every running instance in a layout: each tile's tabs (on screen or not). */
export function instancesOf(root: LayoutNode): string[] {
  return listLeaves(root).flatMap((l) => tabsOf(l).map((t) => t.instanceId));
}

/** Instances in a layout that run hidden: tabs that aren't the one on screen in their tile. */
export function hiddenTabsOf(root: LayoutNode): string[] {
  return listLeaves(root).flatMap((l) => tabsOf(l).flatMap((t) => (t.instanceId === l.instanceId ? [] : [t.instanceId])));
}

function onLeaf(root: LayoutNode, leafId: string, fn: (leaf: LeafNode) => LeafNode): LayoutNode {
  return mapTree(root, (n) => (n.type === 'leaf' && n.id === leafId ? fn(n) : n));
}

/** A leaf with `tabs` and `active` on screen; a single tab drops the list (the plain one-view tile). */
function withTabs(leaf: LeafNode, tabs: BrowserTab[], active: string): LeafNode {
  const { tabs: _old, ...rest } = leaf;
  void _old;
  return tabs.length > 1 ? { ...rest, instanceId: active, tabs } : { ...rest, instanceId: active, ...(tabs[0]?.url || tabs[0]?.title ? { tabs } : {}) };
}

/**
 * Open a new tab after the current one and show it. Browser tiles only; `url` (http(s), checked by
 * the caller) is where it starts, otherwise the search engine's home page. No-op at MAX_TABS.
 */
export function addTab(root: LayoutNode, leafId: string, url?: string): { root: LayoutNode; instanceId: string | null } {
  const leaf = findLeaf(root, leafId);
  if (!leaf || leaf.appId !== 'browser') return { root, instanceId: null };
  const tabs = tabsOf(leaf);
  if (tabs.length >= MAX_TABS) return { root, instanceId: null };
  const tab: BrowserTab = { instanceId: newInstanceId(), ...(url ? { url } : {}) };
  const at = Math.max(0, tabs.findIndex((t) => t.instanceId === leaf.instanceId)) + 1;
  const next = [...tabs.slice(0, at), tab, ...tabs.slice(at)];
  return { root: onLeaf(root, leafId, (l) => withTabs(l, next, tab.instanceId)), instanceId: tab.instanceId };
}

/** Show another of the tile's tabs. */
export function selectTab(root: LayoutNode, leafId: string, instanceId: string): LayoutNode {
  const leaf = findLeaf(root, leafId);
  if (!leaf || leaf.instanceId === instanceId || !tabsOf(leaf).some((t) => t.instanceId === instanceId)) return root;
  return onLeaf(root, leafId, (l) => ({ ...l, instanceId }));
}

/**
 * Close a tab (its page closes). Closing the tab on screen shows its right-hand neighbour (or the
 * left one at the end), as browsers do. The last tab can't be closed: close the tile instead.
 */
export function closeTab(root: LayoutNode, leafId: string, instanceId: string): LayoutNode {
  const leaf = findLeaf(root, leafId);
  if (!leaf) return root;
  const tabs = tabsOf(leaf);
  const i = tabs.findIndex((t) => t.instanceId === instanceId);
  if (i < 0 || tabs.length <= 1) return root;
  const next = tabs.filter((t) => t.instanceId !== instanceId);
  const active = leaf.instanceId === instanceId ? next[Math.min(i, next.length - 1)]!.instanceId : leaf.instanceId!;
  return onLeaf(root, leafId, (l) => withTabs(l, next, active));
}

/**
 * Move a tab into a new Browser tile beside its own (`row`: right, `column`: below). The page keeps
 * running: views follow their instance, so it isn't reloaded. The tile's last tab can't move.
 */
export function moveTabToNewTile(
  root: LayoutNode,
  leafId: string,
  instanceId: string,
  direction: SplitDirection = 'row',
): { root: LayoutNode; newLeafId: string | null } {
  const leaf = findLeaf(root, leafId);
  if (!leaf) return { root, newLeafId: null };
  const tabs = tabsOf(leaf);
  const tab = tabs.find((t) => t.instanceId === instanceId);
  if (!tab || tabs.length <= 1) return { root, newLeafId: null };
  const moved: LeafNode = { type: 'leaf', id: newId('leaf'), appId: leaf.appId, instanceId, ...(leaf.profile ? { profile: leaf.profile } : {}) };
  const withMoved = withTabs(moved, [tab], instanceId);
  const source = closeTab(root, leafId, instanceId);
  const next = mapTree(source, (n) =>
    n.type === 'leaf' && n.id === leafId ? { type: 'split', id: newId('split'), direction, ratio: 0.5, first: n, second: withMoved } : n,
  );
  return { root: next, newLeafId: withMoved.id };
}

/**
 * Remember what a tab shows (to reopen it after a restart). Returns `root` itself when nothing
 * changed, so callers can skip saving.
 */
export function setTabInfo(root: LayoutNode, instanceId: string, info: { url: string; title: string }): LayoutNode {
  let changed = false;
  const next = mapTree(root, (n) => {
    if (n.type !== 'leaf' || n.appId !== 'browser') return n;
    const tabs = tabsOf(n);
    const i = tabs.findIndex((t) => t.instanceId === instanceId);
    if (i < 0 || (tabs[i]!.url === info.url && tabs[i]!.title === info.title)) return n;
    changed = true;
    return { ...n, tabs: tabs.map((t, j) => (j === i ? { ...t, url: info.url, title: info.title } : t)) };
  });
  return changed ? next : root;
}

/** Drop every remembered page (URL and title) from a layout's tabs: nothing to reopen after a restart. */
export function forgetTabPages(root: LayoutNode): LayoutNode {
  if (!listLeaves(root).some((l) => l.tabs?.some((t) => t.url !== undefined || t.title !== undefined))) return root;
  return mapTree(root, (n) => {
    if (n.type !== 'leaf' || !n.tabs) return n;
    const tabs = n.tabs.map((t) => ({ instanceId: t.instanceId }));
    return withTabs(n, tabs, n.instanceId!);
  });
}
