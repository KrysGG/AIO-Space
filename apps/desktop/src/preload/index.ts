/**
 * Preload for the UI window ONLY. Web app views get `webapp.ts` instead (no IPC there).
 * Runs sandboxed: may only import 'electron' (everything else is bundled in).
 * Never expose ipcRenderer itself or any generic "send anything" function.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC,
  type AioApi,
  type DownloadInfo,
  type OpenInNewTile,
  type ShortcutAction,
  type ViewState,
} from '../shared/ipc';

const api: AioApi = {
  getWorkspace: () => ipcRenderer.invoke(IPC.workspaceGet),
  saveWorkspace: (ws) => ipcRenderer.invoke(IPC.workspaceSave, ws),
  getCatalog: () => ipcRenderer.invoke(IPC.catalogGet),
  syncViews: (placements, keep, frame) => ipcRenderer.send(IPC.viewsSync, { placements, keep, frame }),
  setViewsHidden: (hidden) => ipcRenderer.send(IPC.viewsSetHidden, hidden),
  viewCommand: (leafId, command) => ipcRenderer.send(IPC.viewCommand, { leafId, command }),
  focusView: (leafId) => ipcRenderer.send(IPC.viewFocus, { leafId }),
  navigate: (leafId, url) => ipcRenderer.send(IPC.viewNavigate, { leafId, url }),
  downloadAction: (id, action) => ipcRenderer.send(IPC.downloadsAction, { id, action }),
  getFilterListStatus: () => ipcRenderer.invoke(IPC.filtersStatus),
  updateFilterLists: () => ipcRenderer.invoke(IPC.filtersUpdate),
  getStorageStatus: () => ipcRenderer.invoke(IPC.securityStorage),
  clearData: (target) => ipcRenderer.invoke(IPC.dataClear, target),
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
