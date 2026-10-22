// deck.gl-community
// SPDX-License-Identifier: MIT AND BSD-3-Clause
// Copyright (c) vis.gl contributors
// Copyright (c) 2023, MapLibre contributors
// Copyright (c) 2020, Mapbox

/**
 * @license
 * Portions of this file are adapted from MapLibre GL JS v6.13.0,
 * src/shaders/glsl/hillshade.fragment.glsl and hillshade_prepare.fragment.glsl,
 * under these licenses (see also THIRD-PARTY-NOTICES.md):
 *
 * Copyright (c) 2023, MapLibre contributors
 *
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 *     * Redistributions of source code must retain the above copyright notice,
 *       this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright notice,
 *       this list of conditions and the following disclaimer in the documentation
 *       and/or other materials provided with the distribution.
 *     * Neither the name of MapLibre GL JS nor the names of its contributors
 *       may be used to endorse or promote products derived from this software
 *       without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * MapLibre GL JS contains code from mapbox-gl-js v1.13 and earlier, licensed under a
 * BSD-3-Clause license:
 *
 * Copyright (c) 2020, Mapbox
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * * Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 * * Redistributions in binary form must reproduce the above copyright notice,
 *   this list of conditions and the following disclaimer in the documentation
 *   and/or other materials provided with the distribution.
 * * Neither the name of Mapbox GL JS nor the names of its contributors
 *   may be used to endorse or promote products derived from this software
 *   without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
 * EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import {COORDINATE_SYSTEM, log} from '@deck.gl/core';
import type {Layer, LayersList, UpdateParameters} from '@deck.gl/core';
import {SharedTile2DLayer, SharedTileset2D} from '@deck.gl-community/geo-layers';
import type {SharedTile2DLayerProps, SharedTileset2DProps} from '@deck.gl-community/geo-layers';
import {BitmapLayer} from '@deck.gl/layers';
import type {BasemapLoadOptions, BasemapSource} from './style-resolver';

/**
 * `hillshade` style layers over `raster-dem` sources, drawn as MapLibre GL JS draws them.
 *
 * MapLibre draws a hillshade in two passes. The first ("prepare") decodes each DEM tile into
 * elevations and stores the slope of every pixel, scaled for the tile's zoom, in an 8-bit
 * texture one pixel larger than the tile on every side. The second shades that texture with the
 * layer's paint. Here the first pass runs on the CPU, with the same arithmetic and the same 8-bit
 * rounding, and the second in the fragment shader of a `BitmapLayer`, ported from MapLibre's.
 */

/** The encodings of a `raster-dem` source. */
export type DemEncoding = 'mapbox' | 'terrarium' | 'custom';

/** `[redFactor, greenFactor, blueFactor, baseShift]`: elevation = r·R + g·G + b·B − shift. */
export type DemUnpackVector = [number, number, number, number];

/** The elevations of a DEM tile, in meters, row by row from the north-west corner. */
export type DemTile = {
  /** Width and height in pixels. */
  dim: number;
  elevations: Float32Array;
};

/** The unpack vector of a `raster-dem` source, as MapLibre GL JS's `DEMData` chooses it. */
export function getDemUnpackVector(source: BasemapSource): DemUnpackVector {
  switch (source.encoding) {
    case 'terrarium':
      return [256, 1, 1 / 256, 32768];
    case 'custom':
      return [
        (source.redFactor as number | undefined) ?? 1,
        (source.greenFactor as number | undefined) ?? 1,
        (source.blueFactor as number | undefined) ?? 1,
        (source.baseShift as number | undefined) ?? 0
      ];
    default:
      // `mapbox` is the default encoding.
      return [6553.6, 25.6, 0.1, 10000];
  }
}

