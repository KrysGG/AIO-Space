import { describe, expect, it } from 'vitest';
import { assignApp, createLeaf, DEFAULT_PROFILE, listLeaves, setProfile, splitLeaf, swapApps } from '../src/layout/tree';
import { addProfile, defaultWorkspace, MAX_PROFILES_PER_APP, migrateWorkspace, profilesOf, WORKSPACE_VERSION } from '../src/workspace/workspace';

describe('accounts in tiles', () => {
  it('switching account starts a fresh instance; switching back to the first drops the field', () => {
    const a = createLeaf('discord');
    const second = setProfile(a, a.id, 'p2') as typeof a;
    expect(second.profile).toBe('p2');
    expect(second.instanceId).not.toBe(a.instanceId);
    const first = setProfile(second, a.id, DEFAULT_PROFILE) as typeof a;
    expect(first.profile).toBeUndefined();
    expect(setProfile(a, a.id, DEFAULT_PROFILE)).toBe(a); // already there: nothing changes
    expect(setProfile(createLeaf(), 'x', 'p2')).toMatchObject({ appId: null });
  });

  it('the account moves with its app when tiles are swapped', () => {
    const a = createLeaf('discord');
    const { root, newLeafId } = splitLeaf(a, a.id, 'row', 'discord');
    const withP2 = setProfile(root, newLeafId!, 'p2');
    const swapped = listLeaves(swapApps(withP2, a.id, newLeafId!));
    expect(swapped.map((l) => l.profile)).toEqual(['p2', undefined]);
  });

  it('putting another app in a tile resets to its first account', () => {
    const leaf = createLeaf('discord');
    const onP2 = setProfile(leaf, leaf.id, 'p2');
    expect((assignApp(onP2, leaf.id, 'youtube') as typeof leaf).profile).toBeUndefined();
  });
});

describe('workspace accounts', () => {
  it('lists the implicit first account and adds numbered ones up to a limit', () => {
    let ws = defaultWorkspace();
    expect(profilesOf(ws, 'discord')).toEqual([{ id: 'default', name: 'Account 1' }]);
    const r = addProfile(ws, 'discord');
    ws = r.ws;
    expect(r.profileId).toBe('p2');
    expect(profilesOf(ws, 'discord').map((p) => p.name)).toEqual(['Account 1', 'Account 2']);
    for (let i = 0; i < 10; i++) ws = addProfile(ws, 'discord').ws;
    expect(profilesOf(ws, 'discord')).toHaveLength(MAX_PROFILES_PER_APP);
    expect(addProfile(ws, 'discord').profileId).toBeNull();
  });

  it('migrates v6 by adding an empty account list', () => {
    const v6: Record<string, unknown> = { ...defaultWorkspace(), version: 6 };
    delete v6['profiles'];
    const out = migrateWorkspace(v6);
    expect(out.version).toBe(WORKSPACE_VERSION);
    expect(out.profiles).toEqual({});
  });
});
