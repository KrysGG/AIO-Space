import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import {
  defaultWorkspace,
  migrateWorkspace,
  resolvePrivacy,
  type PrivacySettings,
  type Workspace,
} from '@aio/core';
import { WorkspaceSchema } from '../ipc/schemas';

/**
 * Holds the workspace in memory and persists it to userData/workspace.json.
 * Writes are atomic (tmp + rename) and serialized so a crash never leaves a half file.
 */
export class WorkspaceStore {
  private ws: Workspace = defaultWorkspace();
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.file, 'utf8'));
      const parsed = WorkspaceSchema.safeParse(migrateWorkspace(raw));
      this.ws = parsed.success ? parsed.data : defaultWorkspace();
      if (!parsed.success) console.warn('[store] invalid workspace, using defaults', parsed.error.issues);
    } catch {
      this.ws = defaultWorkspace();
    }
  }

  get(): Workspace {
    return this.ws;
  }

  /** Caller must pass an already-validated workspace. */
  save(ws: Workspace): Promise<void> {
    this.ws = ws;
    const data = JSON.stringify(ws, null, 2);
    this.writing = this.writing.then(async () => {
      await fs.mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, data, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(tmp, this.file);
    });
    return this.writing.catch((err) => console.error('[store] save failed', err));
  }

  privacyFor(appId: string): PrivacySettings {
    return resolvePrivacy(this.ws.privacy, this.ws.privacyOverrides[appId]);
  }
}
