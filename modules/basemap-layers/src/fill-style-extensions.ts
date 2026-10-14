// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {LayerExtension, project} from '@deck.gl/core';
import type {Layer} from '@deck.gl/core';
import {FillStyleExtension} from '@deck.gl/extensions';

/** Whether a layer's device runs the GLSL injections of these extensions. */
function isGLSLDevice(layer: Layer): boolean {
  return layer.context.device.type !== 'webgpu';
}

/**
 * `fill-translate` in common space. The offset is in pixels on the ground plane, as MapLibre GL
 * JS applies it in tile units: x east and y south on a map, along the local east and south on a
 * globe. The vertex moves before later injections run, so a pattern moves with the fill.
 */
const fillTranslateModule = {
  name: 'fillTranslate',
  dependencies: [project],
  vs: /* glsl */ `\
layout(std140) uniform fillTranslateUniforms {
  vec2 offset;
} fillTranslate;
`,
  uniformTypes: {offset: 'vec2<f32>'},
  inject: {
    'vs:DECKGL_FILTER_GL_POSITION': {
      order: -1,
      injection: /* glsl */ `
  if (fillTranslate.offset != vec2(0.0)) {
    vec2 fillTranslate_pixels = vec2(fillTranslate.offset.x, -fillTranslate.offset.y);
    if (project.projectionMode == PROJECTION_MODE_GLOBE) {
      // The globe is centred at the origin with its axis along z.
      vec3 fillTranslate_up = normalize(geometry.position.xyz);
      vec3 fillTranslate_east = vec3(-fillTranslate_up.y, fillTranslate_up.x, 0.0);
      fillTranslate_east = length(fillTranslate_east) > 0.0
        ? normalize(fillTranslate_east)
        : vec3(1.0, 0.0, 0.0);
      vec3 fillTranslate_north = cross(fillTranslate_up, fillTranslate_east);
      geometry.position.xyz +=
        (fillTranslate_east * fillTranslate_pixels.x + fillTranslate_north * fillTranslate_pixels.y) /
        project.scale;
    } else {
      geometry.position.xy += fillTranslate_pixels / project.scale;
    }
    position = project_common_position_to_clipspace(geometry.position);
  }
`
    }
  }
} as const;

/** The anchor of `fill-translate`. */
export type FillTranslateAnchor = 'map' | 'viewport';

type FillTranslateExtensionProps = {
  /** `fill-translate`: the offset in pixels, x right and y down. */
  fillTranslate?: [number, number];
  /** `fill-translate-anchor`: `'map'` turns the offset with the map, `'viewport'` keeps it on screen. */
  fillTranslateAnchor?: FillTranslateAnchor;
};

/**
 * Returns the ground offset of `fill-translate` in pixels, x east and y south, at a map bearing in
 * degrees. A `'viewport'` offset is turned by the bearing, so it keeps its direction on screen,
 * as in MapLibre GL JS.
 */
export function getFillTranslateOffset(
  translate: readonly [number, number],
  anchor: FillTranslateAnchor,
  bearing: number
): [number, number] {
  const [x, y] = translate;
  if (anchor !== 'viewport' || !bearing) {
    return [x, y];
  }
  const angle = (bearing * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos - y * sin, x * sin + y * cos];
}

/**
 * Offsets a fill and its outline by `fill-translate` pixels, anchored to the map or to the
 * viewport by `fill-translate-anchor`. WebGL only; on WebGPU fills draw untranslated.
 *
 * Added to a `GeoJsonLayer`, it reaches the polygon fill and outline sublayers.
 */
export class FillTranslateExtension extends LayerExtension {
  static extensionName = 'FillTranslateExtension';
  static defaultProps = {
    fillTranslate: {type: 'array', value: [0, 0], compare: true},
    fillTranslateAnchor: 'map'
  };

  getShaders(this: Layer) {
    if (!isGLSLDevice(this)) {
      return {};
    }
    return {modules: [fillTranslateModule]};
  }

  draw(this: Layer<FillTranslateExtensionProps>) {
    if (!isGLSLDevice(this)) {
      return;
    }
    const {fillTranslate = [0, 0], fillTranslateAnchor = 'map'} = this.props;
    const bearing = (this.context.viewport as {bearing?: number}).bearing || 0;
    this.setShaderModuleProps({
      fillTranslate: {
        offset: getFillTranslateOffset(fillTranslate, fillTranslateAnchor, bearing)
      }
    });
  }
}

/**
 * On a globe, places the pattern by the vertex's Web Mercator position instead of `FillStyleExtension`'s
 * common position, whose x and y lie in the globe's equatorial plane: the pattern then keeps its
 * size and shape across the globe, and stays continuous across tiles, as on a map. Runs after
 * `FillStyleExtension`'s injection (`order: 1`), with the pattern size in common units.
 */
const globePatternModule = {
  name: 'globeFillPattern',
  dependencies: [project],
  inject: {
    'vs:DECKGL_FILTER_GL_POSITION': {
      order: 1,
      injection: /* glsl */ `
  if (project.projectionMode == PROJECTION_MODE_GLOBE && fill.patternEnabled && !fill.procedural) {
    vec2 globePattern_frame = fill.patternUnitScale * fillPatternScales * fillPatternFrames.zw;
    // Pattern atlases use top-left coordinates; Web Mercator y grows northward.
    fill_uv = project_mercator_(geometry.worldPosition.xy) / globePattern_frame * vec2(1.0, -1.0);
    fill_uv += fillPatternOffsets;
  }
`
    }
  }
} as const;

/**
 * `FillStyleExtension` with image patterns, run only where its GLSL shader runs. On WebGPU it adds
 * no shader code, and the fills it is added to draw nothing, as before patterns were supported:
 * their fill color is only the pattern's opacity.
 */
export class FillPatternExtension extends FillStyleExtension {
  static extensionName = 'FillPatternExtension';

  constructor() {
    super({pattern: true});
  }

  getShaders(this: Layer, extension: this): any {
    const shaders = super.getShaders.call(this, extension);
    return (
      shaders && {
        ...shaders,
        modules: [...shaders.modules, globePatternModule]
      }
    );
  }

  isEnabled(layer: Layer): boolean {
    return isGLSLDevice(layer) && super.isEnabled(layer);
  }

  getSubLayerProps(this: Layer, extension: this): any {
    const props = LayerExtension.prototype.getSubLayerProps.call(this, extension);
    return isGLSLDevice(this) ? props : {...props, getFillColor: [0, 0, 0, 0]};
  }
}
