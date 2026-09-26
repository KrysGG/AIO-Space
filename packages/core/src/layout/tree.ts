import { newId } from '../util/id';
import {
  MAX_RATIO,
  MIN_RATIO,
  type ComputedLayout,
  type FocusDirection,
  type LayoutNode,
  type LeafNode,
  type Rect,
  type SplitDirection,
} from './types';

/** The first account of every app. Existing logins live in this one. */
export const DEFAULT_PROFILE = 'default';

/** All functions here are pure: they return a new tree and never mutate the input. */

export function createLeaf(appId: string | null = null): LeafNode {
  return { type: 'leaf', id: newId('leaf'), appId, instanceId: appId ? newInstanceId() : null };
}

/** Id for a newly started app (a new native view). */
export function newInstanceId(): string {
  return newId('app');
}

export function clampRatio(r: number): number {
  if (Number.isNaN(r)) return 0.5;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));
}

export function listLeaves(node: LayoutNode): LeafNode[] {
  return node.type === 'leaf' ? [node] : [...listLeaves(node.first), ...listLeaves(node.second)];
}

export function findLeaf(node: LayoutNode, leafId: string): LeafNode | null {
  return listLeaves(node).find((l) => l.id === leafId) ?? null;
}

/**
 * Bottom-up map: children are transformed first, then `fn` runs on the rebuilt node.
 * Nodes that `fn` creates are never re-visited (top-down would loop forever in splitLeaf).
 */
function mapTree(node: LayoutNode, fn: (n: LayoutNode) => LayoutNode): LayoutNode {
  if (node.type === 'leaf') return fn(node);
  return fn({ ...node, first: mapTree(node.first, fn), second: mapTree(node.second, fn) });
}

/** Split a tile in two. The existing tile stays `first`; the new tile becomes `second`. */
export function splitLeaf(
  root: LayoutNode,
  leafId: string,
  direction: SplitDirection,
  newAppId: string | null = null,
): { root: LayoutNode; newLeafId: string | null } {
  let newLeafId: string | null = null;
  const next = mapTree(root, (n) => {
    if (n.type !== 'leaf' || n.id !== leafId) return n;
    const created = createLeaf(newAppId);
    newLeafId = created.id;
    const split: LayoutNode = {
      type: 'split',
      id: newId('split'),
      direction,
      ratio: 0.5,
      first: n,
      second: created,
    };
    return split;
  });
  return { root: next, newLeafId };
}

/**
 * Remove a tile; its sibling takes over the parent's space.
 * Removing the last tile leaves one empty tile (the layout is never empty).
 */
export function removeLeaf(root: LayoutNode, leafId: string): LayoutNode {
  if (root.type === 'leaf') return root.id === leafId ? createLeaf(null) : root;
  const walk = (n: LayoutNode): LayoutNode => {
    if (n.type === 'leaf') return n;
    if (n.first.type === 'leaf' && n.first.id === leafId) return n.second;
    if (n.second.type === 'leaf' && n.second.id === leafId) return n.first;
    return { ...n, first: walk(n.first), second: walk(n.second) };
  };
  return walk(root);
}

export function setRatio(root: LayoutNode, splitId: string, ratio: number): LayoutNode {
  return mapTree(root, (n) =>
    n.type === 'split' && n.id === splitId ? { ...n, ratio: clampRatio(ratio) } : n,
  );
}

/**
 * Put an app in a tile. The same app keeps its running instance; a different one starts fresh on
 * its first account.
 */
export function assignApp(root: LayoutNode, leafId: string, appId: string | null): LayoutNode {
  return mapTree(root, (n) => {
    if (n.type !== 'leaf' || n.id !== leafId || n.appId === appId) return n;
    const { profile: _dropped, ...rest } = n;
    void _dropped;
    return { ...rest, appId, instanceId: appId ? newInstanceId() : null };
  });
}

/** Switch a tile's app to another account (ROADMAP 2.12): a fresh instance in that account's session. */
export function setProfile(root: LayoutNode, leafId: string, profile: string): LayoutNode {
  return mapTree(root, (n) => {
    if (n.type !== 'leaf' || n.id !== leafId || !n.appId || (n.profile ?? DEFAULT_PROFILE) === profile) return n;
    const { profile: _old, ...rest } = n;
    void _old;
    return profile === DEFAULT_PROFILE ? { ...rest, instanceId: newInstanceId() } : { ...rest, instanceId: newInstanceId(), profile };
  });
}

