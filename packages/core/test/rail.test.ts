import { describe, expect, it } from 'vitest';
import { defaultWorkspace, migrateWorkspace, moveInRail, placeInRail, railApps, setHiddenInRail, setPinnedInRail, WORKSPACE_VERSION } from '../src/workspace/workspace';

const catalog = ['discord', 'youtube', 'twitch', 'reddit'].map((id) => ({ id }));
const ids = (ws: ReturnType<typeof defaultWorkspace>) => railApps(catalog, ws.rail).map((a) => a.id);

describe('sidebar order and hidden apps (ROADMAP 4.7)', () => {
  it('starts in catalog order and migrates v15', () => {
    expect(ids(defaultWorkspace())).toEqual(['discord', 'youtube', 'twitch', 'reddit']);
    const v15: Record<string, unknown> = { ...defaultWorkspace(), version: 15 };
    delete v15['rail'];
    const out = migrateWorkspace(v15);
    expect(out.version).toBe(WORKSPACE_VERSION);
    expect(out.rail).toEqual({ order: [], hidden: [], pinned: [] });
  });

  it('moves apps up and down, stopping at the ends', () => {
    let ws = defaultWorkspace();
    ws = moveInRail(ws, catalog, 'twitch', -1);
    expect(ids(ws)).toEqual(['discord', 'twitch', 'youtube', 'reddit']);
    ws = moveInRail(ws, catalog, 'discord', 1);
    expect(ids(ws)).toEqual(['twitch', 'discord', 'youtube', 'reddit']);
    expect(moveInRail(ws, catalog, 'twitch', -1)).toBe(ws);
    expect(moveInRail(ws, catalog, 'reddit', 1)).toBe(ws);
  });

  it('hides and shows apps; new apps join at the end; moves skip hidden apps', () => {
    let ws = setHiddenInRail(defaultWorkspace(), 'youtube', true);
    expect(ids(ws)).toEqual(['discord', 'twitch', 'reddit']);
    ws = moveInRail(ws, catalog, 'reddit', -1);
    expect(ids(ws)).toEqual(['discord', 'reddit', 'twitch']);
    ws = setHiddenInRail(ws, 'youtube', false);
    expect(ids(ws)).toEqual(['discord', 'reddit', 'twitch', 'youtube']);
    expect(railApps([...catalog, { id: 'custom-new' }], ws.rail).at(-1)?.id).toBe('custom-new');
  });
});

describe('pinned apps and drag and drop (ROADMAP 4.7)', () => {
  const catalog5 = ['discord', 'youtube', 'twitch', 'reddit', 'x'].map((id) => ({ id }));
  const order = (ws: ReturnType<typeof defaultWorkspace>) => railApps(catalog5, ws.rail).map((a) => a.id);

  it('pins apps to the top in pin order, and unpins them to the top of the rest', () => {
    let ws = setPinnedInRail(defaultWorkspace(), catalog5, 'reddit', true);
    ws = setPinnedInRail(ws, catalog5, 'twitch', true);
    expect(order(ws)).toEqual(['reddit', 'twitch', 'discord', 'youtube', 'x']);
    expect(ws.rail.pinned).toEqual(['reddit', 'twitch']);
    ws = setPinnedInRail(ws, catalog5, 'reddit', false);
    expect(order(ws)).toEqual(['twitch', 'reddit', 'discord', 'youtube', 'x']);
    expect(setPinnedInRail(ws, catalog5, 'twitch', true)).toBe(ws);
  });

  it('moves up and down only within the app’s group', () => {
    const ws = setPinnedInRail(defaultWorkspace(), catalog5, 'reddit', true);
    expect(moveInRail(ws, catalog5, 'reddit', 1)).toBe(ws);
    expect(moveInRail(ws, catalog5, 'discord', -1)).toBe(ws);
    expect(order(moveInRail(ws, catalog5, 'discord', 1))).toEqual(['reddit', 'youtube', 'discord', 'twitch', 'x']);
  });

  it('drops an app before or after another, joining its group; the order persists in the workspace', () => {
    let ws = setPinnedInRail(defaultWorkspace(), catalog5, 'reddit', true);
    ws = placeInRail(ws, catalog5, 'x', 'youtube', false);
    expect(order(ws)).toEqual(['reddit', 'discord', 'x', 'youtube', 'twitch']);
    ws = placeInRail(ws, catalog5, 'twitch', 'reddit', true);
    expect(order(ws)).toEqual(['reddit', 'twitch', 'discord', 'x', 'youtube']);
    expect(ws.rail.pinned).toEqual(['reddit', 'twitch']);
    ws = placeInRail(ws, catalog5, 'reddit', 'youtube', true);
    expect(order(ws)).toEqual(['twitch', 'discord', 'x', 'youtube', 'reddit']);
    expect(ws.rail.pinned).toEqual(['twitch']);
    expect(placeInRail(ws, catalog5, 'x', 'x', true)).toBe(ws);
    expect(placeInRail(ws, catalog5, 'nope', 'x', true)).toBe(ws);
  });

  it('hidden apps stay out of both groups', () => {
    let ws = setPinnedInRail(defaultWorkspace(), catalog5, 'reddit', true);
    ws = setHiddenInRail(ws, 'reddit', true);
    expect(order(ws)).toEqual(['discord', 'youtube', 'twitch', 'x']);
  });
});
