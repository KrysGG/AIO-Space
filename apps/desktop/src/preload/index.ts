/**
 * Preload for the UI window ONLY. Web app views get no preload in Phase 1.
 * Runs sandboxed: may only import 'electron' (everything else is bundled in).
 * Never expose ipcRenderer itself or any generic "send anything" function.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type AioApi, type ViewState } from '../shared/ipc';

const api: AioApi = {
  getWorkspace: () => ipcRenderer.invoke(IPC.workspaceGet),
  saveWorkspace: (ws) => ipcRenderer.invoke(IPC.workspaceSave, ws),
  getCatalog: () => ipcRenderer.invoke(IPC.catalogGet),
  syncViews: (placements) => ipcRenderer.send(IPC.viewsSync, placements),
  setViewsHidden: (hidden) => ipcRenderer.send(IPC.viewsSetHidden, hidden),
  viewCommand: (leafId, command) => ipcRenderer.send(IPC.viewCommand, { leafId, command }),
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
};

contextBridge.exposeInMainWorld('aio', api);