/** Decodes the RGBA pixels of a square DEM tile into elevations. */
export function decodeDemTile(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  [redFactor, greenFactor, blueFactor, baseShift]: DemUnpackVector
): DemTile {
  if (width !== height) {
    throw new RangeError('DEM tiles must be square');
  }
  const elevations = new Float32Array(width * height);
  for (let i = 0; i < elevations.length; i++) {
    elevations[i] =
      pixels[i * 4] * redFactor +
      pixels[i * 4 + 1] * greenFactor +
      pixels[i * 4 + 2] * blueFactor -
      baseShift;
  }
  return {dim: width, elevations};
}

/**
 * The DEM tile next to a tile, `dx` and `dy` (each -1, 0 or 1, not both 0) tiles away, or `null`
 * where it is not loaded.
 */
export type DemNeighbors = (dx: number, dy: number) => DemTile | null;

/**
 * The slope texture of MapLibre GL JS's hillshade "prepare" pass, `dim + 2` pixels square: the
 * tile and a one-pixel border, RGBA, with the scaled east-west and north-south slopes in red and
 * green (128 is flat). Pixels past the tile's edges come from its loaded neighbors, and where a
 * neighbor is missing, from the tile's nearest edge pixel, as MapLibre fills them.
 *
 * `zoom` is the tile's zoom, also where it is scaled up past its source's `maxzoom`. MapLibre
 * scales the slopes by it, and exaggerates them below zoom 15.
 */
export function prepareHillshadeTexture(
  dem: DemTile,
  zoom: number,
  getNeighbor: DemNeighbors = () => null
): Uint8ClampedArray<ArrayBuffer> {
  const {dim} = dem;
  const neighbors: (DemTile | null)[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const neighbor = dx || dy ? getNeighbor(dx, dy) : dem;
      neighbors.push(neighbor && neighbor.dim === dim ? neighbor : null);
    }
  }
  // The elevation at a pixel of the tile or of its two-pixel border.
  const getElevation = (x: number, y: number): number => {
    const dx = x < 0 ? -1 : x >= dim ? 1 : 0;
    const dy = y < 0 ? -1 : y >= dim ? 1 : 0;
    const neighbor = neighbors[(dy + 1) * 3 + dx + 1];
    if (neighbor) {
      return neighbor.elevations[(y - dy * dim) * dim + (x - dx * dim)];
    }
    const clampedX = Math.min(Math.max(x, 0), dim - 1);
    const clampedY = Math.min(Math.max(y, 0), dim - 1);
    return dem.elevations[clampedY * dim + clampedX];
  };

  const exaggerationFactor = zoom < 2 ? 0.4 : zoom < 4.5 ? 0.35 : 0.3;
  const exaggeration = zoom < 15 ? (zoom - 15) * exaggerationFactor : 0;
  const scale = dim / 2 ** (exaggeration + (28.2562 - zoom)) / 8;
  const flat = 128 / 255;

  const size = dim + 2;
  const texture = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < size; row++) {
    // Texture pixel (column, row) is tile pixel (column - 1, row - 1).
    const y = row - 1;
    for (let column = 0; column < size; column++) {
      const x = column - 1;
      const a = getElevation(x - 1, y - 1);
      const b = getElevation(x, y - 1);
      const c = getElevation(x + 1, y - 1);
      const d = getElevation(x - 1, y);
      const f = getElevation(x + 1, y);
      const g = getElevation(x - 1, y + 1);
      const h = getElevation(x, y + 1);
      const i = getElevation(x + 1, y + 1);
      const index = (row * size + column) * 4;
      // Rounded to 8 bits as the GPU stores MapLibre's framebuffer.
      texture[index] = Math.round(
        Math.min(Math.max((c + f + f + i - (a + d + d + g)) * scale + flat, 0), 1) * 255
      );
      texture[index + 1] = Math.round(
        Math.min(Math.max((g + h + h + i - (a + b + b + c)) * scale + flat, 0), 1) * 255
      );
      texture[index + 2] = 255;
      texture[index + 3] = 255;
    }
  }
  return texture;
}

