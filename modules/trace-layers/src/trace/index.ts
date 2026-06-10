// TRACE IDS

export {
  brand,
  unbrand,
  type TrackAggregationMode,
  type TraceSpanLayoutMode,
  type TraceProcessId,
  type TraceThreadId,
  type TraceSpanId,
  type TraceInstantId,
  type TraceCounterId,
  type TraceEventId,
  type TraceDependencyId,
  type LocalSpanRef,
  type SpanRef,
  type TraceProcess,
  type TraceThread,
  type TraceSpan,
  type TraceSpanTiming,
  type TraceInstant,
  type TraceCounter,
  type TraceEvent,
  type TraceDependency,
  type TraceLocalDependency,
  type TraceCrossProcessDependency,
  type TraceCrossProcessEndpoint,
  type TraceCrossProcessEndpointId,
  type TracePath,
  type TraceProcessInfo,
  type TraceProcessInfoObject,
  type TraceObject,
  getPrimaryTiming
} from './trace-graph/trace-types';
export {type TraceInteractionMode, type TraceVisSettings} from './trace-graph/trace-settings';
export {
  buildTraceChunkRegistry,
  type TraceChunkBackedRef,
  type TraceChunkBackedRefKind,
  type TraceChunkRegistry,
  type TraceRuntimeChunk,
  type TraceProcessOwnedRef,
  type TraceThreadOwnedRef
} from './trace-graph/trace-chunk-registry';
export {
  TraceOwnerRefRegistry,
  type TraceOwnerProcessMetadata,
  type TraceOwnerProcessSnapshot,
  type TraceOwnerRefSnapshot
} from './trace-graph/trace-owner-ref-registry';
export {
  DEFAULT_TRACE_WINDOW_NOTIFY_INTERVAL_MS,
  TRACE_EXTERNAL_SPAN_ID_URL_CODEC,
  TraceChunkStore,
  createChronologicalTraceChunkSpanBudgetPolicy,
  createStaticTraceChunkStore,
  createStaticTraceGraphRuntimeSource,
  traceWindowToTraceChunkSelectionWindow,
  type StaticTraceChunkStoreOptions,
  type StaticTraceGraphRuntimeSourceChunkOptions,
  type StaticTraceGraphRuntimeSourceGraphDataOptions,
  type StaticTraceGraphRuntimeSourceMetadataOptions,
  type StaticTraceGraphRuntimeSourceOptions,
  type TraceChunkDescriptor,
  type TraceChunkSelection,
  type TraceChunkSelectionPolicy,
  type TraceChunkSelectionPolicyParams,
  type TraceChunkSelectionSummary,
  type TraceChunkSelectionWindow,
  type TraceChunkStoreEnsureParams,
  type TraceChunkStoreEnsureResult,
  type TraceChunkStoreEnsureSummary,
  type TraceChunkStoreDescriptorRefreshParams,
  type TraceChunkStoreLoadResult,
  type TraceChunkStoreOptions,
  type TraceChunkStoreProgress,
  type TraceChunkStoreReadyChunk,
  type TraceChunkStoreRegisterTraceWindowsParams,
  type TraceChunkStoreTraceWindowLoadParams,
  type TraceChunkWindowGraphAppendParams,
  type TraceChunkWindowGraphMaterialization,
  type TraceChunkWindowGraphMaterializer,
  type TraceChunkWindowGraphReadinessSummary,
  type TraceChunkWindowGraphRebuildParams,
  type TraceChunkWindowGraphSnapshot,
  type TraceSpanUrlCodec,
  type TraceSpanUrlDeserializeParams,
  type TraceSpanUrlSerializeParams,
  type TraceWindow,
  type TraceWindowChunksArrivedEvent,
  type TraceStore
} from './trace-chunk-store';
export {
  createTraceGraphRuntimeSource,
  type TraceGraphRuntimeSource
} from './trace-graph/trace-graph-source-adapter';
export {
  buildJSONTraceChunkDataFromTraceChunkData,
  buildTraceChunkDataFromJSONTraceChunkData,
  buildTraceChunkRowWindowTable,
  buildTraceChunkSourceDependencyTable,
  isJSONTraceChunkData,
  isTraceChunkData,
  type JSONTraceChunkData,
  type JSONTraceChunkLocalDependency,
  type JSONTraceChunkProcessMetadata,
  type TraceChunkData,
  type TraceChunkDiagnostics,
  type TraceChunkRowWindowTable,
  type TraceChunkSourceDependencyRow,
  type TraceChunkSourceDependencyTable,
  type TraceChunkSpanOverlapRange
} from './trace-chunk-data';
export {
  isTraceChunk,
  traceChunkHasSpanRefRow,
  type TraceChunk,
  type TraceChunkIndexes,
  type TraceChunkMetadata
} from './trace-chunk';
export {
  TRACE_CHUNK_OUTSIDE_WINDOW_REASON_LABEL,
  buildHiddenTraceChunkSpanInspectorGraph,
  buildTraceChunkWindowGraphData,
  getTraceChunkStoreSpanDisplaySource,
  getTraceChunkStoreSpanFilterNavigation,
  resolveHiddenTraceChunkSpanNavigation,
  searchHiddenTraceChunkSpans,
  searchTraceChunkStoreSpans,
  type TraceChunkSpanNavigation,
  type TraceChunkSpanSearchResult
} from './trace-chunk-window';

