import {LayerExtension, project32} from '@deck.gl/core';
import type {Layer} from '@deck.gl/core';

/**
 * Turns a billboard drawn along a line on a globe from the line's direction at the anchor (the
 * instance angle, counter-clockwise from east) to that direction as the view draws it, so the label
 * follows its line on every frame, at any bearing, anywhere on the globe, without updating any
 * attribute. The direction on screen is the line's tangent at the anchor, east and north on the
 * globe's surface (the derivatives of `project_globe_`), through the view-projection matrix: exact,
 * with no difference of nearby positions to lose precision.
 *
 * With `keepUpright`, a billboard that would read upside down there is turned by another half turn,
 * as `getUprightAngle` turns it from the bearing alone: away from the middle of the view the bearing
 * does not tell which way the view draws a line.
 *
 * With `pixelOffset`, the name of the layer's pixel offset attribute, that offset is not turned
 * around with the billboard: it is a direction along and across the line (see
 * `withLineDirection`), and stays on the same side of the line.
 *
 * The instance angle and pixel offset are only declared in the layer's own shader source, after the
 * hook functions, so they are copied into globals at the start of `main`.
 */
const getGlobeLineAngleModule = (keepUpright: boolean, pixelOffset?: string) => ({
  name: `globeLineAngle${keepUpright ? 'Upright' : ''}${pixelOffset ? `_${pixelOffset}` : ''}`,
  dependencies: [project32],
  inject: {
    'vs:#decl': /* glsl */ `
float globeLineAngle_angle;
vec2 globeLineAngle_pixelOffset;
`,
    'vs:#main-start': /* glsl */ `
  globeLineAngle_angle = radians(instanceAngles);
  // As the layer adds it to the billboard's offset, y down.
  globeLineAngle_pixelOffset = ${pixelOffset ? `vec2(${pixelOffset}.x, -${pixelOffset}.y)` : 'vec2(0.0)'};
`,
    'vs:DECKGL_FILTER_SIZE': /* glsl */ `
  if (project.projectionMode == PROJECTION_MODE_GLOBE) {
    float globeLineAngle_lambda = radians(geometry.worldPosition.x);
    float globeLineAngle_phi = radians(geometry.worldPosition.y);
    vec3 globeLineAngle_east = vec3(cos(globeLineAngle_lambda), sin(globeLineAngle_lambda), 0.0);
    vec3 globeLineAngle_north = vec3(
      -sin(globeLineAngle_lambda) * sin(globeLineAngle_phi),
      cos(globeLineAngle_lambda) * sin(globeLineAngle_phi),
      cos(globeLineAngle_phi)
    );
    vec3 globeLineAngle_tangent = cos(globeLineAngle_angle) * globeLineAngle_east +
      sin(globeLineAngle_angle) * globeLineAngle_north;
    vec4 globeLineAngle_clip = project_common_position_to_clipspace(
      vec4(project_position(geometry.worldPosition), 1.0)
    );
    vec4 globeLineAngle_clipTangent = project.viewProjectionMatrix * vec4(globeLineAngle_tangent, 0.0);
    // The derivative of the anchor's normalized device coordinates, times w squared, in pixels.
    vec2 globeLineAngle_screen = (globeLineAngle_clipTangent.xy * globeLineAngle_clip.w -
      globeLineAngle_clip.xy * globeLineAngle_clipTangent.w) * project.viewportSize;
    float globeLineAngle_turn =
      atan(globeLineAngle_screen.y, globeLineAngle_screen.x) - globeLineAngle_angle;
    float globeLineAngle_cos = cos(globeLineAngle_turn);
    float globeLineAngle_sin = sin(globeLineAngle_turn);
    mat2 globeLineAngle_rotation =
      mat2(globeLineAngle_cos, globeLineAngle_sin, -globeLineAngle_sin, globeLineAngle_cos);
${
  keepUpright
    ? `    if (globeLineAngle_screen.x < 0.0) {
      // Turned around, but for the pixel offset: -(size - offset) + offset.
      size.xy = 2.0 * globeLineAngle_pixelOffset - size.xy;
    }
`
    : ''
}    size.xy = globeLineAngle_rotation * size.xy;
  }
`
  }
});

const GLOBE_LINE_ANGLE_MODULES = {
  free: getGlobeLineAngleModule(false),
  upright: getGlobeLineAngleModule(true),
  // The pixel offset attributes of `IconLayer` (and the glyphs of `TextLayer`) and of
  // `TextLayer`'s backgrounds.
  instancePixelOffset: getGlobeLineAngleModule(true, 'instancePixelOffset'),
  instancePixelOffsets: getGlobeLineAngleModule(true, 'instancePixelOffsets')
};

/**
 * Keeps billboards drawn along lines (labels and icons whose rotation is aligned to the map) on
 * their lines in a `GlobeView`, which draws them in screen space: their angles are taken from
 * north up, and the shader turns them as the view draws the line, upright with `keepUpright`. In
 * other views it does nothing. Add it only to billboards (the shader would also turn the offset of
 * a layer drawn in the map plane) whose angle is a direction on the map. WebGL only: on WebGPU the
 * extension adds no shader code, and they stay as they are drawn from north up.
 *
 * Added to a composite layer such as `TextLayer`, it reaches the character and background
 * sublayers. With `keepOffsetSide`, text kept upright is turned around without its pixel offset,
 * which must then be a direction along and across the line, as `text-offset` is.
 */
export class GlobeLineAngleExtension extends LayerExtension<{
  keepUpright: boolean;
  keepOffsetSide?: boolean;
}> {
  static extensionName = 'GlobeLineAngleExtension';

  constructor(opts: {keepUpright: boolean; keepOffsetSide?: boolean}) {
    super(opts);
  }

  getShaders(this: Layer, extension: GlobeLineAngleExtension) {
    if (this.context.device.type === 'webgpu') {
      return {};
    }
    const {keepUpright, keepOffsetSide} = extension.opts;
    if (!keepUpright) {
      return {modules: [GLOBE_LINE_ANGLE_MODULES.free]};
    }
    if (!keepOffsetSide) {
      return {modules: [GLOBE_LINE_ANGLE_MODULES.upright]};
    }
    // `TextLayer`'s backgrounds name the attribute in the plural.
    const attributes = (this.getAttributeManager() as any)?.attributes || {};
    return {
      modules: [
        attributes.instancePixelOffsets
          ? GLOBE_LINE_ANGLE_MODULES.instancePixelOffsets
          : GLOBE_LINE_ANGLE_MODULES.instancePixelOffset
      ]
    };
  }
}
