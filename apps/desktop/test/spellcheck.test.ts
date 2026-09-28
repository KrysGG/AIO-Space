import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';

/**
 * Spellcheck without Google (D-066): the bundled US English dictionary is used, and nothing is
 * downloaded. Windows is switched to Hunspell (its default is the Windows spellchecker), so this
 * checks what Linux does on every platform. Run `electron-vite build` first; `pnpm test` does.
 */
describe('spellcheck dictionaries', () => {
  let app: ElectronApplication;
  let ui: Page;
  const profile = mkdtempSync(join(tmpdir(), 'aio-spell-'));
  const events = () => app.evaluate(() => (globalThis as unknown as { spell: string[] }).spell);

  beforeAll(async () => {
    app = await electron.launch({
      args: [join(__dirname, '..'), '--disable-features=WinUseBrowserSpellChecker'],
      env: { ...process.env, AIO_USER_DATA_DIR: profile, ELECTRON_RENDERER_URL: '', LANG: 'en_US.UTF-8' },
    });
    ui = await app.firstWindow();
    await ui.locator('.tile').first().waitFor();
    await app.evaluate(({ session }) => {
      const g = globalThis as unknown as { spell: string[] };
      g.spell = [];
      const ses = session.fromPartition('persist:app-browser-default');
      ses.protocol.handle('https', () => new Response('<!doctype html><textarea>speling</textarea>', { headers: { 'content-type': 'text/html' } }));
      for (const name of ['initialized', 'download-begin', 'download-success', 'download-failure'] as const) {
        ses.on(`spellcheck-dictionary-${name}` as 'spellcheck-dictionary-initialized', (_e, lang) => g.spell.push(`${name} ${lang}`));
      }
      ses.setSpellCheckerLanguages(['en-US']);
    });
  });

  afterAll(async () => {
    await app?.close();
    rmSync(profile, { recursive: true, force: true });
  });

  it('uses the bundled US English dictionary and downloads none', async () => {
    expect(existsSync(join(profile, 'Dictionaries', 'en-US-10-1.bdic'))).toBe(true);
    await ui.locator('.tile-body button', { hasText: 'Browser' }).click();
    const address = ui.getByRole('textbox', { name: 'Address or search' });
    await address.fill('https://spell.example/');
    await address.press('Enter');
    await expect.poll(events, { timeout: 20_000 }).toContain('initialized en-US');
    expect((await events()).filter((e) => e.startsWith('download'))).toEqual([]);
  });

  it('downloads no other language: its download goes nowhere, so it fails instead of reaching Google', async () => {
    await app.evaluate(({ session }) => session.fromPartition('persist:app-browser-default').setSpellCheckerLanguages(['de-DE']));
    await expect.poll(events, { timeout: 20_000 }).toContain('download-failure de-DE');
    expect(await events()).not.toContain('download-success de-DE');
    expect(existsSync(join(profile, 'Dictionaries', 'de-DE-3-0.bdic'))).toBe(false);
  });
});