// TRACE GRAPH

export {
  type ChunkRef,
  type CounterRef,
  type CrossDependencyRef,
  decodeChunkRef,
  decodeCounterRef,
  decodeVisibleCrossDependencyRef,
  decodeVisibleLocalDependencyRef,
  decodeCrossDependencyRef,
  decodeEventRef,
  decodeInstantRef,
  decodeLocalDependencySpanRef,
  decodeProcessRef,
  decodeTaggedLocalDependencyRef,
  decodeThreadRef,
  decodeTraceRefInto,
  decodeTraceRef,
  type DecodedTraceRef,
  type DependencyRef,
  encodeChunkRef,
  encodeCounterRef,
  encodeCounterRefFromChunkRow,
  encodeVisibleCrossDependencyRef,
  encodeVisibleLocalDependencyRef,
  encodeCrossDependencyRef,
  encodeEventRef,
  encodeEventRefFromChunkRow,
  encodeInstantRef,
  encodeInstantRefFromChunkRow,
  encodeLocalDependencyRef,
  encodeLocalSpanRef,
  encodeProcessThreadRef,
  encodeProcessRef,
  type GlobalDependencyRef,
  type EventRef,
  EVENT_REF_OFFSET,
  getChunkRefIndex,
  getCounterRefChunkIndex,
  getCounterRefIndex,
  getCounterRefRowIndex,
  getCrossDependencyRefChunkIndex,
  getCrossDependencyRefIndex,
  getCrossDependencyRefRowIndex,
  getEventRefChunkIndex,
  getEventRefIndex,
  getEventRefRowIndex,
  getInstantRefChunkIndex,
  getInstantRefIndex,
  getInstantRefRowIndex,
  getLocalDependencyRefPayload,
  getLocalDependencyRefProcessIndex,
  getLocalDependencyRefRowIndex,
  getLocalSpanRefProcessIndex,
  getLocalSpanRefRowIndex,
  getProcessRefIndex,
  getSpanRefChunkIndex,
  getSpanRefProcessId,
  getSpanRefRowIndex,
  getThreadRefPayload,
  getThreadRefProcessIndex,
  getThreadRefThreadIndex,
  getTraceRefKind,
  getVisibleCrossDependencyRefIndex,
  getVisibleLocalDependencyRefIndex,
  type InstantRef,
  INSTANT_REF_OFFSET,
  type LocalDependencyRef,
  MAX_CHUNK_REF_INDEX,
  MAX_CHUNK_ROW_ENTITY_REF_ROW_INDEX,
  MAX_COUNTER_REF_CHUNK_INDEX,
  MAX_COUNTER_REF_INDEX,
  MAX_EVENT_REF_CHUNK_INDEX,
  MAX_EVENT_REF_INDEX,
  MAX_INSTANT_REF_CHUNK_INDEX,
  MAX_INSTANT_REF_INDEX,
  MAX_LOCAL_DEPENDENCY_REF_PROCESS_INDEX,
  MAX_PROCESS_REF_INDEX,
  MAX_THREAD_REF_INDEX,
  PROCESS_REF_OFFSET,
  type ProcessRef,
  type StitchedParentDependencyRef,
  TraceIdEncoder,
  type TraceDependencyRef,
  type TraceRefDecodeScratch,
  type TraceRefKind,
  THREAD_REF_OFFSET,
  type ThreadRef,
  type VisibleCrossDependencyRef,
  type VisibleDependencyRef,
  type VisibleLocalDependencyRef,
  COUNTER_REF_OFFSET,
  encodeSpanRef,
  isChunkRef,
  isCounterRef,
  isEventRef,
  isInstantRef,
  isProcessRef,
  isSpanRef,
  isThreadRef,
  isVisibleCrossDependencyRef,
  isVisibleLocalDependencyRef
} from './trace-graph/trace-id-encoder';
export {
  type JSONTrace,
  type JSONTraceCrossProcessDependency,
  type JSONTraceLocalDependency,
  type JSONTraceProcess,
  type JSONTraceSpan,
  type MaterializedJSONTrace,
  type BuildJSONTraceOptions,
  EMPTY_JSON_TRACE,
  getProcessFromSpan,
  getThreadFromSpan,
  buildJSONTrace,
  getJSONTraceTimingBounds,
  materializeJSONTrace,
  mergeJSONTraces
} from './ingestion/json-trace';
export {type TraceGraphStats} from './trace-graph/trace-graph-stats';
export {
  type BuildCollapsedActivityByTraceGraphRowsParams,
  type BuildTraceGraphCollapsedActivityOptions,
  type TraceProcessActivityAggregation,
  buildCollapsedActivityByTraceGraphRows
} from './trace-graph/collapsed-activity';
export {
  type ArrowTraceCrossDependencyTable,
  type TraceGraphData,
  type ArrowTraceLocalDependencyTable,
  type TraceLocalDependencyArrowColumns,
  type TraceSpanArrowColumns,
  type ArrowTraceSpanSidecarTable,
  type ArrowTraceSpanSidecarTableMap,
  type TraceSpanArrowSidecarColumns,
  type TraceSpanArrowSidecarEndpoint,
  type TraceSpanArrowSidecarMap,
  type TraceSpanArrowSidecarRow,
  type TraceCrossProcessEndpointsBySpanRef,
  type TraceSpanCrossDependencyRefMap,
  type TraceEventArrowColumns,
  type TraceEventArrowRow,
  type TraceSpanArrowRow,
  type ArrowTraceProcessMetadata,
  type ArrowTraceEventTable,
  type ArrowTraceSpanTable,
  type ArrowTraceChunk,
  type BuildTraceProcessSpanRefTablesOptions,
  type TraceProcessSpanRefTable,
  buildArrowTraceEventTableFromColumns,
  buildArrowTraceEventTableFromRows,
  buildTraceGraphData,
  buildArrowTraceSpanTableFromColumns,
  buildArrowTraceSpanTableFromRows,
  buildArrowTraceSpanSidecarTableFromColumns,
  buildArrowFloat64Vector,
  buildArrowUtf8Vector,
  buildArrowUint64Vector,
  buildArrowUint64ListVector,
  buildArrowTraceCrossDependencyTable,
  buildArrowTraceLocalDependencyTableFromColumns,
  buildTraceSpanTablesByProcessId,
  buildTraceProcessSpanRefTables,
  buildArrowTraceLocalDependencyTable,
  buildCrossDependencyIdToIndexMap,
  buildTraceChunkDataFromJSONTrace,
  buildTraceGraphDataFromJSONTrace,
  getCombinedBlockTable,
  toTraceSpanArrowRow
} from './ingestion/arrow-trace';
export {serializeArrowTraceJson, deserializeArrowTraceJson} from './ingestion/arrow-trace-json';
export {
  TraceGraph,
  TRACE_SPAN_FILTER_MASK_NONE,
  TRACE_SPAN_FILTER_MASK_REGEXP,
  TRACE_SPAN_FILTER_MASK_SOURCE,
  TRACE_SPAN_FILTER_MASK_TOPOLOGY,
  hasTraceSpanNameFilter,
  hasTraceSpanRegexpFilter,
  hasTraceSpanSourceFilter,
  hasTraceSpanTopologyFilter,
  type TraceGraphDependencyLookupOptions,
  type TraceGraphDescendantEntry,
  type TraceGraphDescendantOptions,
  type TraceGraphDescendantResult,
  type TraceGraphFilterOptions,
  type TraceGraphFilteredSpanCountsByFilter,
  type TraceGraphOverlappingParentSpanFilter,
  type TraceGraphPreparedState,
  type TraceGraphSimilarDurationChainSpanFilter,
  type TraceSpanFilterMask,
  type TraceGraphPathBlockSource,
  type TraceGraphPathCrossDependencySource,
  type TraceGraphPathDependencySource,
  type TraceGraphPathLocalDependencySource,
  type TraceGraphSelectedCrossDependencySource,
  type TraceGraphSelectedLocalDependencySource,
  type TraceSelectedDependencyDirection,
  type TraceGraphSpanFilterReasonInput,
  type TraceGraphSpanFilterReason,
  type TraceGraphSpanFilterState,
  type TraceGraphSpanFilterNavigation,
  type TraceGraphSpanFilterStore,
  type TraceGraphSpanStoreAvailability,
  type TraceGraphSpanSearchRecord,
  type TraceGraphVisibleSpanSearchRecord,
  type TraceSpanDependencySelection
} from './trace-graph/trace-graph';
export {buildTraceGraphView, type TraceGraphView} from './trace-graph/trace-graph-view';
export {
  type TraceGraphSpanSearchContext,
  type TraceGraphSpanStoreNavigationParams,
  type TraceGraphSpanStoreSearchParams,
  type TraceGraphVisibleIndex
} from './trace-graph/trace-graph-types';
export {createTraceSpanNameSearchPredicate} from './trace-graph/trace-span-name-search';
export {
  buildTraceFilterSummary,
  hasTraceFilteredItems,
  type TraceFilterSummarySpanCountsByFilter,
  type TraceFilterSummary
} from './trace-graph/trace-filter-summary';
export {
  buildCompiledTraceSpanFilterPlan,
  getTraceSpanNameFilterMatchMask,
  getTraceSpanSourceFilterMatchMask,
  normalizeTraceSpanFilters,
  type CompiledTraceSpanFilterPlan
} from './trace-graph/trace-graph-span-filters';
export {
  estimateTraceGraphSize,
  type TraceGraphSizeEntry,
  type TraceGraphSizeOptions,
  type TraceGraphSizeReport
} from './trace-graph/trace-graph-size';
export {
  getRequiredProcessRef,
  getRequiredSpanRef,
  getRequiredSpanRefBySpanId,
  getRequiredThreadRef,
  getRequiredVisibleDisplaySourceBySpanId,
  getTraceGraphSpanDependencies,
  getTraceGraphDependencyChainForBlock,
  getTraceGraphFilteredParentSpanId,
  isTraceGraphBlockFiltered,
  type TraceGraphBlockDependencySnapshot
} from './trace-graph/trace-graph-test-utils';
export {
  createTraceStreamReplaceChunk,
  createTraceStreamSession,
  type TraceStreamChunk,
  type TraceStreamCounterUpdate,
  type TraceStreamInstantUpdate,
  type TraceStreamLocalDependencyUpdate,
  type TraceStreamProcessUpsert,
  type TraceStreamPublishedSnapshot,
  type TraceStreamReplaceSnapshot,
  type TraceStreamSession,
  type TraceStreamSessionListener,
  type TraceStreamSessionOptions,
  type TraceStreamSpanUpdate,
  type TraceStreamThreadUpsert
} from './trace-stream-session';
export {
  buildTraceCardCrossDependency,
  buildTraceCardDependency,
  type TraceSpanCardChildDependency,
  type TraceCardCrossDependency,
  type TraceCardDependency,
  type TraceSpanCardDependencyEntry,
  type TraceSpanCardDescendantEntry,
  type TraceSpanCardDescendantResult,
  type TraceSpanCardEndpointDependencyEntry,
  type TraceSpanCardModel,
  type TraceSpanCardParentChainEntry,
  type TraceCardSpan
} from './trace-graph/build-trace-span-card-data';
export {
  type TraceLocalDependencyArrowAccessParams,
  buildLocalDependencyBlockAdjacencyFromArrowTable,
  createLazyTraceLocalDependencyArray,
  getTraceLocalDependencyByRefFromArrowTable,
  iterateTraceLocalDependenciesFromArrowTable,
  materializeTraceLocalDependencyFromArrowRow
} from './trace-graph/trace-local-dependency-table';
// Helper functions
export {
  buildCrossDependencies,
  buildCrossDependenciesFromEndpoints
} from './trace-graph/trace-cross-dependency-utils';
export {
  type ArrowTraceSpanRow,
  type TraceCounterSource,
  type TraceCrossDependencySource,
  type TraceDependencySource,
  type TraceEventSource,
  type TraceInstantSource,
  type TraceLocalDependencySource,
  type TraceProcessSource,
  type TraceGraphSpanArrowColumnValue,
  type TraceGraphSpanStoreRow,
  type TraceRenderSpan,
  type TraceThreadSource,
  materializeTraceGraphSpan,
  getArrowTraceSpanField,
  getArrowTraceSpanRow,
  getTraceGraphSpanArrowColumnValues,
  getTraceGraphSpanCount,
  iterateMaterializedTraceGraphSpans,
  getTraceGraphProcessSpanOrdinal,
  getTraceGraphProcessById,
  getTraceGraphProcessSpanCount,
  iterateMaterializedTraceGraphProcessSpans,
  getTraceGraphSpanDisplaySource,
  getTraceGraphSpanExternalSpanId,
  getTraceGraphSpanNameUtf8,
  getTraceGraphSpanRef,
  getTraceGraphSpanRefProcessId,
  getTraceGraphSpanRefProcessRef,
  getTraceGraphSpanRefThreadRef,
  getTraceGraphSpanStoreRow,
  getTraceGraphSpanTableRowIndex,
  getTraceGraphSpanUserData,
  getTraceGraphThreadById,
  iterateTraceGraphProcessSpanRefs,
  iterateTraceGraphSpanRefs
} from './trace-graph-accessors';
export {
  type MultiProcessTrace,
  type MultiProcessTraceOptions,
  type MultiProcessTraceProcessData,
  multiProcessTrace_addProcessData,
  multiProcessTrace_buildTraceGraphData,
  multiProcessTrace_create,
  multiProcessTrace_getCrossDependencies,
  multiProcessTrace_getTraceGraph,
  multiProcessTrace_removeProcessData,
  multiProcessTrace_updateTraceGraphData,
  multiProcessTrace_updateCrossDependencies,
  multiProcessTrace_updateProcessList,
  multiProcessTrace_updateTraceGraph
} from './trace-graph/multi-process-trace';
export {buildFastRowAccessorWithScratchGeneric} from '../arrow-utils/arrow-accessors';

