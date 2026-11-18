// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  LightingEffect,
  project,
  shadow,
  shadowPlugin,
  WebMercatorViewport,
  type EffectContext
} from '@deck.gl/core';
import {getFarmPosition} from './farm-data';

type Point = [number, number, number];

// Both farm layouts, the longest projected tree shadow, and the tallest tree at maximum size.
const bounds = {min: [-55, -55, -1], max: [359, 401, 45]} as const;
export const FARM_GROUND = [
  getFarmPosition(bounds.min[0], bounds.min[1], -0.05),
  getFarmPosition(bounds.max[0], bounds.min[1], -0.05),
  getFarmPosition(bounds.max[0], bounds.max[1], -0.05),
  getFarmPosition(bounds.min[0], bounds.max[1], -0.05)
];
const viewport = new WebMercatorViewport();
export const FARM_COMMON_UNITS_PER_METRE = viewport.getDistanceScales().unitsPerMeter[2];
const corners = [bounds.min[0], bounds.max[0]].flatMap(x =>
  [bounds.min[1], bounds.max[1]].flatMap(y =>
    [bounds.min[2], bounds.max[2]].map(z => viewport.projectPosition(getFarmPosition(x, y, z)))
  )
);

const dot = (a: Point, b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Fit the full farm in the overview and a texel-aligned inspection area when close. */
export const farmShadow = {
  ...shadow,
  getUniforms(
    options: Parameters<typeof shadow.getUniforms>[0]
  ): ReturnType<typeof shadow.getUniforms> {
    const uniforms = shadow.getUniforms(options);
    const light = options.shadowMatrices?.[0];
    if (!light || (!uniforms.drawShadowMap && !uniforms.useShadowMap)) return uniforms;

    const axes: Point[] = [0, 1, 2].map(i => [light[i], light[i + 4], light[i + 8]]);
    const view = options.project?.viewport;
    if (!(view instanceof WebMercatorViewport)) return uniforms;
    const {commonOrigin: origin, viewportSize} = project.getUniforms(options.project) as {
      commonOrigin: Point;
      viewportSize: [number, number];
    };
    const target = view.projectPosition([view.longitude, view.latitude, 0]);
    const inspectionSpan = Math.max(42, 440 * 2 ** (18 - view.zoom));
    const center: [number, number, number, number] = [0, 0, 0, 1];
    const matrix: NonNullable<typeof uniforms.viewProjectionMatrix0> = [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    ];
    for (const [index, axis] of axes.entries()) {
      const positions = corners.map(corner => dot(axis, corner));
      const low = Math.min(...positions);
      const high = Math.max(...positions);
      const fullSpan = high - low;
      const span =
        index === 2 ? fullSpan : Math.min(fullSpan, inspectionSpan * FARM_COMMON_UNITS_PER_METRE);
      const scale = (index === 2 ? -2 : 2) / span;
      let midpoint = (high + low) * 0.5;
      if (span < fullSpan) {
        const texel = span / Math.max(1, Math.floor(viewportSize[index]));
        const targetMidpoint = Math.max(
          low + span * 0.5,
          Math.min(high - span * 0.5, dot(axis, target))
        );
        midpoint = Math.round(targetMidpoint / texel) * texel;
      }
      center[index] = (dot(axis, origin) - midpoint) * scale;
      for (let i = 0; i < 3; i++) matrix[index + i * 4] = axis[i] * scale;
    }
    return {...uniforms, viewProjectionMatrix0: matrix, projectCenter0: center};
  }
};

export const farmShadowPlugin = {...shadowPlugin, module: farmShadow};

/** Reuse deck's shadow pass for the farm's single directional light. */
export class FarmLightingEffect extends LightingEffect {
  setup(context: EffectContext): void {
    super.setup(context);
    context.deck._removeDefaultShaderPlugin(shadowPlugin);
    context.deck._addDefaultShaderPlugin(farmShadowPlugin);
  }

  cleanup(context: EffectContext): void {
    context.deck._removeDefaultShaderPlugin(farmShadowPlugin);
    super.cleanup(context);
  }
}
