import type { AppPermission, WebAppDef } from './apps';
import { makeCustomApp, type CustomAppResult } from './custom';

/**
 * The app store: popular web apps ready to add in one click. Adding one creates a normal custom app
 * (own session, allowed sites, permissions off unless listed here), so it behaves exactly like one
 * the user typed in. Entries only list what each app needs to work: its own sites to stay on, and
 * the permissions its main feature uses (calls need the microphone, chat needs notifications).
 */
export type StoreCategory = 'Chat' | 'Social' | 'Streaming' | 'Music' | 'Productivity' | 'AI' | 'Developer';

export const STORE_CATEGORIES: StoreCategory[] = ['Chat', 'Social', 'Streaming', 'Music', 'Productivity', 'AI', 'Developer'];

export interface StoreApp {
  /** Stable id of the store entry (not the id of the app once added). */
  id: string;
  name: string;
  url: string;
  category: StoreCategory;
  /** One short line: what it's for. */
  description: string;
  /** Sites the app may navigate within (its sign-in pages included). */
  allowedHosts: string[];
  permissions: AppPermission[];
  /** Brand colour for the store's monogram tile (the real favicon is fetched once added). */
  color: string;
  /** Plays protected video or music (Widevine), which this build can't decode yet. */
  drm?: boolean;
  /** Shown first, in "Popular". */
  popular?: boolean;
}

const CHAT: AppPermission[] = ['notifications', 'media', 'display-capture', 'fullscreen'];