export {getDependencyDurationMs} from './trace-graph/trace-dependency-utils';

// TRACE LAYOUT

export {
  type TraceLayout,
  type TraceLayoutBounds,
  type TraceLayoutCollapseState,
  type TraceLayoutGlobalEventRow,
  type TraceLayoutGeometryCache,
  type TraceLayoutGeometryColumn,
  type TraceLayoutGeometryTable,
  type TraceLayoutGeometryTuple,
  type TraceLayoutRenderConfiguration,
  type TraceLayoutOverflowLabelDatum,
  type TraceLayoutProcessGeometryCacheEntry,
  type TraceLayoutDependencyGeometryChunk,
  type TraceLayoutRow,
  type TraceLayoutSpanGeometryChunk,
  type TraceLayoutSpanVisibility,
  type TraceLayoutSpanVisibilityFlag,
  type TraceLayoutSpanVisibilityMask,
  type TraceLayoutVisibleGraph,
  type TraceMinimapLayout,
  type TraceGraphCollapseState,
  type TraceProcessCollapseState,
  type TraceProcessActivityInterval,
  type TraceThreadCollapseState,
  type SerializedTraceGraphCollapseState,
  type SerializedTraceProcessCollapseState,
  type SerializedTraceThreadCollapseState,
  type ProcessLayout,
  type ThreadLaneLayout,
  type ThreadLaneMetadata,
  type ThreadOverflowLabel,
  type ThreadLayout,
  deserializeTraceGraphCollapseState,
  serializeTraceGraphCollapseState,
  buildTraceLayoutGeometryColumn,
  createTraceLayoutGeometryColumn,
  fillTraceLayoutCrossDependencyGeometry,
  fillTraceLayoutLocalDependencyGeometry,
  fillTraceLayoutSpanGeometry,
  getTraceLayoutSpanVisibility,
  getTraceLayoutSpanVisibilityFlags,
  getTraceLayoutSpanVisibilityMask,
  hasTraceLayoutSpanVisibilityFlag,
  isTraceLayoutSpanVisible,
  traceLayoutSpanVisibilityFlags,
  buildTraceLayoutRows,
  buildTraceLayoutOverflowLabels,
  getTraceLayoutCollapsedActivityEndX,
  getTraceLayoutCollapsedActivityStartX,
  getTraceLayoutFilteredSpanCountByThreadRef,
  getTraceLayoutFilteredSpanCountByThreadId,
  getTraceLayoutOverflowLabelThreadName,
  getTraceLayoutBoundsFromStructure,
  getTraceLayoutVerticalBounds
} from './trace-layout/trace-layout';
export {
  estimateTraceLayoutSize,
  type TraceLayoutSizeEntry,
  type TraceLayoutSizeOptions,
  type TraceLayoutSizeReport
} from './trace-layout/trace-layout-size';
export {
  type MutableTraceGraphCollapseState,
  type TraceProcessExpansionOverrides,
  areTraceGraphCollapseStatesEqual,
  areTraceLayoutCollapseStatesEqual,
  cloneTraceGraphCollapseState,
  createEmptyTraceGraphCollapseState,
  expandSelectedSpanProcessRefs,
  pruneTraceLayoutCollapseStateForGraphs,
  pruneTraceLayoutThreadCollapseStateForLaneRefs,
  selectTraceLayoutCollapseStateUpdate,
  setAllTraceProcessesExpanded,
  setTraceProcessExpansionOverride,
  toggleTraceProcessCollapse,
  toggleTraceThreadCollapse
} from './trace-layout/trace-collapse-state';
export {
  buildInitialTraceLayoutCollapseState,
  buildTraceLayoutThreadPruneRequest,
  buildThreadRefMapsByStreamId,
  cloneTraceLayoutCollapseStateForGraphs,
  findProcessGraphIndex,
  findProcessRefForRankId,
  findThreadRefForStreamId,
  getExpandedProcessIdsFromCollapseState,
  getTraceLayoutGraphs,
  getTraceGraphProcessIdForRef,
  resolveTraceProcessRefTarget,
  resolveTraceThreadRefTarget,
  setExpandedTraceProcessIds,
  type TraceLayoutThreadPruneRequest,
  type TraceProcessRefTarget,
  type TraceThreadRefTarget
} from './trace-layout/trace-collapse-resolution';
export {
  createTraceCollapseRuntimeState,
  reduceTraceCollapseRuntimeState,
  type TraceCollapseRuntimeAction,
  type TraceCollapseRuntimeInputs,
  type TraceCollapseRuntimeState
} from './trace-layout/trace-collapse-runtime';
export {
  buildHierarchicalTrackLayout,
  type BuildHierarchicalTrackLayoutParams,
  type HierarchicalTrackDescriptor,
  type HierarchicalTrackLayoutEntry,
  type HierarchicalTrackLayoutResult,
  type HierarchicalTrackSize
} from './trace-layout/hierarchical-track-layout';

