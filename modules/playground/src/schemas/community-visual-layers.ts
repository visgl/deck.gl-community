// deck.gl-community
// SPDX-License-Identifier: MIT
import {z} from 'zod';
import {TripsLayerPropsSchema} from './geo-layers';
import {
  BaseLayerPropsSchema,
  CompositeLayerPropsSchema,
  CallbackSchema,
  ColorAccessorSchema,
  ColorSchema,
  ConstantSchema,
  DataBindingSchema,
  DeckGLPositionSchema,
  FunctionSchema,
  JsonObjectSchema,
  JsonValueSchema,
  NumberAccessorSchema,
  PositionAccessorSchema,
  StringAccessorSchema,
  UnitSchema,
  Vector2AccessorSchema,
  Vector2Schema,
  Vector4Schema,
  createAccessorSchema,
  defineLayer
} from './common';
import {
  ArcLayerPropsSchema,
  FontSettingsSchema,
  IconLayerPropsSchema,
  LineLayerPropsSchema,
  PathLayerPropsSchema,
  SolidPolygonLayerPropsSchema,
  TextLayerPropsSchema
} from './layers';

const nonnegative = z.number().nonnegative();
const fraction = z.number().min(0).max(1);
const fontProps = TextLayerPropsSchema.pick({
  fontFamily: true,
  fontSettings: true,
  fontWeight: true
}).shape;
const boundsProps = {
  xMin: z.number().optional(),
  xMax: z.number().optional(),
  yMin: z.number().optional(),
  yMax: z.number().optional()
};

/** NewHeatLayer shares TripsLayer's JSON props without additional flame controls. */
export const NewHeatLayerPropsSchema = TripsLayerPropsSchema;
/** JSON configuration for NewHeatLayer. */
export const NewHeatLayerSchema = defineLayer('NewHeatLayer', NewHeatLayerPropsSchema);

/** JSON props for outlined paths, including inherited PathLayer styling. */
export const PathOutlineLayerPropsSchema = PathLayerPropsSchema.extend({
  ...CompositeLayerPropsSchema.shape,
  getDashArray: createAccessorSchema(Vector2Schema.nullable()).optional(),
  dashJustified: z.boolean().optional(),
  getOutlineColor: ColorAccessorSchema.optional(),
  outlineWidthScale: z.number().min(1).optional(),
  getZLevel: NumberAccessorSchema.optional()
});
/** JSON configuration for PathOutlineLayer. */
export const PathOutlineLayerSchema = defineLayer('PathOutlineLayer', PathOutlineLayerPropsSchema);

/** JSON props for paths with directional markers; custom marker classes are host references. */
export const PathMarkerLayerPropsSchema = PathOutlineLayerPropsSchema.extend({
  getDirection: FunctionSchema.optional(),
  getMarkerColor: ColorAccessorSchema.optional(),
  getMarkerOutlineColor: ColorAccessorSchema.optional(),
  getMarkerPercentages: FunctionSchema.optional(),
  getMarkerSize: Vector2AccessorSchema.optional(),
  highlightPoint: DeckGLPositionSchema.nullable().optional(),
  highlightIndex: z.number().int().optional(),
  MarkerLayer: ConstantSchema.optional(),
  markerLayerProps: JsonObjectSchema.optional(),
  markerOutlineWidthScale: nonnegative.optional(),
  sizeScale: nonnegative.optional(),
  fp64: z.boolean().optional(),
  nebulaLayer: ConstantSchema.optional()
});
/** JSON configuration for PathMarkerLayer. */
export const PathMarkerLayerSchema = defineLayer('PathMarkerLayer', PathMarkerLayerPropsSchema);

/** JSON props for path, line or arc dependency arrows. */
export const DependencyArrowLayerPropsSchema = CompositeLayerPropsSchema.extend({
  ...LineLayerPropsSchema.pick({
    getColor: true,
    getWidth: true,
    widthUnits: true,
    widthScale: true,
    widthMinPixels: true,
    widthMaxPixels: true
  }).shape,
  mode: z.enum(['path', 'line', 'arc']).optional(),
  getPath: PathLayerPropsSchema.shape.getPath,
  getOutlineColor: ColorAccessorSchema.optional(),
  outlineWidthScale: z.number().min(1).optional(),
  arcNumSegments: ArcLayerPropsSchema.shape.numSegments,
  getArcHeight: NumberAccessorSchema.optional(),
  getArcTilt: NumberAccessorSchema.optional(),
  getDirection: createAccessorSchema(z.number().int().min(0).max(3)).optional(),
  getMarkerColor: ColorAccessorSchema.optional(),
  getMarkerPlacements: createAccessorSchema(z.array(fraction)).optional(),
  getMarkerSize: Vector2AccessorSchema.optional(),
  highlightPoint: DeckGLPositionSchema.nullable().optional(),
  highlightIndex: z.number().int().optional(),
  markerSizeScale: nonnegative.optional()
});
/** JSON configuration for DependencyArrowLayer. */
export const DependencyArrowLayerSchema = defineLayer(
  'DependencyArrowLayer',
  DependencyArrowLayerPropsSchema
);

