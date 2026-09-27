import { DEFAULT_SEARCH_ENGINE, type SearchEngineId } from '../browser/address';
import type { WebAppDef } from '../catalog/apps';
import { createLeaf, DEFAULT_PROFILE, listLeaves, newInstanceId } from '../layout/tree';
import { newId } from '../util/id';
import type { LayoutNode } from '../layout/types';
import { DEFAULT_PRIVACY, type PrivacySettings } from '../privacy/settings';

/**
 * Everything the user has arranged. Persisted as JSON by the platform shell.
 * Bump WORKSPACE_VERSION and add a migration in migrateWorkspace() on any shape change.
 */
export const WORKSPACE_VERSION = 13;

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
}

export interface UiSettings {
  /** The app rail is hidden down to a thin edge; click it or press Ctrl+Shift+B to bring it back. */
  railCollapsed: boolean;
  /**
   * Instant transitions, no glass blur, no page snapshots while views are hidden: saves CPU and GPU.
   * Added in version 13.
   */
  reduceMotion: boolean;
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
    ui: { railCollapsed: false, reduceMotion: false },
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
