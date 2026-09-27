import { describe, expect, it } from 'vitest';
import { listLeaves, splitLeaf } from '../src/layout/tree';
import { addTab, instancesOf } from '../src/layout/tabs';
import type { LayoutNode } from '../src/layout/types';
import {
  addSpaceFromTemplate,
  defaultWorkspace,
  freshLayout,
  MAX_TEMPLATES,
  migrateWorkspace,
  removeTemplate,
  saveTemplate,
  WORKSPACE_VERSION,
} from '../src/workspace/workspace';

/** Discord | (Browser with two tabs over an empty tile). */
function sketch(): LayoutNode {
  const ws = defaultWorkspace();
  const first = ws.spaces[0]!.layout;
  let r = splitLeaf(
    { ...first, type: 'leaf', appId: 'discord', instanceId: 'app_d' } as LayoutNode,
    first.id,
    'row',
    'browser',
  );
  const browser = r.newLeafId!;
  r = splitLeaf(r.root, browser, 'column', null);
  return addTab(r.root, browser, 'https://example.com/').root;
}

describe('space templates (ROADMAP 4.6)', () => {
  it('copies the arrangement with new ids everywhere and no Browser tabs', () => {
    const layout = sketch();
    const copy = freshLayout(layout);
    const shape = (l: LayoutNode): unknown =>
      l.type === 'leaf'
        ? { app: l.appId, profile: l.profile }
        : { d: l.direction, r: l.ratio, a: shape(l.first), b: shape(l.second) };
    expect(shape(copy)).toEqual(shape(layout));
    const ids = (l: LayoutNode) => [...listLeaves(l).map((x) => x.id), ...instancesOf(l)];
    expect(ids(copy).some((id) => ids(layout).includes(id))).toBe(false);
    expect(
      listLeaves(copy).every(
        (l) => l.tabs === undefined && (l.appId === null) === (l.instanceId === null),
      ),
    ).toBe(true);
  });

  it('saves a space, starts new spaces from it (unique names, switched to), and deletes it', () => {
    let ws = defaultWorkspace();
    ws = { ...ws, spaces: [{ ...ws.spaces[0]!, name: 'Gaming', layout: sketch() }] };
    ws = saveTemplate(ws, ws.spaces[0]!.id);
    const tpl = ws.templates[0]!;
    expect(tpl.name).toBe('Gaming');
    ws = addSpaceFromTemplate(ws, tpl.id);
    ws = addSpaceFromTemplate(ws, tpl.id);
    expect(ws.spaces.map((s) => s.name)).toEqual(['Gaming', 'Gaming 2', 'Gaming 3']);
    expect(ws.activeSpaceId).toBe(ws.spaces[2]!.id);
    const all = ws.spaces.flatMap((s) => instancesOf(s.layout));
    expect(new Set(all).size).toBe(all.length);
    expect(ws.spaces[2]!.focusedLeafId).toBe(listLeaves(ws.spaces[2]!.layout)[0]!.id);
    expect(removeTemplate(ws, tpl.id).templates).toEqual([]);
    expect(addSpaceFromTemplate(ws, 'nope')).toBe(ws);
  });

  it(`keeps at most ${MAX_TEMPLATES}, and v16 workspaces migrate with none`, () => {
    let ws = defaultWorkspace();
    for (let i = 0; i < MAX_TEMPLATES + 3; i++) ws = saveTemplate(ws, ws.spaces[0]!.id);
    expect(ws.templates).toHaveLength(MAX_TEMPLATES);
    const v16: Record<string, unknown> = { ...defaultWorkspace(), version: 16 };
    delete v16['templates'];
    const out = migrateWorkspace(v16);
    expect(out.version).toBe(WORKSPACE_VERSION);
    expect(out.templates).toEqual([]);
  });
});
