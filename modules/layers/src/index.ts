// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export type {PathOutlineLayerProps} from './path-outline-layer/path-outline-layer';
export {PathOutlineLayer} from './path-outline-layer/path-outline-layer';

export type {PathMarkerLayerProps} from './path-marker-layer/path-marker-layer';
export {PathMarkerLayer} from './path-marker-layer/path-marker-layer';

export {
  DependencyArrowLayer,
  PathDirection,
  type DependencyArrowLayerProps,
  type MarkerPlacementsAccessor,
  type MarkerPlacementsAccessorContext,
  type PathDirectionAccessor,
  type PathGeometry,
  type PathMarker
} from './dependency-arrow-layer/dependency-arrow-layer';

export type {SkyboxLayerProps} from './skybox-layer/skybox-layer';
export {SkyboxLayer} from './skybox-layer/skybox-layer';

export type {FlameTrailLayerProps} from './flame-trail-layer/flame-trail-layer';
export {FlameTrailLayer} from './flame-trail-layer/flame-trail-layer';

export {TreeLayer} from './tree-layer/tree-layer';
export type {
  TreeLayerProps,
  TreeType,
  Season,
  CropConfig
} from './tree-layer/tree-layer';

export {SplatLayer} from './splat-layer/splat-layer';
export type {SplatLayerProps} from './splat-layer/splat-layer';
export type {SplatSource} from './splat-layer/splat-source';
export {createSplatHierarchy} from './splat-layer/splat-hierarchy';
export type {SplatHierarchy, SplatHierarchyLevel} from './splat-layer/splat-hierarchy';
export {SplatShadowPass} from './splat-layer/splat-shadow-pass';
export type {SplatShadowProjection} from './splat-layer/splat-shadow-pass';
