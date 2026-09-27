import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';

vi.mock('electron', () => ({ session: {} }));
const { isGoogleAccountCookie, sharesSignIn } = await import('../src/main/sessions/sharedSignIn');

describe('shared Google sign-in: what is shared (D-045)', () => {
  it('only Google’s own cookies', () => {
    for (const domain of ['.google.com', 'accounts.google.com', 'myaccount.google.com', '.google.co.uk', '.google.de', '.google.com.br']) {
      expect(isGoogleAccountCookie({ domain }), domain).toBe(true);
    }
    for (const domain of ['.youtube.com', 'discord.com', '.notgoogle.com', 'google.com.evil.net', '.twitch.tv']) {
      expect(isGoogleAccountCookie({ domain }), domain).toBe(false);
    }
  });

  it('only each app’s first account', () => {
    expect(sharesSignIn('persist:app-youtube-default')).toBe(true);
    expect(sharesSignIn('persist:app-custom-notion-ab12cd-default')).toBe(true);
    expect(sharesSignIn('persist:app-youtube-p2')).toBe(false);
    expect(sharesSignIn('persist:aio-filter-lists')).toBe(false);
  });
});

describe('shared Google sign-in in the app', () => {
  const profile = mkdtempSync(join(tmpdir(), 'aio-shared-'));
  let app: ElectronApplication;
  let ui: Page;

  type Probe = { part: string; name: string };
  const has = ({ part, name }: Probe) =>
    app.evaluate(async ({ session }, [p, n]) => (await session.fromPartition(p as string).cookies.get({ name: n as string })).length > 0, [part, name] as const);
  const setIn = (part: string, name: string, url = 'https://accounts.google.com/', domain: string | undefined = '.google.com') =>
    app.evaluate(async ({ session }, [p, n, u, d]) => {
      await session.fromPartition(p as string).cookies.set({ url: u as string, name: n as string, value: 'v1', ...(d ? { domain: d as string } : {}), expirationDate: Date.now() / 1000 + 3600 });
    }, [part, name, url, domain ?? ''] as const);
  const waitFor = async (probe: () => Promise<boolean>, want: boolean): Promise<void> => {
    const end = Date.now() + 10_000;
    while ((await probe()) !== want) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${want}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const openApp = async (name: string) => {
    await ui.getByRole('button', { name: `Open ${name}` }).click();
    await new Promise((r) => setTimeout(r, 500));
  };

  beforeAll(async () => {
    app = await electron.launch({ args: [join(__dirname, '..')], env: { ...process.env, AIO_USER_DATA_DIR: profile, ELECTRON_RENDERER_URL: '' } });
    ui = await app.firstWindow();
    await ui.locator('.tile').first().waitFor();
    await openApp('YouTube');
    await ui.locator('.tile').first().getByRole('button', { name: 'Split right' }).click();
    await openApp('Twitch');
  });

  afterAll(async () => {
    await app?.close();
    rmSync(profile, { recursive: true, force: true });
  });

  const YT = 'persist:app-youtube-default';
  const TW = 'persist:app-twitch-default';

  it('does nothing while the setting is off', async () => {
    await setIn(YT, 'SID_OFF');
    await new Promise((r) => setTimeout(r, 800));
    expect(await has({ part: TW, name: 'SID_OFF' })).toBe(false);
  });

  it('signing in to Google in one app signs the others in; other cookies stay put', async () => {
    await ui.locator('.rail-menu').click();
    await ui.locator('.shield-switch', { hasText: 'Share Google sign-in between apps' }).locator('input').check();
    await ui.keyboard.press('Escape');
    // Turning it on pools what open apps already had.
    await waitFor(() => has({ part: TW, name: 'SID_OFF' }), true);

    await setIn(TW, 'SID');
    await waitFor(() => has({ part: YT, name: 'SID' }), true);
    await setIn(TW, 'twitch_session', 'https://www.twitch.tv/', '.twitch.tv');
    await new Promise((r) => setTimeout(r, 800));
    expect(await has({ part: YT, name: 'twitch_session' })).toBe(false);
  });

  it('an app opened later starts signed in; extra accounts stay separate', async () => {
    await ui.getByRole('button', { name: 'Split focused tile down' }).click();
    await openApp('Discord');
    await waitFor(() => has({ part: 'persist:app-discord-default', name: 'SID' }), true);
    expect(await has({ part: 'persist:app-youtube-p2', name: 'SID' })).toBe(false);
  });

  it('clearing one app’s data doesn’t sign the others out', async () => {
    await ui.evaluate(() => window.aio.clearData({ appId: 'youtube', profile: 'default' }));
    await waitFor(() => has({ part: YT, name: 'SID' }), false);
    await new Promise((r) => setTimeout(r, 800));
    expect(await has({ part: TW, name: 'SID' })).toBe(true);
  });

  it('signing out in one app signs them all out', async () => {
    await app.evaluate(async ({ session }, p) => session.fromPartition(p as string).cookies.remove('https://google.com/', 'SID'), TW);
    await waitFor(() => has({ part: 'persist:app-discord-default', name: 'SID' }), false);
  });
});
