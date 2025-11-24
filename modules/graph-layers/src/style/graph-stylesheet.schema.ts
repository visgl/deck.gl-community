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
export type GraphStyleRule<
  TType extends GraphStyleType = GraphStyleType,
  TValue = GraphStyleLeafValue
> = {type: TType} &
  GraphStylePropertyMap<TType, TValue> &
  Partial<Record<GraphStyleSelector, GraphStylePropertyMap<TType, TValue>>>;

const GraphStyleSelectorKeySchema = z.string().regex(/^:[^\s]+/, 'Selectors must start with ":".');

function createSelectorRefinement(
  allowedKeys: readonly string[],
  propertiesSchema: ZodTypeAny
) {
  const allowedKeySet = new Set<string>(allowedKeys);

  return (value: unknown, ctx: z.RefinementCtx) => {
    if (typeof value !== 'object' || value === null) {
      return;
    }

    const record = value as Record<string, unknown>;

    for (const key of Object.keys(record)) {
      if (key === 'type') continue;
      if (allowedKeySet.has(key)) continue;

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

      const selectorResult = propertiesSchema.safeParse(record[key]);
      if (!selectorResult.success) {
        for (const issue of selectorResult.error.issues) {
          ctx.addIssue({
            ...issue,
            path: [key, ...(issue.path ?? [])]
          });
        }
      }
    }
  };
}

const CircleShape = {
  offset: GraphStyleValueSchema.optional(),
  opacity: GraphStyleValueSchema.optional(),
  fill: GraphStyleValueSchema.optional(),
  stroke: GraphStyleValueSchema.optional(),
  strokeWidth: GraphStyleValueSchema.optional(),
  radius: GraphStyleValueSchema.optional()
} as const;

const CirclePropertiesSchema = z.object(CircleShape).partial().strict();

const CircleStylesheetSchema = z
  .object({
    type: z.literal('circle'),
    ...CircleShape
  })
  .catchall(z.unknown())
  .superRefine(
    createSelectorRefinement(Object.keys(CircleShape), CirclePropertiesSchema)
  );

const RectangleShape = {
  offset: GraphStyleValueSchema.optional(),
  opacity: GraphStyleValueSchema.optional(),
  width: GraphStyleValueSchema.optional(),
  height: GraphStyleValueSchema.optional(),
  fill: GraphStyleValueSchema.optional(),
  stroke: GraphStyleValueSchema.optional(),
  strokeWidth: GraphStyleValueSchema.optional()
} as const;

const RectanglePropertiesSchema = z.object(RectangleShape).partial().strict();

const RectangleStylesheetSchema = z
  .object({
    type: z.literal('rectangle'),
    ...RectangleShape
  })
  .catchall(z.unknown())
  .superRefine(
    createSelectorRefinement(
      Object.keys(RectangleShape),
      RectanglePropertiesSchema
    )
  );

const RoundedRectangleShape = {
  offset: GraphStyleValueSchema.optional(),
  opacity: GraphStyleValueSchema.optional(),
  cornerRadius: GraphStyleValueSchema.optional(),
  radius: GraphStyleValueSchema.optional(),
  width: GraphStyleValueSchema.optional(),
  height: GraphStyleValueSchema.optional(),
  fill: GraphStyleValueSchema.optional(),
  stroke: GraphStyleValueSchema.optional(),
  strokeWidth: GraphStyleValueSchema.optional()
} as const;

const RoundedRectanglePropertiesSchema = z
  .object(RoundedRectangleShape)
  .partial()
  .strict();

const RoundedRectangleStylesheetSchema = z
  .object({
    type: z.literal('rounded-rectangle'),
    ...RoundedRectangleShape
  })
  .catchall(z.unknown())
  .superRefine(
    createSelectorRefinement(
      Object.keys(RoundedRectangleShape),
      RoundedRectanglePropertiesSchema
    )
  );

const PathRoundedRectangleShape = {
  offset: GraphStyleValueSchema.optional(),
  opacity: GraphStyleValueSchema.optional(),
  width: GraphStyleValueSchema.optional(),
  height: GraphStyleValueSchema.optional(),
  fill: GraphStyleValueSchema.optional(),
  stroke: GraphStyleValueSchema.optional(),
  strokeWidth: GraphStyleValueSchema.optional(),
  cornerRadius: GraphStyleValueSchema.optional()
} as const;

const PathRoundedRectanglePropertiesSchema = z
  .object(PathRoundedRectangleShape)
  .partial()
  .strict();

const PathRoundedRectangleStylesheetSchema = z
  .object({
    type: z.literal('path-rounded-rectangle'),
    ...PathRoundedRectangleShape
  })
  .catchall(z.unknown())
  .superRefine(
    createSelectorRefinement(
      Object.keys(PathRoundedRectangleShape),
      PathRoundedRectanglePropertiesSchema
    )
  );

