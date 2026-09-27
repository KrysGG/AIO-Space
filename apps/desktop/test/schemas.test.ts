import { describe, expect, it } from 'vitest';
import { addTab, createLeaf, defaultWorkspace, makeCustomApp, MAX_TABS, parseThemeFile, splitLeaf, type LayoutNode, type WebAppDef } from '@aio/core';
import {
  CustomAppSchema,
  DownloadActionSchema,
  LayoutSchema,
  MAX_TILES,
  PlacementsSchema,
  SearchEngineSchema,
  ViewCommandSchema,
  ViewFocusSchema,
  ViewNavigateSchema,
  ViewsSyncSchema,
  WorkspaceSchema,
  NoPayloadSchema,
  ClearDataSchema,
  PluginId,
  PluginManifestSchema,
  ExtensionId,
  ExtensionOpenSchema,
  ExtensionStoreInputSchema,
} from '../src/main/ipc/schemas';

/** A layout with `n` leaves, built by repeatedly splitting the newest leaf. */
function layoutWithTiles(n: number): LayoutNode {
  let root: LayoutNode = createLeaf(null);
  let last = root.id;
  for (let i = 1; i < n; i++) {
    const r = splitLeaf(root, last, i % 2 ? 'row' : 'column', null);
    if (!r.newLeafId) throw new Error(`split ${i} failed`);
    root = r.root;
    last = r.newLeafId;
  }
  return root;
}

function workspaceWith(layout: LayoutNode) {
  const ws = defaultWorkspace();
  return { ...ws, spaces: [{ ...ws.spaces[0]!, layout }] };
}

describe('WorkspaceSchema', () => {
  it('accepts the default workspace', () => {
    expect(WorkspaceSchema.safeParse(defaultWorkspace()).success).toBe(true);
  });

  it(`accepts ${MAX_TILES} tiles and rejects ${MAX_TILES + 1}`, () => {
    expect(WorkspaceSchema.safeParse(workspaceWith(layoutWithTiles(MAX_TILES))).success).toBe(true);
    expect(WorkspaceSchema.safeParse(workspaceWith(layoutWithTiles(MAX_TILES + 1))).success).toBe(false);
  });

  it('rejects missing fields, bad ids and wrong types', () => {
    const ws = defaultWorkspace();
    expect(WorkspaceSchema.safeParse({ ...ws, spaces: [] }).success).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...ws, activeSpaceId: '../etc' }).success).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...ws, privacy: { ...ws.privacy, fingerprinting: 'max' } }).success).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...ws, version: '1' }).success).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...ws, browser: { searchEngine: 'google' } }).success).toBe(false);
    const { browser: _omit, ...noBrowser } = ws;
    void _omit;
    expect(WorkspaceSchema.safeParse(noBrowser).success).toBe(false);
    expect(WorkspaceSchema.safeParse(null).success).toBe(false);
  });
});

describe('instances in the saved layout', () => {
  it('requires an instance exactly when a tile has an app, and no duplicates', () => {
    const leaf = (id: string, appId: string | null, instanceId: string | null) => ({ type: 'leaf' as const, id, appId, instanceId });
    const split = (a: LayoutNode, b: LayoutNode): LayoutNode => ({ type: 'split', id: 'split_1', direction: 'row', ratio: 0.5, first: a, second: b });
    const ok = (layout: LayoutNode) => WorkspaceSchema.safeParse(workspaceWith(layout)).success;
    expect(ok(split(leaf('leaf_a', 'discord', 'app_1'), leaf('leaf_b', null, null)))).toBe(true);
    expect(ok(leaf('leaf_a', 'discord', null))).toBe(false);
    expect(ok(leaf('leaf_a', null, 'app_1'))).toBe(false);
    expect(ok(split(leaf('leaf_a', 'discord', 'app_1'), leaf('leaf_b', 'youtube', 'app_1')))).toBe(false);
    expect(ok(split(leaf('leaf_a', 'discord', 'app_1'), leaf('leaf_a', 'youtube', 'app_2')))).toBe(false);
  });
});

