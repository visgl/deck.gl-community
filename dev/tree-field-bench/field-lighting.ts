// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  LightingEffect,
  OrbitViewport,
  project,
  shadow,
  type EffectContext,
  type PreRenderOptions,
  type Viewport
} from '@deck.gl/core';
import type {Device, Framebuffer, Texture} from '@luma.gl/core';
import {ClipSpace} from '@luma.gl/engine';
import {FIELD_SHADOW_OPACITY, FIELD_GROUND_SHADOW_GLSL} from './field-ground-shadow';

type Point = [number, number, number];
type ShadowOptions = Parameters<typeof shadow.getUniforms>[0] & {historyWeight?: number};
type ShadowUniforms = ReturnType<typeof shadow.getUniforms>;
type ShadowMatrix = NonNullable<ShadowUniforms['viewProjectionMatrix0']>;

const CLOSE_SHADOW_SPAN = 16;
const FIELD_SHADOW_SPAN = 32;
// Keep the crown-scale grid through ordinary tree inspection, including the close benchmark view.
const CLOSE_SHADOW_ENTER = 6.5;
const CLOSE_SHADOW_EXIT = 7.5;
const LIGHT_BASIS = [0, 1, 2, 4, 5, 6, 8, 9, 10] as const;
const SHADOW_DEPTH_LEVELS = 65535;
const SHADOW_BLEND_MS = 160;

export type FieldShadowDiagnostics = {
  span: Point;
  texelMetres: number;
  snappedCenter: Point;
  mapSize: [number, number];
  historyWeight: number;
};

type LightWindow = {
  light: ArrayLike<number>;
  matrix: ShadowMatrix;
  center: Point;
  span: Point;
};

/** Keep one light-space scale while orbiting and through small zoom changes. */
function getShadowSpan(distance: number, current: number): number {
  // Inspection views fit a finer grid. Keep its hysteresis separate from the wider field bands.
  const closeLimit = current === CLOSE_SHADOW_SPAN ? CLOSE_SHADOW_EXIT : CLOSE_SHADOW_ENTER;
  if (distance <= closeLimit) return CLOSE_SHADOW_SPAN;
  current = Math.max(current, FIELD_SHADOW_SPAN);
  const requested = distance * 4;
  if (requested > current) return 2 ** Math.ceil(Math.log2(requested));
  // Leave headroom between entering and exiting a band so a slight zoom reversal holds scale.
  while (current > FIELD_SHADOW_SPAN && requested < current * 0.45) current *= 0.5;
  return current;
}

// Orbit cameras can reach a singular projection after a large wheel/pinch delta. Keep
// invalid poses and arbitrary coordinate systems out of the Cartesian light fit.
function getFitDistance(viewport: OrbitViewport, width: number, height: number): number | null {
  if (
    !(width >= 1 && height >= 1) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !viewport.viewProjectionMatrix.every(Number.isFinite)
  )
    return null;
  const [x, y, z] = viewport.target;
  const eye = viewport.cameraPosition;
  const distance = Math.hypot(eye[0] - x, eye[1] - y, eye[2] - z);
  return distance >= 0.01 && distance < 2 ** 30 ? distance : null;
}

function dotLight(light: ArrayLike<number>, axis: number, point: Point): number {
  return light[axis] * point[0] + light[axis + 4] * point[1] + light[axis + 8] * point[2];
}

function fitLightWindow(
  light: ArrayLike<number>,
  target: Point,
  span: Point,
  texelMetres: number
): LightWindow {
  const snap = (value: number, step: number) => Math.round(value / step) * step;
  const center: Point = [
    snap(dotLight(light, 0, target), texelMetres),
    snap(dotLight(light, 1, target), texelMetres),
    snap(dotLight(light, 2, target), span[2] / SHADOW_DEPTH_LEVELS)
  ];
  const scaleX = 2 / span[0];
  const scaleY = 2 / span[1];
  const scaleZ = -2 / span[2];
  // deck.gl's Cartesian projection uses positions relative to a common origin. Keep this
  // matrix linear and pass the translated origin separately through projectCenter.
  return {
    light,
    center,
    span,
    matrix: [
      light[0] * scaleX,
      light[1] * scaleY,
      light[2] * scaleZ,
      0,
      light[4] * scaleX,
      light[5] * scaleY,
      light[6] * scaleZ,
      0,
      light[8] * scaleX,
      light[9] * scaleY,
      light[10] * scaleZ,
      0,
      0,
      0,
      0,
      0
    ]
  };
}