const LabelShape = {
  offset: GraphStyleValueSchema.optional(),
  opacity: GraphStyleValueSchema.optional(),
  color: GraphStyleValueSchema.optional(),
  text: GraphStyleValueSchema.optional(),
  fontSize: GraphStyleValueSchema.optional(),
  textAnchor: GraphStyleValueSchema.optional(),
  alignmentBaseline: GraphStyleValueSchema.optional(),
  angle: GraphStyleValueSchema.optional(),
  scaleWithZoom: GraphStyleValueSchema.optional(),
  textMaxWidth: GraphStyleValueSchema.optional(),
  textWordBreak: GraphStyleValueSchema.optional(),
  textSizeMinPixels: GraphStyleValueSchema.optional()
} as const;

const LabelPropertiesSchema = z.object(LabelShape).partial().strict();

const LabelStylesheetSchema = z
  .object({
    type: z.literal('label'),
    ...LabelShape
  })
  .catchall(z.unknown())
  .superRefine(
    createSelectorRefinement(Object.keys(LabelShape), LabelPropertiesSchema)
  );

const MarkerShape = {
  offset: GraphStyleValueSchema.optional(),
  opacity: GraphStyleValueSchema.optional(),
  fill: GraphStyleValueSchema.optional(),
  size: GraphStyleValueSchema.optional(),
  marker: GraphStyleValueSchema.optional(),
  scaleWithZoom: GraphStyleValueSchema.optional()
} as const;

const MarkerPropertiesSchema = z.object(MarkerShape).partial().strict();

const MarkerStylesheetSchema = z
  .object({
    type: z.literal('marker'),
    ...MarkerShape
  })
  .catchall(z.unknown())
  .superRefine(
    createSelectorRefinement(Object.keys(MarkerShape), MarkerPropertiesSchema)
  );

const EdgeUpperShape = {
  stroke: GraphStyleValueSchema.optional(),
  strokeWidth: GraphStyleValueSchema.optional()
} as const;

const EdgeUpperPropertiesSchema = z.object(EdgeUpperShape).partial().strict();

const EdgeUpperStylesheetSchema = z
  .object({
    type: z.literal('Edge'),
    ...EdgeUpperShape
  })
  .catchall(z.unknown())
  .superRefine(
    createSelectorRefinement(
      Object.keys(EdgeUpperShape),
      EdgeUpperPropertiesSchema
    )
  );

const EdgeLowerShape = {
  stroke: GraphStyleValueSchema.optional(),
  strokeWidth: GraphStyleValueSchema.optional()
} as const;

const EdgeLowerPropertiesSchema = z.object(EdgeLowerShape).partial().strict();

const EdgeLowerStylesheetSchema = z
  .object({
    type: z.literal('edge'),
    ...EdgeLowerShape
  })
  .catchall(z.unknown())
  .superRefine(
    createSelectorRefinement(
      Object.keys(EdgeLowerShape),
      EdgeLowerPropertiesSchema
    )
  );

const EdgeLabelShape = {
  color: GraphStyleValueSchema.optional(),
  text: GraphStyleValueSchema.optional(),
  fontSize: GraphStyleValueSchema.optional(),
  textAnchor: GraphStyleValueSchema.optional(),
  alignmentBaseline: GraphStyleValueSchema.optional(),
  scaleWithZoom: GraphStyleValueSchema.optional(),
  textMaxWidth: GraphStyleValueSchema.optional(),
  textWordBreak: GraphStyleValueSchema.optional(),
  textSizeMinPixels: GraphStyleValueSchema.optional()
} as const;

const EdgeLabelPropertiesSchema = z.object(EdgeLabelShape).partial().strict();

const EdgeLabelStylesheetSchema = z
  .object({
    type: z.literal('edge-label'),
    ...EdgeLabelShape
  })
  .catchall(z.unknown())
  .superRefine(
    createSelectorRefinement(
      Object.keys(EdgeLabelShape),
      EdgeLabelPropertiesSchema
    )
  );

const FlowShape = {
  color: GraphStyleValueSchema.optional(),
  width: GraphStyleValueSchema.optional(),
  speed: GraphStyleValueSchema.optional(),
  tailLength: GraphStyleValueSchema.optional()
} as const;

const FlowPropertiesSchema = z.object(FlowShape).partial().strict();

const FlowStylesheetSchema = z
  .object({
    type: z.literal('flow'),
    ...FlowShape
  })
  .catchall(z.unknown())
  .superRefine(
    createSelectorRefinement(Object.keys(FlowShape), FlowPropertiesSchema)
  );