describe('LayoutSchema', () => {
  it('rejects ratios outside 0..1 and unknown node types', () => {
    const split = layoutWithTiles(2);
    expect(LayoutSchema.safeParse(split).success).toBe(true);
    expect(LayoutSchema.safeParse({ ...split, ratio: 1.5 }).success).toBe(false);
    expect(LayoutSchema.safeParse({ type: 'iframe', id: 'a', src: 'https://x' }).success).toBe(false);
  });
});

describe('PlacementsSchema', () => {
  const placement = { leafId: 'leaf_1', instanceId: 'app_1', appId: 'discord', profile: 'default', bounds: { x: 62, y: 40, width: 800, height: 600 } };

  it('accepts integer bounds within range', () => {
    expect(PlacementsSchema.safeParse([placement]).success).toBe(true);
  });

  it('rejects negative, fractional or huge bounds, bad ids and too many placements', () => {
    const withBounds = (b: Partial<typeof placement.bounds>) => [{ ...placement, bounds: { ...placement.bounds, ...b } }];
    expect(PlacementsSchema.safeParse(withBounds({ x: -1 })).success).toBe(false);
    expect(PlacementsSchema.safeParse(withBounds({ width: 10.5 })).success).toBe(false);
    expect(PlacementsSchema.safeParse(withBounds({ height: 20001 })).success).toBe(false);
    expect(PlacementsSchema.safeParse([{ ...placement, appId: 'disc ord' }]).success).toBe(false);
    const many = Array.from({ length: MAX_TILES + 1 }, (_, i) => ({ ...placement, leafId: `leaf_${i}`, instanceId: `app_${i}` }));
    expect(PlacementsSchema.safeParse(many.slice(0, MAX_TILES)).success).toBe(true);
    expect(PlacementsSchema.safeParse(many).success).toBe(false);
  });

  it('rejects a missing instance and duplicate tiles or instances', () => {
    const { instanceId: _i, ...noInstance } = placement;
    void _i;
    expect(PlacementsSchema.safeParse([noInstance]).success).toBe(false);
    expect(PlacementsSchema.safeParse([placement, { ...placement, leafId: 'leaf_2' }]).success).toBe(false);
    expect(PlacementsSchema.safeParse([placement, { ...placement, instanceId: 'app_2' }]).success).toBe(false);
    expect(PlacementsSchema.safeParse([placement, { ...placement, leafId: 'leaf_2', instanceId: 'app_2' }]).success).toBe(true);
  });
});

describe('ViewCommandSchema', () => {
  it('accepts known commands only', () => {
    expect(ViewCommandSchema.safeParse({ leafId: 'leaf_1', command: 'reload' }).success).toBe(true);
    expect(ViewCommandSchema.safeParse({ leafId: 'leaf_1', command: 'navigate' }).success).toBe(false);
    expect(ViewCommandSchema.safeParse({ leafId: 'leaf_1' }).success).toBe(false);
  });
});

describe('ViewFocusSchema', () => {
  it('accepts a tile id or null (the UI), nothing else', () => {
    expect(ViewFocusSchema.safeParse({ leafId: 'leaf_1' }).success).toBe(true);
    expect(ViewFocusSchema.safeParse({ leafId: null }).success).toBe(true);
    expect(ViewFocusSchema.safeParse({}).success).toBe(false);
    expect(ViewFocusSchema.safeParse({ leafId: '<script>' }).success).toBe(false);
    expect(ViewFocusSchema.safeParse({ leafId: 5 }).success).toBe(false);
  });
});

