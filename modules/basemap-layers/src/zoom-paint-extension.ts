import {LayerExtension} from '@deck.gl/core';
import type {Accessor, Layer, LayerContext} from '@deck.gl/core';
import type {Device, Texture} from '@luma.gl/core';

/** The most style layers whose paint one layer can take from `ZoomPaintExtension`. */
export const MAX_ZOOM_PAINT_PARTS = 64;

/** The rows of `ZoomPaintValues`. */
export const ZOOM_PAINT_WIDTH_ROW = 0;
export const ZOOM_PAINT_LINE_COLOR_ROW = 1;
export const ZOOM_PAINT_FILL_COLOR_ROW = 2;
const ZOOM_PAINT_ROWS = 3;

/**
 * The paint of each style layer drawn by a layer, at one zoom: an RGBA texel per style layer
 * (column) and value (row), `MAX_ZOOM_PAINT_PARTS` by 3. Column `i` is the style layer that
 * `getStylePart` returns `i` for.
 *
 * - `ZOOM_PAINT_WIDTH_ROW`: in red, a factor of the layer's width attribute.
 * - `ZOOM_PAINT_LINE_COLOR_ROW`, `ZOOM_PAINT_FILL_COLOR_ROW`: a color in 0-1, which replaces the
 *   layer's color attribute unless its alpha is negative: the attribute then holds the style
 *   layer's per-feature colors.
 */
export type ZoomPaintValues = Float32Array;

/** Creates values with every width factor 1 and every color taken from the attributes. */
export function createZoomPaintValues(): ZoomPaintValues {
  const values = new Float32Array(MAX_ZOOM_PAINT_PARTS * ZOOM_PAINT_ROWS * 4);
  for (let part = 0; part < MAX_ZOOM_PAINT_PARTS; part++) {
    values[getZoomPaintOffset(ZOOM_PAINT_WIDTH_ROW, part)] = 1;
    values[getZoomPaintOffset(ZOOM_PAINT_LINE_COLOR_ROW, part) + 3] = -1;
    values[getZoomPaintOffset(ZOOM_PAINT_FILL_COLOR_ROW, part) + 3] = -1;
  }
  return values;
}

/** The index of a style layer's texel in a row of `ZoomPaintValues`. */
export function getZoomPaintOffset(row: number, part: number): number {
  return (row * MAX_ZOOM_PAINT_PARTS + part) * 4;
}

/**
 * The paint of the style layers drawn by a layer, and the texture that hands it to the shaders,
 * which `destroy` releases.
 */
export class ZoomPaint {
  private texture: Texture | null = null;
  private written: ZoomPaintValues | null = null;

  /** `getValues` returns the values at the current zoom, the same array while they are unchanged. */
  constructor(readonly getValues: () => ZoomPaintValues) {}

  /** The texture of the current values, created on first use. */
  getTexture(device: Device): Texture {
    if (this.texture?.device !== device) {
      this.destroy();
      this.texture = device.createTexture({
        format: 'rgba32float',
        width: MAX_ZOOM_PAINT_PARTS,
        height: ZOOM_PAINT_ROWS,
        mipLevels: 1,
        // Float textures cannot be filtered without an extension; the shader reads exact texels.
        sampler: {minFilter: 'nearest', magFilter: 'nearest'}
      });
    }
    // Layers that share the texture share the values, so it is written once per change.
    const values = this.getValues();
    if (this.written !== values) {
      this.texture.writeData(values);
      this.written = values;
    }
    return this.texture;
  }

  destroy(): void {
    this.texture?.destroy();
    this.texture = null;
    this.written = null;
  }
}

export type ZoomPaintExtensionProps = {
  /** The paint to apply; the layer draws its attributes as they are without it. */
  zoomPaint?: ZoomPaint | null;
  /** Which of `zoomPaint`'s style layers each object belongs to. */
  getStylePart?: Accessor<any, number>;
};

const zoomPaintModule = {
  name: 'zoomPaint',
  vs: /* glsl */ `\
uniform highp sampler2D zoomPaintTexture;
`
} as const;