export const STORE_APPS: StoreApp[] = [
  { id: 'spotify', name: 'Spotify', url: 'https://open.spotify.com/', category: 'Music', description: 'Music and podcasts.', allowedHosts: ['spotify.com'], permissions: ['fullscreen'], color: '#1ed760', drm: true, popular: true },
  { id: 'netflix', name: 'Netflix', url: 'https://www.netflix.com/', category: 'Streaming', description: 'Films and series.', allowedHosts: ['netflix.com'], permissions: ['fullscreen'], color: '#e50914', drm: true, popular: true },
  { id: 'whatsapp', name: 'WhatsApp', url: 'https://web.whatsapp.com/', category: 'Chat', description: 'Messages from your phone.', allowedHosts: ['whatsapp.com'], permissions: ['notifications', 'media'], color: '#25d366', popular: true },
  { id: 'telegram', name: 'Telegram', url: 'https://web.telegram.org/', category: 'Chat', description: 'Fast, cloud-based messaging.', allowedHosts: ['telegram.org'], permissions: ['notifications', 'media'], color: '#2aabee', popular: true },
  { id: 'messenger', name: 'Messenger', url: 'https://www.messenger.com/', category: 'Chat', description: 'Chats and calls with Facebook friends.', allowedHosts: ['messenger.com', 'facebook.com'], permissions: CHAT, color: '#0084ff' },
  { id: 'slack', name: 'Slack', url: 'https://app.slack.com/', category: 'Chat', description: 'Team channels and huddles.', allowedHosts: ['slack.com'], permissions: CHAT, color: '#4a154b', popular: true },
  { id: 'teams', name: 'Microsoft Teams', url: 'https://teams.microsoft.com/', category: 'Chat', description: 'Work chat and meetings.', allowedHosts: ['teams.microsoft.com', 'teams.live.com', 'microsoft.com', 'live.com', 'microsoftonline.com'], permissions: CHAT, color: '#5b5fc7' },
  { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com/', category: 'Productivity', description: 'Google email.', allowedHosts: ['mail.google.com', 'accounts.google.com'], permissions: ['notifications'], color: '#ea4335', popular: true },
  { id: 'google-calendar', name: 'Google Calendar', url: 'https://calendar.google.com/', category: 'Productivity', description: 'Your schedule.', allowedHosts: ['calendar.google.com', 'accounts.google.com'], permissions: ['notifications'], color: '#4285f4' },
  { id: 'outlook', name: 'Outlook', url: 'https://outlook.live.com/', category: 'Productivity', description: 'Microsoft email and calendar.', allowedHosts: ['outlook.live.com', 'outlook.office.com', 'live.com', 'microsoftonline.com', 'office.com'], permissions: ['notifications'], color: '#0078d4' },
  { id: 'notion', name: 'Notion', url: 'https://www.notion.so/', category: 'Productivity', description: 'Notes, docs and wikis.', allowedHosts: ['notion.so', 'notion.com'], permissions: ['clipboard-sanitized-write'], color: '#2f3437' },
  { id: 'figma', name: 'Figma', url: 'https://www.figma.com/', category: 'Productivity', description: 'Design together.', allowedHosts: ['figma.com'], permissions: ['clipboard-sanitized-write', 'fullscreen'], color: '#a259ff' },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', category: 'AI', description: 'OpenAI’s assistant.', allowedHosts: ['chatgpt.com', 'openai.com'], permissions: ['clipboard-sanitized-write'], color: '#10a37f', popular: true },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/', category: 'AI', description: 'Anthropic’s assistant.', allowedHosts: ['claude.ai'], permissions: ['clipboard-sanitized-write'], color: '#d97757', popular: true },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/', category: 'AI', description: 'Google’s assistant.', allowedHosts: ['gemini.google.com', 'accounts.google.com'], permissions: ['clipboard-sanitized-write'], color: '#8e75ff' },
  { id: 'tiktok', name: 'TikTok', url: 'https://www.tiktok.com/', category: 'Social', description: 'Short videos.', allowedHosts: ['tiktok.com'], permissions: ['fullscreen'], color: '#fe2c55' },
  { id: 'linkedin', name: 'LinkedIn', url: 'https://www.linkedin.com/', category: 'Social', description: 'Your professional network.', allowedHosts: ['linkedin.com'], permissions: ['notifications'], color: '#0a66c2' },
  { id: 'pinterest', name: 'Pinterest', url: 'https://www.pinterest.com/', category: 'Social', description: 'Ideas and inspiration.', allowedHosts: ['pinterest.com'], permissions: [], color: '#e60023' },
  { id: 'bluesky', name: 'Bluesky', url: 'https://bsky.app/', category: 'Social', description: 'Open social network.', allowedHosts: ['bsky.app'], permissions: ['notifications'], color: '#1185fe' },
  { id: 'kick', name: 'Kick', url: 'https://kick.com/', category: 'Streaming', description: 'Live streams.', allowedHosts: ['kick.com'], permissions: ['fullscreen'], color: '#53fc18' },
  { id: 'prime-video', name: 'Prime Video', url: 'https://www.primevideo.com/', category: 'Streaming', description: 'Amazon films and series.', allowedHosts: ['primevideo.com', 'amazon.com'], permissions: ['fullscreen'], color: '#1a98ff', drm: true },
  { id: 'disney-plus', name: 'Disney+', url: 'https://www.disneyplus.com/', category: 'Streaming', description: 'Disney, Pixar, Marvel and more.', allowedHosts: ['disneyplus.com'], permissions: ['fullscreen'], color: '#113ccf', drm: true },
  { id: 'youtube-music', name: 'YouTube Music', url: 'https://music.youtube.com/', category: 'Music', description: 'Music videos and playlists.', allowedHosts: ['music.youtube.com', 'accounts.google.com', 'youtube.com'], permissions: ['fullscreen'], color: '#ff0033' },
  { id: 'soundcloud', name: 'SoundCloud', url: 'https://soundcloud.com/', category: 'Music', description: 'Tracks from independent artists.', allowedHosts: ['soundcloud.com'], permissions: [], color: '#ff5500' },
  { id: 'github', name: 'GitHub', url: 'https://github.com/', category: 'Developer', description: 'Code, issues and pull requests.', allowedHosts: ['github.com'], permissions: ['notifications', 'clipboard-sanitized-write'], color: '#24292f' },
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** The app this store entry was added as, if it's in the catalog already (matched by start address host). */
export function installedFromStore(entry: StoreApp, catalog: WebAppDef[]): WebAppDef | undefined {
  const host = hostOf(entry.url);
  return catalog.find((a) => hostOf(a.url) === host);
}

/** Build the custom app for a store entry (same validation as a typed-in app). */
export function appFromStore(entry: StoreApp, existing: WebAppDef[]): CustomAppResult {
  const res = makeCustomApp({ name: entry.name, url: entry.url, allowedHosts: entry.allowedHosts, permissions: entry.permissions }, existing);
  return res.ok ? { ok: true, app: { ...res.app, brand: entry.id, color: entry.color } } : res;
}

/** Entries matching a search (name, description or category) and category ('Popular' or a category). */
export function searchStore(query: string, category: StoreCategory | 'Popular' | 'All'): StoreApp[] {
  const q = query.trim().toLowerCase();
  return STORE_APPS.filter((a) => {
    if (q) return `${a.name} ${a.description} ${a.category}`.toLowerCase().includes(q);
    if (category === 'All') return true;
    if (category === 'Popular') return a.popular === true;
    return a.category === category;
  });
}
