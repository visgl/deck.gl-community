// deck.gl-community
// SPDX-License-Identifier: MIT
import {z} from 'zod';
import {
  Vector2Schema,
  Vector3Schema,
  DeckGLPositionSchema,
  ColorSchema,
  MatrixSchema,
  FunctionSchema,
  ConstantSchema,
  ClassSchema,
  ParametersSchema
} from './common';

export const LayoutSchema = z
  .union([z.number(), z.string()])
  .describe('Pixels or a deck.gl layout expression such as 50% or calc(100% - 20px).');
export const PaddingSchema = z.strictObject({
  left: LayoutSchema.optional(),
  right: LayoutSchema.optional(),
  top: LayoutSchema.optional(),
  bottom: LayoutSchema.optional()
});
export const ControllerOptionsSchema = z.strictObject({
  type: ConstantSchema.optional(),
  scrollZoom: z
    .union([
      z.boolean(),
      z.strictObject({speed: z.number().optional(), smooth: z.boolean().optional()})
    ])
    .optional(),
  dragPan: z.boolean().optional(),
  dragRotate: z.boolean().optional(),
  doubleClickZoom: z.boolean().optional(),
  doubleClickDragZoom: z.boolean().optional(),
  touchZoom: z.boolean().optional(),
  touchRotate: z.boolean().optional(),
  multiTouchDrag: z.enum(['pan', 'rotate']).nullable().optional(),
  trackpadGesture: z.boolean().optional(),
  keyboard: z
    .union([
      z.boolean(),
      z.strictObject({
        zoomSpeed: z.number().optional(),
        moveSpeed: z.number().optional(),
        rotateSpeedX: z.number().optional(),
        rotateSpeedY: z.number().optional()
      })
    ])
    .optional(),
  dragMode: z.enum(['pan', 'rotate']).optional(),
  zoomAround: z.enum(['center', 'pointer']).optional(),
  inertia: z.union([z.boolean(), z.number()]).optional(),
  maxBounds: z
    .union([z.tuple([Vector2Schema, Vector2Schema]), z.tuple([Vector3Schema, Vector3Schema])])
    .nullable()
    .optional(),
  maxBoundsPadding: z.union([LayoutSchema, PaddingSchema]).optional(),
  rubberBand: z.boolean().optional()
});
export const ControllerSchema = z
  .union([z.boolean(), ConstantSchema, ControllerOptionsSchema])
  .nullable();
/** JSON-safe props for ViewTransition; compose or extend with Zod. */
export const ViewTransitionPropsSchema = z.strictObject({
  transitionDuration: z.union([z.number().nonnegative(), z.literal('auto')]).optional(),
  transitionInterpolator: z.union([ClassSchema, ConstantSchema]).optional(),
  transitionEasing: FunctionSchema.optional(),
  transitionInterruption: z
    .union([z.literal(1), z.literal(2), z.literal(3), ConstantSchema])
    .optional(),
  onTransitionStart: FunctionSchema.optional(),
  onTransitionInterrupt: FunctionSchema.optional(),
  onTransitionEnd: FunctionSchema.optional()
});
export const MapViewStateSchema = ViewTransitionPropsSchema.extend({
  longitude: z.number(),
  latitude: z.number(),
  zoom: z.number(),
  pitch: z.number().optional(),
  bearing: z.number().optional(),
  minZoom: z.number().optional(),
  maxZoom: z.number().optional(),
  minPitch: z.number().optional(),
  maxPitch: z.number().optional(),
  position: Vector3Schema.optional(),
  nearZ: z.number().optional(),
  farZ: z.number().optional()
}).meta({id: 'MapViewState'});
export const GlobeViewStateSchema = MapViewStateSchema.omit({
  pitch: true,
  bearing: true,
  minPitch: true,
  maxPitch: true,
  position: true
}).meta({id: 'GlobeViewState'});
export const OrbitViewStateSchema = ViewTransitionPropsSchema.extend({
  target: Vector3Schema,
  zoom: z.number(),
  rotationOrbit: z.number().optional(),
  rotationX: z.number().optional(),
  minZoom: z.number().optional(),
  maxZoom: z.number().optional(),
  minRotationX: z.number().optional(),
  maxRotationX: z.number().optional()
}).meta({id: 'OrbitViewState'});
export const OrthographicViewStateSchema = ViewTransitionPropsSchema.extend({
  target: DeckGLPositionSchema.optional(),
  zoom: z.union([z.number(), Vector2Schema]).optional(),
  zoomAxis: z.enum(['X', 'Y', 'all']).optional(),
  zoomX: z.number().optional(),
  zoomY: z.number().optional(),
  minZoom: z.number().optional(),
  maxZoom: z.number().optional(),
  minZoomX: z.number().optional(),
  maxZoomX: z.number().optional(),
  minZoomY: z.number().optional(),
  maxZoomY: z.number().optional()
}).meta({id: 'OrthographicViewState'});
export const FirstPersonViewStateSchema = ViewTransitionPropsSchema.extend({
  longitude: z.number().optional(),
  latitude: z.number().optional(),
  position: Vector3Schema.optional(),
  bearing: z.number().optional(),
  pitch: z.number().optional(),
  minPitch: z.number().optional(),
  maxPitch: z.number().optional(),
  modelMatrix: MatrixSchema.nullable().optional()
}).meta({id: 'FirstPersonViewState'});

