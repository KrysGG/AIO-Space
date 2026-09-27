import { describe, expect, it } from 'vitest';
import {
  addTab,
  closeTab,
  forgetTabPages,
  hiddenTabsOf,
  instancesOf,
  moveTabToNewTile,
  selectTab,
  setTabInfo,
  tabsOf,
} from '../src/layout/tabs';
import { assignApp, computeLayout, createLeaf, findLeaf, listLeaves, splitLeaf, swapApps } from '../src/layout/tree';
import { MAX_TABS, type LayoutNode, type LeafNode } from '../src/layout/types';

const leafOf = (root: LayoutNode, id: string): LeafNode => findLeaf(root, id)!;

describe('browser tabs', () => {
  it('a tile has one implicit tab, its instance', () => {
    const b = createLeaf('browser');
    expect(tabsOf(b)).toEqual([{ instanceId: b.instanceId }]);
    expect(tabsOf(createLeaf(null))).toEqual([]);
    expect(computeLayout(b, { x: 0, y: 0, width: 100, height: 100 }).tiles[0]!.tabs).toBe(1);
  });

  it('adds a tab after the current one and shows it', () => {
    const b = createLeaf('browser');
    const first = b.instanceId!;
    const r1 = addTab(b, b.id, 'https://a.example/');
    const r2 = addTab(selectTab(r1.root, b.id, first), b.id);
    const leaf = leafOf(r2.root, b.id);
    expect(leaf.instanceId).toBe(r2.instanceId);
    expect(tabsOf(leaf).map((t) => t.instanceId)).toEqual([first, r2.instanceId, r1.instanceId]);
    expect(tabsOf(leaf)[2]!.url).toBe('https://a.example/');
    expect(computeLayout(r2.root, { x: 0, y: 0, width: 100, height: 100 }).tiles[0]!.tabs).toBe(3);
    expect(b.tabs).toBeUndefined(); // input untouched
  });

  it('only Browser tiles get tabs, up to MAX_TABS', () => {
    const d = createLeaf('discord');
    expect(addTab(d, d.id).instanceId).toBeNull();
    let root: LayoutNode = createLeaf('browser');
    const id = (root as LeafNode).id;
    for (let i = 1; i < MAX_TABS; i++) root = addTab(root, id).root;
    expect(tabsOf(leafOf(root, id))).toHaveLength(MAX_TABS);
    expect(addTab(root, id).instanceId).toBeNull();
  });

  it('closing the shown tab shows its right neighbour, or the left one at the end', () => {
    const b = createLeaf('browser');
    const a = b.instanceId!;
    const { root: r1, instanceId: bb } = addTab(b, b.id);
    const { root: r2, instanceId: c } = addTab(r1, b.id);
    const middle = closeTab(selectTab(r2, b.id, bb!), b.id, bb!);
    expect(leafOf(middle, b.id).instanceId).toBe(c);
    const end = closeTab(r2, b.id, c!);
    expect(leafOf(end, b.id).instanceId).toBe(bb);
    // A hidden tab closes without changing what's shown.
    expect(leafOf(closeTab(r2, b.id, a), b.id).instanceId).toBe(c);
  });

  it('never closes the last tab; one tab left drops the list', () => {
    const b = createLeaf('browser');
    expect(closeTab(b, b.id, b.instanceId!)).toBe(b);
    const { root, instanceId } = addTab(b, b.id);
    const back = closeTab(root, b.id, instanceId!);
    expect(leafOf(back, b.id).tabs).toBeUndefined();
    expect(leafOf(back, b.id).instanceId).toBe(b.instanceId);
  });

  it('moves a tab into a new tile beside it, keeping its instance and account', () => {
    const b: LeafNode = { ...createLeaf('browser'), profile: 'p2' };
    const { root, instanceId } = addTab(b, b.id, 'https://moved.example/');
    const moved = moveTabToNewTile(root, b.id, instanceId!, 'column');
    expect(moved.root.type === 'split' && moved.root.direction).toBe('column');
    const target = leafOf(moved.root, moved.newLeafId!);
    expect(target).toMatchObject({ appId: 'browser', instanceId, profile: 'p2' });
    expect(tabsOf(target)[0]!.url).toBe('https://moved.example/');
    expect(tabsOf(leafOf(moved.root, b.id)).map((t) => t.instanceId)).toEqual([b.instanceId]);
    // Every instance still runs exactly once.
    expect(instancesOf(moved.root).sort()).toEqual([b.instanceId, instanceId].sort());
    // The last tab can't move.
    expect(moveTabToNewTile(b, b.id, b.instanceId!).newLeafId).toBeNull();
  });

  it('lists hidden tabs (for main to keep running)', () => {
    const b = createLeaf('browser');
    const { root, instanceId } = addTab(b, b.id);
    expect(hiddenTabsOf(root)).toEqual([b.instanceId]);
    expect(hiddenTabsOf(selectTab(root, b.id, b.instanceId!))).toEqual([instanceId]);
  });

  it('remembers pages per tab, and returns the same tree when nothing changed', () => {
    const b = createLeaf('browser');
    const info = { url: 'https://a.example/', title: 'A' };
    const once = setTabInfo(b, b.instanceId!, info);
    expect(tabsOf(leafOf(once, b.id))[0]).toEqual({ instanceId: b.instanceId, ...info });
    expect(setTabInfo(once, b.instanceId!, info)).toBe(once);
    expect(setTabInfo(once, 'app_unknown', info)).toBe(once);
    const forgotten = forgetTabPages(once);
    expect(leafOf(forgotten, b.id).tabs).toBeUndefined();
    expect(forgetTabPages(forgotten)).toBe(forgotten);
  });

  it('tabs travel with swaps and are dropped when the app changes', () => {
    const b = createLeaf('browser');
    const { root: withTabs } = addTab(b, b.id);
    const { root, newLeafId } = splitLeaf(withTabs, b.id, 'row', 'discord');
    const swapped = swapApps(root, b.id, newLeafId!);
    expect(tabsOf(leafOf(swapped, newLeafId!))).toHaveLength(2);
    expect(leafOf(swapped, b.id).tabs).toBeUndefined();
    expect(leafOf(assignApp(withTabs, b.id, 'discord'), b.id).tabs).toBeUndefined();
    expect(listLeaves(swapped)).toHaveLength(2);
  });
});
