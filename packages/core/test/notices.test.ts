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
