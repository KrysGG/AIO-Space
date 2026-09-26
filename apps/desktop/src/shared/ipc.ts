/**
 * The ONLY contract between renderer (UI) and main. Keep it small.
 * Every channel added here must also get a zod schema in main/ipc/schemas.ts.
 */
import type { FocusDirection, Rect, SplitDirection, WebAppDef, Workspace } from '@aio/core';

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
  shortcut: 'shortcut',
} as const;

/** Where a native web view should sit, in window content coordinates (DIP). */
export interface ViewPlacement {
  leafId: string;
  appId: string;
  bounds: Rect;
}

export type ViewCommand = 'back' | 'forward' | 'reload' | 'home';

export interface ViewState {
  leafId: string;
  /** App the view was showing. The UI ignores states whose app no longer matches the tile. */
  appId: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  crashed: boolean;
}

/** A Browser tile link asked for a new tab. `background` = middle-click / Ctrl+click: keep focus where it is. */
export interface OpenInNewTile {
  fromLeafId: string;
  url: string;
  background: boolean;
}

/** A keyboard shortcut caught in main (from the UI or any web view) and handled by the UI. */
export type ShortcutAction =
  | { kind: 'focus-direction'; direction: FocusDirection }
  | { kind: 'focus-index'; index: number }
  | { kind: 'split'; direction: SplitDirection }
  | { kind: 'close' }
  | { kind: 'reload' }
  | { kind: 'focus-address' }
  | { kind: 'help' };

/** Exposed on window.aio by the preload script. */
export interface AioApi {
  getWorkspace(): Promise<Workspace>;
  saveWorkspace(ws: Workspace): Promise<void>;
  getCatalog(): Promise<WebAppDef[]>;
  syncViews(placements: ViewPlacement[]): void;
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
}
