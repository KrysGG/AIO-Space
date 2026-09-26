import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FiltersEngine, Request, ENGINE_VERSION, type RequestType } from '@ghostery/adblocker';
import type { FilterListKind, FilterListStatus } from '../../shared/ipc';

/**
 * Ad and tracker blocking with community filter lists (ROADMAP 3.5 and 3.6, D-034).
 *
 * Two engines, so the "Block ads" and "Block trackers" switches work separately per app. Lists come
 * from GitHub mirrors (Ghostery's mirror of EasyList/uBlock, and Brave's own repo), are compiled with
 * @ghostery/adblocker's FiltersEngine, cached on disk as serialized engines, and refreshed once a day.
 * The engine is only ever called from our request pipeline: never `enableBlockingInSession`, which
 * would register its own webRequest listeners (AGENTS.md).
 */
const GHOSTERY = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets';
const BRAVE = 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists';

export const FILTER_LISTS: Record<FilterListKind, { urls: string[]; cosmetic: boolean }> = {
  ads: {
    cosmetic: true,
    urls: [
      `${GHOSTERY}/easylist/easylist.txt`,
      `${GHOSTERY}/peter-lowe/serverlist.txt`,
      `${GHOSTERY}/ublock-origin/filters.txt`,
      `${GHOSTERY}/ublock-origin/filters-2024.txt`,
      `${GHOSTERY}/ublock-origin/badware.txt`,
      `${GHOSTERY}/ublock-origin/quick-fixes.txt`,
      `${GHOSTERY}/ublock-origin/unbreak.txt`,
      `${BRAVE}/brave-firstparty.txt`,
      `${BRAVE}/brave-specific.txt`,
      `${BRAVE}/brave-unbreak.txt`,
    ],
  },
  trackers: {
    cosmetic: false,
    urls: [
      `${GHOSTERY}/easylist/easyprivacy.txt`,
      `${GHOSTERY}/ublock-origin/privacy.txt`,
      `${BRAVE}/brave-firstparty-cname.txt`,
      `${BRAVE}/brave-unbreak.txt`,
    ],
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_MS = 60 * 60 * 1000;

/** Compile list texts into an engine. Exported for tests. */
export function compileEngine(texts: string[], cosmetic: boolean): FiltersEngine {
  return FiltersEngine.parse(texts.join('\n'), {
    loadCosmeticFilters: cosmetic,
    loadNetworkFilters: true,
    enableHtmlFiltering: false,
  });
}

export interface MatchInput {
  url: string;
  /** The page (top frame) the request belongs to; unknown for some browser-initiated requests. */
  sourceUrl: string | undefined;
  /** Electron's resourceType ("script", "image", "xhr", ...). */
  resourceType: string;
}

/** True when the engine says to block the request (and no exception filter allows it). */
export function engineBlocks(engine: FiltersEngine, input: MatchInput): boolean {
  const request = Request.fromRawDetails({
    url: input.url,
    sourceUrl: input.sourceUrl ?? '',
    type: input.resourceType as RequestType,
  });
  return engine.match(request).match;
}

interface Meta {
  engineVersion: number;
  updatedAt: number;
  rules: number;
}

type Fetcher = (url: string) => Promise<string>;

export class FilterLists {
  private readonly engines: Partial<Record<FilterListKind, FiltersEngine>> = {};
  private readonly meta: Partial<Record<FilterListKind, Meta>> = {};
  private updating: Promise<void> | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly dir: string,
    private readonly fetchText: Fetcher,
  ) {}

  engine(kind: FilterListKind): FiltersEngine | undefined {
    return this.engines[kind];
  }

  status(): FilterListStatus {
    const kinds = Object.keys(FILTER_LISTS) as FilterListKind[];
    return {
      updating: this.updating !== null,
      error: this.lastError,
      lists: kinds.map((kind) => ({ kind, rules: this.meta[kind]?.rules ?? 0, updatedAt: this.meta[kind]?.updatedAt ?? null })),
    };
  }

  /** Load cached engines, then keep them fresh: update now if stale, and check hourly. */
  async start(onChange: () => void = () => {}): Promise<void> {
    await this.loadCache();
    const refresh = (): void => {
      if (this.isStale()) void this.update().finally(onChange);
    };
    refresh();
    setInterval(refresh, CHECK_MS).unref();
  }

  private isStale(): boolean {
    const now = Date.now();
    return (Object.keys(FILTER_LISTS) as FilterListKind[]).some((k) => !this.meta[k] || now - this.meta[k]!.updatedAt > DAY_MS);
  }

  /** Download every list and rebuild both engines. One update at a time; a failure keeps the old engines. */
  update(): Promise<void> {
    this.updating ??= this.doUpdate().finally(() => {
      this.updating = null;
    });
    return this.updating;
  }

  private async doUpdate(): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
      for (const kind of Object.keys(FILTER_LISTS) as FilterListKind[]) {
        const { urls, cosmetic } = FILTER_LISTS[kind];
        const texts = await Promise.all(urls.map((u) => this.fetchText(u)));
        const engine = compileEngine(texts, cosmetic);
        const meta: Meta = { engineVersion: ENGINE_VERSION, updatedAt: Date.now(), rules: countRules(texts) };
        await writeAtomic(join(this.dir, `${kind}.bin`), engine.serialize());
        await writeAtomic(join(this.dir, `${kind}.json`), JSON.stringify(meta));
        this.engines[kind] = engine;
        this.meta[kind] = meta;
      }
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      console.warn('[filter-lists] update failed, keeping the current lists:', this.lastError);
    }
  }

  private async loadCache(): Promise<void> {
    for (const kind of Object.keys(FILTER_LISTS) as FilterListKind[]) {
      try {
        const meta = JSON.parse(await readFile(join(this.dir, `${kind}.json`), 'utf8')) as Meta;
        if (meta.engineVersion !== ENGINE_VERSION) continue; // library upgraded: rebuild from lists
        this.engines[kind] = FiltersEngine.deserialize(new Uint8Array(await readFile(join(this.dir, `${kind}.bin`))));
        this.meta[kind] = meta;
      } catch {
        // No cache yet, or unreadable: the update below builds it.
      }
    }
  }
}

function countRules(texts: string[]): number {
  let n = 0;
  for (const text of texts) {
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t && !t.startsWith('!') && !t.startsWith('[')) n++;
    }
  }
  return n;
}

async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, path);
}