/** `hillshade-method`, as the shader's `method` uniform. */
const HILLSHADE_METHODS: Record<string, number> = {
  standard: 0,
  combined: 1,
  igor: 2,
  multidirectional: 3,
  basic: 4
};

/** The most light sources the shader takes. MapLibre takes any number. */
export const MAX_HILLSHADE_LIGHTS = 4;

/** A hillshade layer's paint, evaluated and ready for the shader (but for the map's bearing). */
export type HillshadeParameters = {
  /** `hillshade-method`. */
  method: number;
  /** `hillshade-exaggeration`. */
  exaggeration: number;
  /** `hillshade-accent-color`, premultiplied RGBA in 0-1. */
  accent: number[];
  /** Whether the light turns with the map (`hillshade-illumination-anchor: viewport`). */
  viewportAnchored: boolean;
  /** One per light source, at most `MAX_HILLSHADE_LIGHTS`. Directions clockwise from north. */
  directions: number[];
  altitudes: number[];
  /** Premultiplied RGBA in 0-1. */
  shadows: number[][];
  highlights: number[][];
};

function toNumbers(value: unknown, fallback: number): number[] {
  const values = (Array.isArray(value) ? value : [value]).filter(
    (item): item is number => typeof item === 'number'
  );
  return values.length ? values : [fallback];
}

/** `[r, g, b, a]`, RGB in 0-255 and alpha in 0-1, to premultiplied RGBA in 0-1. */
function toPremultiplied(color: unknown): number[] {
  if (!Array.isArray(color) || color.length < 3) {
    return [0, 0, 0, 0];
  }
  const alpha = color[3] ?? 1;
  return [(color[0] / 255) * alpha, (color[1] / 255) * alpha, (color[2] / 255) * alpha, alpha];
}

function toColors(value: unknown, fallback: number[]): number[][] {
  if (!Array.isArray(value) || value.length === 0) {
    return [fallback];
  }
  // A color array is a list of colors; a single color is a list of numbers.
  return (Array.isArray(value[0]) ? value : [value]).map(toPremultiplied);
}

/** Lengthens a list to `length` by repeating its last item, as MapLibre does. */
function padList<T>(list: T[], length: number): T[] {
  return list.concat(Array(length - list.length).fill(list[list.length - 1]));
}

/**
 * The shader parameters of a hillshade layer's evaluated paint (see `getPaint`), with the
 * specification's defaults for unset properties. As in MapLibre GL JS, the number of light sources
 * is the number of `hillshade-highlight-color`s, and the other lists are lengthened to match by
 * repeating their last value; only `multidirectional` uses more than the first.
 */
export function getHillshadeParameters(paint: Record<string, unknown>): HillshadeParameters {
  let directions = toNumbers(paint['hillshade-illumination-direction'], 335);
  let altitudes = toNumbers(paint['hillshade-illumination-altitude'], 45);
  let shadows = toColors(paint['hillshade-shadow-color'], [0, 0, 0, 1]);
  let highlights = toColors(paint['hillshade-highlight-color'], [1, 1, 1, 1]);
  const lights = Math.min(highlights.length, MAX_HILLSHADE_LIGHTS);
  const count = Math.max(directions.length, altitudes.length, shadows.length, highlights.length);
  directions = padList(directions, count);
  altitudes = padList(altitudes, count);
  shadows = padList(shadows, count);
  highlights = padList(highlights, count);
  return {
    method: HILLSHADE_METHODS[paint['hillshade-method'] as string] ?? 0,
    exaggeration: (paint['hillshade-exaggeration'] as number | undefined) ?? 0.5,
    accent: paint['hillshade-accent-color']
      ? toPremultiplied(paint['hillshade-accent-color'])
      : [0, 0, 0, 1],
    viewportAnchored: paint['hillshade-illumination-anchor'] !== 'map',
    directions: directions.slice(0, lights),
    altitudes: altitudes.slice(0, lights),
    shadows: shadows.slice(0, lights),
    highlights: highlights.slice(0, lights)
  };
}

