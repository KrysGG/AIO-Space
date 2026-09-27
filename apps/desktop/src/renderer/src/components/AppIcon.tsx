import { siDiscord, siInstagram, siReddit, siTwitch, siX, siYoutube } from 'simple-icons';
import type { WebAppDef } from '@aio/core';
import { STORE_MARKS, visibleOnDark } from './BrandMarks';

/**
 * Brand marks from Simple Icons (CC0 SVG paths; the logos remain their owners' trademarks), shown
 * in brand colour. X's brand colour is black, so it uses the text colour to stay visible on the
 * dark UI. Custom apps show their own favicon (fetched once through the app's session, D-022);
 * anything else falls back to its text glyph.
 */
const BRAND: Record<string, { path: string; color: string }> = {
  discord: { path: siDiscord.path, color: `#${siDiscord.hex}` },
  youtube: { path: siYoutube.path, color: `#${siYoutube.hex}` },
  twitch: { path: siTwitch.path, color: `#${siTwitch.hex}` },
  reddit: { path: siReddit.path, color: `#${siReddit.hex}` },
  x: { path: siX.path, color: 'currentColor' },
  instagram: { path: siInstagram.path, color: `#${siInstagram.hex}` },
};

export function AppIcon({ app, size = 20 }: { app: Pick<WebAppDef, 'id' | 'glyph' | 'kind' | 'icon' | 'brand' | 'color'>; size?: number }) {
  // App store apps: their brand mark, crisper than a favicon and there before the first load.
  const mark = app.brand ? STORE_MARKS[app.brand] : undefined;
  if (mark) {
    return (
      <svg className="app-icon" viewBox="0 0 24 24" aria-hidden style={{ width: size, height: size, fill: visibleOnDark(app.color), stroke: 'none' }}>
        <path d={mark} />
      </svg>
    );
  }
  // Custom apps: their own favicon (a data: URL checked by main's schema).
  if (app.icon) return <img className="app-icon" src={app.icon} alt="" style={{ width: size, height: size, borderRadius: 4 }} />;
  const brand = BRAND[app.id];
  if (brand) {
    return (
      // Inline style, not attributes: rules like `.rail-btn svg { fill: none }` would override attributes.
      <svg className="app-icon" viewBox="0 0 24 24" aria-hidden style={{ width: size, height: size, fill: brand.color, stroke: 'none' }}>
        <path d={brand.path} />
      </svg>
    );
  }
  if (app.kind === 'browser') {
    // A plain globe: the Browser tile is ours, not a brand.
    return (
      <svg
        className="app-icon"
        viewBox="0 0 24 24"
        aria-hidden
        style={{ width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }}
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9M12 3C9.5 5.6 8.2 8.6 8.2 12s1.3 6.4 3.8 9" />
      </svg>
    );
  }
  return (
    <span className="app-icon-glyph" style={app.color ? { color: visibleOnDark(app.color) } : undefined}>
      {app.glyph}
    </span>
  );
}
