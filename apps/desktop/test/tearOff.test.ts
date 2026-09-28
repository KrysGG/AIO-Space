import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';

/**
 * Tiles torn off into their own windows and docked back (ROADMAP 2.15), in the real app. The tile
 * drag is dispatched as DOM events (a covered window may not paint for mouse input). Apps' pages
 * come from memory; `performance.timeOrigin` tells whether a page was reloaded.
 */
describe('tearing tiles off into their own windows', () => {
  let app: ElectronApplication;
  let ui: Page;
  const profile = mkdtempSync(join(tmpdir(), 'aio-tear-'));

  const launch = async (): Promise<void> => {
    app = await electron.launch({
      args: [join(__dirname, '..')],
      env: { ...process.env, AIO_USER_DATA_DIR: profile, ELECTRON_RENDERER_URL: '' },
    });
    // The main window's page: after a restart a torn-off window opens too, and may come first.
    await app.firstWindow();
    for (const end = Date.now() + 20_000; ; await new Promise((r) => setTimeout(r, 100))) {
      const main = app.windows().find((p) => p.url().startsWith('aio://') && !p.url().includes('?space='));
      if (main) {
        ui = main;
        break;
      }
      if (Date.now() > end) throw new Error('no main window');
    }
    await ui.locator('.tile').first().waitFor();
    await app.evaluate(({ session, webContents }) => {
      for (const id of ['twitch', 'reddit']) {
        session
          .fromPartition(`persist:app-${id}-default`)
          .protocol.handle('https', () => new Response(`<!doctype html><title>${id}</title>`, { headers: { 'content-type': 'text/html' } }));
      }
      // A torn-off window restored at start may already be loading the real site: load the stand-in.
      for (const wc of webContents.getAllWebContents()) if (!wc.getURL().startsWith('aio://')) wc.reload();
    });
  };

  /** The Reddit page: which view it is, whether it's in a torn-off window, and when its document started. */
  const reddit = () =>
    app.evaluate(async ({ BrowserWindow, webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getTitle() === 'reddit' && !w.isLoading());
      if (!wc) return null;
      const host = BrowserWindow.getAllWindows().find((w) => w.contentView.children.some((v) => (v as Electron.WebContentsView).webContents?.id === wc.id));
      const born = (await Promise.race([wc.executeJavaScript('performance.timeOrigin'), new Promise((r) => setTimeout(r, 2000))])) as number;
      return { id: wc.id, born, torn: host ? host.webContents.getURL().includes('?space=') : null };
    });
  const windowCount = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  const workspace = () => ui.evaluate(() => window.aio.getWorkspace());
  const tornPage = async (): Promise<Page> => {
    await expect.poll(() => app.windows().some((p) => p.url().includes('?space='))).toBe(true);
    return app.windows().find((p) => p.url().includes('?space='))!;
  };

  /** Drag a tile's header in `page` and let go at a screen point outside that window. */
  const dragOut = async (page: Page, appName: string, screen: { x: number; y: number }) => {
    const header = page.locator(`.tile[aria-label="${appName}"] .tile-head`);
    const box = (await header.boundingBox())!;
    const start = { clientX: box.x + 40, clientY: box.y + box.height / 2, button: 0, pointerId: 1, bubbles: true };
    await header.dispatchEvent('pointerdown', start);
    await page.evaluate(
      ([s, to]) => {
        window.dispatchEvent(new PointerEvent('pointermove', { ...s, clientX: s.clientX + 40 }));
        window.dispatchEvent(new PointerEvent('pointermove', { ...s, clientX: window.innerWidth + 100, screenX: to.x, screenY: to.y }));
        window.dispatchEvent(new PointerEvent('pointerup', { ...s, clientX: window.innerWidth + 100, screenX: to.x, screenY: to.y }));
      },
      [start, screen] as const,
    );
  };

  beforeAll(async () => {
    await launch();
    await ui.locator('.tile-body button', { hasText: 'Twitch' }).dispatchEvent('click');
    await ui.getByRole('button', { name: 'Split focused tile right' }).dispatchEvent('click');
    await ui.locator('.tile[aria-label="Empty tile"] .tile-body button', { hasText: 'Reddit' }).dispatchEvent('click');
    for (const end = Date.now() + 20_000; !(await reddit()); await new Promise((r) => setTimeout(r, 100))) {
      if (Date.now() > end) throw new Error('Reddit never loaded');
    }
  });

  afterAll(async () => {
    await app?.close();
    rmSync(profile, { recursive: true, force: true });
  });

  it('tears a tile off into its own window without reloading its page', async () => {
    const before = (await reddit())!;
    expect(before.torn).toBe(false);
    const main = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('?space='))!.getContentBounds());
    await dragOut(ui, 'Reddit', { x: main.x + main.width + 150, y: main.y + 80 });

    await expect.poll(windowCount, { timeout: 10_000 }).toBe(2);
    await expect.poll(async () => (await reddit())?.torn, { timeout: 10_000 }).toBe(true);
    const after = (await reddit())!;
    expect([after.id, after.born]).toEqual([before.id, before.born]); // the same page: not reloaded
    await expect.poll(() => ui.locator('.tile').count(), { timeout: 10_000 }).toBe(1);
    const ws = await workspace();
    expect(ws.spaces.filter((s) => s.window)).toHaveLength(1);
    // The torn-off window shows just that app, with the sidebar hidden.
    const torn = await tornPage();
    await expect.poll(() => torn.locator('.tile').evaluateAll((ts) => ts.map((t) => t.getAttribute('aria-label')))).toEqual(['Reddit']);
    expect(await torn.locator('nav.rail.is-collapsed').count()).toBe(1);
  });

  it('docks it back beside a tile in the main window, on the side it leans to', async () => {
    const before = (await reddit())!;
    const main = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('?space='))!.getContentBounds());
    await dragOut(await tornPage(), 'Reddit', { x: main.x + main.width - 40, y: main.y + main.height / 2 });

    await expect.poll(windowCount, { timeout: 10_000 }).toBe(1);
    await expect.poll(async () => (await reddit())?.torn, { timeout: 10_000 }).toBe(false);
    const after = (await reddit())!;
    expect([after.id, after.born]).toEqual([before.id, before.born]);
    await expect.poll(() => ui.locator('.tile').evaluateAll((ts) => ts.map((t) => t.getAttribute('aria-label')))).toEqual(['Twitch', 'Reddit']);
    expect((await workspace()).spaces.filter((s) => s.window)).toHaveLength(0);
  });

  it('reopens a torn-off window after a restart, and closing it closes its tiles', async () => {
    const main = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('?space='))!.getContentBounds());
    await dragOut(ui, 'Reddit', { x: main.x + main.width + 150, y: main.y + 80 });
    await expect.poll(windowCount, { timeout: 10_000 }).toBe(2);
    await new Promise((r) => setTimeout(r, 800)); // saved

    await app.close();
    await launch();
    await expect.poll(windowCount, { timeout: 20_000 }).toBe(2);
    await expect.poll(async () => (await reddit())?.torn, { timeout: 20_000 }).toBe(true);

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('?space='))!.close());
    await expect.poll(windowCount, { timeout: 10_000 }).toBe(1);
    await expect.poll(async () => (await workspace()).spaces.filter((s) => s.window).length, { timeout: 10_000 }).toBe(0);
    await expect.poll(reddit, { timeout: 10_000 }).toBeNull(); // its page closed with it
  });
});
