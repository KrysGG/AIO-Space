import { DEFAULT_SEARCH_ENGINE, type SearchEngineId } from '../browser/address';
import type { WebAppDef } from '../catalog/apps';
import { createLeaf, DEFAULT_PROFILE, listLeaves, mapTree, newInstanceId } from '../layout/tree';
import { newId } from '../util/id';
import type { LayoutNode } from '../layout/types';
import { DEFAULT_PRIVACY, type PrivacySettings } from '../privacy/settings';
import { SYSTEM_THEME, type Theme } from '../ui/themes';

/**
 * Everything the user has arranged. Persisted as JSON by the platform shell.
 * Bump WORKSPACE_VERSION and add a migration in migrateWorkspace() on any shape change.
 */
export const WORKSPACE_VERSION = 17;

export interface Space {
  id: string;
  name: string;
  layout: LayoutNode;
  focusedLeafId: string | null;
}

export interface BrowserSettings {
  searchEngine: SearchEngineId;
}

/** How long a tile may stay hidden (in another space) before it's put to sleep. Null: never. */
export const SLEEP_CHOICES = [null, 5, 15, 30, 60] as const;
export type SleepAfterMinutes = (typeof SLEEP_CHOICES)[number];
export const DEFAULT_SLEEP_AFTER: SleepAfterMinutes = 30;

export interface PerformanceSettings {
  sleepAfterMinutes: SleepAfterMinutes;
}

export interface Workspace {
  version: number;
  spaces: Space[];
  activeSpaceId: string;
  privacy: PrivacySettings;
  /** Per-app privacy overrides, keyed by app id. */
  privacyOverrides: Record<string, Partial<PrivacySettings>>;
  /** Added in version 2. */
  browser: BrowserSettings;
  /** User-added apps (ROADMAP 2.7). Added in version 4. */
  customApps: WebAppDef[];
  /** Added in version 5 (ROADMAP 2.9). */
  performance: PerformanceSettings;
  /** Zoom factor per app id; missing means 100%. Added in version 6 (ROADMAP 2.10). */
  zoom: Record<string, number>;
  /** Extra accounts per app id (the first, 'default', is implicit). Added in version 7 (ROADMAP 2.12). */
  profiles: Record<string, AppProfile[]>;
  /**
   * Sites the user chose to load over plain http because they have no working https (ROADMAP 3.2):
   * exempt from the HTTPS upgrade. Added in version 9.
   */
  httpAllowedHosts: string[];
  /** One-time notices the user dismissed (ROADMAP 3.8). Added in version 10. */
  dismissedNotices: NoticeId[];
  /** Apps whose data (every account) is cleared when AIO Space closes (ROADMAP 3.9). Added in version 11. */
  forgetOnClose: string[];
  /** Interface state. Added in version 12. */
  ui: UiSettings;
  /** Twitch ad blocking (TwitchAdSolutions scripts). Added in version 14. */
  twitch: TwitchSettings;
  /** Signing in across apps. Added in version 15. */
  identity: IdentitySettings;
  /** The sidebar's app order and hidden apps (ROADMAP 4.7). Added in version 16. */
  rail: RailSettings;
  /** Themes the user imported (ROADMAP 4.1). Added in version 17. */
  themes: Theme[];
  /** The user's own CSS per app id, added to every page the app loads (ROADMAP 4.3). Added in version 17. */
  appCss: Record<string, AppCss>;
  /** Installed plugins the user turned on (ROADMAP 4.4); plugins are off until listed here. Added in version 17. */
  enabledPlugins: string[];
  /** Installed Chrome extensions turned on per app id (ROADMAP 4.5); off until listed here. Added in version 17. */
  extensions: Record<string, string[]>;
  /** Saved space layouts to start new spaces from (ROADMAP 4.6). Added in version 17. */
  templates: SpaceTemplate[];
}

/** A space's arrangement (apps, accounts, split ratios) without its pages or running instances. */
export interface SpaceTemplate {
  id: string;
  name: string;
  layout: LayoutNode;
}

