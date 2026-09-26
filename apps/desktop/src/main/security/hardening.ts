import { app, session } from 'electron';

/**
 * App-wide defaults. Individual web app views override the window-open handler
 * with their own allowlist logic in ViewManager. See docs/SECURITY.md.
 */
export function installGlobalHardening(): void {
  app.on('web-contents-created', (_e, contents) => {
    // <webview> is disabled everywhere; we use WebContentsView from main instead.
    contents.on('will-attach-webview', (ev) => ev.preventDefault());
    // Default: no popups. ViewManager replaces this for app views.
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}

/** The UI window's session never needs any permission, and never downloads. */
export function lockDownUiSession(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (e) => e.preventDefault());
}
