import { z } from 'zod';
import {
  isThemeColor,
  isValidHostname,
  MAX_APP_CSS,
  MAX_THEME_NAME,
  MAX_TEMPLATES,
  MAX_USER_THEMES,
  THEME_KEYS,
  isWebUrl,
  listLeaves,
  MAX_CUSTOM_APPS,
  MAX_PROFILES_PER_APP,
  MAX_SPACES,
  MAX_TABS,
  instancesOf,
  tabsOf,
  MAX_TILES,
  MAX_ZOOM,
  MIN_ZOOM,
  NOTICE_IDS,
  SEARCH_ENGINES,
  type AppPermission,
  type LayoutNode,
  type SearchEngineId,
  type Theme,
  type ThemeKey,
  type WebAppDef,
  type Workspace,
} from '@aio/core';

/** Every IPC payload from the renderer is untrusted until parsed here. */

const unique = (xs: string[]): boolean => new Set(xs).size === xs.length;

export const SearchEngineSchema = z.enum(Object.keys(SEARCH_ENGINES) as [SearchEngineId, ...SearchEngineId[]]);

const Id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
/** Installed extension ids (ROADMAP 4.5): a Chrome Web Store id, or local-<name> for a folder install. */
export const ExtensionId = z.string().regex(/^([a-p]{32}|local-[a-z0-9-]{1,30})$/);
/** Plugin ids (ROADMAP 4.4): also their folder name under userData/plugins. */
export const PluginId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
export { MAX_TILES };

/** Account ids: the first is 'default', then p2, p3... (ROADMAP 2.12). */
const ProfileId = z.string().regex(/^(default|p[0-9]{1,2})$/);

/** A page address kept for a Browser tab (D-049). */
const TabUrl = z.string().max(2048).refine(isWebUrl, 'only http(s) URLs');

const TabSchema = z.object({ instanceId: Id, url: TabUrl.optional(), title: z.string().max(300).optional() }).strict();

const LeafSchema = z
  .object({
    type: z.literal('leaf'),
    id: Id,
    appId: Id.nullable(),
    instanceId: Id.nullable(),
    profile: ProfileId.optional(),
    tabs: z.array(TabSchema).min(1).max(MAX_TABS).optional(),
  })
  .refine((l) => (l.appId === null) === (l.instanceId === null), 'a tile has an instance exactly when it has an app')
  .refine((l) => !l.tabs || (l.appId === 'browser' && l.tabs.some((t) => t.instanceId === l.instanceId)), 'tabs belong to a Browser tile and include the one shown');

export const LayoutSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.union([
    LeafSchema,
    z.object({
      type: z.literal('split'),
      id: Id,
      direction: z.enum(['row', 'column']),
      ratio: z.number().min(0).max(1),
      first: LayoutSchema,
      second: LayoutSchema,
    }),
  ]),
);

const Host = z.string().max(253).refine(isValidHostname, 'not a hostname');
const PERMISSIONS: [AppPermission, ...AppPermission[]] = ['media', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'display-capture'];
/** Favicon stored as a data URL: small raster images only (no SVG). */
const IconDataUrl = z
  .string()
  .max(140_000)
  .regex(/^data:image\/(png|x-icon|vnd\.microsoft\.icon|gif|webp|jpeg);base64,[A-Za-z0-9+/]+=*$/);

/**
 * User-added apps (ROADMAP 2.7). Stricter than built-ins: https start page, real hostnames only
 * (never '*', which only the Browser may use), known permissions.
 */
