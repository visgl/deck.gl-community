// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable no-continue */

import {z, type ZodTypeAny} from 'zod';

const GraphStylePrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
]);

const GraphStyleFunctionSchema = z.custom<(...args: unknown[]) => unknown>(
  (value) => typeof value === 'function',
  {
    message: 'Style functions must be callable.'
  }
);

/**
 * Supported scale identifiers for mapping data values to visual encodings.
 */
export const GraphStyleScaleTypeEnum = z.enum([
  'linear',
  'log',
  'pow',
  'sqrt',
  'quantize',
  'quantile',
  'ordinal'
]);

/**
 * TypeScript union of {@link GraphStyleScaleTypeEnum} values.
 */
export type GraphStyleScaleType = z.infer<typeof GraphStyleScaleTypeEnum>;

/**
 * Configuration for data-driven style scaling. Supports deck.gl compatible numeric and
 * categorical scaling with optional d3-scale like parameters.
 */
export const GraphStyleScaleSchema = z
  .object({
    type: GraphStyleScaleTypeEnum.optional(),
    domain: z.array(z.union([z.number(), z.string()])).optional(),
    range: z.array(z.any()).optional(),
    clamp: z.boolean().optional(),
    nice: z.union([z.boolean(), z.number()]).optional(),
    base: z.number().optional(),
    exponent: z.number().optional(),
    unknown: z.any().optional()
  })
  .strict();

/**
 * TypeScript view of {@link GraphStyleScaleSchema} after parsing.
 */
export type GraphStyleScale = z.infer<typeof GraphStyleScaleSchema>;

/**
 * Reference to node/edge attributes, optionally including fallback values and scale
 * configuration for data-driven styling.
 */
export const GraphStyleAttributeReferenceSchema = z.union([
  z
    .string()
    .regex(/^@.+/, 'Attribute reference strings must start with "@" and include an attribute name.'),
  z
    .object({
      attribute: z.string().min(1, 'Attribute name is required.'),
      fallback: GraphStylePrimitiveSchema.optional(),
      scale: z.union([GraphStyleScaleSchema, GraphStyleFunctionSchema]).optional()
    })
    .strict()
]);

/**
 * Parsed value produced by {@link GraphStyleAttributeReferenceSchema}.
 */
export type GraphStyleAttributeReference = z.infer<typeof GraphStyleAttributeReferenceSchema>;

/**
 * Primitive value allowed in stylesheet definitions. Supports literal values, attribute
 * references and imperative resolver functions.
 */
export const GraphStyleLeafValueSchema = z.union([
  GraphStylePrimitiveSchema,
  GraphStyleAttributeReferenceSchema,
  GraphStyleFunctionSchema
]);

/**
 * Union of literal, attribute-driven and functional style values.
 */
export type GraphStyleLeafValue = z.infer<typeof GraphStyleLeafValueSchema>;

const RESERVED_STATE_KEYS = new Set(['attribute', 'fallback', 'scale']);

/**
 * Mapping of interaction or application state keys to leaf style values.
 */
export const GraphStyleStateMapSchema = z.record(
  z
    .string()
    .refine((key) => !RESERVED_STATE_KEYS.has(key), 'State overrides must not use reserved keys.'),
  GraphStyleLeafValueSchema
);

/**
 * Style value that may be either a simple leaf value or a keyed map of overrides.
 */
export const GraphStyleValueSchema = z.union([
  GraphStyleLeafValueSchema,
  GraphStyleStateMapSchema
]);

/**
 * Parsed style property value that may include state overrides.
 */
export type GraphStyleValue = z.infer<typeof GraphStyleValueSchema>;

const COMMON_DECKGL_PROPS = {
  getOffset: 'offset',
  opacity: 'opacity'
} as const;

/**
 * Translation table between graph style properties and the underlying deck.gl accessors for
 * each supported style primitive type.
 */
export const GRAPH_DECKGL_ACCESSOR_MAP = {
  circle: {
    ...COMMON_DECKGL_PROPS,
    getFillColor: 'fill',
    getLineColor: 'stroke',
    getLineWidth: 'strokeWidth',
    getRadius: 'radius'
  },

  rectangle: {
    ...COMMON_DECKGL_PROPS,
    getWidth: 'width',
    getHeight: 'height',
    getFillColor: 'fill',
    getLineColor: 'stroke',
    getLineWidth: 'strokeWidth'
  },

  'rounded-rectangle': {
    ...COMMON_DECKGL_PROPS,
    getCornerRadius: 'cornerRadius',
    getRadius: 'radius',
    getWidth: 'width',
    getHeight: 'height',
    getFillColor: 'fill',
    getLineColor: 'stroke',
    getLineWidth: 'strokeWidth'
  },

  'path-rounded-rectangle': {
    ...COMMON_DECKGL_PROPS,
    getWidth: 'width',
    getHeight: 'height',
    getFillColor: 'fill',
    getLineColor: 'stroke',
    getLineWidth: 'strokeWidth',
    getCornerRadius: 'cornerRadius'
  },

  label: {
    ...COMMON_DECKGL_PROPS,
    getColor: 'color',
    getText: 'text',
    getSize: 'fontSize',
    getTextAnchor: 'textAnchor',
    getAlignmentBaseline: 'alignmentBaseline',
    getAngle: 'angle',
    scaleWithZoom: 'scaleWithZoom',
    textMaxWidth: 'textMaxWidth',
    textWordBreak: 'textWordBreak',
    textSizeMinPixels: 'textSizeMinPixels'
  },

  marker: {
    ...COMMON_DECKGL_PROPS,
    getColor: 'fill',
    getSize: 'size',
    getMarker: 'marker',
    scaleWithZoom: 'scaleWithZoom'
  },

  Edge: {
    getColor: 'stroke',
    getWidth: 'strokeWidth'
  },
  edge: {
    getColor: 'stroke',
    getWidth: 'strokeWidth'
  },
  'edge-label': {
    getColor: 'color',
    getText: 'text',
    getSize: 'fontSize',
    getTextAnchor: 'textAnchor',
    getAlignmentBaseline: 'alignmentBaseline',
    scaleWithZoom: 'scaleWithZoom',
    textMaxWidth: 'textMaxWidth',
    textWordBreak: 'textWordBreak',
    textSizeMinPixels: 'textSizeMinPixels'
  },
  flow: {
    getColor: 'color',
    getWidth: 'width',
    getSpeed: 'speed',
    getTailLength: 'tailLength'
  },
  arrow: {
    getColor: 'color',
    getSize: 'size',
    getOffset: 'offset'
  }
} as const;

