import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Locator, type Page } from 'playwright-core';
import type { AppPermission } from '@aio/core';

/**
 * Screen sharing (ROADMAP 2.11) in the real app: an app's page calls getDisplayMedia, the UI's picker
 * lists screens and windows, and the page gets the chosen source. The apps' https pages are served
 * from memory in their own sessions. Run `electron-vite build` first; `pnpm test` does.
 */
const SHARE = `navigator.mediaDevices.getDisplayMedia({ video: true }).then(
  (s) => { window.result = s.getVideoTracks()[0].readyState; s.getTracks().forEach((t) => t.stop()); },
  (e) => { window.result = e.name; })`;

describe('screen sharing', () => {
  let app: ElectronApplication;
  let ui: Page;
  const profile = mkdtempSync(join(tmpdir(), 'aio-share-'));

  const inApp = (site: string, code: string, gesture = false) =>
    app.evaluate(
      ({ webContents }, [u, c, g]) => {
        const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(u as string) && !w.isLoading());
        return wc?.executeJavaScript(c as string, g as boolean);
      },
      [`https://www.${site}.test/`, code, gesture] as const,
    );
  // A user gesture, as a click on the page's share button would give.
  const share = (site: string) => inApp(site, `window.result = undefined; ${SHARE}; 1`, true);
  // Clicks go to the element as DOM events: Windows stops painting a window that is covered while
  // someone uses the desktop, and mouse clicks wait for paints (this test made that likely).
  const press = (locator: Locator) => locator.dispatchEvent('click');
  const result = (site: string) => inApp(site, 'window.result');

  const openApp = async (site: string, name: string, permissions: AppPermission[]): Promise<void> => {
    const id = `custom-${site}`;
    await app.evaluate(({ session }, p) => {
      session
        .fromPartition(p)
        .protocol.handle('https', () => new Response('<!doctype html><title>share</title>', { headers: { 'content-type': 'text/html' } }));
    }, `persist:app-${id}-default`);
    await ui.evaluate(
      async ([id, site, name, permissions]) => {
        const ws = await window.aio.getWorkspace();
        const custom = { id, name, url: `https://www.${site}.test/`, kind: 'app' as const, allowedHosts: [`${site}.test`], popupHosts: [], permissions, glyph: 'Sh' };
        await window.aio.saveWorkspace({ ...ws, customApps: [...ws.customApps.filter((a) => a.id !== id), custom] });
      },
      [id, site, name, permissions] as const,
    );
    await ui.reload();
    await press(ui.getByRole('button', { name: `Open ${name}` }));
    for (const end = Date.now() + 20_000; (await inApp(site, 'document.title')) !== 'share'; await new Promise((r) => setTimeout(r, 100))) {
      if (Date.now() > end) throw new Error(`${name} never loaded`);
    }
  };

  beforeAll(async () => {
    app = await electron.launch({
      args: [join(__dirname, '..')],
      env: { ...process.env, AIO_USER_DATA_DIR: profile, ELECTRON_RENDERER_URL: '' },
    });
    ui = await app.firstWindow();
    await ui.locator('.tile').first().waitFor();
    await openApp('sharer', 'Sharer', ['display-capture']);
  });

  afterAll(async () => {
    await app?.close();
    rmSync(profile, { recursive: true, force: true });
  });

  it('shows the picker, and the page gets the chosen screen', async () => {
    await share('sharer');
    const picker = ui.getByRole('dialog', { name: 'Share your screen with Sharer' });
    await picker.waitFor({ state: 'attached' });
    await press(picker.getByRole('listbox', { name: 'Screens' }).getByRole('option').first());
    await press(picker.getByRole('button', { name: 'Share' }));
    await expect.poll(() => result('sharer'), { timeout: 10_000 }).toBe('live');
    expect(await picker.count()).toBe(0);
  });

  it('cancelling refuses the page', async () => {
    await share('sharer');
    const picker = ui.getByRole('dialog', { name: 'Share your screen with Sharer' });
    await press(picker.getByRole('button', { name: 'Cancel' }));
    // Electron refuses with AbortError (Chrome says NotAllowedError); either way the page gets no stream.
    await expect.poll(() => result('sharer'), { timeout: 10_000 }).toBe('AbortError');
  });

  it('an app without screen sharing never gets the picker', async () => {
    await openApp('noshare', 'No share', []);
    await share('noshare');
    await expect.poll(() => result('noshare'), { timeout: 10_000 }).toBe('NotAllowedError');
    expect(await ui.getByRole('dialog', { name: /Share your screen/ }).count()).toBe(0);
  });
});
