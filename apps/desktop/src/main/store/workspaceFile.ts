import { promises as fs } from 'node:fs';
import { isSupportedWorkspaceVersion, migrateWorkspace, type Workspace } from '@aio/core';
import type { WorkspaceFileResult } from '../../shared/ipc';
import { WorkspaceSchema } from '../ipc/schemas';

/** Workspace files are small; anything bigger isn't one. */
export const MAX_WORKSPACE_FILE = 5_000_000;

/**
 * Export (ROADMAP 4.6): the saved workspace as it is on disk (layouts, apps, settings). Logins,
 * cookies and site data live in the session partitions and are never part of it.
 */
export async function exportWorkspace(ws: Workspace, file: string): Promise<WorkspaceFileResult> {
  try {
    await fs.writeFile(file, JSON.stringify(ws, null, 2), { encoding: 'utf8', mode: 0o600 });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `Couldn’t write the file (${err instanceof Error ? err.message : String(err)}). Pick another folder.`,
    };
  }
}

/** Import: migrated from older versions and validated exactly like workspace.json at startup. */
export async function importWorkspace(file: string): Promise<WorkspaceFileResult<Workspace>> {
  let raw: unknown;
  try {
    const stat = await fs.stat(file);
    if (stat.size > MAX_WORKSPACE_FILE)
      return { ok: false, error: 'This file is too big to be an AIO Space workspace.' };
    raw = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return {
      ok: false,
      error: 'Couldn’t read this file as JSON. Pick a workspace file exported from AIO Space.',
    };
  }
  const version =
    raw && typeof raw === 'object' ? (raw as { version?: unknown }).version : undefined;
  if (typeof version !== 'number')
    return { ok: false, error: 'This isn’t an AIO Space workspace file.' };
  // migrateWorkspace() falls back to defaults for versions it can't read; an import must say so instead.
  if (!isSupportedWorkspaceVersion(version))
    return {
      ok: false,
      error: 'This workspace is from a newer AIO Space. Update AIO Space and try again.',
    };
  const parsed = WorkspaceSchema.safeParse(migrateWorkspace(raw));
  if (!parsed.success)
    return { ok: false, error: 'This workspace file is damaged, so nothing was changed.' };
  return { ok: true, workspace: parsed.data };
}