export interface AppCss {
  css: string;
  /** Off keeps the CSS but stops applying it. */
  enabled: boolean;
}

export const MAX_APP_CSS = 50_000;

/** Set an app's CSS; empty CSS removes the entry. */
export function setAppCss(ws: Workspace, appId: string, value: AppCss): Workspace {
  const appCss = { ...ws.appCss };
  if (value.css.trim()) appCss[appId] = { css: value.css.slice(0, MAX_APP_CSS), enabled: value.enabled };
  else delete appCss[appId];
  return { ...ws, appCss };
}

export interface RailSettings {
  /** App ids in the order the user arranged them; apps not listed follow in catalog order. */
  order: string[];
  /** App ids hidden from the sidebar (still in the launcher, and restorable in Settings). */
  hidden: string[];
  /** App ids pinned to the top of the sidebar, above the ones that scroll (ROADMAP 4.7). Added in version 17. */
  pinned: string[];
}

/**
 * The sidebar's apps in display order: pinned first, then the rest; each group in the user's order
 * (apps not in it follow in catalog order). Hidden ones are left out.
 */
export function railApps<T extends { id: string }>(catalog: T[], rail: RailSettings): T[] {
  const rank = new Map(rail.order.map((id, i) => [id, i]));
  const hidden = new Set(rail.hidden);
  const pinned = new Set(rail.pinned);
  return catalog
    .map((app, i) => ({ app, i }))
    .filter(({ app }) => !hidden.has(app.id))
    .sort(
      (a, b) =>
        Number(pinned.has(b.app.id)) - Number(pinned.has(a.app.id)) ||
        (rank.get(a.app.id) ?? rail.order.length + a.i) - (rank.get(b.app.id) ?? rail.order.length + b.i),
    )
    .map(({ app }) => app);
}

/** Move an app up (-1) or down (+1) within its group (pinned or not); the new order is saved in full. */
export function moveInRail(ws: Workspace, catalog: Array<{ id: string }>, appId: string, delta: -1 | 1): Workspace {
  const ids = railApps(catalog, ws.rail).map((a) => a.id);
  const from = ids.indexOf(appId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length || ws.rail.pinned.includes(ids[to]!) !== ws.rail.pinned.includes(appId)) return ws;
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  return { ...ws, rail: { ...ws.rail, order: ids } };
}

/**
 * Drag and drop in the sidebar: put `appId` just before or after `targetId`, joining the target's
 * group (dropping on a pinned app pins it, on an unpinned one unpins it).
 */
export function placeInRail(ws: Workspace, catalog: Array<{ id: string }>, appId: string, targetId: string, after: boolean): Workspace {
  if (appId === targetId) return ws;
  const ids = railApps(catalog, ws.rail).map((a) => a.id);
  if (!ids.includes(appId) || !ids.includes(targetId)) return ws;
  const rest = ids.filter((id) => id !== appId);
  rest.splice(rest.indexOf(targetId) + (after ? 1 : 0), 0, appId);
  const pin = ws.rail.pinned.includes(targetId);
  const pinned = ws.rail.pinned.filter((id) => id !== appId).concat(pin ? [appId] : []);
  return { ...ws, rail: { ...ws.rail, order: rest, pinned } };
}

export function setHiddenInRail(ws: Workspace, appId: string, hidden: boolean): Workspace {
  const has = ws.rail.hidden.includes(appId);
  if (hidden === has) return ws;
  return { ...ws, rail: { ...ws.rail, hidden: hidden ? [...ws.rail.hidden, appId] : ws.rail.hidden.filter((id) => id !== appId) } };
}