export {
  buildTraceLayout,
  buildTraceLayoutForSpanRefs,
  buildTraceLayouts,
  rebuildTraceLayoutGeometry,
  type TraceLayoutMode,
  type SpanBoundingBox
} from './trace-layout/trace-geometry-layout';
export {
  buildTracePreparedScene,
  buildTraceSelectionPreparedScene,
  buildTracePreparedMinimapSpanIndicators,
  buildTracePreparedOverviewGraphScenes,
  buildTracePreparedOverviewViewModel,
  buildTracePreparedGraphScenes,
  buildTracePreparedProcessRows,
  createTraceComparisonModelMatrix,
  estimateTracePreparedSceneSize,
  type TracePreparedScene,
  type BuildTracePreparedSceneParams,
  type BuildTraceSelectionPreparedSceneParams,
  type BuildTracePreparedOverviewGraphScenesParams,
  type BuildTracePreparedOverviewViewModelParams,
  type BuildTracePreparedGraphScenesParams,
  type BuildTracePreparedProcessRowsParams,
  type TraceSelectionPreparedScene,
  type TraceComparisonTransform,
  type TracePreparedMinimapSpanIndicator,
  type TracePreparedMinimapSpanIndicatorKind,
  type TraceOverviewLoadedContentBounds,
  type TraceOverviewTimeRange,
  type TracePreparedGraphScene,
  type TracePreparedOverviewViewModel,
  type TracePreparedProcessRow,
  type TracePreparedRowReuseInfo,
  type TraceViewBounds
} from './trace-view-state/trace-prepared-scene';
export {
  buildTraceViewBaseLayoutKey,
  buildTraceViewRenderInputs,
  buildTraceViewState,
  type BuildTraceViewBaseLayoutKeyParams,
  type BuildTraceViewRenderInputsParams,
  type BuildTraceViewStateParams,
  type TraceViewLayoutSettings,
  type TraceViewRenderInputs,
  type TraceViewState
} from './trace-view-state/trace-view-state';
export {
  buildTraceSelectedCrossDependencySources,
  buildTraceSelectedDependencyDirectionMaps,
  buildTraceSelectedLocalDependencySourcesByProcessId,
  getImmediateVisibleDependencyRefsForSpan,
  getTraceSelectedSpanFromRef,
  getTraceSelectedSpanFromRenderSpan,
  getVisibleDependencyEndpointSpanRefs,
  getVisibleCrossDependenciesByRef,
  getVisibleLocalDependenciesByRef,
  type TraceSelectedCrossDependencySources,
  type TraceSelectedDependencyDirectionMapInput,
  type TraceSelectedDependencyDirectionMaps,
  type TraceSelectedDependencySourceDirectionOptions,
  type TraceSelectedLocalDependencySourcesByProcessId,
  type TraceSelectedSpan,
  type TraceSelectionChange,
  type TraceSelectionInteraction,
  type TraceVisibleDependencyEndpointSpanRefInput,
  type TraceVisibleDependencyRefsForSpan
} from './trace-view-state/trace-view-selection';
export {
  type CounterRenderData,
  type CounterSparkline,
  type DerivedTraceData,
  type GlobalEventRenderData,
  type InstantRenderData,
  type TraceDeckBinaryAttributeData,
  type TraceDeckBinaryBlockData,
  type TraceDeckBinaryDependencyLineData,
  type TraceDeckBinaryProcessActivityData,
  type TraceLayoutRowEnrichment,
  DEFAULT_COUNTER_COLOR,
  DEFAULT_INSTANT_COLOR,
  __resetDerivedTraceDataCacheForTests,
  buildTraceDeckBinaryBlockData,
  buildTraceDeckBinaryDependencyLineData,
  buildTraceDeckBinaryProcessActivityData,
  buildTraceLayoutRowEnrichments,
  getMemoizedDerivedTraceData,
  getMemoizedTraceLayoutRowEnrichments
} from './trace-view-state/trace-prepared-scene';
export {
  getLaneIndexFromUserData,
  getLaneYPosition,
  getLayoutDensityPreset,
  getStreamLaneYPositions,
  isLaneVisible
} from './trace-layout/trace-geometry-layout-common';
export {
  buildTraceThreadNameOptions,
  type TraceThreadNameOption
} from './utils/thread-name-options';

