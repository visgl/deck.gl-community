// deck.gl-community
// SPDX-License-Identifier: MIT
import {z} from 'zod';
import {
  BaseLayerPropsSchema,
  ResourceSchema,
  FunctionSchema,
  ConstantSchema,
  MaterialSchema,
  SamplerSchema,
  PositionAccessorSchema,
  ColorAccessorSchema,
  Vector3AccessorSchema,
  MatrixSchema,
  createAccessorSchema,
  defineLayer
} from './common';
const instanceProps = {
  getPosition: PositionAccessorSchema.optional(),
  getColor: ColorAccessorSchema.optional(),
  getOrientation: Vector3AccessorSchema.optional(),
  getScale: Vector3AccessorSchema.optional(),
  getTranslation: Vector3AccessorSchema.optional(),
  getTransformMatrix: createAccessorSchema(MatrixSchema).optional(),
  sizeScale: z.number().nonnegative().optional()
};
/** JSON-safe props for SimpleMeshLayer; compose or extend with Zod. */
export const SimpleMeshLayerPropsSchema = BaseLayerPropsSchema.extend({
  ...instanceProps,
  mesh: ResourceSchema.nullable(),
  texture: ResourceSchema.optional(),
  textureParameters: SamplerSchema.nullable().optional(),
  _instanced: z.boolean().optional(),
  wireframe: z.boolean().optional(),
  material: MaterialSchema.optional()
});
export const AnimationSchema = z.strictObject({
  playing: z.boolean().optional(),
  startTime: z.number().optional(),
  speed: z.number().optional()
});
/** JSON-safe props for ScenegraphLayer; compose or extend with Zod. */
export const ScenegraphLayerPropsSchema = BaseLayerPropsSchema.extend({
  ...instanceProps,
  scenegraph: ResourceSchema.nullable(),
  getScene: FunctionSchema.optional(),
  getAnimator: FunctionSchema.optional(),
  _animations: z.record(z.string(), AnimationSchema).nullable().optional(),
  _lighting: z.enum(['flat', 'pbr']).optional(),
  _imageBasedLightingEnvironment: z.union([ConstantSchema, FunctionSchema]).optional(),
  onFirstDraw: FunctionSchema.optional(),
  sizeMinPixels: z.number().nonnegative().optional(),
  sizeMaxPixels: z.number().nonnegative().optional()
});
export const SimpleMeshLayerSchema = defineLayer('SimpleMeshLayer', SimpleMeshLayerPropsSchema);
export const ScenegraphLayerSchema = defineLayer('ScenegraphLayer', ScenegraphLayerPropsSchema);

/** Inferred JSON props for SimpleMeshLayer. */
export type SimpleMeshLayerProps = z.infer<typeof SimpleMeshLayerPropsSchema>;
/** Inferred JSON props for ScenegraphLayer. */
export type ScenegraphLayerProps = z.infer<typeof ScenegraphLayerPropsSchema>;