/** The `hillshade` shader module's uniforms. */
export type HillshadeUniforms = {
  accent: number[];
  altitudes: number[];
  azimuths: number[];
  shadows: number[];
  highlights: number[];
  latRange: [number, number];
  exaggeration: number;
  method: number;
  lightCount: number;
};

/**
 * The shader uniforms of a tile: its parameters, at the map's `bearing` (degrees) for a light
 * anchored to the viewport, and the tile's latitude range `[north, south]`.
 */
export function getHillshadeUniforms(
  parameters: HillshadeParameters,
  bearing: number,
  latRange: [number, number]
): HillshadeUniforms {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  // MapLibre wraps its bearing to [-180, 180].
  const wrappedBearing = ((((bearing + 180) % 360) + 360) % 360) - 180;
  const rotation = parameters.viewportAnchored ? toRadians(wrappedBearing) : 0;
  const lightCount = parameters.highlights.length;
  const toVec4 = (values: number[]) => padList(values, 4).slice(0, 4);
  // Columns of a mat4: one color per light.
  const toMat4 = (colors: number[][]) => padList(colors, 4).slice(0, 4).flat();
  return {
    accent: parameters.accent,
    altitudes: toVec4(parameters.altitudes.map(toRadians)),
    azimuths: toVec4(parameters.directions.map(direction => toRadians(direction) + rotation)),
    shadows: toMat4(parameters.shadows),
    highlights: toMat4(parameters.highlights),
    latRange,
    exaggeration: parameters.exaggeration,
    method: parameters.method,
    lightCount
  };
}