const ArrowShape = {
  color: GraphStyleValueSchema.optional(),
  size: GraphStyleValueSchema.optional(),
  offset: GraphStyleValueSchema.optional()
} as const;

const ArrowPropertiesSchema = z.object(ArrowShape).partial().strict();

const ArrowStylesheetSchema = z
  .object({
    type: z.literal('arrow'),
    ...ArrowShape
  })
  .catchall(z.unknown())
  .superRefine(
    createSelectorRefinement(Object.keys(ArrowShape), ArrowPropertiesSchema)
  );

const GraphNodeStylesheetVariants = [
  CircleStylesheetSchema,
  RectangleStylesheetSchema,
  RoundedRectangleStylesheetSchema,
  PathRoundedRectangleStylesheetSchema,
  LabelStylesheetSchema,
  MarkerStylesheetSchema
];

const GraphEdgeStylesheetVariants = [
  EdgeUpperStylesheetSchema,
  EdgeLowerStylesheetSchema,
  EdgeLabelStylesheetSchema,
  FlowStylesheetSchema,
  ArrowStylesheetSchema
];

const GraphStyleRuleVariants = [
  ...GraphNodeStylesheetVariants,
  ...GraphEdgeStylesheetVariants
];

type GraphStyleRuleVariantSchema = (typeof GraphStyleRuleVariants)[number];

/**
 * Schema that validates stylesheet definitions for all graph style primitives.
 */
export const GraphStyleRuleSchema = z.discriminatedUnion(
  'type',
  GraphStyleRuleVariants as [
    GraphStyleRuleVariantSchema,
    ...GraphStyleRuleVariantSchema[]
  ]
);

/**
 * Runtime type accepted by {@link GraphStylesheetSchema} before validation.
 */
export type GraphStyleRuleInput = z.input<typeof GraphStyleRuleSchema>;
/**
 * Type returned by {@link GraphStylesheetSchema} after successful parsing.
 */
export type GraphStyleRuleParsed = z.infer<typeof GraphStyleRuleSchema>;

const GraphNodeStyleRuleSchema = z.discriminatedUnion(
  'type',
  GraphNodeStylesheetVariants as [
    (typeof GraphNodeStylesheetVariants)[number],
    ...(typeof GraphNodeStylesheetVariants)[number][]
  ]
);

const GraphEdgeStyleRuleSchema = z.discriminatedUnion(
  'type',
  GraphEdgeStylesheetVariants as [
    (typeof GraphEdgeStylesheetVariants)[number],
    ...(typeof GraphEdgeStylesheetVariants)[number][]
  ]
);

const GraphEdgeBaseRuleSchema = z.discriminatedUnion('type', [
  EdgeUpperStylesheetSchema,
  EdgeLowerStylesheetSchema
] as [typeof EdgeUpperStylesheetSchema, typeof EdgeLowerStylesheetSchema]);

const GraphEdgeDecoratorRuleSchema = z.discriminatedUnion(
  'type',
  [EdgeLabelStylesheetSchema, FlowStylesheetSchema, ArrowStylesheetSchema] as [
    typeof EdgeLabelStylesheetSchema,
    typeof FlowStylesheetSchema,
    typeof ArrowStylesheetSchema,
    ...Array<
      typeof EdgeLabelStylesheetSchema | typeof FlowStylesheetSchema | typeof ArrowStylesheetSchema
    >
  ]
);

const GraphEdgeRuleWithDecoratorsSchema = GraphEdgeBaseRuleSchema.and(
  z.object({decorators: z.array(GraphEdgeDecoratorRuleSchema).optional()}).strict()
);

/**
 * Schema that validates a full graph stylesheet including nodes, edges, and decorators.
 */
export const GraphStylesheetSchema = z
  .object({
    nodes: z.array(GraphNodeStyleRuleSchema).optional(),
    edges: z.union([GraphEdgeRuleWithDecoratorsSchema, z.array(GraphEdgeRuleWithDecoratorsSchema)])
      .optional()
  })
  .strict();

/**
 * Runtime type accepted by {@link GraphStylesheetSchema} before validation.
 */
export type GraphStylesheetInput = z.input<typeof GraphStylesheetSchema>;
/**
 * Type returned by {@link GraphStylesheetSchema} after successful parsing.
 */
export type GraphStylesheet = z.infer<typeof GraphStylesheetSchema>;

/**
 * Runtime type accepted by {@link GraphStyleRuleSchema} before validation.
 */
export type GraphStylesheetRuleInput = GraphStyleRuleInput;
/**
 * Type returned by {@link GraphStyleRuleSchema} after successful parsing.
 */
export type GraphStylesheetRule = GraphStyleRuleParsed;
