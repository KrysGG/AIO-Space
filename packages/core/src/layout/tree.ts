import { newId } from '../util/id';
import {
  MAX_RATIO,
  MIN_RATIO,
  type ComputedLayout,
  type LayoutNode,
  type LeafNode,
  type Rect,
  type SplitDirection,
} from './types';

/** All functions here are pure: they return a new tree and never mutate the input. */

export function createLeaf(appId: string | null = null): LeafNode {
  return { type: 'leaf', id: newId('leaf'), appId };
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

export function assignApp(root: LayoutNode, leafId: string, appId: string | null): LayoutNode {
  return mapTree(root, (n) => (n.type === 'leaf' && n.id === leafId ? { ...n, appId } : n));
}

/** Swap the apps of two tiles (used for drag-to-rearrange). */
export function swapApps(root: LayoutNode, a: string, b: string): LayoutNode {
  const la = findLeaf(root, a);
  const lb = findLeaf(root, b);
  if (!la || !lb) return root;
  return assignApp(assignApp(root, a, lb.appId), b, la.appId);
}

/**
 * Turn the tree into absolute rectangles. `gutter` is the divider thickness in px.
 * Results are rounded to whole pixels so native views line up exactly.
 */
export function computeLayout(root: LayoutNode, area: Rect, gutter = 6): ComputedLayout {
  const out: ComputedLayout = { tiles: [], dividers: [] };
  const walk = (n: LayoutNode, r: Rect): void => {
    if (n.type === 'leaf') {
      out.tiles.push({ leafId: n.id, appId: n.appId, rect: roundRect(r) });
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