// TRACE STYLE

export {type TraceStyle, type TraceLabels} from './trace-style/trace-style';
export {
  DEFAULT_TRACE_FONT_FAMILY,
  DEFAULT_TRACE_STYLE,
  makeTraceStyle
} from './trace-style/trace-style';

export {
  createTraceColorResolver,
  createTraceGraphColorResolver,
  DEFAULT_PATH_HIGHLIGHT_TRAIL_LENGTH,
  getCrossRankDependencyLineColor,
  getDependencyLineColor,
  getSelectedCrossRankDependencyLineColor,
  getSelectedLocalDependencyLineColor,
  MAX_PATH_HIGHLIGHT_TRAIL_LENGTH,
  MIN_PATH_HIGHLIGHT_TRAIL_LENGTH,
  NOT_IN_PATH_FADE_FACTOR,
  PATH_HIGHLIGHT_TRAIL_LENGTH,
  SELECTED_SPAN_HIGHLIGHT_STYLES,
  TRACE_COLOR,
  type TraceColorResolver,
  type TraceColorResolverParams,
  type TraceGraphColorResolver,
  type TraceGraphColorResolverParams
} from './trace-style/trace-colors';
export {
  COLORS,
  COLORS_LIST,
  createColorWheel,
  getPerfettoSliceColor,
  interpolateColor,
  makeDeckColor
} from './trace-style/color-palette';

