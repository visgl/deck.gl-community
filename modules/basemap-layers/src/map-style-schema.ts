import {z} from 'zod';
import type {
  BasemapSource,
  BasemapStyle,
  BasemapStyleLayer,
  ResolvedBasemapStyleLayer,
  ResolvedBasemapStyle
} from './style-resolver';

/** Zod schema for a basemap source entry. */
export const BasemapSourceSchema = z
  .object({
    type: z.string().optional(),
    url: z.string().optional(),
    tiles: z.array(z.string()).optional(),
    minzoom: z.number().optional(),
    maxzoom: z.number().optional(),
    tileSize: z.number().optional()
  })
  .catchall(z.unknown()) satisfies z.ZodType<BasemapSource>;

/** Zod schema for a basemap style layer entry. */
export const BasemapStyleLayerSchema = z
  .object({
    id: z.string(),
    type: z.string().optional(),
    ref: z.string().optional(),
    source: z.string().optional(),
    'source-layer': z.string().optional(),
    minzoom: z.number().optional(),
    maxzoom: z.number().optional(),
    filter: z.array(z.unknown()).optional(),
    paint: z.record(z.string(), z.unknown()).optional(),
    layout: z.record(z.string(), z.unknown()).optional()
  })
  .catchall(z.unknown())
  .superRefine((layer, context) => {
    if (!layer.type && !layer.ref) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Style layers must define either "type" or "ref".',
        path: ['type']
      });
    }
  }) satisfies z.ZodType<BasemapStyleLayer>;

const ResolvedBasemapStyleLayerSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    source: z.string().optional(),
    'source-layer': z.string().optional(),
    minzoom: z.number().optional(),
    maxzoom: z.number().optional(),
    filter: z.array(z.unknown()).optional(),
    paint: z.record(z.string(), z.unknown()).optional(),
    layout: z.record(z.string(), z.unknown()).optional()
  })
  .catchall(z.unknown()) satisfies z.ZodType<ResolvedBasemapStyleLayer>;

/** Zod schema for a MapLibre / Mapbox style document. */
export const BasemapStyleSchema = z
  .object({
    version: z.number().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    sources: z.record(z.string(), BasemapSourceSchema).optional(),
    layers: z.array(BasemapStyleLayerSchema).optional()
  })
  .catchall(z.unknown()) satisfies z.ZodType<BasemapStyle>;

/** Zod schema for a fully resolved basemap style document. */
export const ResolvedBasemapStyleSchema = z
  .object({
    version: z.number().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    sources: z.record(z.string(), BasemapSourceSchema),
    layers: z.array(ResolvedBasemapStyleLayerSchema)
  })
  .catchall(z.unknown()) satisfies z.ZodType<ResolvedBasemapStyle>;