const hillshadeModule = {
  name: 'hillshade',
  fs: /* glsl */ `\
layout(std140) uniform hillshadeUniforms {
  vec4 accent;
  vec4 altitudes;
  vec4 azimuths;
  mat4 shadows;
  mat4 highlights;
  vec2 latRange;
  float exaggeration;
  float method;
  float lightCount;
} hillshade;

// MapLibre GL JS's hillshade fragment shader, for up to four light sources.
const float HILLSHADE_PI = 3.141592653589793;

float hillshade_getAspect(vec2 deriv) {
  return deriv.x != 0.0 ? atan(deriv.y, -deriv.x) : HILLSHADE_PI / 2.0 * (deriv.y > 0.0 ? 1.0 : -1.0);
}

vec4 hillshade_igor(vec2 deriv) {
  deriv = deriv * hillshade.exaggeration * 2.0;
  float aspect = hillshade_getAspect(deriv);
  float azimuth = hillshade.azimuths[0] + HILLSHADE_PI;
  float slopeStrength = atan(length(deriv)) * 2.0 / HILLSHADE_PI;
  float aspectStrength = 1.0 - abs(mod((aspect + azimuth) / HILLSHADE_PI + 0.5, 2.0) - 1.0);
  float shadowStrength = slopeStrength * aspectStrength;
  float highlightStrength = slopeStrength * (1.0 - aspectStrength);
  return hillshade.shadows[0] * shadowStrength + hillshade.highlights[0] * highlightStrength;
}

vec4 hillshade_standard(vec2 deriv) {
  float azimuth = hillshade.azimuths[0] + HILLSHADE_PI;
  float slope = atan(0.625 * length(deriv));
  float aspect = hillshade_getAspect(deriv);
  float intensity = hillshade.exaggeration;
  float base = 1.875 - intensity * 1.75;
  float maxValue = 0.5 * HILLSHADE_PI;
  float scaledSlope = intensity != 0.5
    ? ((pow(base, slope) - 1.0) / (pow(base, maxValue) - 1.0)) * maxValue
    : slope;
  float accent = cos(scaledSlope);
  vec4 accentColor = (1.0 - accent) * hillshade.accent * clamp(intensity * 2.0, 0.0, 1.0);
  float shade = abs(mod((aspect + azimuth) / HILLSHADE_PI + 0.5, 2.0) - 1.0);
  vec4 shadeColor = mix(hillshade.shadows[0], hillshade.highlights[0], shade) *
    sin(scaledSlope) * clamp(intensity * 2.0, 0.0, 1.0);
  return accentColor * (1.0 - shadeColor.a) + shadeColor;
}

vec4 hillshade_basic(vec2 deriv) {
  deriv = deriv * hillshade.exaggeration * 2.0;
  float azimuth = hillshade.azimuths[0] + HILLSHADE_PI;
  float cosAz = cos(azimuth);
  float sinAz = sin(azimuth);
  float cosAlt = cos(hillshade.altitudes[0]);
  float sinAlt = sin(hillshade.altitudes[0]);
  float cang = (sinAlt - (deriv.y * cosAz * cosAlt - deriv.x * sinAz * cosAlt)) /
    sqrt(1.0 + dot(deriv, deriv));
  float shade = clamp(cang, 0.0, 1.0);
  return shade > 0.5
    ? hillshade.highlights[0] * (2.0 * shade - 1.0)
    : hillshade.shadows[0] * (1.0 - 2.0 * shade);
}

vec4 hillshade_multidirectional(vec2 deriv) {
  deriv = deriv * hillshade.exaggeration * 2.0;
  vec4 color = vec4(0.0);
  for (int i = 0; i < 4; i++) {
    if (float(i) >= hillshade.lightCount) {
      break;
    }
    float cosAlt = cos(hillshade.altitudes[i]);
    float sinAlt = sin(hillshade.altitudes[i]);
    float cosAz = -cos(hillshade.azimuths[i]);
    float sinAz = -sin(hillshade.azimuths[i]);
    float cang = (sinAlt - (deriv.y * cosAz * cosAlt - deriv.x * sinAz * cosAlt)) /
      sqrt(1.0 + dot(deriv, deriv));
    float shade = clamp(cang, 0.0, 1.0);
    color += (shade > 0.5
      ? hillshade.highlights[i] * (2.0 * shade - 1.0)
      : hillshade.shadows[i] * (1.0 - 2.0 * shade)) / hillshade.lightCount;
  }
  return color;
}

vec4 hillshade_combined(vec2 deriv) {
  deriv = deriv * hillshade.exaggeration * 2.0;
  float azimuth = hillshade.azimuths[0] + HILLSHADE_PI;
  float cosAz = cos(azimuth);
  float sinAz = sin(azimuth);
  float cosAlt = cos(hillshade.altitudes[0]);
  float sinAlt = sin(hillshade.altitudes[0]);
  float cang = acos((sinAlt - (deriv.y * cosAz * cosAlt - deriv.x * sinAz * cosAlt)) /
    sqrt(1.0 + dot(deriv, deriv)));
  cang = clamp(cang, 0.0, HILLSHADE_PI / 2.0);
  float shade = cang * atan(length(deriv)) * 4.0 / HILLSHADE_PI / HILLSHADE_PI;
  float highlight = (HILLSHADE_PI / 2.0 - cang) * atan(length(deriv)) * 4.0 / HILLSHADE_PI / HILLSHADE_PI;
  return hillshade.shadows[0] * shade + hillshade.highlights[0] * highlight;
}

// The premultiplied color of a pixel of the slope texture, at \`uv\` in the tile.
vec4 hillshade_getColor(sampler2D slopes, vec2 uv) {
  // The texture has a one-pixel border around the tile.
  vec2 size = vec2(textureSize(slopes, 0));
  vec4 pixel = texture(slopes, (uv * (size - 2.0) + 1.0) / size);
  // Slopes are scaled by the cosine of the latitude, interpolated across the tile.
  float scaleFactor = cos(radians(
    (hillshade.latRange[0] - hillshade.latRange[1]) * (1.0 - uv.y) + hillshade.latRange[1]
  ));
  vec2 deriv = (pixel.rg - 128.0 / 255.0) * 8.0 / scaleFactor;
  if (hillshade.method > 3.5) {
    return hillshade_basic(deriv);
  }
  if (hillshade.method > 2.5) {
    return hillshade_multidirectional(deriv);
  }
  if (hillshade.method > 1.5) {
    return hillshade_igor(deriv);
  }
  if (hillshade.method > 0.5) {
    return hillshade_combined(deriv);
  }
  return hillshade_standard(deriv);
}
`,
  uniformTypes: {
    accent: 'vec4<f32>',
    altitudes: 'vec4<f32>',
    azimuths: 'vec4<f32>',
    shadows: 'mat4x4<f32>',
    highlights: 'mat4x4<f32>',
    latRange: 'vec2<f32>',
    exaggeration: 'f32',
    method: 'f32',
    lightCount: 'f32'
  }
} as const;

