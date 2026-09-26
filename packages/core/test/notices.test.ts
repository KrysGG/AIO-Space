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
