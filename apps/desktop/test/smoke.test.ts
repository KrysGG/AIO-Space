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

  it('never writes back the workspace it just loaded (a newer save must not be overwritten)', async () => {
    await tiles().first().waitFor();
    // Right after start, within the UI's 300 ms save delay: a save from elsewhere (as tests and imports do).
    await ui.evaluate(async () => {
      const ws = await window.aio.getWorkspace();
      await window.aio.saveWorkspace({ ...ws, zoom: { 'race-check': 1.5 } });
    });
    await new Promise((r) => setTimeout(r, 1000));
    expect((await ui.evaluate(() => window.aio.getWorkspace())).zoom).toEqual({ 'race-check': 1.5 });
    await ui.evaluate(async () => window.aio.saveWorkspace({ ...(await window.aio.getWorkspace()), zoom: {} }));
    await ui.reload();
  });

  it('opens with one empty tile showing the launcher', async () => {
    await expect.poll(() => tiles().count()).toBe(1);
    for (const name of ['Discord', 'YouTube', 'Twitch', 'Reddit', 'X', 'Instagram', 'Browser']) {
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
      .poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getURL() === 'https://example.com/')), { timeout: 15_000 })
      .toBe(true);
  });

  it('switching the search engine moves a search to the new engine', async () => {
    const urls = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()));
    const address = ui.getByRole('textbox', { name: 'Address or search' });
    await address.fill('aio space test');
    await address.press('Enter');
    // Real sites: allow for a slow network (the default 1 s poll made this fail on busy machines).
    await expect.poll(async () => (await urls()).some((u) => u.startsWith('https://duckduckgo.com/?q=aio')), { timeout: 15_000 }).toBe(true);

    await ui.getByRole('combobox', { name: 'Search engine' }).selectOption('brave');
    await expect
      .poll(async () => (await urls()).some((u) => u.startsWith('https://search.brave.com/search?q=aio%20space%20test')), { timeout: 15_000 })
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

    // Let the previous step's page finish loading, then grab the handle at the start of the header
    // (the Browser header is otherwise address bar and buttons).
    await expect.poll(() => tiles().first().locator('.tile-spinner').count(), { timeout: 20_000 }).toBe(0);
    const handle = await tiles().first().locator('.tile-handle').boundingBox();
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

  it('hides the sidebar to a thin edge, giving the tiles its space, and brings it back', async () => {
    const railWidth = async () => (await ui.locator('.rail').boundingBox())!.width;
    const tileLeft = async () => (await tiles().first().boundingBox())!.x;
    const before = { rail: await railWidth(), tile: await tileLeft() };

    await ui.getByRole('button', { name: 'Hide sidebar' }).click();
    await expect.poll(railWidth).toBeLessThan(20);
    await expect.poll(tileLeft).toBeLessThan(before.tile - 30);
    await expect.poll(() => ui.evaluate(async () => (await window.aio.getWorkspace()).ui.railCollapsed)).toBe(true);

    await ui.getByRole('button', { name: 'Show sidebar' }).click();
    await expect.poll(railWidth).toBe(before.rail);
    await expect.poll(tileLeft).toBe(before.tile);
  });

  it('keeps web views on their tiles while the window resizes, without waiting for the UI', async () => {
    await ui.locator('.tile-body button', { hasText: 'Browser' }).first().click();
    await expect.poll(viewCount).toBe(1);
    await tiles().first().getByRole('button', { name: 'Split right' }).click();
    await expect.poll(() => tiles().count()).toBe(2);
    // Resize and read the view in the same tick: main has already moved it (the UI hasn't re-rendered yet).
    const sameTick = await app.evaluate(({ BaseWindow }) => {
      const win = BaseWindow.getAllWindows()[0]!;
      win.setContentSize(1100, 720);
      return (win.contentView.children[0] as Electron.WebContentsView).getBounds();
    });
    const body = async () => {
      const r = (await tiles().first().locator('.tile-body').boundingBox())!;
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    };
    await expect.poll(body).toEqual(sameTick);
    await tiles().nth(1).getByRole('button', { name: 'Close tile' }).click();
    await tiles().first().getByRole('button', { name: 'Close tile' }).click();
    await expect.poll(viewCount).toBe(0);
  });

  it('adds apps from the app store: from the rail, and into an empty tile from its launcher', async () => {
    await ui.getByRole('button', { name: 'Add an app' }).click();
    const store = ui.getByRole('dialog', { name: 'App store' });
    await store.waitFor();
    await store.getByRole('searchbox', { name: 'Search apps' }).fill('kick');
    await store.locator('.store-card', { hasText: 'Kick' }).getByRole('button', { name: 'Add' }).click();
    await ui.getByRole('button', { name: 'Open Kick' }).waitFor(); // in the rail
    await expect.poll(() => store.locator('.store-card', { hasText: 'Kick' }).locator('button').innerText()).toBe('Open');
    await ui.keyboard.press('Escape');
    await store.waitFor({ state: 'detached' });

    await ui.locator('.launcher-add').first().click();
    await store.locator('.store-card', { hasText: 'Telegram' }).getByRole('button', { name: 'Add' }).click();
    await store.waitFor({ state: 'detached' });
    await expect.poll(() => tiles().first().getAttribute('aria-label')).toBe('Telegram');
    await expect.poll(viewCount).toBe(1);
    await tiles().first().getByRole('button', { name: 'Close tile' }).click();
    await expect.poll(viewCount).toBe(0);
  });

  it('right-click on a sidebar app: move it, hide it, show it again, open it in a new tile', async () => {
    const railOrder = () => ui.locator('.rail-apps .app-glyph').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
    const menu = () => ui.getByRole('menu', { name: 'YouTube options' });
    const rightClick = async () => {
      await ui.getByRole('button', { name: 'Open YouTube' }).click({ button: 'right' });
      await menu().waitFor();
    };
    const before = await railOrder();
    expect(before.slice(0, 2)).toEqual(['Open Discord', 'Open YouTube']);

    await rightClick();
    await menu().getByRole('menuitem', { name: 'Move up' }).click();
    await expect.poll(async () => (await railOrder()).slice(0, 2)).toEqual(['Open YouTube', 'Open Discord']);

    await rightClick();
    expect(await menu().getByRole('menuitem', { name: 'Move up' }).isDisabled()).toBe(true); // already first
    await menu().getByRole('menuitem', { name: 'Hide from sidebar' }).click();
    await expect.poll(async () => (await railOrder()).includes('Open YouTube')).toBe(false);

    await ui.locator('.rail-menu').click();
    await ui.locator('.hidden-apps').getByRole('button', { name: 'Show' }).click();
    await ui.keyboard.press('Escape');
    await expect.poll(async () => (await railOrder()).includes('Open YouTube')).toBe(true);

    const count = await tiles().count();
    await rightClick();
    await menu().getByRole('menuitem', { name: 'Open in a new tile' }).click();
    await expect.poll(() => tiles().count()).toBe(count + 1);
    await expect.poll(() => tiles().last().getAttribute('aria-label')).toBe('YouTube');
    await tiles().last().getByRole('button', { name: 'Close tile' }).click();
    await expect.poll(() => tiles().count()).toBe(count);
  });

  it('drags sidebar apps to reorder them and pins apps to the top; the order survives a restart (ROADMAP 4.7)', async () => {
    const group = (sel: string) => ui.locator(`${sel} .app-glyph`).evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')!.replace('Open ', '')));
    const rest = () => group('.rail-apps');
    const pinned = () => group('.rail-pinned');
    const before = await rest();
    const [a, b, c] = before as [string, string, string];

    // Drag the third app onto the top half of the first: it lands before it.
    const first = ui.getByRole('button', { name: `Open ${a}` });
    const box = (await first.boundingBox())!;
    await ui.getByRole('button', { name: `Open ${c}` }).dragTo(first, { targetPosition: { x: box.width / 2, y: 4 } });
    await expect.poll(async () => (await rest()).slice(0, 3)).toEqual([c, a, b]);

    await ui.getByRole('button', { name: `Open ${b}` }).click({ button: 'right' });
    await ui.getByRole('menuitem', { name: 'Pin to top' }).click();
    await expect.poll(pinned).toEqual([b]);
    expect((await rest()).slice(0, 2)).toEqual([c, a]);

    await new Promise((r) => setTimeout(r, 600)); // the UI saves the workspace after 300 ms
    await ui.reload();
    await ui.locator('.tile').first().waitFor();
    await expect.poll(pinned).toEqual([b]);
    expect((await rest()).slice(0, 2)).toEqual([c, a]);

    await ui.getByRole('button', { name: `Open ${b}` }).click({ button: 'right' });
    await ui.getByRole('menuitem', { name: 'Unpin' }).click();
    await expect.poll(pinned).toEqual([]);
    expect((await rest()).slice(0, 3)).toEqual([b, c, a]);
  });
});