/** Pin an app to the top of the sidebar (at the end of the pinned group), or unpin it. */
export function setPinnedInRail(ws: Workspace, catalog: Array<{ id: string }>, appId: string, pinned: boolean): Workspace {
  const has = ws.rail.pinned.includes(appId);
  if (pinned === has) return ws;
  const ids = railApps(catalog, ws.rail).map((a) => a.id).filter((id) => id !== appId);
  const lastPinned = ids.reduce((last, id, i) => (ws.rail.pinned.includes(id) ? i : last), -1);
  ids.splice(lastPinned + 1, 0, appId); // pinned: last of the pinned group; unpinned: first of the rest
  return {
    ...ws,
    rail: { ...ws.rail, order: ids, pinned: pinned ? [...ws.rail.pinned, appId] : ws.rail.pinned.filter((id) => id !== appId) },
  };
}

export interface IdentitySettings {
  /**
   * Share the Google account between apps (D-045): only Google's own account cookies are copied
   * between each app's first account; everything else stays in each app's container. Off by
   * default: it lets Google link these apps to one person.
   */
  shareGoogle: boolean;
}

/**
 * Which TwitchAdSolutions script blocks Twitch's stream ads (they're stitched into the video, so
 * filter lists can't): 'vaft' (recommended: switches to a clean stream as fast as it can),
 * 'video-swap-new' (older approach), or 'off'. Runs on twitch.tv while "Block ads" is on.
 */
export type TwitchAdScript = 'vaft' | 'video-swap-new' | 'off';
export const TWITCH_AD_SCRIPTS: Array<{ value: TwitchAdScript; label: string }> = [
  { value: 'vaft', label: 'vaft (recommended)' },
  { value: 'video-swap-new', label: 'video-swap-new' },
  { value: 'off', label: 'Off' },
];

export interface TwitchSettings {
  adScript: TwitchAdScript;
}

export interface UiSettings {
  /** The app rail is hidden down to a thin edge; click it or press Ctrl+Shift+B to bring it back. */
  railCollapsed: boolean;
  /**
   * Instant transitions, no glass blur, no page snapshots while views are hidden: saves CPU and GPU.
   * Added in version 13.
   */
  reduceMotion: boolean;
  /** Theme id, or 'system' to follow the desktop's light/dark setting (ROADMAP 4.1). Added in version 17. */
  theme: string;
}

/** Notices shown until dismissed, e.g. 'weak-keyring': logins stored without the system keyring. */
export const NOTICE_IDS = ['weak-keyring'] as const;
export type NoticeId = (typeof NOTICE_IDS)[number];

export function dismissNotice(ws: Workspace, id: NoticeId): Workspace {
  return ws.dismissedNotices.includes(id) ? ws : { ...ws, dismissedNotices: [...ws.dismissedNotices, id] };
}

/** Turn "forget when AIO Space closes" on or off for an app (ROADMAP 3.9). */
export function setForgetOnClose(ws: Workspace, appId: string, forget: boolean): Workspace {
  const has = ws.forgetOnClose.includes(appId);
  if (forget === has) return ws;
  return { ...ws, forgetOnClose: forget ? [...ws.forgetOnClose, appId] : ws.forgetOnClose.filter((id) => id !== appId) };
}

export interface AppProfile {
  id: string;
  name: string;
}

export function defaultWorkspace(): Workspace {
  const leaf = createLeaf(null);
  return {
    version: WORKSPACE_VERSION,
    spaces: [{ id: 'space_main', name: 'Main', layout: leaf, focusedLeafId: leaf.id }],
    activeSpaceId: 'space_main',
    privacy: { ...DEFAULT_PRIVACY },
    privacyOverrides: {},
    browser: { searchEngine: DEFAULT_SEARCH_ENGINE },
    customApps: [],
    performance: { sleepAfterMinutes: DEFAULT_SLEEP_AFTER },
    zoom: {},
    profiles: {},
    httpAllowedHosts: [],
    dismissedNotices: [],
    forgetOnClose: [],
    ui: { railCollapsed: false, reduceMotion: false, theme: SYSTEM_THEME },
    twitch: { adScript: 'vaft' },
    identity: { shareGoogle: false },
    rail: { order: [], hidden: [], pinned: [] },
    themes: [],
    appCss: {},
    enabledPlugins: [],
    templates: [],
    extensions: {},
  };
}

