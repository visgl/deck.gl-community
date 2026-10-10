// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Accessor, DefaultProps} from '@deck.gl/core';
import {ScatterplotLayer, type ScatterplotLayerProps} from '@deck.gl/layers';
import {getStyleAccessor, withOpacity} from './style-accessor';
import {getStylePropertyDefault} from './style-expression';
import type {ResolvedBasemapStyleLayer as BasemapStyleLayer} from './style-resolver';

const DEFAULT_RADIUS = getStylePropertyDefault('circle-radius') as number;
const DEFAULT_COLOR = getStylePropertyDefault('circle-color') as number[];
const DEFAULT_OPACITY = getStylePropertyDefault('circle-opacity') as number;
const DEFAULT_STROKE_WIDTH = getStylePropertyDefault('circle-stroke-width') as number;
const DEFAULT_STROKE_COLOR = getStylePropertyDefault('circle-stroke-color') as number[];
const DEFAULT_STROKE_OPACITY = getStylePropertyDefault('circle-stroke-opacity') as number;
const DEFAULT_BLUR = getStylePropertyDefault('circle-blur') as number;

/** A `ScatterplotLayer` with a per-circle `getBlur` (`circle-blur`, a fraction of the radius). */
class CircleStyleLayer extends ScatterplotLayer<any, {getBlur: Accessor<any, number>}> {
  static layerName = 'CircleStyleLayer';
  static defaultProps: DefaultProps<ScatterplotLayerProps & {getBlur: Accessor<any, number>}> = {
    getBlur: {type: 'accessor', value: 0}
  };

  initializeState(): void {
    super.initializeState();
    this.getAttributeManager()!.addInstanced({
      instanceBlur: {size: 1, accessor: 'getBlur', defaultValue: 0}
    });
  }

  getShaders() {
    const shaders = super.getShaders();
    // The blur is written in GLSL only; on WebGPU circles draw without it.
    if (this.context.device.type === 'webgpu') {
      return shaders;
    }
    // Append to existing injections: extensions such as the tile clip use the same hooks.
    const inject: Record<string, string> = {...shaders.inject};
    const append = (hook: string, code: string) => {
      inject[hook] = `${inject[hook] ?? ''}\n${code}`;
    };
    append('vs:#decl', 'in float instanceBlur;\nout float vCircleBlur;');
    append('vs:#main-end', 'vCircleBlur = instanceBlur;');
    append('fs:#decl', 'in float vCircleBlur;');
    // MapLibre fades the outer `circle-blur` fraction of the circle, stroke included.
    append(
      'fs:DECKGL_FILTER_COLOR',
      'if (vCircleBlur > 0.0) { color.a *= 1.0 - smoothstep(1.0 - vCircleBlur, 1.0, length(geometry.uv)); }'
    );
    return {...shaders, inject};
  }
}

const pointFeatureCache = new WeakMap<any[], any[]>();
const sortedFeatureCache = new WeakMap<
  any[],
  WeakMap<BasemapStyleLayer, {key: unknown[]; features: any[]}>
>();

function getPointFeatures(features: any[]): any[] {
  const cached = pointFeatureCache.get(features);
  if (cached) {
    return cached;
  }
  const points = features.every(feature => feature.geometry?.type === 'Point')
    ? features
    : features.flatMap(feature => {
        if (feature.geometry?.type === 'Point') {
          return [feature];
        }
        if (feature.geometry?.type === 'MultiPoint') {
          return feature.geometry.coordinates.map((position: number[]) => ({...feature, position}));
        }
        return [];
      });
  pointFeatureCache.set(features, points);
  return points;
}

function getSortedFeatures(features: any[], styleLayer: BasemapStyleLayer, zoom: number): any[] {
  const sortKey = styleLayer.layout?.['circle-sort-key'];
  if (sortKey === undefined) {
    return features;
  }
  const accessor = getStyleAccessor(
    styleLayer,
    ['circle-sort-key'],
    zoom,
    ([key]) => Number(key) || 0
  );
  const {value} = accessor;
  const key = [sortKey, typeof value === 'function' ? accessor.updateTrigger : value];
  let byStyleLayer = sortedFeatureCache.get(features);
  if (!byStyleLayer) {
    byStyleLayer = new WeakMap();
    sortedFeatureCache.set(features, byStyleLayer);
  }
  const cached = byStyleLayer.get(styleLayer);
  if (cached && cached.key.every((entry, index) => entry === key[index])) {
    return cached.features;
  }
  const sorted =
    typeof value === 'function'
      ? features
          .map(feature => ({feature, key: value(feature)}))
          .sort((a, b) => a.key - b.key)
          .map(entry => entry.feature)
      : features;
  byStyleLayer.set(styleLayer, {key, features: sorted});
  return sorted;
}

