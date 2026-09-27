/**
 * The ONLY contract between renderer (UI) and main. Keep it small.
 * Every channel added here must also get a zod schema in main/ipc/schemas.ts.
 */
import type { MediaInUse } from './webapp';
import type { FocusDirection, LayoutNode, Rect, SplitDirection, WebAppDef, Workspace, ZoomChange } from '@aio/core';

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
  securityStorage: 'security:storage',
  dataClear: 'data:clear',
  workspaceExport: 'workspace:export',
  workspaceImport: 'workspace:import',
  extensionsList: 'extensions:list',
  extensionsInstallStore: 'extensions:install-store',
  extensionsInstallFolder: 'extensions:install-folder',
  extensionsRemove: 'extensions:remove',
  extensionsOpen: 'extensions:open',
  pluginsList: 'plugins:list',
  pluginsInstall: 'plugins:install',
  pluginsRemove: 'plugins:remove',
} as const;

/** Result of saving or opening a workspace file (ROADMAP 4.6); main shows the file dialogs itself. */
export type WorkspaceFileResult<T = undefined> = ({ ok: true } & (T extends undefined ? unknown : { workspace: T })) | { ok: false; error: string } | { ok: false; cancelled: true };

/** An installed Chrome extension as the UI shows it (ROADMAP 4.5). Its files stay in main. */
export interface ExtensionInfo {
  /** Chrome Web Store id, or `local-<name>` for an unpacked folder. */
  id: string;
  name: string;
  version: string;
  description: string;
  source: 'store' | 'folder';
  /** Its toolbar popup and options pages (paths inside the extension), if it has them. */
  popup?: string;
  options?: string;
}

export type ExtensionInstallResult = { ok: true; extension: ExtensionInfo } | { ok: false; error: string } | { ok: false; cancelled: true };

/** An installed plugin as the UI shows it (ROADMAP 4.4). Its code stays in main. */
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  /** App ids it runs in. */
  apps: string[];
}

/** `plugins:install`: main asks for a folder itself; the UI never passes a path. */
export type PluginInstallResult = { ok: true; plugin: PluginInfo } | { ok: false; error: string } | { ok: false; cancelled: true };

/** What to clear (ROADMAP 3.9): one account of an app, or every app. */
export type ClearDataTarget = { appId: string; profile: string } | { all: true };

/** How logins are encrypted on disk (ROADMAP 3.8). */
export interface StorageStatus {
  /** Linux: Chromium's backend ('kwallet6', 'gnome_libsecret', 'basic_text', ...); 'os' elsewhere. */
  backend: string;
  /** No system keyring in use: cookies are stored with a fixed key. */
  weak: boolean;
}

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
/** Tile header height and the gap between tiles (px). */
export const TILE_HEADER = 34;
export const TILE_GUTTER = 6;
/** Browser tiles with more than one tab show a tab strip under the header (D-049). */
export const TAB_BAR = 30;

/** Height above a tile's web view: the header, plus the tab strip when the tile has tabs. */
export function tileHeaderHeight(tabs: number): number {
  return TILE_HEADER + (tabs > 1 ? TAB_BAR : 0);
}

/**
 * The active space's layout and where the tile area sits in the window (distance from each edge).
 * With it, main recomputes view positions itself when the window resizes, instead of waiting a few
 * frames for the UI to measure and send them (which made pages lag behind their tiles).
 */
export interface ViewFrame {
  layout: LayoutNode;
  insets: { left: number; top: number; right: number; bottom: number };
}

/** Where a native web view should sit, in window content coordinates (DIP). */
export interface ViewPlacement {
  leafId: string;
  /** The running app instance; views follow it when tiles are swapped. */
  instanceId: string;
  appId: string;
  /** Account of the app (ROADMAP 2.12): picks the session partition. */
  profile: string;
  bounds: Rect;
  /** Browser tabs: the page to open when the view is created (the tab's last page, D-049). */
  url?: string;
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
  /** Microphone, camera or screen share in use by the page (privacy dots). */
  media: MediaInUse;
  /** The page is playing sound. */
  audible: boolean;
}

/**
 * A link asked for a new tab. `background` = middle-click / Ctrl+click: keep focus where it is.
 * `tab`: open it as a tab of the Browser tile it came from (D-049) instead of in a new tile.
 */
export interface OpenInNewTile {
  fromLeafId: string;
  url: string;
  background: boolean;
  tab?: boolean;
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
  | { kind: 'help' }
  | { kind: 'toggle-rail' }
  | { kind: 'new-tab' }
  | { kind: 'switch-tab'; delta: 1 | -1 };

/** Exposed on window.aio by the preload script. */
export interface AioApi {
  getWorkspace(): Promise<Workspace>;
  saveWorkspace(ws: Workspace): Promise<void>;
  getCatalog(): Promise<WebAppDef[]>;
  /**
   * Where the active space's views go, plus `keep`: instance ids of apps in other spaces, which
   * main hides but keeps running (ROADMAP 2.8). Any other view is destroyed.
   */
  syncViews(placements: ViewPlacement[], keep: string[], frame?: ViewFrame): void;
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
  getStorageStatus(): Promise<StorageStatus>;
  /** Log out and delete cookies, storage and cache; the files are removed at the next start. */
  clearData(target: ClearDataTarget): Promise<void>;
  /** Save the current workspace (layouts, apps, settings; never logins or cookies) to a file the user picks (ROADMAP 4.6). */
  exportWorkspace(): Promise<WorkspaceFileResult>;
  /** Read and validate a workspace file the user picks. Nothing changes until the UI adopts (and saves) it. */
  importWorkspace(): Promise<WorkspaceFileResult<Workspace>>;
  /** Installed Chrome extensions (ROADMAP 4.5). Which apps run them is `workspace.extensions`. */
  listExtensions(): Promise<ExtensionInfo[]>;
  /** Download and install (or update) from a Chrome Web Store link or extension id. */
  installExtensionFromStore(linkOrId: string): Promise<ExtensionInstallResult>;
  /** Pick an unpacked extension folder and install (or update) it. */
  installExtensionFromFolder(): Promise<ExtensionInstallResult>;
  removeExtension(id: string): Promise<void>;
  /** Open an extension's popup or options page, in the session of the app in `leafId`. */
  openExtensionPage(leafId: string, extensionId: string, page: 'popup' | 'options'): void;
  /** Installed plugins (ROADMAP 4.4). */
  listPlugins(): Promise<PluginInfo[]>;
  /** Pick a plugin folder and install (or update) it. Installed plugins stay off until enabled in the workspace. */
  installPlugin(): Promise<PluginInstallResult>;
  /** Delete an installed plugin. */
  removePlugin(id: string): Promise<void>;
}