/** Built-in apps plus the user's own. */
export function catalogOf(ws: Workspace, builtins: WebAppDef[]): WebAppDef[] {
  return [...builtins, ...ws.customApps];
}

export function activeSpace(ws: Workspace): Space {
  return ws.spaces.find((s) => s.id === ws.activeSpaceId) ?? ws.spaces[0]!;
}

export function updateActiveSpace(ws: Workspace, fn: (s: Space) => Space): Workspace {
  const id = activeSpace(ws).id;
  return { ...ws, spaces: ws.spaces.map((s) => (s.id === id ? fn(s) : s)) };
}

/** Keep focus valid after layout edits. */
export function ensureFocus(space: Space): Space {
  const leaves = listLeaves(space.layout);
  if (space.focusedLeafId && leaves.some((l) => l.id === space.focusedLeafId)) return space;
  return { ...space, focusedLeafId: leaves[0]?.id ?? null };
}

/** Versions migrateWorkspace() can upgrade (or load as-is). */
export function isSupportedWorkspaceVersion(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= WORKSPACE_VERSION;
}

/**
 * Upgrade older saved workspaces, one version at a time. Unknown/newer versions fall back to
 * defaults. The result is still untrusted: the shell validates it afterwards.
 */
export function migrateWorkspace(raw: unknown): Workspace {
  if (!raw || typeof raw !== 'object') return defaultWorkspace();
  let w = raw as Record<string, unknown>;
  if (!isSupportedWorkspaceVersion(w['version'])) return defaultWorkspace();
  if (w['version'] === 1) w = { ...w, version: 2, browser: { searchEngine: DEFAULT_SEARCH_ENGINE } };
  if (w['version'] === 2) w = { ...w, version: 3, spaces: addInstanceIds(w['spaces']) };
  if (w['version'] === 3) w = { ...w, version: 4, customApps: [] };
  if (w['version'] === 4) w = { ...w, version: 5, performance: { sleepAfterMinutes: DEFAULT_SLEEP_AFTER } };
  if (w['version'] === 5) w = { ...w, version: 6, zoom: {} };
  if (w['version'] === 6) w = { ...w, version: 7, profiles: {} };
  if (w['version'] === 7) {
    const privacy = (w['privacy'] && typeof w['privacy'] === 'object' ? w['privacy'] : {}) as Record<string, unknown>;
    w = { ...w, version: 8, privacy: { ...privacy, shields: true } };
  }
  if (w['version'] === 8) w = { ...w, version: 9, httpAllowedHosts: [] };
  if (w['version'] === 9) w = { ...w, version: 10, dismissedNotices: [] };
  if (w['version'] === 10) w = { ...w, version: 11, forgetOnClose: [] };
  if (w['version'] === 11) w = { ...w, version: 12, ui: { railCollapsed: false } };
  if (w['version'] === 12) {
    const ui = (w['ui'] && typeof w['ui'] === 'object' ? w['ui'] : {}) as Record<string, unknown>;
    w = { ...w, version: 13, ui: { ...ui, reduceMotion: false } };
  }
  if (w['version'] === 13) w = { ...w, version: 14, twitch: { adScript: 'vaft' } };
  if (w['version'] === 14) w = { ...w, version: 15, identity: { shareGoogle: false } };
  if (w['version'] === 15) w = { ...w, version: 16, rail: { order: [], hidden: [] } };
  if (w['version'] === 16) {
    const ui = (w['ui'] && typeof w['ui'] === 'object' ? w['ui'] : {}) as Record<string, unknown>;
    const rail = (w['rail'] && typeof w['rail'] === 'object' ? w['rail'] : {}) as Record<string, unknown>;
    w = { ...w, version: 17, ui: { ...ui, theme: SYSTEM_THEME }, rail: { ...rail, pinned: [] }, themes: [], appCss: {}, enabledPlugins: [], templates: [], extensions: {} };
  }
  return w as unknown as Workspace;
}