const DECLARATIONS = /* glsl */ `
in float instanceStyleParts;

vec4 zoomPaint_get(int row) {
  return texelFetch(zoomPaintTexture, ivec2(int(instanceStyleParts + 0.5), row), 0);
}

vec4 zoomPaint_color(vec4 color, int row) {
  vec4 partColor = zoomPaint_get(row);
  return partColor.a < 0.0 ? color : vec4(partColor.rgb, partColor.a * layer.opacity);
}
`;

/** `PathLayer`: widths and line colors. */
const PATH_INJECTION = {
  'vs:#decl': DECLARATIONS,
  'vs:DECKGL_FILTER_SIZE': /* glsl */ `
  size *= zoomPaint_get(${ZOOM_PAINT_WIDTH_ROW}).r;
`,
  'vs:DECKGL_FILTER_COLOR': /* glsl */ `
  color = zoomPaint_color(color, ${ZOOM_PAINT_LINE_COLOR_ROW});
`
};

/** `SolidPolygonLayer`: fill colors. Not for extruded polygons, whose colors are lit. */
const POLYGON_INJECTION = {
  'vs:#decl': DECLARATIONS,
  'vs:DECKGL_FILTER_COLOR': /* glsl */ `
  color = zoomPaint_color(color, ${ZOOM_PAINT_FILL_COLOR_ROW});
`
};

function getLayerType(layer: Layer): 'path' | 'polygon' | null {
  const state = layer.state as Record<string, unknown> | undefined;
  if (state && 'pathTesselator' in state) {
    return 'path';
  }
  if (state && 'polygonTesselator' in state) {
    return 'polygon';
  }
  return null;
}

/** The texture last handed to each model's shaders. */
const boundTextures = new WeakMap<object, Texture>();

/**
 * Takes the zoom-dependent paint of the style layers a `PathLayer` or flat `SolidPolygonLayer`
 * draws from a texture instead of attributes: per style layer, its line width and, when they are
 * the same for all of its features, its colors. The values are read when the layer draws, so a
 * zoom step changes a small texture, shared by every layer with the same `zoomPaint`: the layers'
 * props, and so their attributes, stay the same. Each object's style layer is an attribute, which
 * changes only with the data.
 *
 * The width factor applies after `widthMinPixels` and `widthMaxPixels`, which must not clamp.
 * The owner of a `ZoomPaint` destroys its texture. WebGL only.
 */
export class ZoomPaintExtension extends LayerExtension {
  static extensionName = 'ZoomPaintExtension';
  static defaultProps = {
    zoomPaint: {type: 'object', value: null},
    getStylePart: {type: 'accessor', value: 0}
  };

  isEnabled(layer: Layer): boolean {
    return getLayerType(layer) !== null;
  }

  getShaders(this: Layer<ZoomPaintExtensionProps>, extension: this): any {
    const type = getLayerType(this);
    if (!type) {
      return null;
    }
    return {
      modules: [zoomPaintModule],
      inject: type === 'path' ? PATH_INJECTION : POLYGON_INJECTION
    };
  }

  initializeState(this: Layer<ZoomPaintExtensionProps>, context: LayerContext, extension: this) {
    if (!extension.isEnabled(this)) {
      return;
    }
    this.getAttributeManager()?.add({
      instanceStyleParts: {
        size: 1,
        stepMode: 'dynamic',
        accessor: 'getStylePart',
        defaultValue: 0
      }
    });
  }

  draw(this: Layer<ZoomPaintExtensionProps>, params: any, extension: this) {
    const {zoomPaint} = this.props;
    if (!zoomPaint || !extension.isEnabled(this)) {
      return;
    }
    const texture = zoomPaint.getTexture(this.context.device);
    const models = this.getModels();
    if (models.some(model => boundTextures.get(model) !== texture)) {
      this.setShaderModuleProps({zoomPaint: {zoomPaintTexture: texture}} as any);
      for (const model of models) {
        boundTextures.set(model, texture);
      }
    }
  }
}
