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
export {
  FastTextLayer,
  type FastTextLayerProps,
  type _FastTextLayerProps,
  buildFastTextUtf8ColumnSource,
  buildFastTextGlyphData,
  buildMultiLineGlyphData,
  buildSingleLineGlyphData,
  collectFastTextCharacterSet,
  updateFastTextDynamicGlyphAttributes,
  type BuildFastTextGlyphDataProps,
  type CollectFastTextCharacterSetProps,
  type FastTextAlignmentBaseline,
  type FastTextAnchor,
  type FastTextClipRect,
  type FastTextContentAlign,
  type FastTextDynamicGlyphUpdateStats,
  type FastTextGlyphBuildStats,
  type FastTextGlyphAttributes,
  type FastTextGlyphData,
  type FastTextUtf8Column,
  type FastTextUtf8ColumnSource,
  type FastTextUtf8ViewAccessor,
  type UpdateFastTextDynamicGlyphAttributesProps,
  buildFastTextCharacterMapping,
  createFastTextFontAtlas,
  DEFAULT_FAST_TEXT_FONT_SETTINGS,
  FastTextFontAtlasManager,
  type FastTextCharacter,
  type FastTextCharacterMapping,
  type FastTextFontAtlas,
  type FastTextFontSettings
} from './layers/fast-text-layer/index';

export {fitBoundsOrthographic, getBoundsOrthographic} from './views/orthographic-utils';
export {
  buildViewsFromViewLayout,
  type CompiledDeckViews,
  type ViewLayoutRect,
  ViewLayoutItem,
  type ViewLayoutBaseProps,
  type ViewLayoutChild,
  type ViewLayoutColumnProps,
  type ViewLayoutInsets,
  type ViewLayoutItemProps,
  type ViewLayoutLength,
  type ViewLayoutOverlayProps,
  type ViewLayoutRowProps,
  type ViewLayoutSpacerProps,
  type ViewLayoutViewProps
} from './views/view-layout/index';
export {
  getPaddedBlockBounds,
  type Bounds,
  type Geometry,
  type PaddedBlockBoundsOptions
} from './views/bounds-utils';
export {formatTimeMs, formatTimeRangeMs, type FormatTimeMsOptions} from './utils/format-utils';
export {
  arrowFindUtf8,
  getArrowUtf8ColumnSource,
  getArrowUtf8RowView,
  getUtf8ColumnSourceRowView,
  makeUtf8StringView,
  type Utf8ColumnSource,
  type Utf8ColumnSourceChunk,
  type Utf8StringView
} from './utils/utf8-string-view';
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
