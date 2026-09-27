import { describe, expect, it } from 'vitest';
import { defaultWorkspace, migrateWorkspace, moveInRail, railApps, setHiddenInRail, WORKSPACE_VERSION } from '../src/workspace/workspace';

const catalog = ['discord', 'youtube', 'twitch', 'reddit'].map((id) => ({ id }));
const ids = (ws: ReturnType<typeof defaultWorkspace>) => railApps(catalog, ws.rail).map((a) => a.id);

describe('sidebar order and hidden apps (ROADMAP 4.7)', () => {
  it('starts in catalog order and migrates v15', () => {
    expect(ids(defaultWorkspace())).toEqual(['discord', 'youtube', 'twitch', 'reddit']);
    const v15: Record<string, unknown> = { ...defaultWorkspace(), version: 15 };
    delete v15['rail'];
    const out = migrateWorkspace(v15);
    expect(out.version).toBe(WORKSPACE_VERSION);
    expect(out.rail).toEqual({ order: [], hidden: [] });
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
