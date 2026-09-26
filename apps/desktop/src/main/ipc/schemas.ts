import { z } from 'zod';
import { isWebUrl, listLeaves, MAX_TILES, SEARCH_ENGINES, type LayoutNode, type SearchEngineId, type Workspace } from '@aio/core';

/** Every IPC payload from the renderer is untrusted until parsed here. */

const unique = (xs: string[]): boolean => new Set(xs).size === xs.length;

export const SearchEngineSchema = z.enum(Object.keys(SEARCH_ENGINES) as [SearchEngineId, ...SearchEngineId[]]);

const Id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
export { MAX_TILES };

const LeafSchema = z
  .object({ type: z.literal('leaf'), id: Id, appId: Id.nullable(), instanceId: Id.nullable() })
  .refine((l) => (l.appId === null) === (l.instanceId === null), 'a tile has an instance exactly when it has an app');

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

export const PrivacySchema = z.object({
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

export const WorkspaceSchema: z.ZodType<Workspace> = z.object({
  version: z.number().int(),
  spaces: z
    .array(
      z.object({
        id: Id,
        name: z.string().min(1).max(40),
        layout: LayoutSchema.refine((l) => listLeaves(l).length <= MAX_TILES, 'too many tiles').refine((l) => {
          const leaves = listLeaves(l);
          return unique(leaves.map((x) => x.id)) && unique(leaves.flatMap((x) => (x.instanceId ? [x.instanceId] : [])));
        }, 'duplicate tile or instance'),
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
});

const Bound = z.number().int().min(0).max(20000);

export const PlacementsSchema = z
  .array(
    z.object({
      leafId: Id,
      instanceId: Id,
      appId: Id,
      bounds: z.object({ x: Bound, y: Bound, width: Bound, height: Bound }),
    }),
  )
  .max(MAX_TILES)
  .refine((ps) => unique(ps.map((p) => p.instanceId)) && unique(ps.map((p) => p.leafId)), 'duplicate tile or instance');

export const ViewCommandSchema = z.object({
  leafId: Id,
  command: z.enum(['back', 'forward', 'reload', 'home']),
});

/** `null` means "give keyboard focus to the UI". */
export const ViewFocusSchema = z.object({ leafId: Id.nullable() });

/** Browser tile address bar. Only http(s) URLs; main also refuses non-Browser tiles. */
export const ViewNavigateSchema = z.object({
  leafId: Id,
  url: z.string().max(8192).refine(isWebUrl, 'only http(s) URLs'),
});
