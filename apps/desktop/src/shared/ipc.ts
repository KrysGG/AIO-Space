/**
 * The ONLY contract between renderer (UI) and main. Keep it small.
 * Every channel added here must also get a zod schema in main/ipc/schemas.ts.
 */
import type { FocusDirection, Rect, SplitDirection, WebAppDef, Workspace, ZoomChange } from '@aio/core';

export const IPC = {
  workspaceGet: 'workspace:get',
  workspaceSave: 'workspace:save',
  catalogGet: 'catalog:get',
  viewsSync: 'views:sync',
  viewsSetHidden: 'views:set-hidden',
  viewCommand: 'view:command',
  viewState: 'view:state',
  viewFocused: 'view:focused',
  viewFocus: 'view:focus',
  viewNavigate: 'view:navigate',
  openInNewTile: 'view:open-in-new-tile',
  downloadsUpdate: 'downloads:update',
  downloadsAction: 'downloads:action',
  appIcon: 'app:icon',
  appZoom: 'app:zoom',
  viewsSnapshots: 'views:snapshots',
  shortcut: 'shortcut',
  filtersStatus: 'filters:status',
  filtersUpdate: 'filters:update',
} as const;

/** Ad and tracker filter lists (ROADMAP 3.5/3.6). */
export type FilterListKind = 'ads' | 'trackers';

export interface FilterListStatus {
  updating: boolean;
  /** Why the last update failed; the previous lists stay in use. */
  error: string | null;
  lists: Array<{ kind: FilterListKind; rules: number; updatedAt: number | null }>;
}

/**
 * Web views sit inside the tile body as a rounded card: inset from the tile's sides and bottom so
 * the tile's own rounded corners and outline stay visible, with corners concentric to the tile's.
 * Must match `--view-inset` / `--radius-view` in the renderer's styles.css.
 */
export const VIEW_INSET = 4;
export const VIEW_RADIUS = 8;

/** Where a native web view should sit, in window content coordinates (DIP). */
export interface ViewPlacement {
  leafId: string;
  /** The running app instance; views follow it when tiles are swapped. */
  instanceId: string;
  appId: string;
  /** Account of the app (ROADMAP 2.12): picks the session partition. */
  profile: string;
  bounds: Rect;
}

export type ViewCommand = 'back' | 'forward' | 'reload' | 'home' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'allow-http';

export interface ViewState {
  /** The running app instance this state belongs to. The UI keys states by it, so they follow swaps. */
  instanceId: string;
  /** Tile the view was in when the state was sent. */
  leafId: string;
  appId: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  crashed: boolean;
  /** Page zoom factor (1 = 100%). The UI saves it per app (ROADMAP 2.10). */
  zoom: number;
  /** Requests Shields blocked on the current page (ROADMAP 3.1). */
  blocked: number;
  /**
   * The page was upgraded to https and that failed (ROADMAP 3.2): the view is hidden and the tile
   * offers to continue over http. `url` is the http:// address, `error` Chromium's description.
   */
  httpsFailed?: { host: string; url: string; error: string };
}

/** A Browser tile link asked for a new tab. `background` = middle-click / Ctrl+click: keep focus where it is. */
export interface OpenInNewTile {
  fromLeafId: string;
  url: string;
  background: boolean;
}

/** One download as the UI shows it. Paths stay in main; the UI only gets the file name. */
export interface DownloadInfo {
  id: string;
  filename: string;
  /** Site the file came from, e.g. "github.com". */
  host: string;
  receivedBytes: number;
  /** 0 when the server didn't say. */
  totalBytes: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  /** False for types the desktop might run (scripts, .desktop, installers): show in folder only. */
  canOpen: boolean;
}

export type DownloadAction = 'open' | 'show' | 'cancel' | 'clear';

/** A keyboard shortcut caught in main (from the UI or any web view) and handled by the UI. */
export type ShortcutAction =
  | { kind: 'focus-direction'; direction: FocusDirection }
  | { kind: 'focus-index'; index: number }
  | { kind: 'split'; direction: SplitDirection }
  | { kind: 'close' }
  | { kind: 'reload' }
  | { kind: 'focus-address' }
  | { kind: 'zoom'; change: ZoomChange }
  | { kind: 'help' };

/** Exposed on window.aio by the preload script. */
export interface AioApi {
  getWorkspace(): Promise<Workspace>;
  saveWorkspace(ws: Workspace): Promise<void>;
  getCatalog(): Promise<WebAppDef[]>;
  /**
   * Where the active space's views go, plus `keep`: instance ids of apps in other spaces, which
   * main hides but keeps running (ROADMAP 2.8). Any other view is destroyed.
   */
  syncViews(placements: ViewPlacement[], keep: string[]): void;
  setViewsHidden(hidden: boolean): void;
  viewCommand(leafId: string, command: ViewCommand): void;
  /** Give keyboard focus to a tile's web view, or to the UI when `leafId` is null or the tile is empty. */
  focusView(leafId: string | null): void;
  /** Browser tiles only; http(s) only. Works before the tile's view exists (it starts there). */
  navigate(leafId: string, url: string): void;
  /** Returns an unsubscribe function. */
  onViewState(cb: (state: ViewState) => void): () => void;
  onViewFocused(cb: (leafId: string) => void): () => void;
  onShortcut(cb: (action: ShortcutAction) => void): () => void;
  onOpenInNewTile(cb: (request: OpenInNewTile) => void): () => void;
  /** Full list of this session's downloads, newest first, whenever it changes. */
  onDownloads(cb: (downloads: DownloadInfo[]) => void): () => void;
  /** A custom app's favicon was fetched (data: URL); the UI stores it on the app. */
  onAppIcon(cb: (appId: string, icon: string) => void): () => void;
  /**
   * The user zoomed an app (keys or Ctrl+wheel); the UI saves it per app. Only sent for user
   * actions, so a page reporting 100% while it loads never overwrites a saved zoom.
   */
  onAppZoom(cb: (appId: string, factor: number) => void): () => void;
  /**
   * Snapshots (JPEG data URLs, by instance id) of the views, sent just before they're hidden so tiles
   * can show them (ROADMAP 2.13); an empty object when the views are shown again.
   */
  onViewSnapshots(cb: (snapshots: Record<string, string>) => void): () => void;
  /** `clear` removes finished downloads from the list (the files stay); `id` is ignored for it. */
  downloadAction(id: string, action: DownloadAction): void;
  getFilterListStatus(): Promise<FilterListStatus>;
  /** Download the filter lists now; resolves with the new status when done. */
  updateFilterLists(): Promise<FilterListStatus>;
}
