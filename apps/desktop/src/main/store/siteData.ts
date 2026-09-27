import { session } from 'electron';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BUILTIN_APPS, partitionFor, profilesOf, type Workspace } from '@aio/core';
import { withoutSignInSync } from '../sessions/sharedSignIn';

/**
 * Clearing app data (ROADMAP 3.9). Clearing works in two parts:
 * 1. now: the session's cookies, storage, caches and auth are cleared, so the account is logged out
 *    at once (Chromium's databases may keep deleted bytes until they compact);
 * 2. next start: the account's whole partition folder is deleted before any session opens, so nothing
 *    is left on disk. Folders to delete are listed in `wipe.json`; apps set to "forget when SpaceAIO
 *    closes" are always deleted at start too, which also covers a crash before quit.
 */
const WIPE_FILE = 'wipe.json';

/** Chromium stores `persist:<name>` under `Partitions/<name>`. */
export function partitionDir(userData: string, partition: string): string {
  return join(userData, 'Partitions', partition.replace(/^persist:/, ''));
}

/** Every partition an app's accounts use. */
export function partitionsOfApp(ws: Workspace, appId: string): string[] {
  return profilesOf(ws, appId).map((p) => partitionFor(appId, p.id));
}

/** Every app partition the workspace knows (built-in and custom apps, all accounts). */
export function allAppPartitions(ws: Workspace): string[] {
  const ids = [...BUILTIN_APPS.map((a) => a.id), ...ws.customApps.map((a) => a.id)];
  return ids.flatMap((id) => partitionsOfApp(ws, id));
}

/** Clear one partition's data now (step 1 above). */
export async function clearPartitionNow(partition: string): Promise<void> {
  const ses = session.fromPartition(partition);
  // Clearing one app isn't a Google sign-out for the others (shared sign-in, D-045).
  await withoutSignInSync(ses, async () => {
    await Promise.allSettled([
      ses.clearStorageData(),
      ses.clearCache(),
      ses.clearAuthCache(),
      ses.clearCodeCaches({}),
      ses.clearHostResolverCache(),
    ]);
  });
  ses.flushStorageData();
}

async function readWipeList(userData: string): Promise<string[]> {
  try {
    const list: unknown = JSON.parse(await readFile(join(userData, WIPE_FILE), 'utf8'));
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string' && p.startsWith('persist:app-')) : [];
  } catch {
    return [];
  }
}

/** Queue partitions for deletion at the next start (step 2 above). */
export async function scheduleWipe(userData: string, partitions: string[]): Promise<void> {
  const list = new Set([...(await readWipeList(userData)), ...partitions]);
  await writeFile(join(userData, WIPE_FILE), JSON.stringify([...list]), { mode: 0o600 });
}

/** Clear partitions now and delete their folders at the next start. */
export async function clearPartitions(userData: string, partitions: string[]): Promise<void> {
  await scheduleWipe(userData, partitions);
  await Promise.all(partitions.map((p) => clearPartitionNow(p)));
}

/**
 * At startup, BEFORE any app session is created: delete queued partition folders and those of apps
 * set to forget on close. Returns the folders that were deleted.
 */
export async function wipeAtStartup(userData: string, ws: Workspace): Promise<string[]> {
  const partitions = new Set([...(await readWipeList(userData)), ...ws.forgetOnClose.flatMap((id) => partitionsOfApp(ws, id))]);
  const deleted: string[] = [];
  for (const p of partitions) {
    const dir = partitionDir(userData, p);
    await rm(dir, { recursive: true, force: true });
    deleted.push(dir);
  }
  await rm(join(userData, WIPE_FILE), { force: true });
  return deleted;
}
