import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { BUILTIN_APPS, partitionFor } from '@aio/core';
import { IPC, type ExtensionInstallResult, type PluginInstallResult, type WorkspaceFileResult } from '../../shared/ipc';
import { exportWorkspace, importWorkspace } from '../store/workspaceFile';
import type { PluginStore } from '../plugins/pluginStore';
import type { ExtensionStore } from '../extensions/extensionStore';
import type { Updates } from '../updates';
import { clearHttpAllowedThisRun } from '../privacy/httpsFallback';
import type { WorkspaceStore } from '../store/workspaceStore';
import type { DownloadManager } from '../downloads/DownloadManager';
import type { FilterLists } from '../privacy/filterLists';
import { storageStatus } from '../security/keyring';
import { allAppPartitions, clearPartitions } from '../store/siteData';
import type { ViewManager } from '../views/ViewManager';
import {
  ClearDataSchema,
  DownloadActionSchema,
  NoPayloadSchema,
  ExtensionId,
  ExtensionOpenSchema,
  ExtensionStoreInputSchema,
  TitleBarColorsSchema,
  PluginId,
  ViewsSyncSchema,
  ViewCommandSchema,
  ViewFocusSchema,
  ViewNavigateSchema,
  OpenExternalSchema,
  WorkspaceSchema,
} from './schemas';

