import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { BUILTIN_APPS } from '@aio/core';
import { IPC } from '../../shared/ipc';
import type { WorkspaceStore } from '../store/workspaceStore';
import type { DownloadManager } from '../downloads/DownloadManager';
import type { ViewManager } from '../views/ViewManager';
import {
  DownloadActionSchema,
  PlacementsSchema,
  ViewCommandSchema,
  ViewFocusSchema,
  ViewNavigateSchema,
  WorkspaceSchema,
} from './schemas';

export function registerIpc(
  win: BrowserWindow,
  store: WorkspaceStore,
  views: ViewManager,
  downloads: DownloadManager,
): void {
  /** Only the UI window's top frame may talk to main. Web app views have no preload anyway. */
  const fromUi = (e: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    !win.isDestroyed() &&
    e.sender.id === win.webContents.id &&
    e.senderFrame !== null &&
    e.senderFrame === e.sender.mainFrame;

  const guard = (e: IpcMainInvokeEvent): void => {
    if (!fromUi(e)) throw new Error('IPC rejected: untrusted sender');
  };

  ipcMain.handle(IPC.workspaceGet, (e) => {
    guard(e);
    return store.get();
  });

  ipcMain.handle(IPC.workspaceSave, async (e, raw: unknown) => {
    guard(e);
    const ws = WorkspaceSchema.parse(raw);
    await store.save(ws);
  });

  ipcMain.handle(IPC.catalogGet, (e) => {
    guard(e);
    return BUILTIN_APPS;
  });

  ipcMain.on(IPC.viewsSync, (e, raw: unknown) => {
    if (!fromUi(e)) return;
    const parsed = PlacementsSchema.safeParse(raw);
    if (parsed.success) views.sync(parsed.data);
  });

  ipcMain.on(IPC.viewsSetHidden, (e, raw: unknown) => {
    if (!fromUi(e) || typeof raw !== 'boolean') return;
    views.setHidden(raw);
  });

  ipcMain.on(IPC.viewCommand, (e, raw: unknown) => {
    if (!fromUi(e)) return;
    const parsed = ViewCommandSchema.safeParse(raw);
    if (parsed.success) views.command(parsed.data.leafId, parsed.data.command);
  });

  ipcMain.on(IPC.viewFocus, (e, raw: unknown) => {
    if (!fromUi(e)) return;
    const parsed = ViewFocusSchema.safeParse(raw);
    if (parsed.success) views.focus(parsed.data.leafId);
  });

  ipcMain.on(IPC.viewNavigate, (e, raw: unknown) => {
    if (!fromUi(e)) return;
    const parsed = ViewNavigateSchema.safeParse(raw);
    if (parsed.success) views.navigate(parsed.data.leafId, parsed.data.url);
  });

  ipcMain.on(IPC.downloadsAction, (e, raw: unknown) => {
    if (!fromUi(e)) return;
    const parsed = DownloadActionSchema.safeParse(raw);
    if (parsed.success) downloads.action(parsed.data.id, parsed.data.action);
  });
}
