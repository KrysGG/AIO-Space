import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ net: {}, protocol: {} }));
const { uiFilePath } = await import('../src/main/security/uiProtocol');

describe('aio:// UI protocol', () => {
  const root = '/opt/aio/resources/app.asar/out/renderer';

  it('maps app URLs into the renderer folder', () => {
    expect(uiFilePath(root, 'aio://app/index.html')).toBe(`${root}/index.html`);
    expect(uiFilePath(root, 'aio://app/')).toBe(`${root}/index.html`);
    expect(uiFilePath(root, 'aio://app/assets/index-abc.js?x=1')).toBe(`${root}/assets/index-abc.js`);
  });

  it('never serves anything outside the renderer folder', () => {
    for (const url of [
      'aio://app/../../../etc/passwd',
      'aio://app/%2e%2e/%2e%2e/etc/passwd',
      'aio://app/assets/..%2f..%2f..%2fmain/index.js',
      'aio://other/index.html',
      'file:///etc/passwd',
      'not a url',
    ]) {
      const file = uiFilePath(root, url);
      expect(file === null || file.startsWith(`${root}/`), url).toBe(true);
    }
    // The URL parser resolves dot segments first, so this stays inside the folder.
    expect(uiFilePath(root, 'aio://app/%2e%2e/%2e%2e/etc/passwd')).toBe(`${root}/etc/passwd`);
    expect(uiFilePath(root, 'aio://other/index.html')).toBeNull();
  });
});
