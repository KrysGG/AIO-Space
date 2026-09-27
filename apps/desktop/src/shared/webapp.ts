/**
 * Settings main hands to the web app preload (ROADMAP 3.4) through `additionalArguments`: web views
 * have no IPC, so the command line is the only channel, fixed when the view is created.
 */
export type FingerprintLevel = 'off' | 'standard' | 'strict';

export interface WebAppArgs {
  fingerprinting: FingerprintLevel;
  gpc: boolean;
  /** "Block ads" is on: the session's scriptlet preload runs (ROADMAP 3.6). */
  ads: boolean;
  /** Random per app session and run (hex): seeds the noise. */
  key: string;
}

const PREFIX = '--aio-webapp=';

export function webAppArgs(args: WebAppArgs): string[] {
  return [`${PREFIX}${args.fingerprinting},${args.gpc ? 1 : 0},${args.key},${args.ads ? 1 : 0}`];
}

/** Anything missing or malformed means no protection changes, never a broken page. */
export function parseWebAppArgs(argv: readonly string[]): WebAppArgs {
  const raw = argv.find((a) => a.startsWith(PREFIX))?.slice(PREFIX.length) ?? '';
  const [level, gpc, key, ads] = raw.split(',');
  const fingerprinting: FingerprintLevel = level === 'standard' || level === 'strict' ? level : 'off';
  return { fingerprinting, gpc: gpc === '1', key: /^[0-9a-f]{8,64}$/.test(key ?? '') ? key! : '0', ads: ads === '1' };
}

/** Media reports from the page-world script, on the console: `<prefix><key>:<mic><camera><screen>`. */
export const MEDIA_REPORT = '\u2063aio-media:';

export interface MediaInUse {
  mic: boolean;
  camera: boolean;
  screen: boolean;
}

export const NO_MEDIA: MediaInUse = { mic: false, camera: false, screen: false };

/** A report from this view's script, or null (another message, or someone without the key). */
export function parseMediaReport(message: string, key: string): MediaInUse | null {
  if (!message.startsWith(MEDIA_REPORT)) return null;
  const m = /^([0-9a-f]+):([01])([01])([01])$/.exec(message.slice(MEDIA_REPORT.length));
  if (!m || m[1] !== key) return null;
  return { mic: m[2] === '1', camera: m[3] === '1', screen: m[4] === '1' };
}

/**
 * Identity providers' sign-in pages (hosts they hop between during a login). The app's own page
 * scripts (fingerprinting, media tracking, scriptlets) never run there: their bot checks treat
 * wrapped browser functions as an unsafe browser ("Couldn't sign you in", D-046).
 */
export const SIGN_IN_HOSTS = [
  // Google (accounts.youtube.com sets YouTube's cookie during a Google login).
  'accounts.google.com',
  'accounts.youtube.com',
  'myaccount.google.com',
  'gds.google.com',
  // Apple
  'appleid.apple.com',
  'idmsa.apple.com',
  // Microsoft
  'login.microsoftonline.com',
  'login.live.com',
  'account.live.com',
];

/** A sign-in provider's page (host or subdomain of SIGN_IN_HOSTS). */
export function isSignInHost(host: string): boolean {
  const h = host.toLowerCase();
  return SIGN_IN_HOSTS.some((s) => h === s || h.endsWith(`.${s}`));
}