/**
 * The blending of the hillshade's premultiplied colors, as MapLibre blends them (and as
 * `RASTER_COLOR_BLEND_PARAMETERS`).
 */
const PREMULTIPLIED_BLEND_PARAMETERS = {
  blendColorOperation: 'add',
  blendColorSrcFactor: 'one',
  blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha'
} as const;

type HillshadeBitmapLayerProps = {
  hillshadeParameters: HillshadeParameters;
  /** The tile's latitude range, `[north, south]`. */
  hillshadeLatRange: [number, number];
};

/**
 * A `BitmapLayer` whose image is a tile's slope texture (see `prepareHillshadeTexture`), drawn as
 * MapLibre GL JS shades it. WebGL only.
 */
class HillshadeBitmapLayer extends BitmapLayer<HillshadeBitmapLayerProps> {
  static layerName = 'HillshadeBitmapLayer';

  getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      modules: [...shaders.modules, hillshadeModule],
      inject: {
        ...shaders.inject,
        // At the end of main(), where the bitmap's sampler is in scope.
        'fs:#main-end': /* glsl */ `
  if (!bool(picking.isActive)) {
    fragColor = hillshade_getColor(bitmapTexture, geometry.uv) * layer.opacity;
  }
`
      }
    };
  }

  draw(options: any) {
    const {hillshadeParameters, hillshadeLatRange} = this.props;
    const bearing = (this.context.viewport as {bearing?: number}).bearing ?? 0;
    for (const model of this.getModels()) {
      model.shaderInputs.setProps({
        hillshade: getHillshadeUniforms(hillshadeParameters, bearing, hillshadeLatRange)
      });
    }
    super.draw(options);
  }
}

/** Reads the pixels of a decoded image. */
function readImagePixels(image: ImageBitmap): Uint8ClampedArray {
  const {width, height} = image;
  const canvas =
    typeof OffscreenCanvas === 'undefined'
      ? Object.assign(document.createElement('canvas'), {width, height})
      : new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', {willReadFrequently: true}) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, width, height).data;
}

/**
 * Fetches and decodes a DEM tile. Colors are read as stored, without color space conversion or
 * premultiplication, which would change the elevations. An empty response is a tile without data.
 */
export async function loadDemTile(
  url: string,
  unpack: DemUnpackVector,
  {signal, loadOptions}: {signal?: AbortSignal; loadOptions?: BasemapLoadOptions} = {}
): Promise<DemTile | null> {
  const fetchFn = loadOptions?.fetch || fetch;
  const response = await fetchFn(url, {...loadOptions?.fetchOptions, signal});
  if (!response.ok) {
    throw new Error(`Failed to load DEM tile: ${url} (${response.status})`);
  }
  const blob = await response.blob();
  if (blob.size === 0) {
    return null;
  }
  const image = await createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none'
  });
  try {
    return decodeDemTile(readImagePixels(image), image.width, image.height, unpack);
  } finally {
    image.close();
  }
}

