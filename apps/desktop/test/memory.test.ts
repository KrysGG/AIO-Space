import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';

/**
 * Memory (ROADMAP 2.14): opening and closing tabs and tiles, divider drags (views hidden, with
 * snapshots) and window resizes leave nothing behind. Browser pages come from memory. Run
 * `electron-vite build` first; `pnpm test` does. Profiled by hand with real YouTube + X on a
 * 5120x1440 screen (200 cycles): flat, see ROADMAP 2.14.
 */
const CYCLES = 40;

describe('memory over open/close/resize cycles', () => {
  let app: ElectronApplication;
  let ui: Page;
  const profile = mkdtempSync(join(tmpdir(), 'aio-memory-'));
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // DOM events, not mouse clicks (a covered window may not paint; see screenShare.test.ts).
  const press = (name: string) => ui.getByRole('button', { name }).last().dispatchEvent('click');

  const measure = async () => {
    await ui.evaluate(() => (globalThis as unknown as { gc(): void }).gc());
    return {
      ...(await app.evaluate(({ app, webContents, BaseWindow }) => {
        (globalThis as unknown as { gc(): void }).gc();
        return {
          pages: webContents.getAllWebContents().length,
          views: BaseWindow.getAllWindows()[0]!.contentView.children.length,
          processes: app.getAppMetrics().length,
          mainHeapMB: process.memoryUsage().heapUsed / 1048576,
        };
      })),
      uiHeapMB: await ui.evaluate(() => (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576),
    };
  };

  beforeAll(async () => {
    app = await electron.launch({
      args: [join(__dirname, '..'), '--js-flags=--expose-gc'],
      env: { ...process.env, AIO_USER_DATA_DIR: profile, ELECTRON_RENDERER_URL: '' },
    });
    ui = await app.firstWindow();
    await ui.locator('.tile').first().waitFor();
    await app.evaluate(({ session }) =>
      session
        .fromPartition('persist:app-browser-default')
        .protocol.handle('https', (req) => new Response(`<!doctype html><title>page ${new URL(req.url).pathname}</title>`, { headers: { 'content-type': 'text/html' } })),
    );
  });

  afterAll(async () => {
    await app?.close();
    rmSync(profile, { recursive: true, force: true });
  });

  it('leaves no pages, views or processes behind, and heaps stay flat', async () => {
    await ui.locator('.tile-body button', { hasText: 'Browser' }).dispatchEvent('click');
    const address = () => ui.getByRole('textbox', { name: 'Address or search' }).first();
    await address().fill('https://mem.test/start');
    await address().press('Enter');
    await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getTitle() === 'page /start'))).toBe(true);
    // Warm up once (first tab, split, drag and resize allocate their caches), then measure.
    const cycle = async (i: number) => {
      await press('New tab (Ctrl+T)');
      await address().fill(`https://mem.test/${i}`);
      await address().press('Enter');
      await expect.poll(() => ui.getByRole('button', { name: `Close page /${i}` }).count(), { timeout: 10_000 }).toBe(1);
      await press(`Close page /${i}`);
      await press('Split focused tile right');
      await expect.poll(() => ui.locator('.tile').count()).toBe(2);
      await press('Close tile');
      await expect.poll(() => ui.locator('.tile').count()).toBe(1);
      await ui.evaluate(() => window.aio.setViewsHidden(true));
      await pause(100);
      await ui.evaluate(() => window.aio.setViewsHidden(false));
      await app.evaluate(({ BaseWindow }, n) => BaseWindow.getAllWindows()[0]!.setSize(n % 2 ? 1200 : 1400, n % 2 ? 800 : 900), i);
      await pause(100);
    };
    await cycle(0);
    await pause(1500);
    const before = await measure();
    for (let i = 1; i <= CYCLES; i++) await cycle(i);
    await pause(1500);
    const after = await measure();

    expect(after.pages).toBe(before.pages);
    expect(after.views).toBe(before.views);
    // A closed page's renderer can take a moment to exit.
    await expect.poll(async () => (await measure()).processes, { timeout: 10_000 }).toBeLessThanOrEqual(before.processes);
    expect(after.mainHeapMB - before.mainHeapMB).toBeLessThan(15);
    expect(after.uiHeapMB - before.uiHeapMB).toBeLessThan(10);
  });
});