/**
 * Supported graph style primitive identifiers (e.g. `circle`, `edge`).
 */
export type GraphStyleType = keyof typeof GRAPH_DECKGL_ACCESSOR_MAP;

/**
 * CSS-like pseudo selector supported by the stylesheet for state overrides.
 */
export type GraphStyleSelector = `:${string}`;

type GraphStylePropertyKey<TType extends GraphStyleType> = Extract<
  (typeof GRAPH_DECKGL_ACCESSOR_MAP)[TType][keyof (typeof GRAPH_DECKGL_ACCESSOR_MAP)[TType]],
  PropertyKey
>;

type GraphStyleStatefulValue<TValue> = TValue | {[state: string]: TValue};

type GraphStylePropertyMap<TType extends GraphStyleType, TValue> = Partial<
  Record<GraphStylePropertyKey<TType>, GraphStyleStatefulValue<TValue>>
>;

/**
 * Typed representation of a stylesheet definition for a specific graph primitive.
 */
export type GraphStylesheet<
  TType extends GraphStyleType = GraphStyleType,
  TValue = GraphStyleLeafValue
> = {type: TType} &
  GraphStylePropertyMap<TType, TValue> &
  Partial<Record<GraphStyleSelector, GraphStylePropertyMap<TType, TValue>>>;

const GraphStyleSelectorKeySchema = z.string().regex(/^:[^\s]+/, 'Selectors must start with ":".');

function createPropertiesSchema(keys: readonly string[]) {
  const shape = keys.reduce<Record<string, ZodTypeAny>>((acc, key) => {
    acc[key] = GraphStyleValueSchema.optional();
    return acc;
  }, {});
  return z.object(shape).partial().strict();
}

const GraphStylesheetVariants = (
  Object.entries(GRAPH_DECKGL_ACCESSOR_MAP) as Array<
    [GraphStyleType, (typeof GRAPH_DECKGL_ACCESSOR_MAP)[GraphStyleType]]
  >
).map(([type, accessors]) => {
  const propertyKeys = Object.values(accessors);
  const propertyKeySet = new Set<string>(propertyKeys);
  const propertiesSchema = createPropertiesSchema(propertyKeys);
  const baseShape: Record<string, ZodTypeAny> = {
    type: z.literal(type)
  };
  for (const key of propertyKeys) {
    baseShape[key] = GraphStyleValueSchema.optional();
  }

  return z
    .object(baseShape)
    .catchall(z.unknown())
    .superRefine((value, ctx) => {
      for (const key of Object.keys(value)) {
        if (key === 'type') {
          continue;
        }
        if (propertyKeySet.has(key)) {
          continue;
        }
        if (!key.startsWith(':')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `Unknown style property "${key}".`
          });
          continue;
        }
        if (!GraphStyleSelectorKeySchema.safeParse(key).success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: 'Selectors must start with ":".'
          });
          continue;
        }
        const selectorResult = propertiesSchema.safeParse(value[key]);
        if (!selectorResult.success) {
          for (const issue of selectorResult.error.issues) {
            ctx.addIssue({
              ...issue,
              path: [key, ...(issue.path ?? [])]
            });
          }
        }
      }
    });
});

type GraphStylesheetVariantSchema = (typeof GraphStylesheetVariants)[number];

/**
 * Schema that validates stylesheet definitions for all graph style primitives.
 */
export const GraphStylesheetSchema = z.discriminatedUnion(
  'type',
  GraphStylesheetVariants as [
    GraphStylesheetVariantSchema,
    ...GraphStylesheetVariantSchema[]
  ]
);

/**
 * Runtime type accepted by {@link GraphStylesheetSchema} before validation.
 */
export type GraphStylesheetInput = z.input<typeof GraphStylesheetSchema>;
/**
 * Type returned by {@link GraphStylesheetSchema} after successful parsing.
 */
export type GraphStylesheetParsed = z.infer<typeof GraphStylesheetSchema>;