/** The slope texture of a DEM tile, with the neighbors it was prepared with. */
const preparedTextures = new WeakMap<DemTile, {key: string; image: ImageData}>();

type TileIndex = {x: number; y: number; z: number};
type DemTileHeader = {
  id: string;
  index: TileIndex;
  bbox: unknown;
  content: DemTile | null;
  isLoaded: boolean;
};

/**
 * Creates the tileset of a `raster-dem` source: each tile is fetched and decoded once, and shared
 * by every `HillshadeTileLayer` drawn from it, as the tiles of a vector source are shared by its
 * style runs. `tilesetProps` are the source's tile pyramid (see `getTilePyramidProps`).
 */
export function createSharedDemTileset(
  source: BasemapSource,
  loadOptions: BasemapLoadOptions | undefined,
  tilesetProps: Partial<SharedTileset2DProps<DemTile | null>> = {}
): SharedTileset2D<DemTile | null> {
  const unpack = getDemUnpackVector(source);
  // Expands the source's URL template for a tile, as the layer does for its own tileset.
  const loader = new SharedTile2DLayer<DemTile | null>({
    data: source.tiles as string[],
    getTileData: ({url, signal}) => (url ? loadDemTile(url, unpack, {signal, loadOptions}) : null)
  });
  return new SharedTileset2D<DemTile | null>({
    ...loader._getTilesetOptions(),
    ...tilesetProps,
    tileSize: source.tileSize || 512,
    getTileData: tile => loader.getTileData(tile)
  } as SharedTileset2DProps<DemTile | null>);
}

/**
 * A tileset shared by the `HillshadeTileLayer`s of one `raster-dem` source, finalized when the
 * last of them is. `BasemapLayer` owns its sources' tilesets itself; this is for the layers that
 * `getBasemapLayers` creates without it.
 */
export type DemTilesetOwner = {tileset: SharedTileset2D; consumers: Set<object>};

/** Props of a `HillshadeTileLayer`. */
export type HillshadeTileLayerProps = SharedTile2DLayerProps<DemTile | null> & {
  hillshadeParameters: HillshadeParameters;
  /** Extra props of every tile's bitmap layer, such as `parameters`. */
  hillshadeSubLayerProps?: Record<string, unknown>;
  /** The owner of a shared `data` tileset that the layer releases when finalized. */
  demTilesetOwner?: DemTilesetOwner | null;
};

/**
 * The tiles of a `raster-dem` source, shaded by one `hillshade` style layer. The decoded tiles
 * come from the source's tileset, shared with the source's other hillshade layers (see
 * `createSharedDemTileset`); the slopes and the shading are the layer's own. Each tile's slopes are
 * prepared from its elevations and those of its loaded neighbors, so that tiles join without
 * seams. Draws nothing on WebGPU: the shader is GLSL.
 */
export class HillshadeTileLayer extends SharedTile2DLayer<DemTile | null, HillshadeTileLayerProps> {
  static layerName = 'HillshadeTileLayer';
  static defaultProps = {
    ...SharedTile2DLayer.defaultProps,
    hillshadeParameters: {type: 'object', value: null, compare: false},
    hillshadeSubLayerProps: {type: 'object', value: null, compare: false},
    demTilesetOwner: {type: 'object', value: null, compare: false}
  };

  declare state: SharedTile2DLayer<DemTile | null>['state'] & {
    demTilesetOwner?: DemTilesetOwner;
    /** Stands for this layer among an owner's consumers. */
    demTilesetConsumer?: object;
  };

  updateState(params: UpdateParameters<this>): void {
    const owner = this.props.demTilesetOwner || undefined;
    if (owner !== this.state.demTilesetOwner) {
      this.releaseDemTileset();
      this.state.demTilesetConsumer ??= {};
      owner?.consumers.add(this.state.demTilesetConsumer);
      this.state.demTilesetOwner = owner;
    }
    super.updateState(params);
  }