function getProjectCenter(fit: LightWindow, origin: Point): [number, number, number, number] {
  const {light, center, span} = fit;
  return [
    ((dotLight(light, 0, origin) - center[0]) * 2) / span[0],
    ((dotLight(light, 1, origin) - center[1]) * 2) / span[1],
    ((center[2] - dotLight(light, 2, origin)) * 2) / span[2],
    1
  ];
}

const shadowBlendDeclaration = /* glsl */ `
layout(std140) uniform fieldShadowBlendUniforms {
  float weight;
  vec2 depthRange;
} fieldShadowBlend;
`;
const fieldShadowBlend = {
  name: 'fieldShadowBlend',
  vs: shadowBlendDeclaration,
  fs: shadowBlendDeclaration,
  source: /* wgsl */ `
struct FieldShadowBlendUniforms {
  weight: f32,
  depthRange: vec2<f32>,
};
@group(0) @binding(auto) var<uniform> fieldShadowBlend: FieldShadowBlendUniforms;
`,
  uniformTypes: {weight: 'f32', depthRange: 'vec2<f32>'},
  defaultUniforms: {weight: 0, depthRange: [1, 1]}
} as const;

/** Use the same light-space texels for casters and receivers. */
export function createFieldShadowModule() {
  let viewport: OrbitViewport | undefined;
  let anchor: Point | undefined;
  let band = FIELD_SHADOW_SPAN;
  let width = 0;
  let height = 0;
  let texelMetres = 0;
  let span: Point = [0, 0, 0];
  let lights: LightWindow[] = [];
  let diagnostics: FieldShadowDiagnostics | null = null;
  let frameBand: number | undefined;
  let history: LightWindow | undefined;
  let historyStart = 0;
  let historyWeight = 0;

  function invalidateFit(): void {
    // The pass can reuse or clear its texture after an invalid view. Its contents no longer
    // match the last valid transform, so the next frame must not capture it for a blend.
    viewport = undefined;
    lights = [];
    diagnostics = null;
    history = undefined;
    historyWeight = 0;
  }

  return {
    setAnchor(next: Point): void {
      if (anchor && next.every((value, axis) => value === anchor![axis])) return;
      anchor = next;
      viewport = undefined;
    },
    /** Request one copy of the previous map before the shadow pass replaces it. */
    beginFrame(
      nextViewport: Viewport | undefined,
      ratio: number,
      now: number,
      hasMap: boolean
    ): boolean {
      frameBand = undefined;
      if (!(nextViewport instanceof OrbitViewport)) {
        invalidateFit();
        return false;
      }
      const distance = getFitDistance(
        nextViewport,
        nextViewport.width * ratio,
        nextViewport.height * ratio
      );
      if (distance === null) {
        invalidateFit();
        return false;
      }
      const sameSize =
        width === Math.floor(nextViewport.width * ratio) &&
        height === Math.floor(nextViewport.height * ratio);
      const elapsed = (now - historyStart) / SHADOW_BLEND_MS;
      if (!sameSize || !hasMap || elapsed >= 1) history = undefined;
      const phase = Math.min(1, Math.max(0, elapsed));
      historyWeight = history ? 1 - phase * phase * (3 - 2 * phase) : 0;
      const requested = getShadowSpan(distance, band);
      // Finish the current blend before accepting a reversal. Capturing midway would replace
      // the displayed mix with only one of its maps.
      frameBand = history ? band : requested;
      if (history || band === requested || !sameSize || !hasMap || lights.length !== 1)
        return false;
      history = lights[0];
      historyStart = now;
      historyWeight = 1;
      return true;
    },
    module: {
      ...shadow,
      dependencies: [...shadow.dependencies, fieldShadowBlend],
      // The field's flat ground receives this map. Reject samples beyond its local footprint and
      // compare each packed depth before interpolating visibility, so small shadows stay visible
      // next to clear texels.
      fs: shadow.fs
        .replace(
          /float shadow_getShadowWeight\(vec3 position, sampler2D shadowMap\) \{[\s\S]*?\n\}/,
          FIELD_GROUND_SHADOW_GLSL
        )
        .replace(
          /    float shadowAlpha = 0.0;[\s\S]*?    shadowAlpha \*= shadow.color.a \/ shadow.lightCount;/,
          /* glsl */ `    float shadowAlpha = shadow_getShadowWeight(
      shadow_vPosition[0], shadow_uShadowMap0, fieldShadowBlend.depthRange.x);
    if (shadow.lightCount > 1.0) {
      float previous = shadow_getShadowWeight(
        shadow_vPosition[1], shadow_uShadowMap1, fieldShadowBlend.depthRange.y);
      shadowAlpha = fieldShadowBlend.weight > 0.0
        ? mix(shadowAlpha, previous, fieldShadowBlend.weight)
        : (shadowAlpha + previous) / shadow.lightCount;
    }
    // The field's far ground patches use the same peak opacity. Tree materials read the map separately.
    shadowAlpha *= min(shadow.color.a, ${FIELD_SHADOW_OPACITY});`
        ),
      getUniforms(options: ShadowOptions): ShadowUniforms {
        const {project: projection, shadowMatrices} = options;
        const nextViewport = projection?.viewport;
        if (
          options.shadowEnabled === false ||
          !(nextViewport instanceof OrbitViewport) ||
          !shadowMatrices?.length
        ) {
          return shadow.getUniforms(options);
        }
        const {commonOrigin, viewportSize} = project.getUniforms(projection) as {
          commonOrigin: Point;
          viewportSize: [number, number];
        };
        // ShadowPass uses the viewport's device dimensions for its color and depth attachments.
        const mapWidth = Math.max(1, Math.floor(viewportSize[0]));
        const mapHeight = Math.max(1, Math.floor(viewportSize[1]));
        const distance = getFitDistance(nextViewport, mapWidth, mapHeight);
        if (
          distance === null ||
          !commonOrigin.every(Number.isFinite) ||
          shadowMatrices.some(matrix => !LIGHT_BASIS.every(index => Number.isFinite(matrix[index])))
        ) {
          invalidateFit();
          return shadow.getUniforms({...options, shadowEnabled: false});
        }
        const lightCount = Math.min(shadowMatrices.length, 2);
        if (
          viewport !== nextViewport ||
          width !== mapWidth ||
          height !== mapHeight ||
          lights.length !== lightCount ||
          (frameBand !== undefined && frameBand !== band)
        ) {
          viewport = nextViewport;
          width = mapWidth;
          height = mapHeight;
          band = frameBand ?? getShadowSpan(distance, band);
          texelMetres = band / Math.min(width, height);
          span = [width * texelMetres, height * texelMetres, band * 2];
          lights = [];
        }
        const previous = options.historyWeight && !options.drawToShadowMap ? history : undefined;
        const result: ShadowUniforms = {
          drawShadowMap: Boolean(options.drawToShadowMap),
          useShadowMap: Boolean(options.shadowMaps?.length),
          color: options.shadowColor ?? [0, 0, 0, 1],
          lightId: options.shadowLightId ?? 0,
          lightCount: previous ? 2 : lightCount,
          shadow_uShadowMap0: options.shadowMaps?.[0] ?? options.dummyShadowMap!,
          shadow_uShadowMap1: options.shadowMaps?.[1] ?? options.dummyShadowMap!
        };
        for (let index = 0; index < lightCount; index++) {
          const light = shadowMatrices[index];
          let fit = lights[index];
          if (!fit || LIGHT_BASIS.some(axis => fit.light[axis] !== light[axis])) {
            fit = fitLightWindow(light, anchor ?? nextViewport.target, span, texelMetres);
            lights[index] = fit;
            if (index === 0) {
              diagnostics = {
                span,
                texelMetres,
                snappedCenter: fit.center,
                mapSize: [width, height],
                historyWeight
              };
            }
          }
          const center = getProjectCenter(fit, commonOrigin);
          if (index === 0) {
            result.viewProjectionMatrix0 = fit.matrix;
            result.projectCenter0 = center;
          } else {
            result.viewProjectionMatrix1 = fit.matrix;
            result.projectCenter1 = center;
          }
        }
        if (previous) {
          result.viewProjectionMatrix1 = previous.matrix;
          result.projectCenter1 = getProjectCenter(previous, commonOrigin);
        }
        return result;
      }
    },
    get diagnostics() {
      return diagnostics ? {...diagnostics, historyWeight} : null;
    },
    get historyWeight() {
      return historyWeight;
    },
    get depthRange(): [number, number] {
      const current = 2 * (frameBand ?? band);
      return [current, history?.span[2] ?? current];
    }
  };
}