describe('ViewNavigateSchema', () => {
  it('accepts http(s) URLs only', () => {
    expect(ViewNavigateSchema.safeParse({ leafId: 'leaf_1', url: 'https://example.com/' }).success).toBe(true);
    expect(ViewNavigateSchema.safeParse({ leafId: 'leaf_1', url: 'http://example.com/' }).success).toBe(true);
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'chrome://gpu', 'example.com', '']) {
      expect(ViewNavigateSchema.safeParse({ leafId: 'leaf_1', url }).success).toBe(false);
    }
    expect(ViewNavigateSchema.safeParse({ leafId: 'leaf_1', url: 'https://x.example/' + 'a'.repeat(9000) }).success).toBe(false);
    expect(ViewNavigateSchema.safeParse({ leafId: '../x', url: 'https://example.com/' }).success).toBe(false);
  });
});

describe('SearchEngineSchema', () => {
  it('accepts the three engines only', () => {
    for (const id of ['duckduckgo', 'brave', 'startpage']) expect(SearchEngineSchema.safeParse(id).success).toBe(true);
    expect(SearchEngineSchema.safeParse('google').success).toBe(false);
    expect(SearchEngineSchema.safeParse(null).success).toBe(false);
  });
});

describe('DownloadActionSchema', () => {
  it('accepts known actions on a download id only', () => {
    for (const action of ['open', 'show', 'cancel', 'clear']) expect(DownloadActionSchema.safeParse({ id: 'dl_1', action }).success).toBe(true);
    expect(DownloadActionSchema.safeParse({ id: 'dl_1', action: 'delete' }).success).toBe(false);
    expect(DownloadActionSchema.safeParse({ id: '/etc/passwd', action: 'open' }).success).toBe(false);
    expect(DownloadActionSchema.safeParse({ action: 'open' }).success).toBe(false);
  });
});

describe('CustomAppSchema', () => {
  const made = makeCustomApp({ name: 'WhatsApp', url: 'web.whatsapp.com', permissions: ['notifications'] });
  if (!made.ok) throw new Error(made.error);
  const app: WebAppDef = made.app;
  const ok = (a: unknown) => CustomAppSchema.safeParse(a).success;

  it('accepts what makeCustomApp builds, with or without an icon', () => {
    expect(ok(app)).toBe(true);
    expect(ok({ ...app, icon: 'data:image/png;base64,iVBORw0KGgo=' })).toBe(true);
  });

  it('never lets a custom app go everywhere or start off https', () => {
    expect(ok({ ...app, allowedHosts: ['*'] })).toBe(false);
    expect(ok({ ...app, popupHosts: ['*'] })).toBe(false);
    expect(ok({ ...app, allowedHosts: [] })).toBe(false);
    expect(ok({ ...app, url: 'http://web.whatsapp.com/' })).toBe(false);
    expect(ok({ ...app, url: 'javascript:alert(1)' })).toBe(false);
    expect(ok({ ...app, kind: 'browser' })).toBe(false);
  });

  it('rejects built-in ids, unknown permissions and non-raster icons', () => {
    expect(ok({ ...app, id: 'discord' })).toBe(false);
    expect(ok({ ...app, permissions: ['geolocation'] })).toBe(false);
    expect(ok({ ...app, icon: 'data:image/svg+xml;base64,PHN2Zz4=' })).toBe(false);
    expect(ok({ ...app, icon: 'https://evil.example/x.png' })).toBe(false);
    expect(ok({ ...app, icon: 'data:image/png;base64,' + 'A'.repeat(150_000) })).toBe(false);
  });

  it('is part of the workspace, with unique ids', () => {
    expect(WorkspaceSchema.safeParse({ ...defaultWorkspace(), customApps: [app] }).success).toBe(true);
    expect(WorkspaceSchema.safeParse({ ...defaultWorkspace(), customApps: [app, app] }).success).toBe(false);
  });

});

