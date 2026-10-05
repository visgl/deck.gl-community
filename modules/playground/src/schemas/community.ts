// deck.gl-community
// SPDX-License-Identifier: MIT
import {CommunityVisualLayerSchemas} from './community-visual-layers';
import {CommunityGeoLayerSchemas} from './community-geo-layers';
import {CommunityDataLayerSchemas} from './community-data-layers';
import type {z} from 'zod';

export * from './community-visual-layers';
export * from './community-geo-layers';
export * from './community-data-layers';

/** JSON schemas for concrete public community layers, without importing their constructors. */
export const CommunityLayerSchemas: Record<string, z.ZodObject> = {
  ...CommunityVisualLayerSchemas,
  ...CommunityGeoLayerSchemas,
  ...CommunityDataLayerSchemas
};
