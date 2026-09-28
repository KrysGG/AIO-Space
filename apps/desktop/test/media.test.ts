import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';

/**
 * Privacy dots in the real app: a custom app with camera/mic permission captures from Chromium's fake
 * devices. Run `electron-vite build` first; `pnpm test` does.
 */
const PAGE = `<!doctype html><title>media</title><script>
  window.start = async () => { window.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); return 'ok'; };
</script>`;

/** Wait until `get()` returns something truthy (expect.poll isn't allowed in hooks). */
async function until<T>(get: () => Promise<T>, timeout = 20_000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await get();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('microphone and camera indicators', () => {
  let server: Server;
  let page = '';
  const profile = mkdtempSync(join(tmpdir(), 'aio-media-'));
  let app: ElectronApplication;
  let ui: Page;

  const inPage = (js: string) =>
    app.evaluate(async ({ webContents }, [u, code]) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL() === u && !w.isLoading());
      return wc ? Promise.race([wc.executeJavaScript(code), new Promise((r) => setTimeout(r, 2000))]) : undefined; // A page that unloads mid-call never answers: wait 2 s at most (polls retry).
    }, [page, js] as const);
  const header = () => ui.locator('.tile').first().locator('.tile-media');
  const railDot = () => ui.getByRole('button', { name: 'Open Media test' }).locator('.media-dot');

  beforeAll(async () => {
    server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    page = `http://www.aio-media.test:${port}/`;
    app = await electron.launch({
      args: [
        join(__dirname, '..'),
        '--host-resolver-rules=MAP www.aio-media.test 127.0.0.1',
        `--unsafely-treat-insecure-origin-as-secure=http://www.aio-media.test:${port}`,
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
      env: { ...process.env, AIO_USER_DATA_DIR: profile, ELECTRON_RENDERER_URL: '' },
    });
    ui = await app.firstWindow();
    await ui.locator('.tile').first().waitFor();
    await ui.evaluate(async () => {
      const ws = await window.aio.getWorkspace();
      const custom = {
        id: 'custom-media-test',
        name: 'Media test',
        url: 'https://www.aio-media.test/',
        kind: 'app' as const,
        allowedHosts: ['aio-media.test'],
        popupHosts: [],
        permissions: ['media' as const],
        glyph: 'Mt',
      };
      await window.aio.saveWorkspace({ ...ws, customApps: [custom], privacyOverrides: { 'custom-media-test': { httpsOnly: false } } });
    });
    await ui.reload();
    await ui.getByRole('button', { name: 'Open Media test' }).click();
    const id = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().find((w) => w.getURL().includes('aio-media.test'))?.id ?? null);
    const viewId = await until(id);
    await app.evaluate(({ webContents }, [i, u]) => void webContents.fromId(i as number)!.loadURL(u as string), [viewId, page] as const);
    await until(async () => (await inPage('document.title')) === 'media');
  });

  afterAll(async () => {
    await app?.close();
    server?.close();
    rmSync(profile, { recursive: true, force: true });
  });

  it('shows camera and microphone while they are in use, and clears them when stopped', async () => {
    expect(await header().count()).toBe(0);
    expect(await inPage('window.start()')).toBe('ok');
    await expect.poll(() => header().getByRole('img', { name: 'Camera in use' }).count()).toBe(1);
    await expect.poll(() => header().getByRole('img', { name: 'Microphone in use' }).count()).toBe(1);
    await expect.poll(() => railDot().getAttribute('class')).toContain('media-dot-camera');

    await inPage("window.stream.getVideoTracks().forEach((t) => t.stop())");
    await expect.poll(() => header().getByRole('img', { name: 'Camera in use' }).count()).toBe(0);
    expect(await header().getByRole('img', { name: 'Microphone in use' }).count()).toBe(1);
    await expect.poll(() => railDot().getAttribute('class')).toContain('media-dot-mic');

    await inPage("window.stream.getTracks().forEach((t) => t.stop())");
    await expect.poll(() => header().count()).toBe(0);
    await expect.poll(() => railDot().count()).toBe(0);
  });

  it('ignores reports the page tries to fake', async () => {
    await inPage("console.debug('\\u2063aio-media:deadbeef:111')");
    await new Promise((r) => setTimeout(r, 500));
    expect(await header().count()).toBe(0);
  });
});
