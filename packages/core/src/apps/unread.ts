/**
 * Unread state that web apps put in their page title: "(3) Discord", "(12) Home / X",
 * "(99+) Reddit", or Discord's "• Discord | #general" (unread, no mentions).
 */
export type Unread = { count: number; more: boolean } | 'dot' | null;

const COUNT = /^\s*\((\d{1,5})(\+?)\)\s/;
const DOT = /^\s*[•●]\s/;

export function unreadFromTitle(title: string): Unread {
  const m = COUNT.exec(title);
  if (m) {
    const count = Number(m[1]);
    return count > 0 ? { count, more: m[2] === '+' } : null;
  }
  return DOT.test(title) ? 'dot' : null;
}

/** The title without its unread prefix, for display next to a badge. */
export function titleWithoutUnread(title: string): string {
  return title.replace(COUNT, '').replace(DOT, '').trim() || title;
}

/** Add up unread states (several tiles of one app, or every app for the tray). */
export function sumUnread(items: Unread[]): Unread {
  let count = 0;
  let more = false;
  let dot = false;
  for (const u of items) {
    if (u === 'dot') dot = true;
    else if (u) {
      count += u.count;
      more ||= u.more;
    }
  }
  if (count > 0) return { count, more };
  return dot ? 'dot' : null;
}

/** Badge text: "3", "99+", or "" for a dot / nothing. */
export function unreadLabel(u: Unread): string {
  if (!u || u === 'dot') return '';
  return u.count > 99 || u.more ? `${Math.min(u.count, 99)}+` : String(u.count);
}
