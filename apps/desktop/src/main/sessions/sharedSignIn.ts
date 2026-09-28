import { session, type Cookie, type CookiesSetDetails, type Session } from 'electron';

/**
 * "Share Google sign-in between apps" (D-045). Each app keeps its own session (cookies, storage,
 * cache); only Google's own account cookies (on google.com and its country domains) are copied
 * between the sessions of each app's FIRST account, so signing in to Google once signs every app in,
 * and signing out signs them all out. Extra accounts ("Account 2", ...) never take part, so a second
 * Google identity can still run side by side. A hub session keeps the master copy, so an app opened
 * later starts signed in. Off by default: it lets Google link these apps to one person.
 */
const HUB_PARTITION = 'persist:aio-google-identity';

/** Sessions being cleared (ROADMAP 3.9): their removals are not a sign-out to copy to other apps. */
const muted = new WeakSet<Session>();

/** Run `clear` on a session without its cookie removals spreading to the other apps. */
export async function withoutSignInSync(ses: Session, clear: () => Promise<void>): Promise<void> {
  muted.add(ses);
  try {
    await clear();
    // Cookie change events arrive shortly after the clear resolves.
    await new Promise((r) => setTimeout(r, 500));
  } finally {
    muted.delete(ses);
  }
}

/** Cookies Google's sign-in uses: google.com, its subdomains and country domains (google.co.uk). */
export function isGoogleAccountCookie(cookie: Pick<Cookie, 'domain'>): boolean {
  const domain = (cookie.domain ?? '').replace(/^\./, '').toLowerCase();
  return /(^|\.)google\.(com|[a-z]{2}|com?\.[a-z]{2})$/.test(domain);
}

/** Only the first account of each app shares (partitions end in "-default"). */
export function sharesSignIn(partition: string): boolean {
  return partition.startsWith('persist:app-') && partition.endsWith('-default');
}

/** A cookie's identity (domain, path, name) and, for a change we expect, its value. */
const markOf = (c: Cookie, removed: boolean): string => `${c.domain ?? ''}|${c.path ?? '/'}|${c.name}|${removed ? '' : c.value}`;

/** Same cookie (name, domain, path)? */
function sameKey(a: Cookie, b: Cookie): boolean {
  return a.name === b.name && (a.domain ?? '') === (b.domain ?? '') && (a.path ?? '/') === (b.path ?? '/');
}

function setDetails(c: Cookie): CookiesSetDetails {
  const host = (c.domain ?? '').replace(/^\./, '');
  return {
    url: `https://${host}${c.path ?? '/'}`,
    name: c.name,
    value: c.value,
    // Host-only cookies must not get a domain (that would widen them to subdomains).
    ...(c.hostOnly ? {} : { domain: c.domain }),
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    ...(c.session || c.expirationDate === undefined ? {} : { expirationDate: c.expirationDate }),
    sameSite: c.sameSite,
  };
}

export class SharedSignIn {
  private readonly sessions = new Map<string, Session>();
  private hubSession: Session | undefined;
  /** Copies being written into a session: their own change events must not be spread again. */
  private readonly expected = new WeakMap<Session, Set<string>>();
  /** Copies into a session are written one at a time, in the order they changed. */
  private readonly queues = new WeakMap<Session, Promise<void>>();

  constructor(private readonly enabled: () => boolean) {}

  private get hub(): Session {
    this.hubSession ??= session.fromPartition(HUB_PARTITION);
    return this.hubSession;
  }

  /** A new app session: join (first accounts only), and start signed in if sharing is on. */
  attach(partition: string, ses: Session): void {
    if (!sharesSignIn(partition) || this.sessions.has(partition)) return;
    this.sessions.set(partition, ses);
    ses.cookies.on('changed', (_e, cookie, cause, removed) => {
      if (!this.enabled() || muted.has(ses) || !isGoogleAccountCookie(cookie)) return;
      // A replaced cookie reports its old value as removed, then the new one: only the new one matters.
      // (An expired overwrite is Google signing out: that one spreads.)
      if (removed && cause === 'overwrite') return;
      // Our own copy arriving: sending it on would echo an older value back over a newer one.
      if (this.expected.get(ses)?.delete(markOf(cookie, removed))) return;
      void this.spread(ses, cookie, removed);
    });
    if (this.enabled()) void this.copyAll(this.hub, ses);
  }

  /** Sharing was just turned on: collect the Google sign-in from open apps, then give it to all. */
  async enable(): Promise<void> {
    for (const ses of this.sessions.values()) await this.copyAll(ses, this.hub);
    for (const ses of this.sessions.values()) await this.copyAll(this.hub, ses);
  }

  /** One cookie changed in `from`: make every other shared session (and the hub) match. */
  private async spread(from: Session, cookie: Cookie, removed: boolean): Promise<void> {
    const targets = [this.hub, ...this.sessions.values()].filter((s) => s !== from);
    await Promise.all(targets.map((to) => this.apply(to, cookie, removed)));
  }

  /** Write one change into a session, after the ones before it; skipped when it already matches. */
  private apply(to: Session, cookie: Cookie, removed: boolean): Promise<void> {
    const run = async (): Promise<void> => {
      const mark = markOf(cookie, removed);
      try {
        const existing = (await to.cookies.get({ name: cookie.name })).find((c) => sameKey(c, cookie));
        if (removed ? !existing : existing && existing.value === cookie.value && existing.expirationDate === cookie.expirationDate) return;
        this.expect(to, mark);
        if (removed) await to.cookies.remove(setDetails(cookie).url, cookie.name);
        else await to.cookies.set(setDetails(cookie));
      } catch (err) {
        this.expected.get(to)?.delete(mark);
        console.warn('[shared-sign-in] could not copy a cookie:', err instanceof Error ? err.message : err);
      }
    };
    const next = (this.queues.get(to) ?? Promise.resolve()).then(run);
    this.queues.set(to, next);
    return next;
  }

  // ponytail: a mark whose change event never comes stays in the set; bounded by Google's few dozen cookies.
  private expect(to: Session, mark: string): void {
    let set = this.expected.get(to);
    if (!set) this.expected.set(to, (set = new Set()));
    set.add(mark);
  }

  private async copyAll(from: Session, to: Session): Promise<void> {
    const cookies = (await from.cookies.get({})).filter(isGoogleAccountCookie);
    for (const c of cookies) await this.apply(to, c, false);
  }
}