describe('ViewsSyncSchema', () => {
  const placement = { leafId: 'leaf_1', instanceId: 'app_1', appId: 'discord', profile: 'default', bounds: { x: 0, y: 0, width: 10, height: 10 } };
  it('takes placements plus instance ids to keep running', () => {
    expect(ViewsSyncSchema.safeParse({ placements: [placement], keep: ['app_2', 'app_3'] }).success).toBe(true);
    expect(ViewsSyncSchema.safeParse({ placements: [], keep: [] }).success).toBe(true);
  });
  it('rejects bad or duplicate keep ids and old-style payloads', () => {
    expect(ViewsSyncSchema.safeParse({ placements: [placement], keep: ['app_2', 'app_2'] }).success).toBe(false);
    expect(ViewsSyncSchema.safeParse({ placements: [placement], keep: ['../x'] }).success).toBe(false);
    expect(ViewsSyncSchema.safeParse([placement]).success).toBe(false);
  });
});

describe('performance settings', () => {
  it('accepts only the offered sleep choices', () => {
    const ws = defaultWorkspace();
    for (const m of [null, 5, 15, 30, 60]) expect(WorkspaceSchema.safeParse({ ...ws, performance: { sleepAfterMinutes: m } }).success).toBe(true);
    for (const m of [0, 1, 7, -5, '30']) expect(WorkspaceSchema.safeParse({ ...ws, performance: { sleepAfterMinutes: m } }).success).toBe(false);
  });
});

describe('zoom', () => {
  it('stores 25%..500% per app id, and zoom commands', () => {
    const ws = defaultWorkspace();
    expect(WorkspaceSchema.safeParse({ ...ws, zoom: { youtube: 1.25, 'custom-mail-abc123': 0.9 } }).success).toBe(true);
    expect(WorkspaceSchema.safeParse({ ...ws, zoom: { youtube: 7 } }).success).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...ws, zoom: { youtube: 0.1 } }).success).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...ws, zoom: { '../x': 1.1 } }).success).toBe(false);
    expect(ViewCommandSchema.safeParse({ leafId: 'leaf_1', command: 'zoom-in' }).success).toBe(true);
  });
});