export {
  DEFAULT_TRACE_COLOR_SCHEME,
  getReadableSpanBorderColor,
  PERFETTO_TRACE_COLOR_SCHEME,
  PROCESS_TRACE_COLOR_SCHEME,
  type TraceProcessColorParams,
  type TraceSpanColorSource,
  type TraceSpanColorAccessorSource,
  type TraceSpanColorParams,
  type TraceSpanColorRefParams,
  type TraceSpanColorStyle,
  type TraceThreadColorParams,
  type TraceKeywordPresentation,
  type TraceColorScheme,
  type TraceColor,
  type TraceDeckColor
} from './trace-style/trace-color-scheme';
export {getJSONForTraceObject} from './trace-style/get-json-for-trace-object';

export {
  computeTracePathHighlighting,
  type PathHighlightTrailEntry,
  type TracePathHighlightingResult,
  type TracePathHighlightingSettings
} from './trace-style/trace-path-highlighting';

// CHROME TRACE FORMAT PARSERS / WRITER / SCHEMAS

export {
  CHROME_TRACE_EVENT_ARROW_FIELDS,
  chromeTraceEventArrowSchema,
  parseChromeTraceToArrowRecordBatches,
  parseChromeTraceToArrowTable,
  type ChromeTraceArrowParseOptions,
  type ChromeTraceEventArrowColumns,
  type ChromeTraceEventArrowRecordBatch,
  type ChromeTraceEventArrowSchema,
  type ChromeTraceEventArrowTable,
  parseChromeTrace,
  type ChromeTraceParseOptions
} from './loaders/chrome-trace-loader/index';