/** Shared view constructor props. Camera state is validated separately per view. */
export const BaseViewPropsSchema = z.strictObject({
  id: z.string().optional(),
  canvasId: z.string().optional(),
  x: LayoutSchema.optional(),
  y: LayoutSchema.optional(),
  width: LayoutSchema.optional(),
  height: LayoutSchema.optional(),
  padding: PaddingSchema.nullable().optional(),
  clear: z.boolean().optional(),
  clearColor: z.union([ColorSchema, z.literal(false)]).optional(),
  clearDepth: z.union([z.number().min(0).max(1), z.literal(false)]).optional(),
  clearStencil: z.union([z.number().int().min(0).max(255), z.literal(false)]).optional(),
  parameters: ParametersSchema.optional(),
  controller: ControllerSchema.optional()
});
function viewState<S extends z.ZodRawShape>(schema: z.ZodObject<S>) {
  return z.union([z.string(), schema.partial().extend({id: z.string().optional()})]).optional();
}
const perspectiveProps = {
  projectionMatrix: MatrixSchema.optional(),
  fovy: z.number().optional(),
  near: z.number().optional(),
  far: z.number().optional()
};
/** JSON-safe props for MapView; compose or extend with Zod. */
export const MapViewPropsSchema = BaseViewPropsSchema.extend({
  viewState: viewState(MapViewStateSchema),
  repeat: z.boolean().optional(),
  nearZMultiplier: z.number().optional(),
  farZMultiplier: z.number().optional(),
  projectionMatrix: MatrixSchema.optional(),
  fovy: z.number().optional(),
  altitude: z.number().optional(),
  orthographic: z.boolean().optional()
});
/** JSON-safe props for GlobeView; compose or extend with Zod. */
export const GlobeViewPropsSchema = BaseViewPropsSchema.extend({
  viewState: viewState(GlobeViewStateSchema),
  resolution: z.number().positive().optional(),
  nearZMultiplier: z.number().optional(),
  farZMultiplier: z.number().optional(),
  altitude: z.number().optional()
});
/** JSON-safe props for OrbitView; compose or extend with Zod. */
export const OrbitViewPropsSchema = BaseViewPropsSchema.extend({
  ...perspectiveProps,
  viewState: viewState(OrbitViewStateSchema),
  orbitAxis: z.enum(['Y', 'Z']).optional(),
  orthographic: z.boolean().optional()
});
/** JSON-safe props for FirstPersonView; compose or extend with Zod. */
export const FirstPersonViewPropsSchema = BaseViewPropsSchema.extend({
  ...perspectiveProps,
  viewState: viewState(FirstPersonViewStateSchema),
  focalDistance: z.number().optional()
});
/** JSON-safe props for OrthographicView; compose or extend with Zod. */
export const OrthographicViewPropsSchema = BaseViewPropsSchema.extend({
  viewState: viewState(OrthographicViewStateSchema),
  near: z.number().optional(),
  far: z.number().optional(),
  flipY: z.boolean().optional()
});
export const MapViewSchema = MapViewPropsSchema.extend({'@@type': z.literal('MapView')}).meta({
  id: 'MapViewSchema'
});
export const GlobeViewSchema = GlobeViewPropsSchema.extend({
  '@@type': z.literal('_GlobeView')
}).meta({id: 'GlobeViewSchema'});
export const OrbitViewSchema = OrbitViewPropsSchema.extend({'@@type': z.literal('OrbitView')}).meta(
  {id: 'OrbitViewSchema'}
);
export const FirstPersonViewSchema = FirstPersonViewPropsSchema.extend({
  '@@type': z.literal('FirstPersonView')
}).meta({id: 'FirstPersonViewSchema'});
export const OrthographicViewSchema = OrthographicViewPropsSchema.extend({
  '@@type': z.literal('OrthographicView')
}).meta({id: 'OrthographicViewSchema'});
export const DeckGLViewSchemas = {
  MapView: MapViewSchema,
  FirstPersonView: FirstPersonViewSchema,
  OrbitView: OrbitViewSchema,
  OrthographicView: OrthographicViewSchema,
  GlobeView: GlobeViewSchema
};
export const DeckGLViewStateSchemas = {
  MapView: MapViewStateSchema,
  FirstPersonView: FirstPersonViewStateSchema,
  OrbitView: OrbitViewStateSchema,
  OrthographicView: OrthographicViewStateSchema,
  GlobeView: GlobeViewStateSchema
};
export const DeckGLViewSchema = z.discriminatedUnion('@@type', [
  MapViewSchema,
  FirstPersonViewSchema,
  OrbitViewSchema,
  OrthographicViewSchema,
  GlobeViewSchema
]);
export const DeckGLViewStateSchema = z.union([
  MapViewStateSchema,
  FirstPersonViewStateSchema,
  OrbitViewStateSchema,
  OrthographicViewStateSchema,
  GlobeViewStateSchema
]);
export type DeckGLView = z.infer<typeof DeckGLViewSchema>;
export type DeckGLViewName = keyof typeof DeckGLViewSchemas;
export type MapViewState = z.infer<typeof MapViewStateSchema>;
export type OrbitViewState = z.infer<typeof OrbitViewStateSchema>;
export type OrthographicViewState = z.infer<typeof OrthographicViewStateSchema>;
export type FirstPersonViewState = z.infer<typeof FirstPersonViewStateSchema>;
export type GlobeViewState = z.infer<typeof GlobeViewStateSchema>;
/** JSON-safe constructor props, without the JSON converter discriminator. */
export type MapViewProps = z.infer<typeof MapViewPropsSchema>;
export type GlobeViewProps = z.infer<typeof GlobeViewPropsSchema>;
export type OrbitViewProps = z.infer<typeof OrbitViewPropsSchema>;
export type OrthographicViewProps = z.infer<typeof OrthographicViewPropsSchema>;
export type FirstPersonViewProps = z.infer<typeof FirstPersonViewPropsSchema>;