/**
 * Draws a `circle` style layer's points (and each point of a multipoint) with MapLibre's circle
 * paint: the stroke is drawn outside `circle-radius`. Under pitch, circles shrink with distance,
 * as with the default `circle-pitch-scale` of `map`; `viewport` is not applied.
 * `circle-translate-anchor` follows `circle-pitch-alignment`: the offset is screen-aligned when
 * circles face the viewer and map-aligned when they lie on the map.
 */
export function createCircleSubLayer({
  baseProps,
  id,
  styleLayer,
  features,
  zoom,
  parameters
}: {
  baseProps: any;
  id: string;
  styleLayer: BasemapStyleLayer;
  features: any[];
  zoom: number;
  parameters: any;
}) {
  const points = getPointFeatures(features);
  if (points.length === 0) {
    return null;
  }
  const radius = getStyleAccessor(
    styleLayer,
    ['circle-radius', 'circle-stroke-width'],
    zoom,
    ([value, width]) =>
      Math.max(0, Number(value ?? DEFAULT_RADIUS)) +
      Math.max(0, Number(width ?? DEFAULT_STROKE_WIDTH)) / 2
  );
  const lineWidth = getStyleAccessor(styleLayer, ['circle-stroke-width'], zoom, ([width]) =>
    Math.max(0, Number(width ?? DEFAULT_STROKE_WIDTH))
  );
  const fillColor = getStyleAccessor(
    styleLayer,
    ['circle-color', 'circle-opacity'],
    zoom,
    ([color, opacity]) => withOpacity(color ?? DEFAULT_COLOR, opacity ?? DEFAULT_OPACITY)
  );
  const lineColor = getStyleAccessor(
    styleLayer,
    ['circle-stroke-color', 'circle-stroke-opacity'],
    zoom,
    ([color, opacity]) =>
      withOpacity(color ?? DEFAULT_STROKE_COLOR, opacity ?? DEFAULT_STROKE_OPACITY)
  );
  const blur = getStyleAccessor(styleLayer, ['circle-blur'], zoom, ([value]) =>
    Math.min(1, Math.max(0, Number(value ?? DEFAULT_BLUR) || 0))
  );
  const pixelOffset = getStyleAccessor<[number, number]>(
    styleLayer,
    ['circle-translate'],
    zoom,
    ([value]) => {
      const [x, y] = value ?? [0, 0];
      // Scatterplot adds offsets in clip space (billboard) or common space (map), both y-up.
      return [x, y === 0 ? 0 : -y];
    }
  );
  const alignment = getStyleAccessor(styleLayer, ['circle-pitch-alignment'], zoom, ([v]) => v);

  return new CircleStyleLayer({
    ...baseProps,
    id,
    data: getSortedFeatures(points, styleLayer, zoom),
    getPosition: d => d.position ?? d.geometry.coordinates,
    getRadius: radius.value,
    getLineWidth: lineWidth.value,
    getFillColor: fillColor.value,
    getLineColor: lineColor.value,
    getBlur: blur.value,
    getPixelOffset: pixelOffset.value,
    billboard: alignment.value !== 'map',
    stroked: styleLayer.paint?.['circle-stroke-width'] !== undefined && lineWidth.value !== 0,
    updateTriggers: {
      getRadius: radius.updateTrigger,
      getLineWidth: lineWidth.updateTrigger,
      getFillColor: fillColor.updateTrigger,
      getLineColor: lineColor.updateTrigger,
      getBlur: blur.updateTrigger,
      getPixelOffset: pixelOffset.updateTrigger
    },
    radiusUnits: 'pixels',
    lineWidthUnits: 'pixels',
    radiusMinPixels: 0,
    lineWidthMinPixels: 0,
    filled: true,
    antialiasing: true,
    parameters
  });
}