export class FieldLightingEffect extends LightingEffect {
  private fieldShadow = createFieldShadowModule();
  private shadowMap: Texture | undefined;
  private historyMap: Texture | undefined;
  private historyTarget: Framebuffer | undefined;
  private copyHistory: ClipSpace | undefined;

  get shadowDiagnostics(): FieldShadowDiagnostics | null {
    return this.fieldShadow.diagnostics;
  }

  setShadowAnchor(anchor: Point): void {
    this.fieldShadow.setAnchor(anchor);
  }

  override setProps(props: Parameters<LightingEffect['setProps']>[0]): void {
    // LightingEffect can call setup while applying the lights, before storing its props.
    this.props = props;
    super.setProps(props);
  }

  override setup(context: EffectContext): void {
    super.setup(context);
    if (Object.values(this.props).some(light => light.type === 'directional' && light.shadow)) {
      context.deck._removeDefaultShaderModule(shadow);
      context.deck._addDefaultShaderModule(this.fieldShadow.module);
    }
  }

  override preRender(options: PreRenderOptions): void {
    const {device} = this.context!;
    const source = this.shadowMap;
    const capture = this.fieldShadow.beginFrame(
      options.viewports[0],
      device.canvasContext?.cssToDeviceRatio() ?? 1,
      performance.now(),
      Boolean(source)
    );
    if (capture && source) {
      if (this.historyMap?.width !== source.width || this.historyMap.height !== source.height) {
        this.historyTarget?.destroy();
        this.historyTarget = undefined;
        this.historyMap?.destroy();
        this.historyMap = device.createTexture({
          id: 'tree-shadow-history',
          format: 'rgba8unorm',
          width: source.width,
          height: source.height,
          sampler: {minFilter: 'linear', magFilter: 'linear'}
        });
      }
      this.captureHistory(device, source, this.historyMap);
    }
    super.preRender(options);
  }