/** `leaf` showing `from`'s app, instance and account. */
function withApp(leaf: LeafNode, from: LeafNode): LeafNode {
  const { profile: _p, ...rest } = leaf;
  void _p;
  const next: LeafNode = { ...rest, appId: from.appId, instanceId: from.instanceId };
  return from.profile ? { ...next, profile: from.profile } : next;
}

/**
 * Swap the apps of two tiles (drag-to-rearrange). Running instances move with their apps,
 * so both pages stay loaded.
 */
export function swapApps(root: LayoutNode, a: string, b: string): LayoutNode {
  const la = findLeaf(root, a);
  const lb = findLeaf(root, b);
  if (!la || !lb || a === b) return root;
  return mapTree(root, (n) => {
    if (n.type !== 'leaf') return n;
    if (n.id === a) return withApp(n, lb);
    if (n.id === b) return withApp(n, la);
    return n;
  });
}

/**
 * Turn the tree into absolute rectangles. `gutter` is the divider thickness in px.
 * Results are rounded to whole pixels so native views line up exactly.
 */
export function computeLayout(root: LayoutNode, area: Rect, gutter = 6): ComputedLayout {
  const out: ComputedLayout = { tiles: [], dividers: [] };
  const walk = (n: LayoutNode, r: Rect): void => {
    if (n.type === 'leaf') {
      out.tiles.push({ leafId: n.id, appId: n.appId, instanceId: n.instanceId, profile: n.profile ?? DEFAULT_PROFILE, rect: roundRect(r) });
      return;
    }
    const horizontal = n.direction === 'row';
    const total = horizontal ? r.width : r.height;
    const usable = Math.max(0, total - gutter);
    const firstSize = Math.round(usable * n.ratio);
    const secondSize = usable - firstSize;
    if (horizontal) {
      walk(n.first, { x: r.x, y: r.y, width: firstSize, height: r.height });
      out.dividers.push({
        splitId: n.id,
        direction: n.direction,
        rect: roundRect({ x: r.x + firstSize, y: r.y, width: gutter, height: r.height }),
        parentRect: r,
      });
      walk(n.second, { x: r.x + firstSize + gutter, y: r.y, width: secondSize, height: r.height });
    } else {
      walk(n.first, { x: r.x, y: r.y, width: r.width, height: firstSize });
      out.dividers.push({
        splitId: n.id,
        direction: n.direction,
        rect: roundRect({ x: r.x, y: r.y + firstSize, width: r.width, height: gutter }),
        parentRect: r,
      });
      walk(n.second, { x: r.x, y: r.y + firstSize + gutter, width: r.width, height: secondSize });
    }
  };
  walk(root, area);
  return out;
}

/**
 * The tile next to `fromLeafId` in `dir`, or null at the edge. Picks the closest tile beyond that
 * edge which overlaps it on the other axis; ties go to the larger overlap.
 */
export function neighborTile(
  tiles: ComputedLayout['tiles'],
  fromLeafId: string,
  dir: FocusDirection,
): string | null {
  const from = tiles.find((t) => t.leafId === fromLeafId)?.rect;
  if (!from) return null;
  const horizontal = dir === 'left' || dir === 'right';
  const overlap = (r: Rect): number =>
    horizontal
      ? Math.min(from.y + from.height, r.y + r.height) - Math.max(from.y, r.y)
      : Math.min(from.x + from.width, r.x + r.width) - Math.max(from.x, r.x);
  const gap = (r: Rect): number => {
    if (dir === 'left') return from.x - (r.x + r.width);
    if (dir === 'right') return r.x - (from.x + from.width);
    if (dir === 'up') return from.y - (r.y + r.height);
    return r.y - (from.y + from.height);
  };
  let best: { id: string; gap: number; overlap: number } | null = null;
  for (const t of tiles) {
    if (t.leafId === fromLeafId) continue;
    const g = gap(t.rect);
    const o = overlap(t.rect);
    if (g < 0 || o <= 0) continue;
    if (!best || g < best.gap || (g === best.gap && o > best.overlap)) best = { id: t.leafId, gap: g, overlap: o };
  }
  return best?.id ?? null;
}

/** Convert a pointer position over a divider's parent split into a ratio. */
export function ratioFromPointer(
  direction: SplitDirection,
  parent: Rect,
  pointer: { x: number; y: number },
): number {
  const r =
    direction === 'row'
      ? (pointer.x - parent.x) / Math.max(1, parent.width)
      : (pointer.y - parent.y) / Math.max(1, parent.height);
  return clampRatio(r);
}

function roundRect(r: Rect): Rect {
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.max(0, Math.round(r.width)),
    height: Math.max(0, Math.round(r.height)),
  };
}