const textureSource = z.union([
  z.string(),
  z.array(z.string()),
  z.strictObject({
    mipLevels: z.union([z.number().int().positive(), z.literal('auto')]),
    template: z.string()
  })
]);
/** JSON props for a skybox loaded from a cubemap URL or manifest. */
export const SkyboxLayerPropsSchema = BaseLayerPropsSchema.extend({
  cubemap: z
    .union([
      z.string(),
      z.strictObject({
        shape: z.literal('image-texture-cube'),
        faces: z.partialRecord(
          z.enum([
            '+X',
            '-X',
            '+Y',
            '-Y',
            '+Z',
            '-Z',
            'right',
            'left',
            'top',
            'bottom',
            'front',
            'back'
          ]),
          textureSource
        )
      })
    ])
    .nullable()
    .optional(),
  loadOptions: JsonObjectSchema.nullable().optional(),
  orientation: z.enum(['default', 'y-up']).optional()
});
/** JSON configuration for SkyboxLayer. */
export const SkyboxLayerSchema = defineLayer('SkyboxLayer', SkyboxLayerPropsSchema);

/** JSON props for interval guides and duration labels. */
export const TimeDeltaLayerPropsSchema = CompositeLayerPropsSchema.extend({
  ...fontProps,
  unit: z.enum(['timestamp', 'milliseconds']).optional(),
  minTimeMs: z.number().optional(),
  maxTimeMs: z.number().optional(),
  startTimeMs: z.number().optional(),
  endTimeMs: z.number().optional(),
  y: z.number().optional(),
  header: z.boolean().optional(),
  fontSize: nonnegative.optional(),
  color: ColorSchema.optional(),
  yMin: z.number().optional(),
  yMax: z.number().optional()
});
/** JSON configuration for TimeDeltaLayer. */
export const TimeDeltaLayerSchema = defineLayer('TimeDeltaLayer', TimeDeltaLayerPropsSchema);

const animationFrame = z.strictObject({
  props: JsonObjectSchema,
  duration: nonnegative,
  delay: nonnegative.optional(),
  easing: FunctionSchema.optional()
});
const animationFrames = z.strictObject({
  type: z.enum(['sequence', 'concurrence', 'stagger']),
  delay: nonnegative.optional(),
  get frames(): z.ZodArray<z.ZodUnion<[typeof animationFrame, typeof animationFrames]>> {
    return z.array(z.union([animationFrame, animationFrames]));
  }
});
/** JSON props for scheduled animations of a host-owned child layer. */
export const AnimationLayerPropsSchema = CompositeLayerPropsSchema.extend({
  layer: ConstantSchema,
  frames: animationFrames.meta({'x-playground-layer-props': true}),
  repeat: z.number().int().nonnegative().optional(),
  repeatType: z.enum(['loop', 'reverse']).optional(),
  repeatDelay: nonnegative.optional()
});
/** JSON configuration for AnimationLayer. */
export const AnimationLayerSchema = defineLayer('AnimationLayer', AnimationLayerPropsSchema);

/** JSON props for filled and outlined rectangular blocks. */
export const BlockLayerPropsSchema = BaseLayerPropsSchema.extend({
  sizeUnits: UnitSchema.optional(),
  widthMinPixels: nonnegative.optional(),
  widthMaxPixels: nonnegative.optional(),
  widthCutoffPixels: nonnegative.optional(),
  heightMinPixels: nonnegative.optional(),
  sizeMaxPixels: nonnegative.optional(),
  lineWidthUnits: UnitSchema.optional(),
  strokeOffset: fraction.optional(),
  getPosition: PositionAccessorSchema.optional(),
  getSize: Vector2AccessorSchema.optional(),
  getLineWidth: NumberAccessorSchema.optional(),
  getLineColor: ColorAccessorSchema.optional(),
  getFillColor: ColorAccessorSchema.optional(),
  getOpacity: NumberAccessorSchema.optional(),
  overrideColor: ColorSchema.optional(),
  getColorOverride: NumberAccessorSchema.optional()
});
/** JSON configuration for BlockLayer. */
export const BlockLayerSchema = defineLayer('BlockLayer', BlockLayerPropsSchema);

