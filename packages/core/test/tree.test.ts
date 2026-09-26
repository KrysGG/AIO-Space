import { describe, expect, it } from 'vitest';
import {
  assignApp,
  computeLayout,
  createLeaf,
  listLeaves,
  neighborTile,
  ratioFromPointer,
  removeLeaf,
  setRatio,
  splitLeaf,
  swapApps,
} from '../src/layout/tree';
import { stripTrackingParams } from '../src/privacy/trackingParams';
import { hostMatches } from '../src/catalog/apps';

describe('layout tree', () => {
  it('splits a leaf and keeps the original first', () => {
    const a = createLeaf('discord');
    const { root, newLeafId } = splitLeaf(a, a.id, 'row', 'youtube');
    expect(root.type).toBe('split');
    const leaves = listLeaves(root);
    expect(leaves.map((l) => l.appId)).toEqual(['discord', 'youtube']);
    expect(leaves[1]!.id).toBe(newLeafId);
  });

  it('removes a leaf and promotes its sibling', () => {
    const a = createLeaf('discord');
    const { root, newLeafId } = splitLeaf(a, a.id, 'row', 'youtube');
    const after = removeLeaf(root, newLeafId!);
    expect(after).toEqual(a);
  });

  it('never leaves the layout empty', () => {
    const a = createLeaf('discord');
    const after = removeLeaf(a, a.id);
    expect(after.type).toBe('leaf');
    expect((after as { appId: string | null }).appId).toBeNull();
  });

  it('clamps ratios', () => {
    const a = createLeaf();
    const { root } = splitLeaf(a, a.id, 'column');
    const id = (root as { id: string }).id;
    expect((setRatio(root, id, 5) as { ratio: number }).ratio).toBe(0.9);
    expect((setRatio(root, id, -1) as { ratio: number }).ratio).toBe(0.1);
  });

  it('computes pixel-exact rects that fill the area', () => {
    const a = createLeaf('a');
    const { root } = splitLeaf(a, a.id, 'row', 'b');
    const out = computeLayout(root, { x: 0, y: 0, width: 1006, height: 500 }, 6);
    expect(out.tiles[0]!.rect).toEqual({ x: 0, y: 0, width: 500, height: 500 });
    expect(out.dividers[0]!.rect).toEqual({ x: 500, y: 0, width: 6, height: 500 });
    expect(out.tiles[1]!.rect).toEqual({ x: 506, y: 0, width: 500, height: 500 });
  });

  it('converts pointer to ratio', () => {
    expect(ratioFromPointer('row', { x: 100, y: 0, width: 400, height: 10 }, { x: 200, y: 5 })).toBe(0.25);
  });

  it('assigns and swaps apps', () => {
    const a = createLeaf('a');
    const { root, newLeafId } = splitLeaf(a, a.id, 'row', 'b');
    const swapped = swapApps(root, a.id, newLeafId!);
    expect(listLeaves(swapped).map((l) => l.appId)).toEqual(['b', 'a']);
    const cleared = assignApp(swapped, a.id, null);
    expect(listLeaves(cleared)[0]!.appId).toBeNull();
  });
});

describe('neighborTile', () => {
  // [A | [B / C]] : A on the left, B top-right, C bottom-right.
  const a = createLeaf('a');
  const s1 = splitLeaf(a, a.id, 'row', 'b');
  const b = s1.newLeafId!;
  const s2 = splitLeaf(s1.root, b, 'column', 'c');
  const c = s2.newLeafId!;
  const { tiles } = computeLayout(s2.root, { x: 0, y: 0, width: 1000, height: 800 });

  it('moves across and down the grid', () => {
    expect(neighborTile(tiles, a.id, 'right')).toBe(b); // B and C tie; the first in tree order wins
    expect(neighborTile(tiles, b, 'down')).toBe(c);
    expect(neighborTile(tiles, c, 'up')).toBe(b);
    expect(neighborTile(tiles, c, 'left')).toBe(a.id);
  });

  it('returns null at the edges and for unknown tiles', () => {
    expect(neighborTile(tiles, a.id, 'left')).toBeNull();
    expect(neighborTile(tiles, a.id, 'up')).toBeNull();
    expect(neighborTile(tiles, b, 'right')).toBeNull();
    expect(neighborTile(tiles, 'nope', 'right')).toBeNull();
  });
});

describe('tracking params', () => {
  it('strips global and host-specific params', () => {
    expect(stripTrackingParams('https://youtu.be/abc?si=xyz&t=10')).toBe('https://youtu.be/abc?t=10');
    expect(stripTrackingParams('https://example.com/?utm_source=a&id=1&fbclid=z')).toBe(
      'https://example.com/?id=1',
    );
  });
  it('returns null when nothing changes or URL is invalid', () => {
    expect(stripTrackingParams('https://example.com/?id=1')).toBeNull();
    expect(stripTrackingParams('not a url')).toBeNull();
  });
});

describe('hostMatches', () => {
  it('matches subdomains but not lookalikes', () => {
    expect(hostMatches('ptb.discord.com', ['discord.com'])).toBe(true);
    expect(hostMatches('evildiscord.com', ['discord.com'])).toBe(false);
    expect(hostMatches('anything.org', ['*'])).toBe(true);
  });
});
