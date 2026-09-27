import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TwitchAdScript } from '@aio/core';
import vaftBundled from '../../../vendor/twitch-ad-solutions/vaft.user.js?raw';
import videoSwapBundled from '../../../vendor/twitch-ad-solutions/video-swap-new.user.js?raw';

/**
 * Twitch ad blocking (D-043) with TwitchAdSolutions (MIT, github.com/ryanbr/TwitchAdSolutions).
 * Twitch stitches ads into the stream, which filter lists can't touch; these userscripts hook the
 * player's worker and switch to an ad-free stream (vaft) or drop ad segments. They run at document
 * start in twitch.tv pages' own world through the scriptlet preload (D-041). A bundled copy works
 * offline; Twitch changes often, so fresh copies are fetched daily from the same repository and used
 * only if they still look like these userscripts.
 */
export type TwitchScriptName = Exclude<TwitchAdScript, 'off'>;

const REPO = 'https://raw.githubusercontent.com/ryanbr/TwitchAdSolutions/master';
export const TWITCH_SCRIPT_URLS: Record<TwitchScriptName, string> = {
  vaft: `${REPO}/vaft/vaft.user.js`,
  'video-swap-new': `${REPO}/video-swap-new/video-swap-new.user.js`,
};
const BUNDLED: Record<TwitchScriptName, string> = { vaft: vaftBundled, 'video-swap-new': videoSwapBundled };
const NAMES = Object.keys(TWITCH_SCRIPT_URLS) as TwitchScriptName[];
const DAY_MS = 24 * 60 * 60 * 1000;

/** A download is used only if it's still a page-world userscript for twitch.tv of sane size. */
export function isTwitchUserscript(text: string): boolean {
  if (text.length < 1000 || text.length > 2_000_000 || !text.startsWith('// ==UserScript==')) return false;
  const header = text.slice(0, text.indexOf('// ==/UserScript==') + 1);
  return /@match\s+\*:\/\/\*\.twitch\.tv\/\*/.test(header) && /@grant\s+none/.test(header) && /@run-at\s+document-start/.test(header);
}

export class TwitchScripts {
  private readonly code: Record<TwitchScriptName, string> = { ...BUNDLED };
  onUpdated: () => void = () => {};

  constructor(
    private readonly dir: string,
    private readonly fetchText: (url: string) => Promise<string>,
  ) {}

  /** Code to run on twitch.tv for the chosen script ([] when off). */
  scriptsFor(choice: TwitchAdScript): string[] {
    return choice === 'off' ? [] : [this.code[choice]];
  }

  /** Use cached downloads if present, then refresh them when older than a day. */
  async start(): Promise<void> {
    let stale = false;
    for (const name of NAMES) {
      const file = join(this.dir, `${name}.user.js`);
      try {
        const text = await readFile(file, 'utf8');
        if (isTwitchUserscript(text)) this.code[name] = text;
        if (Date.now() - (await stat(file)).mtimeMs > DAY_MS) stale = true;
      } catch {
        stale = true;
      }
    }
    if (stale) void this.update();
    setInterval(() => void this.update(), DAY_MS).unref();
  }

  async update(): Promise<void> {
    let changed = false;
    for (const name of NAMES) {
      try {
        const text = await this.fetchText(TWITCH_SCRIPT_URLS[name]);
        if (!isTwitchUserscript(text)) throw new Error('not the expected userscript');
        await mkdir(this.dir, { recursive: true });
        const file = join(this.dir, `${name}.user.js`);
        await writeFile(`${file}.tmp`, text, { mode: 0o600 });
        await rename(`${file}.tmp`, file);
        if (this.code[name] !== text) changed = true;
        this.code[name] = text;
      } catch (err) {
        console.warn(`[twitch] keeping the current ${name}:`, err instanceof Error ? err.message : err);
      }
    }
    if (changed) this.onUpdated();
  }
}
