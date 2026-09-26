import { DEFAULT_SEARCH_ENGINE, type SearchEngineId } from '../browser/address';
import type { WebAppDef } from '../catalog/apps';
import { createLeaf, listLeaves, newInstanceId } from '../layout/tree';
import { newId } from '../util/id';
import type { LayoutNode } from '../layout/types';
import { DEFAULT_PRIVACY, type PrivacySettings } from '../privacy/settings';

/**
 * Everything the user has arranged. Persisted as JSON by the platform shell.
 * Bump WORKSPACE_VERSION and add a migration in migrateWorkspace() on any shape change.
 */
export const WORKSPACE_VERSION = 4;

export interface Space {
  id: string;
  name: string;
  layout: LayoutNode;
  focusedLeafId: string | null;
}

export interface BrowserSettings {
  searchEngine: SearchEngineId;
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
