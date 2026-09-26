// deck.gl-community
// SPDX-License-Identifier: MIT
import {z} from 'zod';

/** JSON values; opaque payloads cannot contain functions, GPU objects or promises. */
export type JsonValue = string | number | boolean | null | JsonValue[] | {[key: string]: JsonValue};
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema)
  ])
);
export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);
/** Calls a named function registered with JSONConverter; does not contain JavaScript source. */
export const JsonFunctionSchema = z
  .object({'@@function': z.string().min(1)})
  .catchall(JsonValueSchema);
export type JsonFunction = z.infer<typeof JsonFunctionSchema>;
/** A reference resolved by the host's constants registry. */
export const ConstantSchema = z.string().regex(/^@@#\S+$/);
/** A per-row expression in deck.gl JSON syntax. Validation never evaluates expressions. */
export const ExpressionSchema = z.string().regex(/^@@=[\s\S]+$/);
export const FunctionSchema = z.union([ExpressionSchema, ConstantSchema, JsonFunctionSchema]);
/** A registered class constructor and its JSON options. */
export const ClassSchema = z.object({'@@type': z.string().min(1)}).catchall(JsonValueSchema);
export const ResourceSchema = z.union([z.string(), ClassSchema]);

/** Preserves the constant's inferred type while allowing deferred JSON conversion. */
export function createAccessorSchema<T extends z.ZodType>(value: T) {
  return z.union([value, ExpressionSchema, ConstantSchema, JsonFunctionSchema]);
}
export const Vector2Schema = z.tuple([z.number(), z.number()]);
export const Vector3Schema = z.tuple([z.number(), z.number(), z.number()]);
export const Vector4Schema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export const DeckGLPositionSchema = z.union([Vector2Schema, Vector3Schema]);
const channel = z.number().min(0).max(255);
export const ColorSchema = z.union([
  z.tuple([channel, channel, channel]),
  z.tuple([channel, channel, channel, channel])
]);
export const MatrixSchema = z.array(z.number()).length(16);
export const UnitSchema = z.enum(['meters', 'common', 'pixels']);
export const CoordinateSystemSchema = z.union([
  z.enum(['default', 'lnglat', 'meter-offsets', 'lnglat-offsets', 'cartesian']),
  ConstantSchema
]);
export const NumberAccessorSchema = createAccessorSchema(z.number());
export const ColorAccessorSchema = createAccessorSchema(ColorSchema);
export const PositionAccessorSchema = createAccessorSchema(DeckGLPositionSchema);
export const Vector2AccessorSchema = createAccessorSchema(Vector2Schema);
export const Vector3AccessorSchema = createAccessorSchema(Vector3Schema);
export const StringAccessorSchema = createAccessorSchema(z.string());
/** Optional callback represented as a registered reference or expression. */
export const CallbackSchema = FunctionSchema.nullable().optional();
export const MaterialSchema = z.union([
  z.boolean(),
  z.strictObject({
    ambient: z.number().optional(),
    diffuse: z.number().optional(),
    shininess: z.number().optional(),
    specularColor: ColorSchema.optional()
  })
]);
/** GPU parameters are an opaque JSON escape hatch owned by luma.gl, not this catalog. */
export const ParametersSchema = JsonObjectSchema.describe(
  'luma.gl GPU parameters; backend-specific keys are not validated.'
);
export const SamplerSchema = z.strictObject({
  addressModeU: z.enum(['clamp-to-edge', 'repeat', 'mirror-repeat']).optional(),
  addressModeV: z.enum(['clamp-to-edge', 'repeat', 'mirror-repeat']).optional(),
  addressModeW: z.enum(['clamp-to-edge', 'repeat', 'mirror-repeat']).optional(),
  minFilter: z.enum(['nearest', 'linear']).optional(),
  magFilter: z.enum(['nearest', 'linear']).optional(),
  mipmapFilter: z.enum(['none', 'nearest', 'linear']).optional(),
  lodMinClamp: z.number().optional(),
  lodMaxClamp: z.number().optional(),
  maxAnisotropy: z.number().int().min(1).optional(),
  compare: z
    .enum([
      'never',
      'less',
      'equal',
      'less-equal',
      'greater',
      'not-equal',
      'greater-equal',
      'always'
    ])
    .optional(),
  type: z.enum(['color-sampler', 'comparison-sampler']).optional(),
  id: z.string().optional(),
  userData: JsonObjectSchema.optional()
});
export const TransitionSchema = z.union([
  z.number().nonnegative(),
  z.strictObject({
    type: z.literal('interpolation').optional(),
    duration: z.number().nonnegative().optional(),
    easing: FunctionSchema.optional(),
    enter: FunctionSchema.optional(),
    onStart: FunctionSchema.optional(),
    onEnd: FunctionSchema.optional(),
    onInterrupt: FunctionSchema.optional()
  }),
  z.strictObject({
    type: z.literal('spring'),
    stiffness: z.number().optional(),
    damping: z.number().optional(),
    enter: FunctionSchema.optional(),
    onStart: FunctionSchema.optional(),
    onEnd: FunctionSchema.optional(),
    onInterrupt: FunctionSchema.optional()
  })
]);
/** A named host-owned row array, kept separate from the editable document. */
export const DataBindingSchema = z.strictObject({'@@data': z.string().min(1)});
export type DataBinding = z.infer<typeof DataBindingSchema>;
const JsonDataDescriptorSchema = z
  .object({'@@data': z.never().optional()})
  .catchall(JsonValueSchema);
export const DataSchema = z
  .union([
    z.string(),
    z.array(JsonValueSchema),
    DataBindingSchema,
    JsonDataDescriptorSchema,
    z.null()
  ])
  .describe(
    'URL, inline JSON rows, a named host binding or JSON data descriptor. Live binary/GPU resources must be supplied by the host.'
  );
/** Shared LayerProps. Unknown prop names are rejected; custom layers must extend the schema. */
export const BaseLayerPropsSchema = z
  .strictObject({
    id: z.string().min(1),
    data: DataSchema.optional(),
    dataComparator: CallbackSchema,
    _dataDiff: CallbackSchema,
    dataTransform: CallbackSchema,
    fetch: FunctionSchema.optional(),
    updateTriggers: JsonObjectSchema.optional(),
    operation: z
      .string()
      .regex(/^(draw|mask|terrain)(\+(draw|mask|terrain))*$/)
      .optional(),
    visible: z.boolean().optional(),
    pickable: z.union([z.boolean(), z.literal('3d')]).optional(),
    opacity: z.number().min(0).max(1).optional(),
    coordinateSystem: CoordinateSystemSchema.optional(),
    coordinateOrigin: Vector3Schema.optional(),
    modelMatrix: MatrixSchema.nullable().optional(),
    wrapLongitude: z.boolean().optional(),
    positionFormat: z.enum(['XY', 'XYZ']).optional(),
    colorFormat: z.enum(['RGB', 'RGBA']).optional(),
    parameters: ParametersSchema.optional(),
    transitions: z.record(z.string(), TransitionSchema).nullable().optional(),
    extensions: z.array(z.union([ClassSchema, ConstantSchema])).optional(),
    loaders: z.array(ConstantSchema).optional(),
    loadOptions: JsonObjectSchema.optional(),
    getPolygonOffset: CallbackSchema,
    autoHighlight: z.boolean().optional(),
    highlightedObjectIndex: z.number().int().nullable().optional(),
    highlightColor: ColorAccessorSchema.optional(),
    onDataLoad: CallbackSchema,
    onError: CallbackSchema,
    onHover: CallbackSchema,
    onClick: CallbackSchema,
    onDragStart: CallbackSchema,
    onDrag: CallbackSchema,
    onDragEnd: CallbackSchema,
    numInstances: z.number().int().nonnegative().nullable().optional(),
    startIndices: z.array(z.number().int().nonnegative()).nullable().optional()
  })
  .describe('JSON representation of deck.gl LayerProps.');
/** JSON-safe props for CompositeLayer; compose or extend with Zod. */
export const CompositeLayerPropsSchema = BaseLayerPropsSchema.extend({
  _subLayerProps: z.record(z.string(), JsonObjectSchema).nullable().optional()
});
/** Creates a typed discriminator without erasing the prop shape. */
export function defineLayer<const N extends string, S extends z.ZodRawShape>(
  name: N,
  props: z.ZodObject<S>
) {
  return props
    .extend({'@@type': z.literal(name)})
    .strict()
    .meta({id: `${name}Schema`, title: name});
}

/** Inferred JSON props for BaseLayer. */
export type BaseLayerProps = z.infer<typeof BaseLayerPropsSchema>;
/** Inferred JSON props for CompositeLayer. */
export type CompositeLayerProps = z.infer<typeof CompositeLayerPropsSchema>;
