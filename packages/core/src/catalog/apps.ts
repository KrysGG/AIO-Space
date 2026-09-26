/**
 * Built-in web apps. Users will be able to add their own in Phase 2 (step 2.7).
 * Each app gets its own isolated, persistent session partition so logins and
 * cookies never leak between services.
 */

/** Permissions a web app may request. Anything not listed is denied. */
export type AppPermission =
  | 'media' // camera / microphone (voice & video calls)
  | 'notifications'
  | 'fullscreen'
  | 'clipboard-sanitized-write'
  | 'display-capture'; // screen share

export interface WebAppDef {
  id: string;
  name: string;
  /** Start URL. Must be https. */
  url: string;
  /** 'browser' tiles get an address bar and may navigate anywhere. */
  kind: 'app' | 'browser';
  /** Hostnames (and their subdomains) the app may navigate to inside its tile. */
  allowedHosts: string[];
  /** Hostnames allowed to open as popup windows (OAuth / sign-in flows). */
  popupHosts: string[];
  permissions: AppPermission[];
  /** Short text glyph, shown when there's no icon. */
  glyph: string;
  /** Custom apps: the site's favicon as a data: URL, fetched once through the app's own session. */
  icon?: string;
}

export const BUILTIN_APPS: WebAppDef[] = [
  {
    id: 'discord',
    name: 'Discord',
    url: 'https://discord.com/app',
    kind: 'app',
    allowedHosts: ['discord.com', 'discordapp.com', 'discord.gg'],
    popupHosts: ['discord.com'],
    permissions: ['media', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'display-capture'],
    glyph: 'Dc',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    url: 'https://www.youtube.com',
    kind: 'app',
    allowedHosts: ['youtube.com', 'youtu.be', 'google.com', 'accounts.google.com'],
    popupHosts: ['accounts.google.com'],
    permissions: ['fullscreen', 'clipboard-sanitized-write'],
    glyph: 'Yt',
  },
  {
    id: 'reddit',
    name: 'Reddit',
    url: 'https://www.reddit.com',
    kind: 'app',
    allowedHosts: ['reddit.com', 'redd.it'],
    popupHosts: ['accounts.google.com', 'appleid.apple.com'],
    permissions: ['fullscreen', 'notifications', 'clipboard-sanitized-write'],
    glyph: 'Rd',
  },
  {
    id: 'x',
    name: 'X',
    url: 'https://x.com',
    kind: 'app',
    allowedHosts: ['x.com', 'twitter.com', 't.co'],
    popupHosts: ['accounts.google.com', 'appleid.apple.com'],
    permissions: ['fullscreen', 'notifications', 'clipboard-sanitized-write'],
    glyph: 'X',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    url: 'https://www.instagram.com',
    kind: 'app',
    allowedHosts: ['instagram.com', 'facebook.com'],
    popupHosts: ['facebook.com'],
    permissions: ['fullscreen', 'notifications', 'clipboard-sanitized-write'],
    glyph: 'Ig',
  },
  {
    id: 'browser',
    name: 'Browser',
    url: 'https://duckduckgo.com',
    kind: 'browser',
    allowedHosts: ['*'],
    popupHosts: ['*'],
    permissions: ['fullscreen', 'clipboard-sanitized-write'],
    glyph: 'Br',
  },
];

export function getApp(id: string, catalog: WebAppDef[] = BUILTIN_APPS): WebAppDef | undefined {
  return catalog.find((a) => a.id === id);
}

/** Session partition name for an app. `profile` enables multiple accounts per app later. */
export function partitionFor(appId: string, profile = 'default'): string {
  return `persist:app-${appId}-${profile}`;
}

/** True if `host` equals one of `hosts` or is a subdomain of one. '*' matches everything. */
export function hostMatches(host: string, hosts: string[]): boolean {
  const h = host.toLowerCase();
  return hosts.some((allowed) => allowed === '*' || h === allowed || h.endsWith(`.${allowed}`));
}
