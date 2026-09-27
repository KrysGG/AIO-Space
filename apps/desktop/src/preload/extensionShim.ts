/**
 * Session preload for apps with Chrome extensions (ROADMAP 4.5, D-055), registered for service
 * workers and frames. Electron implements only part of the chrome.* API, and many extensions crash
 * at startup on a missing event (tabs.onRemoved, webNavigation.onCommitted...). In extension
 * contexts only (chrome-extension: pages and workers), this adds harmless stand-ins: events that
 * never fire, getters that return nothing, and storage.sync backed by storage.local. Web pages are
 * left alone. Nothing here talks to main.
 */
import { contextBridge } from 'electron';

function shim(): void {
  const g = globalThis as unknown as {
    chrome?: Record<string, Record<string, unknown>>;
    location?: Location;
  };
  const c = g.chrome;
  if (!c || g.location?.protocol !== 'chrome-extension:') return;
  const event = () => ({
    addListener() {},
    removeListener() {},
    hasListener: () => false,
    hasListeners: () => false,
  });
  const ns = (name: string, events: string[], fns: Record<string, unknown> = {}): void => {
    let o = c[name];
    if (!o) {
      o = {};
      try {
        c[name] = o;
      } catch {
        return;
      }
    }
    for (const e of events)
      if (!o[e])
        try {
          o[e] = event();
        } catch {
          /* read-only */
        }
    for (const [k, f] of Object.entries(fns))
      if (!o[k])
        try {
          o[k] = f;
        } catch {
          /* read-only */
        }
  };
  const nothing = () => Promise.resolve(undefined);
  const none = () => Promise.resolve([]);
  const storage = c['storage'] as { local?: unknown } | undefined;
  if (storage?.local) {
    try {
      Object.defineProperty(storage, 'sync', { value: storage.local, configurable: true });
    } catch {
      // keep Electron's
    }
  }
  ns('extension', [], {
    isAllowedFileSchemeAccess: () => Promise.resolve(false),
    isAllowedIncognitoAccess: () => Promise.resolve(false),
  });
  ns(
    'tabs',
    [
      'onCreated',
      'onUpdated',
      'onRemoved',
      'onActivated',
      'onReplaced',
      'onAttached',
      'onDetached',
      'onHighlighted',
      'onMoved',
    ],
    { getCurrent: nothing, query: none, create: nothing },
  );
  ns('windows', ['onCreated', 'onRemoved', 'onFocusChanged', 'onBoundsChanged'], {
    getAll: none,
    getCurrent: nothing,
    getLastFocused: nothing,
    WINDOW_ID_NONE: -1,
  });
  ns(
    'webNavigation',
    [
      'onBeforeNavigate',
      'onCommitted',
      'onDOMContentLoaded',
      'onCompleted',
      'onErrorOccurred',
      'onHistoryStateUpdated',
      'onReferenceFragmentUpdated',
      'onTabReplaced',
      'onCreatedNavigationTarget',
    ],
    { getFrame: nothing, getAllFrames: none },
  );
  ns('contextMenus', ['onClicked'], {
    create: () => 0,
    update: nothing,
    remove: nothing,
    removeAll: nothing,
  });
  ns('action', ['onClicked'], {
    setBadgeText: nothing,
    setBadgeBackgroundColor: nothing,
    setBadgeTextColor: nothing,
    setIcon: nothing,
    setTitle: nothing,
    setPopup: nothing,
    getUserSettings: () => Promise.resolve({ isOnToolbar: true }),
  });
  ns('commands', ['onCommand'], { getAll: none });
  ns('alarms', ['onAlarm'], {
    create: nothing,
    clear: () => Promise.resolve(true),
    clearAll: () => Promise.resolve(true),
    get: nothing,
    getAll: none,
  });
  ns('notifications', ['onClicked', 'onClosed', 'onButtonClicked'], {
    create: nothing,
    clear: nothing,
  });
  ns('idle', ['onStateChanged'], {
    queryState: () => Promise.resolve('active'),
    setDetectionInterval() {},
  });
  ns('cookies', ['onChanged'], { get: nothing, getAll: none });
  ns('permissions', ['onAdded', 'onRemoved'], {
    contains: () => Promise.resolve(true),
    getAll: () => Promise.resolve({ permissions: [], origins: [] }),
    request: () => Promise.resolve(false),
  });
  ns('declarativeNetRequest', [], {
    updateDynamicRules: nothing,
    updateSessionRules: nothing,
    getDynamicRules: none,
    getSessionRules: none,
    updateEnabledRulesets: nothing,
    getEnabledRulesets: none,
  });
}

try {
  contextBridge.executeInMainWorld({ func: shim });
} catch {
  // Not available in this context: the extension gets Electron's API as it is.
}
