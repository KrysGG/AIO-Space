import { app, type WebContents } from 'electron';
import {
  computeLayout,
  detachLeaf,
  dockLeaf,
  dropSide,
  findLeaf,
  getApp,
  listLeaves,
  MAX_TILES,
  removeSpace,
  updateSpace,
  type DockSide,
  type WindowBounds,
  type Workspace,
} from '@aio/core';
import { IPC, TILE_GUTTER, type ViewFrame } from '../shared/ipc';
import { createMainWindow } from './window';
import type { ViewManager } from './views/ViewManager';
import type { WorkspaceStore } from './store/workspaceStore';

/** A torn-off window's size when nothing better is known. */
const DEFAULT_SIZE = { width: 900, height: 650 };

type Point = { x: number; y: number };
const inside = (r: WindowBounds, p: Point): boolean => p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;

/**
 * Torn-off windows (ROADMAP 2.15, D-069). Each shows one space, whose `window` bounds are kept in the
 * workspace so it reopens at the next start. Tiles move between windows through the workspace: main
 * edits it, saves, and every window's UI gets the new one; views follow their tiles without reloading.
 */
export class Windows {
  private quitting = false;

  constructor(
    private readonly store: WorkspaceStore,
    private readonly views: ViewManager,
  ) {
    app.on('before-quit', () => {
      this.quitting = true;
    });
  }

  /** Reopen the torn-off windows that were open when SpaceAIO last quit. */
  restore(): void {
    for (const s of this.store.get().spaces) if (s.window) this.open(s.id, s.window, s.name);
  }

  /** Give every window's UI the saved workspace (but the one that saved it), and close windows whose space is gone. */
  changed(ws: Workspace, from?: WebContents): void {
    for (const h of this.views.windows()) {
      if (h.win.isDestroyed()) continue;
      if (h.spaceId && !ws.spaces.some((s) => s.id === h.spaceId)) h.win.close();
      else if (h.win.webContents !== from) h.win.webContents.send(IPC.workspaceChanged, ws);
    }
  }

  /**
   * A tile's header was dragged out of its window and let go at `point` (screen coordinates). Over
   * another SpaceAIO window it docks beside the tile there, on the side it leans to; anywhere else
   * it opens in a window of its own.
   */
  async dragOut(sender: WebContents, leafId: string, point: Point): Promise<void> {
    const from = this.views.hostOf(sender);
    const ws = this.store.get();
    const fromSpaceId = from?.spaceId ?? ws.activeSpaceId;
    const space = ws.spaces.find((s) => s.id === fromSpaceId);
    const leaf = space && findLeaf(space.layout, leafId);
    if (!from || !space || !leaf?.appId) return;

    const target = this.views.windows().find((h) => h !== from && !h.win.isDestroyed() && inside(h.win.getContentBounds(), point));
    if (target) {
      const hit = this.tileAt(target.win.getContentBounds(), target.frame, point);
      if (!hit) return;
      await this.update((w) => dockLeaf(w, fromSpaceId, leafId, target.spaceId ?? w.activeSpaceId, hit.leafId, hit.side));
      target.win.focus();
      return;
    }
    // A torn-off window's only app: there's nothing to tear off (the window moves by its title bar).
    if (from.spaceId && listLeaves(space.layout).filter((l) => l.appId).length <= 1) return;
    const size = from.frame ? this.tileAt(from.win.getContentBounds(), from.frame, null, leafId)?.size : undefined;
    const bounds = { x: Math.round(point.x - 80), y: Math.round(point.y - 16), ...(size ?? DEFAULT_SIZE) };
    const name = getApp(leaf.appId, this.store.catalog())?.name ?? 'SpaceAIO';
    const torn = detachLeaf(ws, fromSpaceId, leafId, name, bounds);
    if (!torn.spaceId) return;
    await this.store.save(torn.ws);
    this.changed(torn.ws);
    this.open(torn.spaceId, bounds, name);
  }

  /**
   * The tile at a screen point in a window, and the side the point leans to; or, with `leafId`, that
   * tile's size. From the UI's last layout, the way main places views on resize.
   */
  private tileAt(
    content: WindowBounds,
    frame: ViewFrame | undefined,
    point: Point | null,
    leafId?: string,
  ): { leafId: string; side: DockSide; size: { width: number; height: number } } | undefined {
    if (!frame) return undefined;
    const { left, top, right, bottom } = frame.insets;
    const area = { x: 0, y: 0, width: Math.max(0, content.width - left - right), height: Math.max(0, content.height - top - bottom) };
    const tiles = computeLayout(frame.layout, area, TILE_GUTTER).tiles;
    const canSplit = tiles.length < MAX_TILES;
    for (const t of tiles) {
      const rect = { x: content.x + left + t.rect.x, y: content.y + top + t.rect.y, width: t.rect.width, height: t.rect.height };
      const size = { width: Math.round(rect.width), height: Math.round(rect.height) };
      if (leafId !== undefined ? t.leafId === leafId : point && inside(rect, point)) {
        return { leafId: t.leafId, side: point ? dropSide(point, rect, canSplit) : 'center', size };
      }
    }
    return undefined;
  }

  private open(spaceId: string, bounds: WindowBounds, title: string): void {
    const win = createMainWindow({ spaceId, bounds, title });
    this.views.addWindow(win, spaceId);
    // Where it is, for the next start (after moving or resizing settles).
    let timer: NodeJS.Timeout | undefined;
    const remember = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (win.isDestroyed()) return;
        const window = win.getBounds();
        void this.update((ws) => updateSpace(ws, spaceId, (s) => (s.window ? { ...s, window } : s)));
      }, 500);
    };
    win.on('moved', remember);
    win.on('resize', remember);
    // Closing it closes its tiles, like a browser window; quitting keeps it for the next start.
    win.on('closed', () => {
      clearTimeout(timer);
      if (!this.quitting) void this.update((ws) => removeSpace(ws, spaceId));
    });
  }

  /** A main-side edit: save it and give every window the new workspace. */
  private async update(edit: (ws: Workspace) => Workspace): Promise<void> {
    const before = this.store.get();
    const ws = edit(before);
    if (ws === before) return;
    await this.store.save(ws);
    this.changed(ws);
  }
}