export const CustomAppSchema: z.ZodType<WebAppDef> = z.object({
  id: z.string().regex(/^custom-[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(40),
  url: z.string().max(2048).refine((u) => isWebUrl(u) && u.startsWith('https://'), 'https only'),
  kind: z.literal('app'),
  allowedHosts: z.array(Host).min(1).max(20),
  popupHosts: z.array(Host).max(30),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
  glyph: z.string().min(1).max(3),
  icon: IconDataUrl.optional(),
  // Any slug: an app added from the store stays valid if its entry later moves or goes (e.g. Twitch).
  brand: z.string().regex(/^[a-z0-9-]{1,32}$/).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/).optional(),
});

/** Imported themes (ROADMAP 4.1): colours only, every key present (they're completed on import). */
const ThemeColor = z.string().refine(isThemeColor, 'not a colour');
export const ThemeSchema: z.ZodType<Theme> = z
  .object({
    id: z.string().regex(/^user-[a-z0-9-]{1,40}$/),
    name: z.string().trim().min(1).max(MAX_THEME_NAME),
    scheme: z.enum(['dark', 'light']),
    colors: z.object(Object.fromEntries(THEME_KEYS.map((k) => [k, ThemeColor])) as Record<ThemeKey, typeof ThemeColor>).strict(),
  })
  .strict();

export const PrivacySchema = z.object({
  shields: z.boolean(),
  blockAds: z.boolean(),
  blockTrackers: z.boolean(),
  stripTrackingParams: z.boolean(),
  globalPrivacyControl: z.boolean(),
  httpsOnly: z.boolean(),
  trimReferrers: z.boolean(),
  blockThirdPartyCookies: z.boolean(),
  fingerprinting: z.enum(['off', 'standard', 'strict']),
  webrtcPolicy: z.enum(['default', 'default_public_interface_only', 'disable_non_proxied_udp']),
});

/** A space's layout: at most MAX_TILES tiles, unique tiles and running instances. */
const SpaceLayout = LayoutSchema.refine((l) => listLeaves(l).length <= MAX_TILES, 'too many tiles').refine((l) => {
  const leaves = listLeaves(l);
  return unique(leaves.map((x) => x.id)) && unique(instancesOf(l)) && leaves.every((x) => tabsOf(x).length <= MAX_TABS);
}, 'duplicate tile or instance');

export const WorkspaceSchema: z.ZodType<Workspace> = z.object({
  version: z.number().int(),
  spaces: z
    .array(
      z.object({
        id: Id,
        name: z.string().min(1).max(40),
        layout: SpaceLayout,
        focusedLeafId: Id.nullable(),
      }),
    )
    .min(1)
    .max(20),
  activeSpaceId: Id,
  privacy: PrivacySchema,
  privacyOverrides: z.record(Id, PrivacySchema.partial()),
  browser: z.object({
    searchEngine: SearchEngineSchema,
  }),
  performance: z.object({
    sleepAfterMinutes: z.union([z.null(), z.literal(5), z.literal(15), z.literal(30), z.literal(60)]),
  }),
  zoom: z
    .record(z.string().regex(/^[a-z0-9-]{1,64}$/), z.number().min(MIN_ZOOM).max(MAX_ZOOM))
    .refine((z) => Object.keys(z).length <= 200, 'too many zoom entries'),
  profiles: z
    .record(
      z.string().regex(/^[a-z0-9-]{1,64}$/),
      z.array(z.object({ id: ProfileId.refine((p) => p !== 'default'), name: z.string().trim().min(1).max(30) })).max(MAX_PROFILES_PER_APP - 1),
    )
    .refine((p) => Object.keys(p).length <= 100, 'too many apps with accounts'),
  httpAllowedHosts: z.array(Host).max(200).refine(unique, 'duplicate host'),
  ui: z.object({ railCollapsed: z.boolean(), reduceMotion: z.boolean(), theme: Id }),
  themes: z
    .array(ThemeSchema)
    .max(MAX_USER_THEMES)
    .refine((ts) => unique(ts.map((t) => t.id)), 'duplicate theme id'),
  twitch: z.object({ adScript: z.enum(['vaft', 'video-swap-new', 'off']) }),
  identity: z.object({ shareGoogle: z.boolean() }),
  rail: z.object({
    order: z.array(Id).max(300).refine(unique, 'duplicate app id'),
    hidden: z.array(Id).max(300).refine(unique, 'duplicate app id'),
    pinned: z.array(Id).max(300).refine(unique, 'duplicate app id'),
  }),
  appCss: z
    .record(Id, z.object({ css: z.string().max(MAX_APP_CSS), enabled: z.boolean() }).strict())
    .refine((c) => Object.keys(c).length <= 200, 'too many apps with CSS'),
  templates: z
    .array(z.object({ id: Id, name: z.string().trim().min(1).max(40), layout: SpaceLayout }).strict())
    .max(MAX_TEMPLATES)
    .refine((ts) => unique(ts.map((t) => t.id)), 'duplicate template id'),
  extensions: z
    .record(Id, z.array(ExtensionId).max(50).refine(unique, 'duplicate extension id'))
    .refine((e) => Object.keys(e).length <= 200, 'too many apps with extensions'),
  enabledPlugins: z.array(PluginId).max(100).refine(unique, 'duplicate plugin id'),
  forgetOnClose: z.array(Id).max(200).refine(unique, 'duplicate app id'),
  dismissedNotices: z.array(z.enum(NOTICE_IDS)).max(NOTICE_IDS.length).refine(unique, 'duplicate notice'),
  customApps: z
    .array(CustomAppSchema)
    .max(MAX_CUSTOM_APPS)
    .refine((apps) => unique(apps.map((a) => a.id)), 'duplicate app id'),
});

const Bound = z.number().int().min(0).max(20000);

export const PlacementsSchema = z
  .array(
    z.object({
      leafId: Id,
      instanceId: Id,
      appId: Id,
      profile: ProfileId,
      bounds: z.object({ x: Bound, y: Bound, width: Bound, height: Bound }),
      url: TabUrl.optional(),
    }),
  )
  .max(MAX_TILES)
  .refine((ps) => unique(ps.map((p) => p.instanceId)) && unique(ps.map((p) => p.leafId)), 'duplicate tile or instance');

/** `views:sync`: the active space's placements, and instance ids of other spaces' apps to keep alive. */
const Inset = z.number().min(0).max(20000);
export const ViewFrameSchema = z.object({
  layout: LayoutSchema,
  insets: z.object({ left: Inset, top: Inset, right: Inset, bottom: Inset }),
});

export const ViewsSyncSchema = z.object({
  placements: PlacementsSchema,
  frame: ViewFrameSchema.optional(),
  keep: z
    .array(Id)
    .max(MAX_TILES * MAX_SPACES * MAX_TABS)
    .refine(unique, 'duplicate instance'),
});

export const ViewCommandSchema = z.object({
  leafId: Id,
  command: z.enum(['back', 'forward', 'reload', 'home', 'zoom-in', 'zoom-out', 'zoom-reset', 'allow-http']),
});

/** `null` means "give keyboard focus to the UI". */
export const ViewFocusSchema = z.object({ leafId: Id.nullable() });

/** Browser tile address bar. Only http(s) URLs; main also refuses non-Browser tiles. */
export const ViewNavigateSchema = z.object({
  leafId: Id,
  url: z.string().max(8192).refine(isWebUrl, 'only http(s) URLs'),
});

export const DownloadActionSchema = z.object({
  id: Id,
  action: z.enum(['open', 'show', 'cancel', 'clear']),
});

/** Channels that take no payload (filters:status, filters:update, security:storage): anything sent along is rejected. */
export const NoPayloadSchema = z.undefined();

/** data:clear (ROADMAP 3.9): one app account, or every app. */
export const ClearDataSchema = z.union([
  z.object({ appId: Id, profile: ProfileId }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

/* ---- Plugins (ROADMAP 4.4) ------------------------------------------------------------------ */


/** A file a plugin lists: a plain name in the plugin folder (no paths, so nothing outside it). */
const PluginFile = (ext: 'js' | 'css') => z.string().regex(new RegExp(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\\.${ext}$`));

/**
 * manifest.json. Plugins get no permissions yet: a plugin asking for any is refused rather than run
 * without what it expects. TODO(ROADMAP 4.4): the permissioned message channel to main (D-052).
 */
export const PluginManifestSchema = z
  .object({
    id: PluginId,
    name: z.string().trim().min(1).max(60),
    version: z.string().regex(/^[0-9]{1,5}(\.[0-9]{1,5}){0,3}$/),
    description: z.string().trim().max(300).default(''),
    apps: z.array(Id).min(1).max(20).refine(unique, 'duplicate app id'),
    permissions: z.array(z.string()).max(0, 'SpaceAIO doesn’t offer plugin permissions yet').default([]),
    scripts: z.array(PluginFile('js')).max(10).refine(unique, 'duplicate file').default([]),
    styles: z.array(PluginFile('css')).max(10).refine(unique, 'duplicate file').default([]),
  })
  .strict()
  .refine((m) => m.scripts.length + m.styles.length > 0, 'a plugin needs at least one script or style');
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/* ---- Chrome extensions (ROADMAP 4.5) -------------------------------------------------------- */

/** extensions:install-store: a store link or id (main extracts and checks the id). */
export const ExtensionStoreInputSchema = z.string().trim().min(32).max(2048);

/** extensions:open: which page of which extension, for the app in which tile. */
export const ExtensionOpenSchema = z.object({ leafId: Id, extensionId: ExtensionId, page: z.enum(['popup', 'options']) }).strict();

