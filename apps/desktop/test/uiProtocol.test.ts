import { isAbsolute, join, relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ net: {}, protocol: {} }));
const { uiFilePath } = await import('../src/main/security/uiProtocol');

describe('aio:// UI protocol', () => {
  // The platform's own absolute form (D:\opt\... on Windows).
  const root = resolve('/opt/aio/resources/app.asar/out/renderer');
  const inside = (file: string): boolean => {
    const rel = relative(root, file);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  };

  it('maps app URLs into the renderer folder', () => {
    expect(uiFilePath(root, 'aio://app/index.html')).toBe(join(root, 'index.html'));
    expect(uiFilePath(root, 'aio://app/')).toBe(join(root, 'index.html'));
    expect(uiFilePath(root, 'aio://app/assets/index-abc.js?x=1')).toBe(join(root, 'assets', 'index-abc.js'));
  });

  it('never serves anything outside the renderer folder', () => {
    for (const url of [
      'aio://app/../../../etc/passwd',
      'aio://app/%2e%2e/%2e%2e/etc/passwd',
      'aio://app/assets/..%2f..%2f..%2fmain/index.js',
      // Windows path rules (ROADMAP 6.1): backslashes, encoded backslashes, drive letters, UNC paths.
      'aio://app/..\\..\\..\\Windows\\win.ini',
      'aio://app/assets/..%5c..%5c..%5cmain%5cindex.js',
      'aio://app/C:/Windows/win.ini',
      'aio://app/C:%5cWindows%5cwin.ini',
      'aio://app/%5c%5cserver%5cshare%5cfile',
      'aio://app//server/share/file',
      'aio://other/index.html',
      'file:///etc/passwd',
      'not a url',
    ]) {
      const file = uiFilePath(root, url);
      expect(file === null || inside(file), `${url} -> ${file}`).toBe(true);
    }
    // The URL parser resolves dot segments first, so this stays inside the folder.
    expect(uiFilePath(root, 'aio://app/%2e%2e/%2e%2e/etc/passwd')).toBe(join(root, 'etc', 'passwd'));
    expect(uiFilePath(root, 'aio://other/index.html')).toBeNull();
  });
});
