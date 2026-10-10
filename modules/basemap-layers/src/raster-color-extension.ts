import {LayerExtension} from '@deck.gl/core';
import type {Layer} from '@deck.gl/core';

/** The style values of a raster layer's color adjustments, as evaluated from its paint. */
export type RasterColorAdjustments = {
  /** `raster-brightness-min`, 0 to 1. */
  brightnessMin: number;
  /** `raster-brightness-max`, 0 to 1. */
  brightnessMax: number;
  /** `raster-saturation`, -1 to 1. */
  saturation: number;
  /** `raster-contrast`, -1 to 1. */
  contrast: number;
  /** `raster-hue-rotate`, in degrees. */
  hueRotate: number;
};

/** The style specification's defaults, which leave colors unchanged. */
export const DEFAULT_RASTER_COLOR_ADJUSTMENTS: RasterColorAdjustments = {
  brightnessMin: 0,
  brightnessMax: 1,
  saturation: 0,
  contrast: 0,
  hueRotate: 0
};

/** The shader uniforms of a set of color adjustments, computed as MapLibre GL JS does. */
export type RasterColorUniforms = {
  brightnessLow: number;
  brightnessHigh: number;
  saturationFactor: number;
  contrastFactor: number;
  spinWeights: [number, number, number];
};

/** Weights that rotate an RGB color about the gray axis by `angle` degrees. */
function getSpinWeights(angle: number): [number, number, number] {
  const radians = (angle * Math.PI) / 180;
  const s = Math.sin(radians);
  const c = Math.cos(radians);
  return [(2 * c + 1) / 3, (-Math.sqrt(3) * s - c + 1) / 3, (Math.sqrt(3) * s - c + 1) / 3];
}

function getContrastFactor(contrast: number): number {
  return contrast > 0 ? 1 / (1 - contrast) : 1 + contrast;
}

function getSaturationFactor(saturation: number): number {
  return saturation > 0 ? 1 - 1 / (1.001 - saturation) : -saturation;
}

/** Converts color adjustments to shader uniforms, with MapLibre GL JS's `raster` program math. */
export function getRasterColorUniforms(adjustments: RasterColorAdjustments): RasterColorUniforms {
  return {
    brightnessLow: adjustments.brightnessMin,
    brightnessHigh: adjustments.brightnessMax,
    saturationFactor: getSaturationFactor(adjustments.saturation),
    contrastFactor: getContrastFactor(adjustments.contrast),
    spinWeights: getSpinWeights(adjustments.hueRotate)
  };
}

/** Whether a set of color adjustments changes any color. */
export function hasRasterColorAdjustments(adjustments: RasterColorAdjustments): boolean {
  return (Object.keys(DEFAULT_RASTER_COLOR_ADJUSTMENTS) as (keyof RasterColorAdjustments)[]).some(
    key => adjustments[key] !== DEFAULT_RASTER_COLOR_ADJUSTMENTS[key]
  );
}

const rasterColorModule = {
  name: 'rasterColor',
  fs: /* glsl */ `\
layout(std140) uniform rasterColorUniforms {
  float brightnessLow;
  float brightnessHigh;
  float saturationFactor;
  float contrastFactor;
  vec3 spinWeights;
} rasterColor;

// MapLibre GL JS's raster fragment shader, applied to an unpremultiplied color.
vec3 rasterColor_adjust(vec3 color) {
  vec3 rgb = vec3(
    dot(color, rasterColor.spinWeights.xyz),
    dot(color, rasterColor.spinWeights.zxy),
    dot(color, rasterColor.spinWeights.yzx)
  );
  float average = (color.r + color.g + color.b) / 3.0;
  rgb += (average - rgb) * rasterColor.saturationFactor;
  rgb = (rgb - 0.5) * rasterColor.contrastFactor + 0.5;
  return mix(vec3(rasterColor.brightnessLow), vec3(rasterColor.brightnessHigh), rgb);
}
`,
  uniformTypes: {
    brightnessLow: 'f32',
    brightnessHigh: 'f32',
    saturationFactor: 'f32',
    contrastFactor: 'f32',
    spinWeights: 'vec3<f32>'
  }
} as const;

const injection = {
  // MapLibre writes the adjusted color premultiplied, so a value pushed above 1 is clamped only
  // after the multiplication by alpha. Layers using this extension blend premultiplied colors
  // (`RASTER_COLOR_BLEND_PARAMETERS`) to draw the same.
  'fs:DECKGL_FILTER_COLOR': /* glsl */ `
  color.rgb = rasterColor_adjust(color.rgb) * color.a;
`
};

/** The blending of layers using `RasterColorExtension`, whose shader outputs premultiplied colors. */
export const RASTER_COLOR_BLEND_PARAMETERS = {
  blendColorOperation: 'add',
  blendColorSrcFactor: 'one',
  blendColorDstFactor: 'one-minus-src-alpha',
  // WebGL sets both factors together; these are deck.gl's alpha factors.
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha'
} as const;

type RasterColorExtensionProps = {
  /** The color adjustments of the raster style layer. */
  rasterColorAdjustments?: RasterColorAdjustments;
};

/** Whether the extension's shader runs on a layer's device. It is written in GLSL only. */
function isRasterColorSupported(layer: Layer): boolean {
  return layer.context.device.type !== 'webgpu';
}

/**
 * Applies a raster style layer's `raster-brightness-min`, `raster-brightness-max`,
 * `raster-saturation`, `raster-contrast` and `raster-hue-rotate` to a `BitmapLayer`, with the
 * formulas of MapLibre GL JS's raster shader. WebGL only.
 *
 * The adjusted colors are premultiplied, so the layer must blend with
 * `RASTER_COLOR_BLEND_PARAMETERS` exactly where the shader runs. Added to a composite layer, the
 * extension passes them to its sublayers as `rasterColorBlendParameters`, decided by the same
 * device check as the shader; on WebGPU they are `null` and the sublayers keep their blending.
 */
export class RasterColorExtension extends LayerExtension {
  static extensionName = 'RasterColorExtension';
  static defaultProps = {
    rasterColorAdjustments: {type: 'object', value: DEFAULT_RASTER_COLOR_ADJUSTMENTS, compare: 1}
  };

  getShaders(this: Layer<RasterColorExtensionProps>) {
    if (!isRasterColorSupported(this)) {
      return {};
    }
    return {modules: [rasterColorModule], inject: injection};
  }

  getSubLayerProps(this: Layer<RasterColorExtensionProps>, extension: this) {
    return {
      ...LayerExtension.prototype.getSubLayerProps.call(this, extension),
      rasterColorBlendParameters: isRasterColorSupported(this)
        ? RASTER_COLOR_BLEND_PARAMETERS
        : null
    };
  }

  draw(this: Layer<RasterColorExtensionProps>) {
    if (!isRasterColorSupported(this)) {
      return;
    }
    const adjustments = this.props.rasterColorAdjustments ?? DEFAULT_RASTER_COLOR_ADJUSTMENTS;
    this.setShaderModuleProps({rasterColor: getRasterColorUniforms(adjustments)});
  }
}
