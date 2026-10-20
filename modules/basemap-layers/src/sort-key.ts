// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {getStyleAccessor} from './style-accessor';
import type {ResolvedBasemapStyleLayer as BasemapStyleLayer} from './style-resolver';

/** The latest sorted features per tile content and style layer. */
const sortedFeatureCache = new WeakMap<
  any[],
  WeakMap<BasemapStyleLayer, {key: unknown[]; features: any[]}>
>();

/**
 * A tile's features of a style layer in the order of their sort key (`circle-sort-key`,
 * `line-sort-key`), ascending, as MapLibre GL JS orders a bucket: features with a higher key draw
 * over those with a lower one, and features with the same key keep their tile order. Without a
 * per-feature key, the features are returned as they are. The sorted array is reused while the
 * features, the key and (for a key that depends on zoom) the style zoom are unchanged, so deck.gl
 * does not re-tessellate the features at every zoom step.
 */
export function sortFeaturesByKey(
  features: any[],
  styleLayer: BasemapStyleLayer,
  propertyName: 'circle-sort-key' | 'line-sort-key',
  zoom: number
): any[] {
  const sortKey = styleLayer.layout?.[propertyName];
  if (sortKey === undefined) {
    return features;
  }
  const accessor = getStyleAccessor(styleLayer, [propertyName], zoom, ([key]) => Number(key) || 0);
  const {value} = accessor;
  const key = [
    propertyName,
    sortKey,
    features.length,
    typeof value === 'function' ? accessor.updateTrigger : value
  ];
  let byStyleLayer = sortedFeatureCache.get(features);
  if (!byStyleLayer) {
    byStyleLayer = new WeakMap();
    sortedFeatureCache.set(features, byStyleLayer);
  }
  const cached = byStyleLayer.get(styleLayer);
  if (cached && cached.key.every((entry, index) => entry === key[index])) {
    return cached.features;
  }
  // `Array.prototype.sort` is stable.
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