export {
  ArrowChromeTraceWriter,
  ChromeTraceWriter,
  buildArrowChromeTraceFile,
  buildChromeTraceFile,
  writeArrowChromeTrace,
  writeChromeTrace,
  type ChromeTraceBigIntSerialization,
  type ChromeTraceWriterOptions
} from './loaders/chrome-trace-loader/chrome-trace-writer';

export {
  parsePerfettoTraceToArrow,
  TracksSchema,
  SlicesSchema,
  ProcessesSchema,
  ThreadsSchema,
  type ArrowTraceConsumer,
  type TrackRow,
  type SliceRow,
  type ProcessRow,
  type ThreadRow
} from './loaders/perfetto-trace-loader/parse-perfetto-trace-arrow';

export {
  buildTraceRanksFromChromeTrace,
  type BuildChromeTraceRanksOptions,
  type ChromeTraceProcessColorOptions,
  type ChromeTraceProcessColorSeed
} from './trace-chrome/build-trace-graph-from-chrome-trace';
export {
  consumeChromeTraceArrowStream,
  consumeChromeTraceEventStream,
  consumeChromeTraceFileStream,
  type ChromeTraceArrowSourceItem,
  type ChromeTraceEventStreamItem,
  type ChromeTraceStreamOptions,
  streamChromeTraceArrowChunks,
  streamChromeTraceEventChunks,
  streamChromeTraceFileChunks
} from './chrome-trace-stream';

