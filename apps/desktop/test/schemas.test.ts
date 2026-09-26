import { describe, expect, it } from 'vitest';
import { createLeaf, defaultWorkspace, makeCustomApp, splitLeaf, type LayoutNode, type WebAppDef } from '@aio/core';
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
  const placement = { leafId: 'leaf_1', instanceId: 'app_1', appId: 'discord', bounds: { x: 62, y: 40, width: 800, height: 600 } };

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
  const placement = { leafId: 'leaf_1', instanceId: 'app_1', appId: 'discord', bounds: { x: 0, y: 0, width: 10, height: 10 } };
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