/** v2 -> v3: every tile with an app gets a running-instance id. Leaves bad shapes for validation. */
function addInstanceIds(spaces: unknown): unknown {
  if (!Array.isArray(spaces)) return spaces;
  const walk = (n: unknown): unknown => {
    if (!n || typeof n !== 'object') return n;
    const node = n as Record<string, unknown>;
    if (node['type'] === 'leaf') return { ...node, instanceId: node['appId'] ? newInstanceId() : null };
    if (node['type'] === 'split') return { ...node, first: walk(node['first']), second: walk(node['second']) };
    return n;
  };
  return spaces.map((s: unknown) =>
    s && typeof s === 'object' ? { ...(s as Record<string, unknown>), layout: walk((s as Record<string, unknown>)['layout']) } : s,
  );
}

/* ---- Spaces (ROADMAP 2.8): each is its own layout; the others keep running in the background. ---- */

export const MAX_SPACES = 20;
export const MAX_SPACE_NAME = 40;

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, MAX_SPACE_NAME);
}

/** "Space 2", "Space 3"... the first number not in use. */
function nextSpaceName(ws: Workspace): string {
  const names = new Set(ws.spaces.map((s) => s.name));
  for (let i = ws.spaces.length + 1; ; i++) if (!names.has(`Space ${i}`)) return `Space ${i}`;
}

/** Add a space with one empty tile and switch to it. No-op at MAX_SPACES. */
export function addSpace(ws: Workspace, name?: string): Workspace {
  if (ws.spaces.length >= MAX_SPACES) return ws;
  const leaf = createLeaf(null);
  const space: Space = { id: newId('space'), name: cleanName(name ?? '') || nextSpaceName(ws), layout: leaf, focusedLeafId: leaf.id };
  return { ...ws, spaces: [...ws.spaces, space], activeSpaceId: space.id };
}

export function renameSpace(ws: Workspace, spaceId: string, name: string): Workspace {
  const clean = cleanName(name);
  if (!clean) return ws;
  return { ...ws, spaces: ws.spaces.map((s) => (s.id === spaceId ? { ...s, name: clean } : s)) };
}

export function switchSpace(ws: Workspace, spaceId: string): Workspace {
  return ws.spaces.some((s) => s.id === spaceId) ? { ...ws, activeSpaceId: spaceId } : ws;
}

/** Remove a space (never the last). Removing the active one switches to its neighbour. */
export function removeSpace(ws: Workspace, spaceId: string): Workspace {
  const i = ws.spaces.findIndex((s) => s.id === spaceId);
  if (i < 0 || ws.spaces.length <= 1) return ws;
  const spaces = ws.spaces.filter((s) => s.id !== spaceId);
  const activeSpaceId = ws.activeSpaceId === spaceId ? spaces[Math.min(i, spaces.length - 1)]!.id : ws.activeSpaceId;
  return { ...ws, spaces, activeSpaceId };
}

/** Turn an installed plugin on or off (ROADMAP 4.4). */
export function setPluginEnabled(ws: Workspace, pluginId: string, on: boolean): Workspace {
  const has = ws.enabledPlugins.includes(pluginId);
  if (on === has) return ws;
  return { ...ws, enabledPlugins: on ? [...ws.enabledPlugins, pluginId] : ws.enabledPlugins.filter((id) => id !== pluginId) };
}

/** Turn an installed extension on or off for one app (ROADMAP 4.5). */
export function setExtensionEnabled(ws: Workspace, appId: string, extensionId: string, on: boolean): Workspace {
  const now = ws.extensions[appId] ?? [];
  if (on === now.includes(extensionId)) return ws;
  const next = on ? [...now, extensionId] : now.filter((id) => id !== extensionId);
  const extensions = { ...ws.extensions, [appId]: next };
  if (next.length === 0) delete extensions[appId];
  return { ...ws, extensions };
}

/** An uninstalled extension is turned off everywhere. */
export function forgetExtension(ws: Workspace, extensionId: string): Workspace {
  return Object.keys(ws.extensions).reduce((w, appId) => setExtensionEnabled(w, appId, extensionId, false), ws);
}

