import { DEFAULT_SEARCH_ENGINE, type SearchEngineId } from '../browser/address';
import { createLeaf, listLeaves } from '../layout/tree';
import type { LayoutNode } from '../layout/types';
import { DEFAULT_PRIVACY, type PrivacySettings } from '../privacy/settings';

/**
 * Everything the user has arranged. Persisted as JSON by the platform shell.
 * Bump WORKSPACE_VERSION and add a migration in migrateWorkspace() on any shape change.
 */
export const WORKSPACE_VERSION = 2;

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
  };
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
  return w as unknown as Workspace;
}
