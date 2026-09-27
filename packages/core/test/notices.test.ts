import { describe, expect, it } from 'vitest';
import { defaultWorkspace, dismissNotice, migrateWorkspace, WORKSPACE_VERSION } from '../src/workspace/workspace';

describe('dismissed notices (ROADMAP 3.8)', () => {
  it('starts empty and remembers a dismissal once', () => {
    const ws = defaultWorkspace();
    expect(ws.dismissedNotices).toEqual([]);
    const once = dismissNotice(ws, 'weak-keyring');
    expect(once.dismissedNotices).toEqual(['weak-keyring']);
    expect(dismissNotice(once, 'weak-keyring')).toBe(once);
    expect(ws.dismissedNotices).toEqual([]); // pure
  });

  it('migrates a v9 workspace', () => {
    const v9: Record<string, unknown> = { ...defaultWorkspace(), version: 9 };
    delete v9['dismissedNotices'];
    const out = migrateWorkspace(v9);
    expect(out.version).toBe(WORKSPACE_VERSION);
    expect(out.dismissedNotices).toEqual([]);
  });
});

describe('forget on close (ROADMAP 3.9)', () => {
  it('turns on and off per app, purely', async () => {
    const { setForgetOnClose } = await import('../src/workspace/workspace');
    const ws = defaultWorkspace();
    const on = setForgetOnClose(ws, 'reddit', true);
    expect(on.forgetOnClose).toEqual(['reddit']);
    expect(setForgetOnClose(on, 'reddit', true)).toBe(on);
    expect(setForgetOnClose(on, 'reddit', false).forgetOnClose).toEqual([]);
    expect(ws.forgetOnClose).toEqual([]);
  });

  it('migrates a v10 workspace', () => {
    const v10: Record<string, unknown> = { ...defaultWorkspace(), version: 10 };
    delete v10['forgetOnClose'];
    expect(migrateWorkspace(v10).forgetOnClose).toEqual([]);
  });
});

describe('interface state (v12)', () => {
  it('starts with the rail shown and migrates v11', () => {
    expect(defaultWorkspace().ui).toEqual({ railCollapsed: false, reduceMotion: false });
    const v11: Record<string, unknown> = { ...defaultWorkspace(), version: 11 };
    delete v11['ui'];
    const out = migrateWorkspace(v11);
    expect(out.version).toBe(WORKSPACE_VERSION);
    expect(out.ui).toEqual({ railCollapsed: false, reduceMotion: false });
  });

  it('migrates v12 keeping the rail state (v13 adds reduceMotion)', () => {
    const v12 = { ...defaultWorkspace(), version: 12, ui: { railCollapsed: true } };
    expect(migrateWorkspace(v12).ui).toEqual({ railCollapsed: true, reduceMotion: false });
  });
});