const characterMapping = z.record(
  z.string(),
  z.strictObject({
    x: z.number(),
    y: z.number(),
    width: nonnegative,
    height: nonnegative,
    anchorX: z.number(),
    anchorY: z.number(),
    advance: z.number()
  })
);
/** JSON props for bitmap text; canvas atlases and UTF-8 columns remain host-owned resources. */
export const FastTextLayerPropsSchema = BaseLayerPropsSchema.extend({
  ...TextLayerPropsSchema.pick({
    billboard: true,
    sizeScale: true,
    sizeUnits: true,
    sizeMinPixels: true,
    sizeMaxPixels: true,
    characterSet: true,
    fontFamily: true,
    fontWeight: true,
    getText: true,
    getPosition: true,
    getColor: true,
    getContentBox: true,
    contentCutoffPixels: true,
    contentAlignHorizontal: true,
    contentAlignVertical: true
  }).shape,
  fontSettings: FontSettingsSchema.optional(),
  alphaCutoff: fraction.optional(),
  lineHeight: nonnegative.optional(),
  size: nonnegative.optional(),
  pixelOffset: Vector2Schema.optional(),
  getPixelOffset: Vector2Schema.optional(),
  characterMapping: z.union([characterMapping, ConstantSchema]).nullable().optional(),
  fontAtlas: ConstantSchema.nullable().optional(),
  textUtf8Column: ConstantSchema.nullable().optional(),
  getTextUtf8Row: createAccessorSchema(z.number().int().nonnegative().nullable()).optional(),
  getTextUtf8: CallbackSchema,
  singleLine: z.boolean().optional(),
  textAnchor: z.enum(['start', 'middle', 'end']).optional(),
  alignmentBaseline: z.enum(['top', 'center', 'bottom']).optional(),
  getClipRect: createAccessorSchema(Vector4Schema).optional()
});
/** JSON configuration for FastTextLayer. */
export const FastTextLayerSchema = defineLayer('FastTextLayer', FastTextLayerPropsSchema);

const horizonProps = {
  bands: z.number().int().positive().optional(),
  positiveColor: ColorSchema.optional(),
  negativeColor: ColorSchema.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: nonnegative.optional(),
  height: nonnegative.optional()
};
/** JSON props for one numeric horizon series. */
export const HorizonGraphLayerPropsSchema = BaseLayerPropsSchema.extend({
  ...horizonProps,
  data: z.union([z.array(z.number()), DataBindingSchema, ConstantSchema]).optional(),
  yAxisScale: z.number().positive().optional()
});
/** JSON configuration for HorizonGraphLayer. */
export const HorizonGraphLayerSchema = defineLayer(
  'HorizonGraphLayer',
  HorizonGraphLayerPropsSchema
);
/** JSON props for stacked numeric horizon series. */
export const MultiHorizonGraphLayerPropsSchema = CompositeLayerPropsSchema.extend({
  ...horizonProps,
  getSeries: FunctionSchema.optional(),
  getScale: FunctionSchema.optional(),
  dividerColor: ColorSchema.optional(),
  dividerWidth: nonnegative.optional()
});
/** JSON configuration for MultiHorizonGraphLayer. */
export const MultiHorizonGraphLayerSchema = defineLayer(
  'MultiHorizonGraphLayer',
  MultiHorizonGraphLayerPropsSchema
);

