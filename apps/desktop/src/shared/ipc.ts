/**
 * The ONLY contract between renderer (UI) and main. Keep it small.
 * Every channel added here must also get a zod schema in main/ipc/schemas.ts.
 */
import type { Rect, WebAppDef, Workspace } from '@aio/core';

export const IPC = {
  workspaceGet: 'workspace:get',
  workspaceSave: 'workspace:save',
  catalogGet: 'catalog:get',
  viewsSync: 'views:sync',
  viewsSetHidden: 'views:set-hidden',
  viewCommand: 'view:command',
  viewState: 'view:state',
  viewFocused: 'view:focused',
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

/** Exposed on window.aio by the preload script. */
export interface AioApi {
  getWorkspace(): Promise<Workspace>;
  saveWorkspace(ws: Workspace): Promise<void>;
  getCatalog(): Promise<WebAppDef[]>;
  syncViews(placements: ViewPlacement[]): void;
  setViewsHidden(hidden: boolean): void;
  viewCommand(leafId: string, command: ViewCommand): void;
  /** Returns an unsubscribe function. */
  onViewState(cb: (state: ViewState) => void): () => void;
  onViewFocused(cb: (leafId: string) => void): () => void;
}
