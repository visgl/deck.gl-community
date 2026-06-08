// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export {TimeDeltaLayer, type TimeDeltaLayerProps} from './layers/time-delta-layer';
export {
  AnimationLayer,
  type AnimationLayerProps
} from './layers/animation-layer/animation-layer';
export type {
  AnimationFrame,
  AnimationFramesGroup
} from './layers/animation-layer/animation';
export {BlockLayer, type BlockLayerProps} from './layers/block-layer/block-layer';

export {fitBoundsOrthographic, getBoundsOrthographic} from './views/orthographic-utils';
export {
  getPaddedBlockBounds,
  type Bounds,
  type Geometry,
  type PaddedBlockBoundsOptions
} from './views/bounds-utils';
export {formatTimeMs, formatTimeRangeMs, type FormatTimeMsOptions} from './utils/format-utils';
export {validateViewState, mergeViewStates, type OptionalViewState} from './views/view-state-utils';
export {makeLayerFilter} from './views/layer-filter';
export {
  DEFAULT_BOUNDS_EPSILON,
  boundsAreEqual,
  getViewportBoundsForViewState,
  isBoundsCompletelyOutside,
  type BoundsEqualityOptions,
  type ViewportBounds
} from './views/viewport-bounds-utils';
export {
  type LayerFilter,
  type LayerBoundsFilterDecision,
  type LayerBoundsFilterOptions,
  combineLayerFilters,
  createViewportBoundsFilter
} from './views/layer-bounds-filter';

export {
  HEADER_VIEW_HEIGHT,
  LEGEND_VIEW_WIDTH,
  SYNCHRONIZED_VIEWS,
  SYNCHRONIZED_VIEW_STATE_CONSTRAINTS,
  getSynchronizedViewStates,
  fitSynchronizedViewStatesToBounds
} from './synchronized-views/synchronized-views';