/** JSON props for timestamp or duration axes. */
export const TimeAxisLayerPropsSchema = CompositeLayerPropsSchema.extend({
  ...fontProps,
  characterSet: TextLayerPropsSchema.shape.characterSet,
  mode: z.enum(['timestamp', 'duration']).optional(),
  unit: z.enum(['timestamp', 'milliseconds', 'ms', 's']).optional(),
  minX: z.number().optional(),
  maxX: z.number().optional(),
  minY: z.number().optional(),
  maxY: z.number().optional(),
  startTimeMs: z.number().optional(),
  endTimeMs: z.number().optional(),
  tickCount: z.number().positive().optional(),
  minorTickCount: nonnegative.optional(),
  textColor: ColorSchema.optional(),
  gridColor: ColorSchema.optional(),
  coverage: nonnegative.optional(),
  axisLine: z.boolean().optional(),
  tickLabels: z.boolean().optional(),
  fontSize: nonnegative.optional(),
  labelY: z.number().optional(),
  formatTick: FunctionSchema.optional(),
  timeZoneOffsetHours: z.number().optional(),
  y: z.number().optional(),
  color: ColorSchema.optional(),
  bounds: Vector4Schema.optional()
});
/** JSON configuration for TimeAxisLayer. */
export const TimeAxisLayerSchema = defineLayer('TimeAxisLayer', TimeAxisLayerPropsSchema);
/** JSON props for vertical timeline grid lines. */
export const VerticalGridLayerPropsSchema = CompositeLayerPropsSchema.extend({
  ...boundsProps,
  xMin: z.number(),
  xMax: z.number(),
  tickCount: z.number().positive().optional(),
  width: nonnegative.optional(),
  color: ColorSchema.optional()
});
/** JSON configuration for VerticalGridLayer. */
export const VerticalGridLayerSchema = defineLayer(
  'VerticalGridLayer',
  VerticalGridLayerPropsSchema
);

const datumId = z.union([z.string(), z.number()]);
const timelineClip = z
  .object({
    id: datumId,
    startMs: z.number(),
    endMs: z.number(),
    color: ColorSchema.optional(),
    label: z.string().optional(),
    subtrackIndex: z.number().int().nonnegative().optional()
  })
  .catchall(JsonValueSchema);
const timelineTrack = z
  .object({
    id: datumId,
    clips: z.array(timelineClip),
    visible: z.boolean().optional(),
    name: z.string().optional()
  })
  .catchall(JsonValueSchema);
