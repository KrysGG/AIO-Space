import { describe, expect, it } from 'vitest';
import { assignApp, listLeaves, splitLeaf } from '../src/layout/tree';
import { defaultWorkspace, detachLeaf, dockLeaf, type Workspace } from '../src/workspace/workspace';

/** A workspace whose only space has YouTube | X side by side. */
function twoApps(): { ws: Workspace; spaceId: string; youtube: string; x: string } {
  const ws = defaultWorkspace();
  const space = ws.spaces[0]!;
  const first = listLeaves(space.layout)[0]!.id;
  const split = splitLeaf(assignApp(space.layout, first, 'youtube'), first, 'row', 'x');
  return { ws: { ...ws, spaces: [{ ...space, layout: split.root }] }, spaceId: space.id, youtube: first, x: split.newLeafId! };
}
const bounds = { x: 100, y: 100, width: 800, height: 600 };

describe('tiles in their own windows (ROADMAP 2.15)', () => {
  it('tears a tile off into a window space, keeping its running instance', () => {
    const { ws, spaceId, x } = twoApps();
    const leaf = listLeaves(ws.spaces[0]!.layout).find((l) => l.id === x)!;
    const r = detachLeaf(ws, spaceId, x, 'X', bounds);
    const win = r.ws.spaces.find((s) => s.id === r.spaceId)!;
    expect(win.window).toEqual(bounds);
    expect(listLeaves(win.layout)).toEqual([leaf]); // same leaf: same instance, no reload
    expect(listLeaves(r.ws.spaces[0]!.layout).map((l) => l.appId)).toEqual(['youtube']);
    expect(detachLeaf(ws, spaceId, 'nope', 'X', bounds).spaceId).toBeNull();
  });

  it('docks it back beside a tile on the chosen side, and the emptied window space goes away', () => {
    const { ws, spaceId, youtube, x } = twoApps();
    const torn = detachLeaf(ws, spaceId, x, 'X', bounds);
    const back = dockLeaf(torn.ws, torn.spaceId!, x, spaceId, youtube, 'left');
    expect(back.spaces.map((s) => s.id)).toEqual([spaceId]);
    expect(listLeaves(back.spaces[0]!.layout).map((l) => [l.id, l.appId])).toEqual([[x, 'x'], [youtube, 'youtube']]);
    expect(back.spaces[0]!.focusedLeafId).toBe(x);
    // The middle of an app counts as its right; the same space is a no-op.
    const middle = dockLeaf(torn.ws, torn.spaceId!, x, spaceId, youtube, 'center');
    expect(listLeaves(middle.spaces[0]!.layout).map((l) => l.appId)).toEqual(['youtube', 'x']);
    expect(dockLeaf(ws, spaceId, x, spaceId, youtube, 'left')).toBe(ws);
  });

  it('keeps a main-window space even when it ends up empty', () => {
    const { ws, spaceId, youtube, x } = twoApps();
    const one = detachLeaf(ws, spaceId, x, 'X', bounds);
    const two = detachLeaf(one.ws, spaceId, youtube, 'YouTube', bounds);
    const main = two.ws.spaces.find((s) => s.id === spaceId)!;
    expect(listLeaves(main.layout).map((l) => l.appId)).toEqual([null]);
    expect(two.ws.spaces).toHaveLength(3);
  });
});
