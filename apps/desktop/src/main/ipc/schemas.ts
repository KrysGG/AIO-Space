import { z } from 'zod';
import { listLeaves, type LayoutNode, type Workspace } from '@aio/core';

/** Every IPC payload from the renderer is untrusted until parsed here. */

const Id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const MAX_TILES = 16;

const LeafSchema = z.object({ type: z.literal('leaf'), id: Id, appId: Id.nullable() });

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
        layout: LayoutSchema.refine((l) => listLeaves(l).length <= MAX_TILES, 'too many tiles'),
        focusedLeafId: Id.nullable(),
      }),
    )
    .min(1)
    .max(20),
  activeSpaceId: Id,
  privacy: PrivacySchema,
  privacyOverrides: z.record(Id, PrivacySchema.partial()),
});

const Bound = z.number().int().min(0).max(20000);

export const PlacementsSchema = z
  .array(
    z.object({
      leafId: Id,
      appId: Id,
      bounds: z.object({ x: Bound, y: Bound, width: Bound, height: Bound }),
    }),
  )
  .max(MAX_TILES);

export const ViewCommandSchema = z.object({
  leafId: Id,
  command: z.enum(['back', 'forward', 'reload', 'home']),
});