export function registerIpc(
  win: BrowserWindow,
  store: WorkspaceStore,
  views: ViewManager,
  downloads: DownloadManager,
  filterLists: FilterLists,
  plugins: PluginStore,
  extensions: ExtensionStore,
  updates: Updates,
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
    clearHttpAllowedThisRun(); // the saved list is authoritative again (removals take effect)
    views.refresh(); // a custom app added just now can get its view
    views.applyPrivacy(); // WebRTC policy changes need a reload
    views.applyAppCss(); // custom CSS edits show at once
    views.applyPlugins(); // plugins turned on or off: their apps reload
    views.applyExtensions(); // extensions turned on or off for an app: loaded or unloaded, the app reloads
  });

  ipcMain.handle(IPC.catalogGet, (e) => {
    guard(e);
    return BUILTIN_APPS;
  });

  ipcMain.on(IPC.viewsSync, (e, raw: unknown) => {
    if (!fromUi(e)) return;
    const parsed = ViewsSyncSchema.safeParse(raw);
    if (parsed.success) views.sync(parsed.data.placements, parsed.data.keep, parsed.data.frame);
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

  ipcMain.on(IPC.linkOpenExternal, (e, raw: unknown) => {
    if (!fromUi(e)) return;
    const parsed = OpenExternalSchema.safeParse(raw);
    if (parsed.success) void shell.openExternal(parsed.data.url);
  });

  ipcMain.on(IPC.downloadsAction, (e, raw: unknown) => {
    if (!fromUi(e)) return;
    const parsed = DownloadActionSchema.safeParse(raw);
    if (parsed.success) downloads.action(parsed.data.id, parsed.data.action);
  });

  ipcMain.handle(IPC.filtersStatus, (e, raw: unknown) => {
    guard(e);
    NoPayloadSchema.parse(raw);
    return filterLists.status();
  });

  ipcMain.handle(IPC.filtersUpdate, async (e, raw: unknown) => {
    guard(e);
    NoPayloadSchema.parse(raw);
    await filterLists.update();
    return filterLists.status();
  });

  ipcMain.handle(IPC.dataClear, async (e, raw: unknown) => {
    guard(e);
    const target = ClearDataSchema.parse(raw);
    const ws = store.get();
    const partitions = 'all' in target ? allAppPartitions(ws) : [partitionFor(target.appId, target.profile)];
    await clearPartitions(app.getPath('userData'), partitions);
    views.restartPartitions(new Set(partitions));
  });

  ipcMain.handle(IPC.securityStorage, (e, raw: unknown) => {
    guard(e);
    NoPayloadSchema.parse(raw);
    return storageStatus();
  });

  // Workspace files (ROADMAP 4.6): both dialogs are shown here; the UI never passes a path.
  ipcMain.handle(IPC.workspaceExport, async (e, raw: unknown): Promise<WorkspaceFileResult> => {
    guard(e);
    NoPayloadSchema.parse(raw);
    const pick = await dialog.showSaveDialog(win, {
      title: 'Export workspace',
      defaultPath: `aio-space-workspace-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'SpaceAIO workspace', extensions: ['json'] }],
    });
    if (pick.canceled || !pick.filePath) return { ok: false, cancelled: true };
    return exportWorkspace(store.get(), pick.filePath);
  });

  ipcMain.handle(IPC.workspaceImport, async (e, raw: unknown) => {
    guard(e);
    NoPayloadSchema.parse(raw);
    const pick = await dialog.showOpenDialog(win, {
      title: 'Import workspace',
      properties: ['openFile'],
      filters: [{ name: 'SpaceAIO workspace', extensions: ['json'] }],
    });
    const file = pick.filePaths[0];
    if (pick.canceled || !file) return { ok: false, cancelled: true };
    return importWorkspace(file);
  });

  ipcMain.handle(IPC.pluginsList, (e, raw: unknown) => {
    guard(e);
    NoPayloadSchema.parse(raw);
    return plugins.list();
  });

  // The folder is picked here, in main: the UI never hands us a path.
  ipcMain.handle(IPC.pluginsInstall, async (e, raw: unknown): Promise<PluginInstallResult> => {
    guard(e);
    NoPayloadSchema.parse(raw);
    const pick = await dialog.showOpenDialog(win, { title: 'Install a plugin: pick its folder', properties: ['openDirectory'] });
    const folder = pick.filePaths[0];
    if (pick.canceled || !folder) return { ok: false, cancelled: true };
    try {
      const plugin = await plugins.install(folder);
      views.applyPlugins(); // an update to an enabled plugin reloads its apps
      return { ok: true, plugin };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.pluginsRemove, async (e, raw: unknown) => {
    guard(e);
    await plugins.remove(PluginId.parse(raw));
    views.applyPlugins();
  });

  ipcMain.on(IPC.windowTitleBar, (e, raw: unknown) => {
    if (!fromUi(e) || process.platform !== 'win32') return;
    const parsed = TitleBarColorsSchema.safeParse(raw);
    if (parsed.success) win.setTitleBarOverlay(parsed.data);
  });

  ipcMain.handle(IPC.updatesStatus, (e, raw: unknown) => {
    guard(e);
    NoPayloadSchema.parse(raw);
    return updates.get();
  });

  ipcMain.on(IPC.updatesCheck, (e, raw: unknown) => {
    if (fromUi(e) && NoPayloadSchema.safeParse(raw).success) updates.check(true);
  });

  ipcMain.on(IPC.updatesInstall, (e, raw: unknown) => {
    if (fromUi(e) && NoPayloadSchema.safeParse(raw).success) updates.install();
  });

  ipcMain.handle(IPC.extensionsList, (e, raw: unknown) => {
    guard(e);
    NoPayloadSchema.parse(raw);
    return extensions.list();
  });

  const installed = async (install: () => Promise<{ id: string }>): Promise<ExtensionInstallResult> => {
    try {
      const extension = await install();
      views.reloadExtension(extension.id); // an update replaces the running copy
      return { ok: true, extension: extensions.list().find((x) => x.id === extension.id)! };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  ipcMain.handle(IPC.extensionsInstallStore, (e, raw: unknown) => {
    guard(e);
    const input = ExtensionStoreInputSchema.parse(raw);
    return installed(() => extensions.installFromStore(input));
  });

  // The folder is picked here, in main: the UI never hands us a path.
  ipcMain.handle(IPC.extensionsInstallFolder, async (e, raw: unknown): Promise<ExtensionInstallResult> => {
    guard(e);
    NoPayloadSchema.parse(raw);
    const pick = await dialog.showOpenDialog(win, { title: 'Install an unpacked extension: pick its folder', properties: ['openDirectory'] });
    const folder = pick.filePaths[0];
    if (pick.canceled || !folder) return { ok: false, cancelled: true };
    return installed(() => extensions.installFromFolder(folder));
  });

  ipcMain.handle(IPC.extensionsRemove, async (e, raw: unknown) => {
    guard(e);
    const id = ExtensionId.parse(raw);
    await extensions.remove(id);
    views.applyExtensions();
  });

  ipcMain.on(IPC.extensionsOpen, (e, raw: unknown) => {
    if (!fromUi(e)) return;
    const parsed = ExtensionOpenSchema.safeParse(raw);
    if (parsed.success) views.openExtensionPage(parsed.data.leafId, parsed.data.extensionId, parsed.data.page);
  });
}