export {openChromeTraceInPerfetto} from './links/open-chrome-trace-in-perfetto';
export {PERFETTO_ICON_DATA_URL} from './links/perfetto-icon';

export {type ChromeTrace} from './loaders/chrome-trace-loader/chrome-trace-types';

export {
  type ChromeTraceFileSchema,
  type ChromeTraceEventPhase,
  type ChromeTraceEventSchema,
  type ChromeTraceValidationOptions,
  ChromechromeTraceFileSchema,
  maybeChromeTraceFile,
  validateChromeTraceFile
} from './loaders/chrome-trace-loader/chrome-trace-schema';

export {
  createChromeTraceColorScheme,
  getColorFromUserData
} from './trace-chrome/chrome-color-scheme';

// LOCAL DEPENDENCY HELPERS

export {
  DEFAULT_SUBMIT_MIN_WAIT_TIME_MS,
  SUBMIT_MIN_WAIT_TIME_MS,
  filterLocalDependenciesByMode,
  shouldShowLocalDependencyByMode,
  shouldShowLocalDependencyByModeFields
} from './trace-layout/local-dependency-filter';

// UTILITIES

export {assignThreadLanes} from './trace-layout/assign-thread-lanes';
export {
  kahnLaneLayout,
  layoutLanes,
  layoutLanesByOverlap,
  sortBlocksByTime,
  visitKahnLaneAssignments,
  visitLaneAssignments,
  visitParentAwareLaneAssignments
} from './trace-layout/lane-layout';
export type {LaneAssignment, LaneLayoutOptions} from './trace-layout/lane-layout';

export {assert} from './utils/assert';
export {
  TRACE_TIMING_DISPLAY_ORDER,
  compareTraceTimingKeys,
  orderTraceTimingKeys
} from './utils/trace-timing-key-order';
export {
  capitalize,
  capitalizeFirstLetter,
  lowerCase,
  pluralize,
  truncateMiddle,
  type TruncateMiddleOptions,
  wrapText,
  type WrapTextOptions
} from './utils/string-utils';
export {
  parseTS,
  formatTS,
  formatTSDate,
  formatTSRange,
  formatTSTime,
  diffTS
} from './utils/time-utils';
export {formatTimeMs} from './utils/time-format-utils';

// Logging
export {log as traceLog, makeModestObject, HeapLog} from './log';
