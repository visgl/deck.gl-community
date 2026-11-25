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

export {VolumetricVideoLayer} from './volumetric-video-layer/volumetric-video-layer';
export type {
  VolumetricVideoLayerProps,
  VolumetricVideoInfo,
  VolumetricVideoFrameInfo
} from './volumetric-video-layer/volumetric-video-layer';

export {getFrameHistoryBytes as getVolumetricVideoHistoryBytes} from './volumetric-video-layer/frame-utils';

export {SelectionPulseExtension} from '@deck.gl-community/layers/extensions';
export type {SelectionPulseExtensionProps} from '@deck.gl-community/layers/extensions';

export * from '@deck.gl-community/layers/splat-layers';

export {EdgeMarkerLayer} from './edge-marker-layer/edge-marker-layer';
export type {EdgeMarkerLayerProps} from './edge-marker-layer/edge-marker-layer';
export {
  computeEdgeMarkers,
  createEdgeMarkerFrame,
  EdgeMarkerState,
  DEFAULT_EDGE_MARKER_OPTIONS
} from './edge-marker-layer/compute-edge-markers';
export type {
  EdgeMarkerFrame,
  EdgeMarkerMargins,
  EdgeMarkerOptions
} from './edge-marker-layer/compute-edge-markers';

export {
  AnimationLayer,
  type AnimationLayerProps
} from './animation-layer/animation-layer';
export type {
  AnimationFrame,
  AnimationFramesGroup
} from './animation-layer/animation';
export {BlockLayer, type BlockLayerProps} from './block-layer/block-layer';
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
} from './fast-text-layer/index';

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
