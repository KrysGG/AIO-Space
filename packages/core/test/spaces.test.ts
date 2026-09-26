import { describe, expect, it } from 'vitest';
import { addSpace, defaultWorkspace, MAX_SPACES, migrateWorkspace, removeSpace, renameSpace, switchSpace, WORKSPACE_VERSION } from '../src/workspace/workspace';

describe('spaces', () => {
  it('adds a space with one empty tile and switches to it', () => {
    const ws = addSpace(defaultWorkspace(), '  Gaming  ');
    expect(ws.spaces.map((s) => s.name)).toEqual(['Main', 'Gaming']);
    const gaming = ws.spaces[1]!;
    expect(ws.activeSpaceId).toBe(gaming.id);
    expect(gaming.layout).toMatchObject({ type: 'leaf', appId: null });
    expect(gaming.focusedLeafId).toBe((gaming.layout as { id: string }).id);
  });

  it('names new spaces "Space N" without clashing', () => {
    let ws = addSpace(defaultWorkspace());
    ws = addSpace(ws);
    expect(ws.spaces.map((s) => s.name)).toEqual(['Main', 'Space 2', 'Space 3']);
  });

  it('stops at the maximum', () => {
    let ws = defaultWorkspace();
    for (let i = 0; i < MAX_SPACES + 3; i++) ws = addSpace(ws);
    expect(ws.spaces).toHaveLength(MAX_SPACES);
  });

  it('renames, ignoring blank names and trimming long ones', () => {
    const ws = defaultWorkspace();
    const id = ws.spaces[0]!.id;
    expect(renameSpace(ws, id, '  Work  stuff ').spaces[0]!.name).toBe('Work stuff');
    expect(renameSpace(ws, id, '   ').spaces[0]!.name).toBe('Main');
    expect(renameSpace(ws, id, 'x'.repeat(60)).spaces[0]!.name).toHaveLength(40);
  });

  it('switches only to spaces that exist', () => {
    const ws = addSpace(defaultWorkspace());
    const main = ws.spaces[0]!.id;
    expect(switchSpace(ws, main).activeSpaceId).toBe(main);
    expect(switchSpace(ws, 'nope')).toBe(ws);
  });

  it('removes a space, moving to its neighbour, but never the last one', () => {
    let ws = addSpace(addSpace(defaultWorkspace(), 'A'), 'B'); // Main, A, B; active B
    const [main, a, b] = ws.spaces.map((s) => s.id) as [string, string, string];
    ws = switchSpace(ws, a);
    const without = removeSpace(ws, a);
    expect(without.spaces.map((s) => s.id)).toEqual([main, b]);
    expect(without.activeSpaceId).toBe(b); // neighbour takes over
    expect(removeSpace(without, main).activeSpaceId).toBe(b); // removing an inactive one keeps focus
    const single = defaultWorkspace();
    expect(removeSpace(single, single.spaces[0]!.id)).toBe(single);
  });
});

describe('workspace v5 (sleep setting)', () => {
  it('defaults to sleeping hidden tiles after 30 minutes, and migrates v4', () => {
    expect(defaultWorkspace().performance).toEqual({ sleepAfterMinutes: 30 });
    const v4: Record<string, unknown> = { ...defaultWorkspace(), version: 4 };
    delete v4['performance'];
    const out = migrateWorkspace(v4);
    expect(out.version).toBe(WORKSPACE_VERSION);
    expect(out.performance).toEqual({ sleepAfterMinutes: 30 });
  });
});
