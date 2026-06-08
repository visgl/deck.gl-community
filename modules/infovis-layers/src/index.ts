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
export {
  DependencyArrowLayer,
  PathDirection,
  type DependencyArrowLayerProps
} from './layers/dependency-arrow-layer/dependency-arrow-layer';
export {BlockLayer, type BlockLayerProps} from './layers/block-layer/block-layer';
export {
  TimeAxisLayer,
  type TimeAxisLayerProps,
  type TimeAxisTickFormatter
} from './layers/time-axis-layer';

export {fitBoundsOrthographic, getBoundsOrthographic} from './views/orthographic-utils';
export {getPaddedBlockBounds, type Bounds} from './views/bounds-utils';
export {formatTimeMs, formatTimeRangeMs} from './utils/format-utils';
export {formatDuration, type Tick} from './utils/tick-utils';
export {validateViewState, mergeViewStates, type OptionalViewState} from './views/view-state-utils';
export {makeLayerFilter} from './views/layer-filter';
export {
  DEFAULT_BOUNDS_EPSILON,
  boundsAreEqual,
  getViewportBoundsForViewState,
  isBoundsCompletelyOutside,
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
