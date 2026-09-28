/**
 * Preload for the UI window ONLY. Web app views get `webapp.ts` instead (no IPC there).
 * Runs sandboxed: may only import 'electron' (everything else is bundled in).
 * Never expose ipcRenderer itself or any generic "send anything" function.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { Workspace } from '@aio/core';
import {
  IPC,
  type AioApi,
  type DownloadInfo,
  type OpenInNewTile,
  type ScreenShareRequest,
  type ShortcutAction,
  type UpdateStatus,
  type ViewState,
} from '../shared/ipc';

const api: AioApi = {
  platform: process.platform,
  setTitleBarColors: (color, symbolColor) => ipcRenderer.send(IPC.windowTitleBar, { color, symbolColor }),
  getWorkspace: () => ipcRenderer.invoke(IPC.workspaceGet),
  saveWorkspace: (ws) => ipcRenderer.invoke(IPC.workspaceSave, ws),
  getCatalog: () => ipcRenderer.invoke(IPC.catalogGet),
  syncViews: (placements, keep, frame) => ipcRenderer.send(IPC.viewsSync, { placements, keep, frame }),
  setViewsHidden: (hidden) => ipcRenderer.send(IPC.viewsSetHidden, hidden),
  viewCommand: (leafId, command) => ipcRenderer.send(IPC.viewCommand, { leafId, command }),
  focusView: (leafId) => ipcRenderer.send(IPC.viewFocus, { leafId }),
  navigate: (leafId, url) => ipcRenderer.send(IPC.viewNavigate, { leafId, url }),
  openExternal: (url) => ipcRenderer.send(IPC.linkOpenExternal, { url }),
  onWorkspaceChanged: (cb) => {
    const listener = (_e: IpcRendererEvent, ws: Workspace): void => cb(ws);
    ipcRenderer.on(IPC.workspaceChanged, listener);
    return () => ipcRenderer.removeListener(IPC.workspaceChanged, listener);
  },
  dragTileOut: (leafId, x, y) => ipcRenderer.send(IPC.tileDragOut, { leafId, x: Math.round(x), y: Math.round(y) }),
  onScreenSharePick: (cb) => {
    const listener = (_e: IpcRendererEvent, request: ScreenShareRequest): void => cb(request);
    ipcRenderer.on(IPC.screenSharePick, listener);
    return () => ipcRenderer.removeListener(IPC.screenSharePick, listener);
  },
  chooseScreenShare: (id, sourceId, audio) => ipcRenderer.send(IPC.screenShareChoose, { id, sourceId, audio }),
  downloadAction: (id, action) => ipcRenderer.send(IPC.downloadsAction, { id, action }),
  getFilterListStatus: () => ipcRenderer.invoke(IPC.filtersStatus),
  updateFilterLists: () => ipcRenderer.invoke(IPC.filtersUpdate),
  getStorageStatus: () => ipcRenderer.invoke(IPC.securityStorage),
  clearData: (target) => ipcRenderer.invoke(IPC.dataClear, target),
  exportWorkspace: () => ipcRenderer.invoke(IPC.workspaceExport),
  importWorkspace: () => ipcRenderer.invoke(IPC.workspaceImport),
  listExtensions: () => ipcRenderer.invoke(IPC.extensionsList),
  installExtensionFromStore: (linkOrId) => ipcRenderer.invoke(IPC.extensionsInstallStore, linkOrId),
  installExtensionFromFolder: () => ipcRenderer.invoke(IPC.extensionsInstallFolder),
  removeExtension: (id) => ipcRenderer.invoke(IPC.extensionsRemove, id),
  openExtensionPage: (leafId, extensionId, page) => ipcRenderer.send(IPC.extensionsOpen, { leafId, extensionId, page }),
  getUpdateStatus: () => ipcRenderer.invoke(IPC.updatesStatus),
  checkForUpdates: () => ipcRenderer.send(IPC.updatesCheck),
  installUpdate: () => ipcRenderer.send(IPC.updatesInstall),
  onUpdateStatus: (cb) => {
    const listener = (_e: IpcRendererEvent, status: UpdateStatus): void => cb(status);
    ipcRenderer.on(IPC.updatesState, listener);
    return () => ipcRenderer.removeListener(IPC.updatesState, listener);
  },
  listPlugins: () => ipcRenderer.invoke(IPC.pluginsList),
  installPlugin: () => ipcRenderer.invoke(IPC.pluginsInstall),
  removePlugin: (id) => ipcRenderer.invoke(IPC.pluginsRemove, id),
  onViewState: (cb) => {
    const listener = (_e: IpcRendererEvent, s: ViewState): void => cb(s);
    ipcRenderer.on(IPC.viewState, listener);
    return () => ipcRenderer.removeListener(IPC.viewState, listener);
  },
  onViewFocused: (cb) => {
    const listener = (_e: IpcRendererEvent, leafId: string): void => cb(leafId);
    ipcRenderer.on(IPC.viewFocused, listener);
    return () => ipcRenderer.removeListener(IPC.viewFocused, listener);
  },
  onShortcut: (cb) => {
    const listener = (_e: IpcRendererEvent, action: ShortcutAction): void => cb(action);
    ipcRenderer.on(IPC.shortcut, listener);
    return () => ipcRenderer.removeListener(IPC.shortcut, listener);
  },
  onOpenInNewTile: (cb) => {
    const listener = (_e: IpcRendererEvent, request: OpenInNewTile): void => cb(request);
    ipcRenderer.on(IPC.openInNewTile, listener);
    return () => ipcRenderer.removeListener(IPC.openInNewTile, listener);
  },
  onViewSnapshots: (cb) => {
    const listener = (_e: IpcRendererEvent, snapshots: Record<string, string>): void => cb(snapshots);
    ipcRenderer.on(IPC.viewsSnapshots, listener);
    return () => ipcRenderer.removeListener(IPC.viewsSnapshots, listener);
  },
  onAppZoom: (cb) => {
    const listener = (_e: IpcRendererEvent, appId: string, factor: number): void => cb(appId, factor);
    ipcRenderer.on(IPC.appZoom, listener);
    return () => ipcRenderer.removeListener(IPC.appZoom, listener);
  },
  onAppIcon: (cb) => {
    const listener = (_e: IpcRendererEvent, appId: string, icon: string): void => cb(appId, icon);
    ipcRenderer.on(IPC.appIcon, listener);
    return () => ipcRenderer.removeListener(IPC.appIcon, listener);
  },
  onDownloads: (cb) => {
    const listener = (_e: IpcRendererEvent, downloads: DownloadInfo[]): void => cb(downloads);
    ipcRenderer.on(IPC.downloadsUpdate, listener);
    return () => ipcRenderer.removeListener(IPC.downloadsUpdate, listener);
  },
};

contextBridge.exposeInMainWorld('aio', api);
