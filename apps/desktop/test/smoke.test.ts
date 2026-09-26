import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';

/**
 * Launches the built app (run `electron-vite build` first; `pnpm test` does) with a throwaway
 * profile, and walks the Phase 1 basics. Needs a display: use `xvfb-run` on headless machines.
 */
describe('desktop smoke test', () => {
  let app: ElectronApplication;
  let ui: Page;
  const profile = mkdtempSync(join(tmpdir(), 'aio-smoke-'));

  const viewCount = () =>
    app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.contentView.children.length ?? -1);
  const tiles = () => ui.locator('.tile');

  beforeAll(async () => {
    app = await electron.launch({
      args: [join(__dirname, '..')],
      env: { ...process.env, AIO_USER_DATA_DIR: profile, ELECTRON_RENDERER_URL: '' },
    });
    ui = await app.firstWindow();
  });

  afterAll(async () => {
    await app?.close();
    rmSync(profile, { recursive: true, force: true });
  });

  it('opens with one empty tile showing the launcher', async () => {
    await expect.poll(() => tiles().count()).toBe(1);
    for (const name of ['Discord', 'YouTube', 'Reddit', 'X', 'Instagram', 'Browser']) {
      await ui.locator('.tile-body button', { hasText: name }).first().waitFor();
    }
    expect(await viewCount()).toBe(0);
  });

  it('opens Browser in the tile as a native view', async () => {
    await ui.locator('.tile-body button', { hasText: 'Browser' }).click();
    await expect.poll(viewCount).toBe(1);
    await expect.poll(() => tiles().first().getAttribute('aria-label')).toBe('Browser');
  });

  it('loads an address typed into the Browser tile', async () => {
    const address = ui.getByRole('textbox', { name: 'Address or search' });
    await address.fill('example.com');
    await address.press('Enter');
    await expect
      .poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getURL() === 'https://example.com/')))
      .toBe(true);
  });

  it('switching the search engine moves a search to the new engine', async () => {
    const urls = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()));
    const address = ui.getByRole('textbox', { name: 'Address or search' });
    await address.fill('aio space test');
    await address.press('Enter');
    await expect.poll(async () => (await urls()).some((u) => u.startsWith('https://duckduckgo.com/?q=aio'))).toBe(true);

    await ui.getByRole('combobox', { name: 'Search engine' }).selectOption('brave');
    await expect
      .poll(async () => (await urls()).some((u) => u.startsWith('https://search.brave.com/search?q=aio%20space%20test')))
      .toBe(true);
  });

  it('drags a tile onto another to swap them without reloading the page', async () => {
    const viewIds = () =>
      app.evaluate(({ BaseWindow }) =>
        BaseWindow.getAllWindows()[0]!.contentView.children.map((v) => (v as Electron.WebContentsView).webContents.id),
      );
    const before = await viewIds();
    await tiles().first().getByRole('button', { name: 'Split right' }).click();
    await expect.poll(() => tiles().count()).toBe(2);

    // Grab the app icon at the start of the header (the Browser header is otherwise address bar and buttons).
    const handle = await tiles().first().locator('.tile-head .app-icon, .tile-head .tile-spinner').first().boundingBox();
    const to = await tiles().nth(1).boundingBox();
    const start = { x: handle!.x + handle!.width / 2, y: handle!.y + handle!.height / 2 };
    await ui.mouse.move(start.x, start.y);
    await ui.mouse.down();
    await ui.mouse.move(start.x + 20, start.y + 10, { steps: 3 });
    await ui.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 8 });
    await expect.poll(() => tiles().nth(1).getAttribute('class')).toContain('is-drop-target');
    await ui.mouse.up();

    await expect.poll(async () => [await tiles().first().getAttribute('aria-label'), await tiles().nth(1).getAttribute('aria-label')]).toEqual(['Empty tile', 'Browser']);
    expect(await viewIds()).toEqual(before); // same view, just moved: the page didn't reload
    await tiles().first().getByRole('button', { name: 'Close tile' }).click();
    await expect.poll(() => tiles().count()).toBe(1);
  });

  it('splits the tile, then closes both tiles back to one empty tile', async () => {
    await tiles().first().getByRole('button', { name: 'Split right' }).click();
    await expect.poll(() => tiles().count()).toBe(2);
    expect(await viewCount()).toBe(1);

    await tiles().nth(1).getByRole('button', { name: 'Close tile' }).click();
    await expect.poll(() => tiles().count()).toBe(1);

    await tiles().first().getByRole('button', { name: 'Close tile' }).click();
    await expect.poll(viewCount).toBe(0);
    await expect.poll(() => tiles().first().getAttribute('aria-label')).toBe('Empty tile');
  });

  it('handles keyboard shortcuts (split, focus, help, close)', async () => {
    // Through Electron's native input path, like a real keypress; this is what before-input-event sees.
    const press = (keyCode: string, modifiers: string[]) =>
      app.evaluate(
        ({ BrowserWindow }, k) => {
          const wc = BrowserWindow.getAllWindows()[0]!.webContents;
          wc.sendInputEvent({ type: 'keyDown', keyCode: k.keyCode, modifiers: k.modifiers as Electron.InputEvent['modifiers'] });
          wc.sendInputEvent({ type: 'keyUp', keyCode: k.keyCode, modifiers: k.modifiers as Electron.InputEvent['modifiers'] });
        },
        { keyCode, modifiers },
      );
    const focusedIndex = () => ui.locator('.tile').evaluateAll((ts) => ts.findIndex((t) => t.classList.contains('is-focused')));

    await press('D', ['control', 'shift']);
    await expect.poll(() => tiles().count()).toBe(2);
    expect(await focusedIndex()).toBe(1);

    await press('Left', ['control', 'alt']);
    await expect.poll(focusedIndex).toBe(0);
    await press('2', ['control']);
    await expect.poll(focusedIndex).toBe(1);

    await press('/', ['control']);
    await ui.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor();
    await press('Escape', []);
    await ui.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor({ state: 'detached' });

    await press('W', ['control']);
    await expect.poll(() => tiles().count()).toBe(1);
  });
});