/* ---- Templates (ROADMAP 4.6) --------------------------------------------------------------- */

export const MAX_TEMPLATES = 20;

/**
 * The same arrangement with new ids for every tile, split and running app, so it can sit next to
 * the original (instance ids must be unique across spaces). Browser tabs are dropped: a Browser tile
 * starts on its home page.
 */
export function freshLayout(layout: LayoutNode): LayoutNode {
  return mapTree(layout, (n) => {
    if (n.type === 'split') return { ...n, id: newId('split') };
    const leaf = { ...n, id: newId('leaf'), instanceId: n.appId ? newInstanceId() : null };
    delete leaf.tabs;
    return leaf;
  });
}

/** Save a space's arrangement as a template (named like the space). No-op at MAX_TEMPLATES. */
export function saveTemplate(ws: Workspace, spaceId: string): Workspace {
  const space = ws.spaces.find((s) => s.id === spaceId);
  if (!space || ws.templates.length >= MAX_TEMPLATES) return ws;
  return { ...ws, templates: [...ws.templates, { id: newId('tpl'), name: space.name, layout: freshLayout(space.layout) }] };
}

export function removeTemplate(ws: Workspace, templateId: string): Workspace {
  return { ...ws, templates: ws.templates.filter((t) => t.id !== templateId) };
}

/** Add a space laid out like a template, and switch to it. */
export function addSpaceFromTemplate(ws: Workspace, templateId: string): Workspace {
  const template = ws.templates.find((t) => t.id === templateId);
  if (!template || ws.spaces.length >= MAX_SPACES) return ws;
  const layout = freshLayout(template.layout);
  const taken = new Set(ws.spaces.map((s) => s.name));
  let name = template.name;
  for (let n = 2; taken.has(name); n++) name = `${template.name.slice(0, MAX_SPACE_NAME - 4)} ${n}`;
  const space: Space = { id: newId('space'), name, layout, focusedLeafId: listLeaves(layout)[0]?.id ?? null };
  return { ...ws, spaces: [...ws.spaces, space], activeSpaceId: space.id };
}

/* ---- Accounts per app (ROADMAP 2.12) ------------------------------------------------------- */

export const MAX_PROFILES_PER_APP = 8;

/** Every account of an app, the implicit first one included. */
export function profilesOf(ws: Workspace, appId: string): AppProfile[] {
  return [{ id: DEFAULT_PROFILE, name: 'Account 1' }, ...(ws.profiles[appId] ?? [])];
}

/** Add an account ("Account N") to an app; returns its id (null at the limit). */
export function addProfile(ws: Workspace, appId: string): { ws: Workspace; profileId: string | null } {
  const all = profilesOf(ws, appId);
  if (all.length >= MAX_PROFILES_PER_APP) return { ws, profileId: null };
  const ids = new Set(all.map((p) => p.id));
  let n = 2;
  while (ids.has(`p${n}`)) n++;
  const profile: AppProfile = { id: `p${n}`, name: `Account ${n}` };
  return { ws: { ...ws, profiles: { ...ws.profiles, [appId]: [...(ws.profiles[appId] ?? []), profile] } }, profileId: profile.id };
}

/* ---- Sites allowed over plain http (ROADMAP 3.2) ------------------------------------------- */

export const MAX_HTTP_ALLOWED = 200;

export function allowHttpHost(ws: Workspace, host: string): Workspace {
  const h = host.toLowerCase();
  if (!h || ws.httpAllowedHosts.includes(h) || ws.httpAllowedHosts.length >= MAX_HTTP_ALLOWED) return ws;
  return { ...ws, httpAllowedHosts: [...ws.httpAllowedHosts, h] };
}

export function disallowHttpHost(ws: Workspace, host: string): Workspace {
  return { ...ws, httpAllowedHosts: ws.httpAllowedHosts.filter((h) => h !== host) };
}