/** JSON props for tracks, clips and an interactive timeline scrubber. */
export const TimelineLayerPropsSchema = CompositeLayerPropsSchema.extend({
  data: z.union([z.array(timelineTrack), DataBindingSchema, ConstantSchema]),
  timelineStart: z.number(),
  timelineEnd: z.number(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: nonnegative.optional(),
  trackHeight: nonnegative.optional(),
  trackSpacing: nonnegative.optional(),
  currentTimeMs: z.number().optional(),
  viewport: z
    .strictObject({startMs: z.number().optional(), endMs: z.number().optional()})
    .optional(),
  timeFormatter: FunctionSchema.optional(),
  selectedClipId: datumId.nullable().optional(),
  hoveredClipId: datumId.nullable().optional(),
  selectedTrackId: datumId.nullable().optional(),
  hoveredTrackId: datumId.nullable().optional(),
  selectionStyle: z
    .strictObject({
      selectedClipColor: ColorSchema.optional(),
      hoveredClipColor: ColorSchema.optional(),
      selectedTrackColor: ColorSchema.optional(),
      hoveredTrackColor: ColorSchema.optional(),
      selectedLineWidth: nonnegative.optional(),
      hoveredLineWidth: nonnegative.optional()
    })
    .optional(),
  showScrubber: z.boolean().optional(),
  showClipLabels: z.boolean().optional(),
  showTrackLabels: z.boolean().optional(),
  showAxis: z.boolean().optional(),
  showSubtrackSeparators: z.boolean().optional(),
  clipProps: SolidPolygonLayerPropsSchema.partial()
    .optional()
    .meta({'x-playground-layer-props': true}),
  trackProps: SolidPolygonLayerPropsSchema.partial()
    .optional()
    .meta({'x-playground-layer-props': true}),
  trackLabelProps: TextLayerPropsSchema.partial()
    .optional()
    .meta({'x-playground-layer-props': true}),
  clipLabelProps: TextLayerPropsSchema.partial()
    .optional()
    .meta({'x-playground-layer-props': true}),
  axisLineProps: LineLayerPropsSchema.partial().optional().meta({'x-playground-layer-props': true}),
  axisLabelProps: TextLayerPropsSchema.partial()
    .optional()
    .meta({'x-playground-layer-props': true}),
  scrubberLineProps: LineLayerPropsSchema.partial()
    .optional()
    .meta({'x-playground-layer-props': true}),
  onClipClick: CallbackSchema,
  onClipHover: CallbackSchema,
  onTrackClick: CallbackSchema,
  onTrackHover: CallbackSchema,
  onScrubberHover: CallbackSchema,
  onScrubberDragStart: CallbackSchema,
  onScrubberDrag: CallbackSchema,
  onTimelineClick: CallbackSchema,
  onCurrentTimeChange: CallbackSchema,
  onViewportChange: CallbackSchema,
  onZoomChange: CallbackSchema
});
/** JSON configuration for TimelineLayer. */
export const TimelineLayerSchema = defineLayer('TimelineLayer', TimelineLayerPropsSchema);

/** JSON props for graph rank lines; the alias avoids deck.gl's aggregation GridLayer. */
export const GraphGridLayerPropsSchema = CompositeLayerPropsSchema.extend({
  ...boundsProps,
  direction: z.enum(['horizontal', 'vertical']).optional(),
  width: nonnegative.optional(),
  color: ColorSchema.optional(),
  getLabel: FunctionSchema.optional(),
  getColor: FunctionSchema.optional(),
  getWidth: FunctionSchema.optional(),
  showLabels: z.boolean().optional(),
  labelOffset: Vector2Schema.optional()
});
/** JSON configuration for the graph-layers GridLayer export, registered as GraphGridLayer. */
export const GraphGridLayerSchema = defineLayer('GraphGridLayer', GraphGridLayerPropsSchema);

const stylePrimitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const styleLiteral = z.union([stylePrimitive, z.array(stylePrimitive)]);
const styleLeaf = z.union([
  styleLiteral,
  FunctionSchema,
  z.strictObject({
    attribute: z.string().min(1),
    fallback: styleLiteral.optional(),
    scale: z
      .union([
        FunctionSchema,
        z.strictObject({
          type: z
            .enum(['linear', 'log', 'pow', 'sqrt', 'quantize', 'quantile', 'ordinal'])
            .optional(),
          domain: z.array(z.union([z.number(), z.string()])).optional(),
          range: z.array(JsonValueSchema).optional(),
          clamp: z.boolean().optional(),
          nice: z.union([z.boolean(), z.number()]).optional(),
          base: z.number().optional(),
          exponent: z.number().optional(),
          unknown: JsonValueSchema.optional()
        })
      ])
      .optional()
  })
]);
const styleValue = z.union([
  styleLeaf,
  z.record(z.string().regex(/^(?!attribute$|fallback$|scale$).+/), styleLeaf)
]);
function createStyleRule<const T extends string>(type: T, names: string) {
  const shape = Object.fromEntries(names.split(' ').map(name => [name, styleValue.optional()]));
  const schema = z.object({
    type: z.literal(type),
    ...shape,
    pickable: z.boolean().optional(),
    visible: z.boolean().optional(),
    data: FunctionSchema.optional()
  });
  return withStyleSelectors(schema, z.strictObject(shape));
}
function withStyleSelectors<S extends z.ZodRawShape, P extends z.ZodRawShape>(
  schema: z.ZodObject<S>,
  properties: z.ZodObject<P>
) {
  return z.intersection(
    schema.catchall(properties),
    z.record(
      z.union([z.enum(Object.keys(schema.shape)), z.string().regex(/^:[^\s]+$/)]),
      JsonValueSchema
    )
  );
}
const nodeStyle = z.union([
  createStyleRule('circle', 'offset opacity fill stroke strokeWidth radius'),
  createStyleRule('rectangle', 'offset opacity width height fill stroke strokeWidth'),
  createStyleRule(
    'rounded-rectangle',
    'offset opacity width height fill stroke strokeWidth cornerRadius radius'
  ),
  createStyleRule(
    'path-rounded-rectangle',
    'offset opacity width height fill stroke strokeWidth cornerRadius'
  ),
  createStyleRule(
    'label',
    'offset opacity color text fontSize textAnchor alignmentBaseline angle scaleWithZoom textMaxWidth textWordBreak textSizeMinPixels'
  ),
  createStyleRule('marker', 'offset opacity fill size marker scaleWithZoom')
]);
const decoratorStyle = z.union([
  createStyleRule(
    'edge-label',
    'color text fontSize textAnchor alignmentBaseline scaleWithZoom textMaxWidth textWordBreak textSizeMinPixels'
  ),
  createStyleRule('flow', 'color width speed tailLength'),
  createStyleRule('arrow', 'color size offset')
]);
const edgeStyle = withStyleSelectors(
  z.object({
    type: z.enum(['edge', 'Edge']).optional(),
    stroke: styleValue.optional(),
    strokeWidth: styleValue.optional(),
    decorators: z.array(decoratorStyle).optional(),
    data: FunctionSchema.optional(),
    visible: z.boolean().optional()
  }),
  z.strictObject({stroke: styleValue.optional(), strokeWidth: styleValue.optional()})
);
/** JSON props for graph rendering; graph engines and layout instances are supplied by the host. */
export const GraphLayerPropsSchema = CompositeLayerPropsSchema.extend({
  graph: ConstantSchema.optional(),
  layout: ConstantSchema.optional(),
  engine: ConstantSchema.optional(),
  graphLoader: FunctionSchema.optional(),
  onLayoutStart: CallbackSchema,
  onLayoutChange: CallbackSchema,
  onLayoutDone: CallbackSchema,
  onLayoutError: CallbackSchema,
  stylesheet: z
    .strictObject({
      nodes: z.array(nodeStyle).optional(),
      edges: z.union([edgeStyle, z.array(edgeStyle)]).optional()
    })
    .nullable()
    .optional(),
  nodeStyle: z.array(nodeStyle).optional(),
  edgeStyle: z.union([edgeStyle, z.array(edgeStyle)]).optional(),
  nodeEvents: z
    .strictObject({
      onMouseLeave: CallbackSchema,
      onHover: CallbackSchema,
      onMouseEnter: CallbackSchema,
      onClick: CallbackSchema,
      onDrag: CallbackSchema
    })
    .optional(),
  edgeEvents: z.strictObject({onClick: CallbackSchema, onHover: CallbackSchema}).optional(),
  enableDragging: z.boolean().optional(),
  resumeLayoutAfterDragging: z.boolean().optional(),
  rankGrid: z
    .union([
      z.boolean(),
      z.strictObject({
        enabled: z.boolean().optional(),
        direction: z.enum(['horizontal', 'vertical']).optional(),
        maxLines: z.number().int().nonnegative().optional(),
        rankAccessor: FunctionSchema.optional(),
        labelAccessor: FunctionSchema.optional(),
        gridProps: GraphGridLayerPropsSchema.omit({
          id: true,
          data: true,
          direction: true
        }).optional()
      })
    ])
    .optional()
});
/** JSON configuration for GraphLayer. */
export const GraphLayerSchema = defineLayer('GraphLayer', GraphLayerPropsSchema);
/** JSON props for graph edges; stylesheet engines are registered host resources. */
export const EdgeLayerPropsSchema = CompositeLayerPropsSchema.extend({
  getLayoutInfo: FunctionSchema.optional(),
  positionUpdateTrigger: JsonValueSchema.optional(),
  stylesheet: ConstantSchema
});
/** JSON configuration for EdgeLayer. */
export const EdgeLayerSchema = defineLayer('EdgeLayer', EdgeLayerPropsSchema);
/** JSON props for glyphs from the bundled marker atlas. */
export const MarkerLayerPropsSchema = IconLayerPropsSchema.extend({
  ...CompositeLayerPropsSchema.shape,
  getMarker: StringAccessorSchema.optional()
});
/** JSON configuration for MarkerLayer. */
export const MarkerLayerSchema = defineLayer('MarkerLayer', MarkerLayerPropsSchema);

/** All public visual, information, timeline and graph layer constructors. */
export const CommunityVisualLayerSchemas = {
  NewHeatLayer: NewHeatLayerSchema,
  PathOutlineLayer: PathOutlineLayerSchema,
  PathMarkerLayer: PathMarkerLayerSchema,
  DependencyArrowLayer: DependencyArrowLayerSchema,
  SkyboxLayer: SkyboxLayerSchema,
  TimeDeltaLayer: TimeDeltaLayerSchema,
  AnimationLayer: AnimationLayerSchema,
  BlockLayer: BlockLayerSchema,
  FastTextLayer: FastTextLayerSchema,
  HorizonGraphLayer: HorizonGraphLayerSchema,
  MultiHorizonGraphLayer: MultiHorizonGraphLayerSchema,
  TimeAxisLayer: TimeAxisLayerSchema,
  VerticalGridLayer: VerticalGridLayerSchema,
  TimelineLayer: TimelineLayerSchema,
  GraphLayer: GraphLayerSchema,
  EdgeLayer: EdgeLayerSchema,
  GraphGridLayer: GraphGridLayerSchema,
  MarkerLayer: MarkerLayerSchema
};
