/**
 * The layout is a binary tree. Leaves are tiles that host one web app (or nothing yet).
 * Splits divide their space between `first` and `second` using `ratio` (share of `first`).
 *
 *   row    = side by side  (first | second)
 *   column = stacked       (first over second)
 */
export type SplitDirection = 'row' | 'column';

/** Direction for moving focus between tiles. */
export type FocusDirection = 'left' | 'right' | 'up' | 'down';

export interface LeafNode {
  type: 'leaf';
  id: string;
  /** Catalog app id, or null for an empty tile that shows the launcher. */
  appId: string | null;
}

export interface SplitNode {
  type: 'split';
  id: string;
  direction: SplitDirection;
  /** 0..1, share of space given to `first`. Clamped by MIN_RATIO/MAX_RATIO. */
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
}

export type LayoutNode = LeafNode | SplitNode;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DividerRect {
  splitId: string;
  direction: SplitDirection;
  rect: Rect;
  /** Full area of the split this divider belongs to; used to turn pointer position into a ratio. */
  parentRect: Rect;
}

export interface ComputedLayout {
  tiles: Array<{ leafId: string; appId: string | null; rect: Rect }>;
  dividers: DividerRect[];
}

export const MIN_RATIO = 0.1;
export const MAX_RATIO = 0.9;