  override getShaderModuleProps(...args: Parameters<LightingEffect['getShaderModuleProps']>) {
    const props = super.getShaderModuleProps(...args);
    const original = props.shadow;
    if (!original.shadowMaps || original.shadowMaps.length !== 1) return props;
    this.shadowMap = original.shadowMaps[0];
    const weight = this.fieldShadow.historyWeight;
    if (this.historyMap && weight > 0) {
      // Finish the blend even when the camera stops immediately after a wheel step.
      args[0].setNeedsRedraw();
      Object.assign(original, {
        shadowMaps: [original.shadowMaps[0], this.historyMap],
        historyWeight: weight
      });
    }
    return {...props, fieldShadowBlend: {weight, depthRange: this.fieldShadow.depthRange}};
  }

  private captureHistory(device: Device, source: Texture, destination: Texture): void {
    if (device.type === 'webgl') {
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToTexture({sourceTexture: source, destinationTexture: destination});
      device.submit(encoder.finish());
      return;
    }
    // deck's WebGPU shadow attachment can be sampled but has no COPY_SRC usage.
    // Reproduce its packed bytes with one render-to-texture draw only at a band change.
    this.historyTarget ??= device.createFramebuffer({colorAttachments: [destination]});
    this.copyHistory ??= new ClipSpace(device, {
      id: 'field-shadow-history-copy',
      source: /* wgsl */ `
@group(0) @binding(0) var sourceMap: texture_2d<f32>;
@fragment fn fragmentMain(input: FragmentInputs) -> @location(0) vec4<f32> {
  return textureLoad(sourceMap, vec2<i32>(input.Position.xy), 0);
}
`,
      shaderLayout: {
        attributes: [
          {name: 'clipSpacePositions', location: 0, type: 'vec2<f32>'},
          {name: 'texCoords', location: 1, type: 'vec2<f32>'},
          {name: 'coordinates', location: 2, type: 'vec2<f32>'}
        ],
        bindings: [
          {
            name: 'sourceMap',
            type: 'texture',
            group: 0,
            location: 0,
            sampleType: 'unfilterable-float'
          }
        ]
      }
    });
    this.copyHistory.setBindings({sourceMap: source});
    const pass = device.beginRenderPass({framebuffer: this.historyTarget});
    this.copyHistory.draw(pass);
    pass.end();
  }

  override cleanup(context: EffectContext): void {
    this.copyHistory?.destroy();
    this.copyHistory = undefined;
    this.historyTarget?.destroy();
    this.historyTarget = undefined;
    this.historyMap?.destroy();
    this.historyMap = undefined;
    this.shadowMap = undefined;
    context.deck._removeDefaultShaderModule(this.fieldShadow.module);
    super.cleanup(context);
  }
}
