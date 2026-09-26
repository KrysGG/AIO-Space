import { describe, expect, it } from 'vitest';
import { createLeaf, defaultWorkspace, splitLeaf, type LayoutNode } from '@aio/core';
import {
  LayoutSchema,
  MAX_TILES,
  PlacementsSchema,
  ViewCommandSchema,
  ViewFocusSchema,
  ViewNavigateSchema,
  WorkspaceSchema,
} from '../src/main/ipc/schemas';

/** A layout with `n` leaves, built by repeatedly splitting the newest leaf. */
function layoutWithTiles(n: number): LayoutNode {
  let root: LayoutNode = createLeaf(null);
  let last = root.id;
  for (let i = 1; i < n; i++) {
    const r = splitLeaf(root, last, i % 2 ? 'row' : 'column', null);
    if (!r.newLeafId) throw new Error(`split ${i} failed`);
    root = r.root;
    last = r.newLeafId;
  }
  return root;
}

function workspaceWith(layout: LayoutNode) {
  const ws = defaultWorkspace();
  return { ...ws, spaces: [{ ...ws.spaces[0]!, layout }] };
}

describe('WorkspaceSchema', () => {
  it('accepts the default workspace', () => {
    expect(WorkspaceSchema.safeParse(defaultWorkspace()).success).toBe(true);
  });

  it(`accepts ${MAX_TILES} tiles and rejects ${MAX_TILES + 1}`, () => {
    expect(WorkspaceSchema.safeParse(workspaceWith(layoutWithTiles(MAX_TILES))).success).toBe(true);
    expect(WorkspaceSchema.safeParse(workspaceWith(layoutWithTiles(MAX_TILES + 1))).success).toBe(false);
  });

  it('rejects missing fields, bad ids and wrong types', () => {
    const ws = defaultWorkspace();
    expect(WorkspaceSchema.safeParse({ ...ws, spaces: [] }).success).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...ws, activeSpaceId: '../etc' }).success).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...ws, privacy: { ...ws.privacy, fingerprinting: 'max' } }).success).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...ws, version: '1' }).success).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...ws, browser: { searchEngine: 'google' } }).success).toBe(false);
    const { browser: _omit, ...noBrowser } = ws;
    void _omit;
    expect(WorkspaceSchema.safeParse(noBrowser).success).toBe(false);
    expect(WorkspaceSchema.safeParse(null).success).toBe(false);
  });
});

describe('LayoutSchema', () => {
  it('rejects ratios outside 0..1 and unknown node types', () => {
    const split = layoutWithTiles(2);
    expect(LayoutSchema.safeParse(split).success).toBe(true);
    expect(LayoutSchema.safeParse({ ...split, ratio: 1.5 }).success).toBe(false);
    expect(LayoutSchema.safeParse({ type: 'iframe', id: 'a', src: 'https://x' }).success).toBe(false);
  });
});

describe('PlacementsSchema', () => {
  const placement = { leafId: 'leaf_1', appId: 'discord', bounds: { x: 62, y: 40, width: 800, height: 600 } };

  it('accepts integer bounds within range', () => {
    expect(PlacementsSchema.safeParse([placement]).success).toBe(true);
  });

  it('rejects negative, fractional or huge bounds, bad ids and too many placements', () => {
    const withBounds = (b: Partial<typeof placement.bounds>) => [{ ...placement, bounds: { ...placement.bounds, ...b } }];
    expect(PlacementsSchema.safeParse(withBounds({ x: -1 })).success).toBe(false);
    expect(PlacementsSchema.safeParse(withBounds({ width: 10.5 })).success).toBe(false);
    expect(PlacementsSchema.safeParse(withBounds({ height: 20001 })).success).toBe(false);
    expect(PlacementsSchema.safeParse([{ ...placement, appId: 'disc ord' }]).success).toBe(false);
    expect(PlacementsSchema.safeParse(Array(MAX_TILES + 1).fill(placement)).success).toBe(false);
  });
});

describe('ViewCommandSchema', () => {
  it('accepts known commands only', () => {
    expect(ViewCommandSchema.safeParse({ leafId: 'leaf_1', command: 'reload' }).success).toBe(true);
    expect(ViewCommandSchema.safeParse({ leafId: 'leaf_1', command: 'navigate' }).success).toBe(false);
    expect(ViewCommandSchema.safeParse({ leafId: 'leaf_1' }).success).toBe(false);
  });
});

describe('ViewFocusSchema', () => {
  it('accepts a tile id or null (the UI), nothing else', () => {
    expect(ViewFocusSchema.safeParse({ leafId: 'leaf_1' }).success).toBe(true);
    expect(ViewFocusSchema.safeParse({ leafId: null }).success).toBe(true);
    expect(ViewFocusSchema.safeParse({}).success).toBe(false);
    expect(ViewFocusSchema.safeParse({ leafId: '<script>' }).success).toBe(false);
    expect(ViewFocusSchema.safeParse({ leafId: 5 }).success).toBe(false);
  });
});

describe('ViewNavigateSchema', () => {
  it('accepts http(s) URLs only', () => {
    expect(ViewNavigateSchema.safeParse({ leafId: 'leaf_1', url: 'https://example.com/' }).success).toBe(true);
    expect(ViewNavigateSchema.safeParse({ leafId: 'leaf_1', url: 'http://example.com/' }).success).toBe(true);
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'chrome://gpu', 'example.com', '']) {
      expect(ViewNavigateSchema.safeParse({ leafId: 'leaf_1', url }).success).toBe(false);
    }
    expect(ViewNavigateSchema.safeParse({ leafId: 'leaf_1', url: 'https://x.example/' + 'a'.repeat(9000) }).success).toBe(false);
    expect(ViewNavigateSchema.safeParse({ leafId: '../x', url: 'https://example.com/' }).success).toBe(false);
  });
});
