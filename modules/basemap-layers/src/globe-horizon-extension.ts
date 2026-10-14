import {LayerExtension, project} from '@deck.gl/core';
import type {Layer} from '@deck.gl/core';

/**
 * Hides every vertex of an instance whose anchor (`geometry.worldPosition`) lies beyond the
 * globe's horizon. Runs after the collision filter's `DECKGL_FILTER_GL_POSITION` injection
 * (`order: 1`), so its sort depth cannot move a hidden quad back into clip space.
 *
 * In `GlobeView`'s common space the globe is centred at the origin with radius `GLOBE_RADIUS`. As
 * in MapLibre GL JS, the test uses the point of the surface under the anchor, with unit normal
 * `n`:
 * - with a perspective camera at `C`, the point is visible when `dot(n, C) >= GLOBE_RADIUS`, the
 *   camera's side of the plane through the points where lines from the camera touch the globe;
 * - with an orthographic camera, whose rays are parallel, it is visible when the normal does not
 *   point away from the viewer. The fourth row of an orthographic view-projection matrix is
 *   `(0, 0, 0, 1)`, and its third row is the direction in which depth grows.
 */
const globeHorizonModule = {
  name: 'globeHorizon',
  dependencies: [project],
  inject: {
    'vs:DECKGL_FILTER_GL_POSITION': {
      order: 1,
      injection: /* glsl */ `
  if (project.projectionMode == PROJECTION_MODE_GLOBE) {
    vec3 globeHorizon_normal = normalize(project_position(geometry.worldPosition));
    mat4 globeHorizon_m = project.viewProjectionMatrix;
    vec3 globeHorizon_wRow = vec3(globeHorizon_m[0][3], globeHorizon_m[1][3], globeHorizon_m[2][3]);
    bool globeHorizon_hidden = dot(globeHorizon_wRow, globeHorizon_wRow) == 0.0
      ? dot(globeHorizon_normal, vec3(globeHorizon_m[0][2], globeHorizon_m[1][2], globeHorizon_m[2][2])) > 0.0
      : dot(globeHorizon_normal, project.cameraPosition) < GLOBE_RADIUS;
    if (globeHorizon_hidden) {
      // Every vertex of the quad lands beyond the far plane, so it is clipped. In the collision
      // pass this keeps a hidden label out of the collision map.
      position = vec4(0.0, 0.0, 2.0, 1.0);
    }
  }
`
    }
  }
} as const;

/**
 * Hides labels and icons whose anchor is on the far side of the globe in a `GlobeView`, in the
 * screen pass and in the collision filter's pass. In other views the shader does nothing. WebGL
 * only: on WebGPU the extension adds no shader code.
 *
 * Added to a composite layer such as `TextLayer`, it reaches the character and background
 * sublayers.
 */
export class GlobeHorizonExtension extends LayerExtension {
  static extensionName = 'GlobeHorizonExtension';

  getShaders(this: Layer) {
    if (this.context.device.type === 'webgpu') {
      return {};
    }
    return {modules: [globeHorizonModule]};
  }
}
