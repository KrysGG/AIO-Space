import type {
  OnBeforeRequestListenerDetails,
  OnBeforeSendHeadersListenerDetails,
  OnHeadersReceivedListenerDetails,
  Session,
} from 'electron';

/**
 * IMPORTANT: Electron allows only ONE listener per webRequest event per session.
 * Every request hook in this app (shields, adblock engine, plugins) must be a
 * RequestFilter registered here, never a direct ses.webRequest.* call.
 */
export interface RequestDecision {
  cancel?: boolean;
  redirectURL?: string;
}

export interface RequestFilter {
  name: string;
  onBeforeRequest?(details: OnBeforeRequestListenerDetails): RequestDecision | undefined;
  /** Return the (possibly modified) headers. Must not throw. */
  onBeforeSendHeaders?(
    details: OnBeforeSendHeadersListenerDetails,
    headers: Record<string, string>,
  ): Record<string, string>;
  /** Response headers; return them (possibly modified). Must not throw. */
  onHeadersReceived?(
    details: OnHeadersReceivedListenerDetails,
    headers: Record<string, string[]>,
  ): Record<string, string[]>;
}

/**
 * `onBlocked` is told about every cancelled request with the page it came from, for the Shields
 * count in the tile header (ROADMAP 3.1).
 */
export function installRequestPipeline(
  ses: Session,
  filters: RequestFilter[],
  onBlocked: (webContentsId: number) => void = () => {},
): void {
  ses.webRequest.onBeforeRequest((details, callback) => {
    for (const f of filters) {
      try {
        const d = f.onBeforeRequest?.(details);
        if (d?.cancel && details.webContentsId !== undefined) onBlocked(details.webContentsId);
        if (d?.cancel || d?.redirectURL) return callback(d);
      } catch (err) {
        console.error(`[pipeline] ${f.name} onBeforeRequest failed`, err);
      }
    }
    callback({});
  });

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    let headers = { ...details.requestHeaders };
    for (const f of filters) {
      try {
        if (f.onBeforeSendHeaders) headers = f.onBeforeSendHeaders(details, headers);
      } catch (err) {
        console.error(`[pipeline] ${f.name} onBeforeSendHeaders failed`, err);
      }
    }
    callback({ requestHeaders: headers });
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    const original = details.responseHeaders ?? {};
    let headers = original;
    for (const f of filters) {
      try {
        if (f.onHeadersReceived) headers = f.onHeadersReceived(details, headers);
      } catch (err) {
        console.error(`[pipeline] ${f.name} onHeadersReceived failed`, err);
      }
    }
    // Only replace the headers when a filter changed them.
    callback(headers === original ? {} : { responseHeaders: headers });
  });
}