  finalizeState(): void {
    super.finalizeState();
    this.releaseDemTileset();
  }

  private releaseDemTileset(): void {
    const owner = this.state.demTilesetOwner;
    if (owner) {
      owner.consumers.delete(this.state.demTilesetConsumer!);
      if (!owner.consumers.size) owner.tileset.finalize();
      this.state.demTilesetOwner = undefined;
    }
  }

  _onTileLoad(tile: any): void {
    // The tiles around it can now take its edge pixels: their sublayers are prepared again.
    const {x, y, z} = tile.index as TileIndex;
    const count = 2 ** z;
    for (const other of (this.state.tileset?.tiles || []) as DemTileHeader[]) {
      const index = other.index;
      const dx = Math.abs(index.x - x);
      if (
        index.z === z &&
        Math.abs(index.y - y) <= 1 &&
        (dx <= 1 || dx === count - 1) &&
        other !== tile
      ) {
        this.state.tileLayers.delete(other.id);
      }
    }
    super._onTileLoad(tile);
  }

  renderLayers(): Layer | null | LayersList {
    if (this.context.device.type === 'webgpu') {
      log.once(1, '[BasemapLayer] hillshade layers are not drawn on WebGPU')();
      return null;
    }
    return super.renderLayers();
  }

  renderSubLayers(props: any): Layer | null | LayersList {
    const dem = props.data as DemTile | null;
    const tile = props.tile as DemTileHeader;
    if (!dem || typeof ImageData === 'undefined') {
      return null;
    }
    const {x, y, z} = tile.index;

    const loaded = new Map<string, DemTile>();
    for (const other of (this.state.tileset?.tiles || []) as DemTileHeader[]) {
      if (other.index.z === z && other.isLoaded && other.content) {
        loaded.set(`${other.index.x}/${other.index.y}`, other.content);
      }
    }
    const count = 2 ** z;
    const getNeighbor: DemNeighbors = (dx, dy) =>
      loaded.get(`${(x + dx + count) % count}/${y + dy}`) ?? null;
    // Which neighbors are loaded decides the texture's border.
    const present = [-1, 0, 1]
      .flatMap(dy => [-1, 0, 1].map(dx => ((dx || dy) && getNeighbor(dx, dy) ? 1 : 0)))
      .join('');
    const key = present;
    // Kept with the decoded tile, so the source's hillshade layers prepare its slopes once.
    let prepared = preparedTextures.get(dem);
    if (prepared?.key !== key) {
      const size = dem.dim + 2;
      const pixels = prepareHillshadeTexture(dem, z, getNeighbor);
      prepared = {key, image: new ImageData(pixels, size, size)};
      preparedTextures.set(dem, prepared);
    }

    const {west, south, east, north} = tile.bbox as {
      west: number;
      south: number;
      east: number;
      north: number;
    };
    const {hillshadeParameters, hillshadeSubLayerProps} = this.props;
    const textureParameters = hillshadeSubLayerProps?.textureParameters as
      | {magFilter?: string}
      | undefined;
    return new HillshadeBitmapLayer({
      ...props,
      ...hillshadeSubLayerProps,
      // A texture keeps the filter it was created with, so a filter change needs a new layer.
      id: textureParameters?.magFilter === 'nearest' ? `${props.id}-nearest` : props.id,
      parameters: {
        ...(hillshadeSubLayerProps?.parameters as object),
        ...PREMULTIPLIED_BLEND_PARAMETERS
      },
      data: null,
      // Positions in the tile are Web Mercator, also on a globe.
      _imageCoordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      image: prepared.image,
      bounds: [west, south, east, north],
      hillshadeParameters,
      hillshadeLatRange: [north, south]
    } as any);
  }
}