describe('accounts', () => {
  const placement = { leafId: 'leaf_1', instanceId: 'app_1', appId: 'discord', profile: 'p2', bounds: { x: 0, y: 0, width: 10, height: 10 } };
  it('placements carry a known account id', () => {
    expect(PlacementsSchema.safeParse([placement]).success).toBe(true);
    for (const profile of ['', 'P2', 'p100', '../x', 'default2']) expect(PlacementsSchema.safeParse([{ ...placement, profile }]).success).toBe(false);
  });
  it('the workspace names extra accounts per app, never redefining the first', () => {
    const ws = defaultWorkspace();
    expect(WorkspaceSchema.safeParse({ ...ws, profiles: { discord: [{ id: 'p2', name: 'Work' }] } }).success).toBe(true);
    expect(WorkspaceSchema.safeParse({ ...ws, profiles: { discord: [{ id: 'default', name: 'Hijack' }] } }).success).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...ws, profiles: { discord: [{ id: 'p2', name: '' }] } }).success).toBe(false);
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 2}`, name: `A${i}` }));
    expect(WorkspaceSchema.safeParse({ ...ws, profiles: { discord: many } }).success).toBe(false);
  });
});

describe('http-allowed sites', () => {
  it('stores real hostnames only, once each', () => {
    const ws = defaultWorkspace();
    expect(WorkspaceSchema.safeParse({ ...ws, httpAllowedHosts: ['neverssl.com'] }).success).toBe(true);
    expect(WorkspaceSchema.safeParse({ ...ws, httpAllowedHosts: ['*'] }).success).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...ws, httpAllowedHosts: ['a.com', 'a.com'] }).success).toBe(false);
    expect(ViewCommandSchema.safeParse({ leafId: 'leaf_1', command: 'allow-http' }).success).toBe(true);
  });
});

describe('NoPayloadSchema (filters:status, filters:update)', () => {
  it('accepts no payload and rejects anything else', () => {
    expect(NoPayloadSchema.safeParse(undefined).success).toBe(true);
    for (const bad of [null, {}, 'update', 1, []]) expect(NoPayloadSchema.safeParse(bad).success).toBe(false);
  });
});

describe('ClearDataSchema (data:clear)', () => {
  it('accepts one app account or everything', () => {
    expect(ClearDataSchema.safeParse({ appId: 'discord', profile: 'default' }).success).toBe(true);
    expect(ClearDataSchema.safeParse({ appId: 'custom-ab12', profile: 'p3' }).success).toBe(true);
    expect(ClearDataSchema.safeParse({ all: true }).success).toBe(true);
  });

  it('rejects anything else', () => {
    for (const bad of [
      undefined,
      {},
      { all: false },
      { appId: 'discord' },
      { appId: '../x', profile: 'default' },
      { appId: 'discord', profile: 'evil' },
      { appId: 'discord', profile: 'default', all: true },
    ]) {
      expect(ClearDataSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('ViewsSyncSchema frame (window-resize placement)', () => {
  const layout = createLeaf(null);
  it('accepts a layout with the tile area margins, and stays optional', () => {
    expect(ViewsSyncSchema.safeParse({ placements: [], keep: [] }).success).toBe(true);
    expect(ViewsSyncSchema.safeParse({ placements: [], keep: [], frame: { layout, insets: { left: 62, top: 6, right: 6, bottom: 6 } } }).success).toBe(true);
  });

  it('rejects bad layouts and margins', () => {
    for (const frame of [
      { layout, insets: { left: -1, top: 6, right: 6, bottom: 6 } },
      { layout, insets: { left: 6, top: 6, right: 6 } },
      { layout: { type: 'leaf' }, insets: { left: 6, top: 6, right: 6, bottom: 6 } },
      { insets: { left: 6, top: 6, right: 6, bottom: 6 } },
    ]) {
      expect(ViewsSyncSchema.safeParse({ placements: [], keep: [], frame }).success, JSON.stringify(frame)).toBe(false);
    }
  });
});

describe('Browser tabs (D-049)', () => {
  const ok = (layout: LayoutNode) => WorkspaceSchema.safeParse(workspaceWith(layout)).success;
  const browser = (tabs: unknown, instanceId = 'app_1', appId = 'browser') =>
    ({ type: 'leaf', id: 'leaf_a', appId, instanceId, tabs }) as unknown as LayoutNode;

  it('accepts tabs with saved http(s) pages, including the one shown', () => {
    expect(ok(browser([{ instanceId: 'app_1', url: 'https://a.example/', title: 'A' }, { instanceId: 'app_2' }]))).toBe(true);
    const leaf = createLeaf('browser');
    expect(ok(addTab(leaf, leaf.id, 'https://b.example/').root)).toBe(true);
  });

  it('rejects tabs outside Browser tiles, without the shown tab, duplicated, or with other schemes', () => {
    expect(ok(browser([{ instanceId: 'app_1' }], 'app_1', 'discord'))).toBe(false);
    expect(ok(browser([{ instanceId: 'app_2' }, { instanceId: 'app_3' }]))).toBe(false);
    expect(ok(browser([{ instanceId: 'app_1' }, { instanceId: 'app_1' }]))).toBe(false);
    expect(ok(browser([]))).toBe(false);
    expect(ok(browser([{ instanceId: 'app_1', url: 'file:///etc/passwd' }]))).toBe(false);
    expect(ok(browser([{ instanceId: 'app_1', url: 'javascript:alert(1)' }]))).toBe(false);
    expect(ok(browser([{ instanceId: 'app_1', title: 'x'.repeat(301) }]))).toBe(false);
    expect(ok(browser([{ instanceId: 'app_1', extra: true }]))).toBe(false);
    expect(ok(browser(Array.from({ length: MAX_TABS + 1 }, (_, i) => ({ instanceId: `app_${i + 1}` }))))).toBe(false);
  });

  it('rejects a tab instance also used by another tile', () => {
    const layout: LayoutNode = {
      type: 'split',
      id: 'split_1',
      direction: 'row',
      ratio: 0.5,
      first: browser([{ instanceId: 'app_1' }, { instanceId: 'app_2' }]),
      second: { type: 'leaf', id: 'leaf_b', appId: 'discord', instanceId: 'app_2' },
    };
    expect(ok(layout)).toBe(false);
  });

  it('placements may carry an http(s) start page; keep lists cover hidden tabs', () => {
    const p = { leafId: 'leaf_1', instanceId: 'app_1', appId: 'browser', profile: 'default', bounds: { x: 0, y: 0, width: 10, height: 10 } };
    expect(PlacementsSchema.safeParse([{ ...p, url: 'https://a.example/' }]).success).toBe(true);
    expect(PlacementsSchema.safeParse([{ ...p, url: 'file:///etc/passwd' }]).success).toBe(false);
    const keep = Array.from({ length: MAX_TILES * 2 }, (_, i) => `app_${i + 10}`);
    expect(ViewsSyncSchema.safeParse({ placements: [p], keep }).success).toBe(true);
  });
});

describe('themes (ROADMAP 4.1)', () => {
  const imported = parseThemeFile('{"name":"Mine","colors":{"ink":"#000"}}', []);
  const theme = imported.ok ? imported.theme : null;

  it('stores imported themes and the chosen theme id', () => {
    expect(theme).not.toBeNull();
    const ws = { ...defaultWorkspace(), themes: [theme], ui: { ...defaultWorkspace().ui, theme: theme!.id } };
    expect(WorkspaceSchema.safeParse(ws).success).toBe(true);
  });

  it('rejects non-colour values, missing or extra keys, built-in ids and duplicates', () => {
    const bad = [
      { ...theme!, colors: { ...theme!.colors, ink: 'url(https://x.test/)' } },
      { ...theme!, colors: { ...theme!.colors, extra: '#000' } },
      { ...theme!, colors: { ink: '#000' } },
      { ...theme!, id: 'dark' },
    ];
    for (const t of bad) expect(WorkspaceSchema.safeParse({ ...defaultWorkspace(), themes: [t] }).success).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...defaultWorkspace(), themes: [theme, theme] }).success).toBe(false);
  });
});

describe('custom CSS (ROADMAP 4.3)', () => {
  it('stores CSS per app id within the size limit', () => {
    const ok = { ...defaultWorkspace(), appCss: { reddit: { css: 'aside{display:none}', enabled: true } } };
    expect(WorkspaceSchema.safeParse(ok).success).toBe(true);
    for (const appCss of [{ 'bad id!': { css: '', enabled: true } }, { reddit: { css: 'x'.repeat(50_001), enabled: true } }, { reddit: { css: '', enabled: 'yes' } }]) {
      expect(WorkspaceSchema.safeParse({ ...defaultWorkspace(), appCss }).success).toBe(false);
    }
  });
});

describe('plugins (ROADMAP 4.4)', () => {
  it('plugins:remove takes a plugin id only', () => {
    for (const ok of ['youtube-hide-shorts', 'a', 'x1']) expect(PluginId.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['', '../x', 'A', '-x', 'a/b', 'a'.repeat(41), 1, null]) expect(PluginId.safeParse(bad).success, String(bad)).toBe(false);
  });

  it('the workspace lists enabled plugin ids, once each', () => {
    expect(WorkspaceSchema.safeParse({ ...defaultWorkspace(), enabledPlugins: ['youtube-hide-shorts'] }).success).toBe(true);
    expect(WorkspaceSchema.safeParse({ ...defaultWorkspace(), enabledPlugins: ['a', 'a'] }).success).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...defaultWorkspace(), enabledPlugins: ['../a'] }).success).toBe(false);
  });

  it('manifests list plain file names of the right type, and no permissions yet', () => {
    const base = { id: 'p', name: 'P', version: '1.2.3', apps: ['youtube'], scripts: ['a.js'] };
    expect(PluginManifestSchema.safeParse(base).success).toBe(true);
    for (const patch of [{ scripts: ['a.css'] }, { styles: ['a.js'] }, { scripts: ['.hidden.js'] }, { scripts: ['dir/a.js'] }, { version: 'v1' }, { permissions: ['net'] }, { apps: ['a', 'a'] }]) {
      expect(PluginManifestSchema.safeParse({ ...base, ...patch }).success, JSON.stringify(patch)).toBe(false);
    }
  });
});

describe('space templates (ROADMAP 4.6)', () => {
  it('stores saved layouts under the same tile limits as spaces', () => {
    const ws = defaultWorkspace();
    const tpl = { id: 'tpl_1', name: 'Gaming', layout: layoutWithTiles(3) };
    expect(WorkspaceSchema.safeParse({ ...ws, templates: [tpl] }).success).toBe(true);
    for (const bad of [{ ...tpl, layout: layoutWithTiles(MAX_TILES + 1) }, { ...tpl, name: '' }, { ...tpl, extra: 1 }]) {
      expect(WorkspaceSchema.safeParse({ ...ws, templates: [bad] }).success).toBe(false);
    }
    expect(WorkspaceSchema.safeParse({ ...ws, templates: [tpl, tpl] }).success).toBe(false);
  });
});

describe('Chrome extensions (ROADMAP 4.5)', () => {
  it('extensions:remove and the workspace take store ids or local-<name> only', () => {
    for (const ok of ['eimadpbcbfnmbkopoojfekhnkhdbieeh', 'local-my-tool']) expect(ExtensionId.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['', 'eimadpbcbfnmbkopoojfekhnkhdbiee', 'EIMADPBCBFNMBKOPOOJFEKHNKHDBIEEH', 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', 'local-', 'local-../x', 1]) {
      expect(ExtensionId.safeParse(bad).success, String(bad)).toBe(false);
    }
    expect(WorkspaceSchema.safeParse({ ...defaultWorkspace(), extensions: { youtube: ['local-my-tool'] } }).success).toBe(true);
    expect(WorkspaceSchema.safeParse({ ...defaultWorkspace(), extensions: { youtube: ['local-a', 'local-a'] } }).success).toBe(false);
  });

  it('extensions:install-store takes a link-sized string; extensions:open a tile, id and page kind', () => {
    expect(ExtensionStoreInputSchema.safeParse('https://chromewebstore.google.com/detail/x/eimadpbcbfnmbkopoojfekhnkhdbieeh').success).toBe(true);
    for (const bad of ['short', 'x'.repeat(3000), 42]) expect(ExtensionStoreInputSchema.safeParse(bad).success).toBe(false);
    expect(ExtensionOpenSchema.safeParse({ leafId: 'leaf_1', extensionId: 'local-a', page: 'popup' }).success).toBe(true);
    for (const bad of [{ leafId: 'leaf_1', extensionId: 'local-a', page: 'background' }, { leafId: 'leaf_1', extensionId: 'x', page: 'popup' }, { leafId: 'leaf_1', extensionId: 'local-a', page: 'popup', url: 'x' }]) {
      expect(ExtensionOpenSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('update settings (ROADMAP 5.4)', () => {
  it('stores automatic update checks as a switch, nothing else', () => {
    expect(defaultWorkspace().updates).toEqual({ auto: true });
    expect(WorkspaceSchema.safeParse({ ...defaultWorkspace(), updates: { auto: false } }).success).toBe(true);
    for (const updates of [{ auto: 'yes' }, { auto: true, feed: 'http://x' }, {}]) {
      expect(WorkspaceSchema.safeParse({ ...defaultWorkspace(), updates }).success).toBe(false);
    }
  });
});
