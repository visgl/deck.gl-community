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
  type TraceSpanAttributePath,
  type TraceProcess,
  type TraceThread,
  type TraceSpan,
  type TraceSpanTiming,
  type TraceInstant,
  type TraceCounter,
  type TraceEvent,
  type TraceDependency,
  type TraceSameProcessDependency,
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
  type TraceSpanOwnerRefs,
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
  TraceChunkStoreLoadCancelledError,
  TraceChunkStoreLoadSkippedError,
  createChronologicalTraceChunkSpanBudgetPolicy,
  createStaticTraceChunkStore,
  createStaticTraceGraphRuntimeSource,
  isTraceChunkStoreLoadCancelledError,
  isTraceChunkStoreLoadSkippedError,
  traceWindowToTraceChunkSelectionWindow,
  type StaticTraceChunkStoreOptions,
  type StaticTraceGraphRuntimeSourceOptions,
  type TraceChunkDescriptor,
  type TraceChunkReadyMaterializerParams,
  type TraceChunkLoadContext,
  type TraceChunkSelection,
  type TraceChunkSelectionPolicy,
  type TraceChunkSelectionPolicyParams,
  type TraceChunkSelectionSummary,
  type TraceChunkSelectionWindow,
  type TraceChunkStoreDiagnostics,
  type TraceChunkStoreLoadWindowParams,
  type TraceChunkStoreLoadWindowResult,
  type TraceChunkStoreLoadResult,
  type TraceChunkLoadState,
  type TraceChunkStoreOptions,
  type TraceChunkStoreProgress,
  type TraceChunkStoreReadyChunk,
  type TraceChunkStoreUnloadSummary,
  type TraceChunkStoreWindow,
  type TraceChunkStoreWindowChunksArrivedEvent,
  type TraceSpanUrlCodec,
  type TraceSpanUrlDeserializeParams,
  type TraceSpanUrlSerializeParams,
  type TraceSpanUrlSource,
  type TraceStore
} from './trace-chunk-store';
export {
  appendTraceDatasetFromReadyTraceChunks,
  buildTraceDatasetFromReadyTraceChunks,
  replaceTraceDatasetEvents
} from './trace-chunk-graph-assembler';
export {
  forEachTraceDatasetActiveSpanRow,
  getTraceDatasetSpanRefProcessId,
  type TraceDataset,
  type TraceDatasetTimeExtents
} from './trace-dataset';
export {type TraceRefSource} from './trace-ref-source';
export {
  buildTraceViewSnapshot,
  getTraceViewSpanFilterMask,
  hasTraceViewSnapshotFilters,
  type TraceViewChunkSnapshot,
  type TraceViewSnapshot,
  type TraceViewSnapshotOptions
} from './trace-view-snapshot';
export {type TraceGraphRuntimeSource} from './trace-graph/trace-graph-runtime-source';
export {
  buildJSONTraceChunkDataFromTraceChunkData,
  buildTraceChunkDataFromJSONTraceChunkData,
  buildTraceChunkRowWindowTable,
  buildTraceChunkSourceDependencyTable,
  buildTraceChunkSourceDependencyTableFromColumns,
  isJSONTraceChunkData,
  isTraceChunkData,
  readTraceChunkSourceDependencyRow,
  readTraceChunkSourceDependencyRows,
  type JSONTraceChunkData,
  type JSONTraceChunkSameProcessDependency,
  type JSONTraceChunkProcessMetadata,
  type TraceChunkData,
  type TraceChunkDiagnostics,
  type TraceChunkRowWindowTable,
  type TraceChunkSourceDependencyRow,
  type TraceChunkSourceDependencyArrowColumns,
  type TraceChunkSourceDependencyTable,
  type TraceChunkSpanOverlapRange
} from './trace-chunk-data';
export {
  buildTracePhysicalSpanChunk,
  type BuildTracePhysicalSpanChunkOptions,
  type TracePhysicalSpanChunkColumns,
  type TracePhysicalSpanColumn
} from './physical-span-chunk';
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
  buildTraceChunkWindowDataset,
  getTraceChunkStoreSpanDetailSource,
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
  type CrossProcessDependencyRef,
  decodeChunkRef,
  decodeCounterRef,
  decodeCrossProcessDependencyRef,
  decodeEventRef,
  decodeInstantRef,
  decodeSameProcessDependencySpanRef,
  decodeProcessRef,
  decodeTaggedSameProcessDependencyRef,
  decodeThreadRef,
  decodeTraceRefInto,
  decodeTraceRef,
  type DecodedTraceRef,
  type DependencyRef,
  encodeChunkRef,
  encodeCounterRef,
  encodeCounterRefFromChunkRow,
  encodeCrossProcessDependencyRef,
  encodeEventRef,
  encodeEventRefFromChunkRow,
  encodeInstantRef,
  encodeInstantRefFromChunkRow,
  encodeSameProcessDependencyRef,
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
  getCrossProcessDependencyRefChunkIndex,
  getCrossProcessDependencyRefIndex,
  getCrossProcessDependencyRefRowIndex,
  getEventRefChunkIndex,
  getEventRefIndex,
  getEventRefRowIndex,
  getInstantRefChunkIndex,
  getInstantRefIndex,
  getInstantRefRowIndex,
  getSameProcessDependencyRefChunkIndex,
  getSameProcessDependencyRefPayload,
  getSameProcessDependencyRefProcessIndex,
  getSameProcessDependencyRefRowIndex,
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
  type InstantRef,
  INSTANT_REF_OFFSET,
  type SameProcessDependencyRef,
  MAX_CHUNK_REF_INDEX,
  MAX_CHUNK_ROW_ENTITY_REF_ROW_INDEX,
  MAX_COUNTER_REF_CHUNK_INDEX,
  MAX_COUNTER_REF_INDEX,
  MAX_EVENT_REF_CHUNK_INDEX,
  MAX_EVENT_REF_INDEX,
  MAX_INSTANT_REF_CHUNK_INDEX,
  MAX_INSTANT_REF_INDEX,
  MAX_SAME_PROCESS_DEPENDENCY_REF_PROCESS_INDEX,
  MAX_PROCESS_REF_INDEX,
  MAX_THREAD_REF_INDEX,
  PROCESS_REF_OFFSET,
  type ProcessRef,
  TraceIdEncoder,
  type TraceDependencyRef,
  type TraceRefDecodeScratch,
  type TraceRefKind,
  THREAD_REF_OFFSET,
  type ThreadRef,
  COUNTER_REF_OFFSET,
  encodeSpanRef,
  isChunkRef,
  isCounterRef,
  isCrossProcessDependencyRef,
  isEventRef,
  isInstantRef,
  isProcessRef,
  isSpanRef,
  isSameProcessDependencyRef,
  isThreadRef
} from './trace-graph/trace-id-encoder';
export {
  type JSONTrace,
  type JSONTraceCrossProcessDependency,
  type JSONTraceSameProcessDependency,
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
  type CollapsedActivityByProcessRef,
  type TraceProcessActivityAggregation,
  buildCollapsedActivityByTraceGraphRows
} from './trace-graph/collapsed-activity';
export {
  type ArrowTraceCrossProcessDependencyTable,
  type BuildTraceChunkDataOptions,
  type ArrowTraceSameProcessDependencyTable,
  type TraceSameProcessDependencyArrowColumns,
  type TraceSpanArrowColumns,
  type ArrowTraceSpanSidecarTable,
  type ArrowTraceSpanSidecarTableMap,
  type TraceSpanArrowSidecarColumns,
  type TraceSpanArrowTimingProjectionColumns,
  type TraceSpanArrowSidecarEndpoint,
  type TraceSpanArrowSidecarRow,
  type TraceCrossProcessEndpointsBySpanRef,
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
  buildArrowTraceSpanTableFromColumns,
  buildArrowTraceSpanTableFromRows,
  replaceArrowTraceSpanRefColumns,
  buildArrowTraceSpanSidecarTableFromColumns,
  buildArrowTraceSpanSidecarTableFromRows,
  buildArrowFloat64Vector,
  buildArrowUtf8Vector,
  buildArrowTraceCrossProcessDependencyTable,
  buildArrowTraceSameProcessDependencyTableFromColumns,
  buildTraceSpanTablesByProcessId,
  buildTraceProcessSpanRefTables,
  buildArrowTraceSameProcessDependencyTable,
  buildTraceChunkDataFromJSONTrace,
  buildTraceChunkDataFromTraceProcesses,
  toTraceSpanArrowRow
} from './ingestion/arrow-trace';
export {serializeArrowTraceJson, deserializeArrowTraceJson} from './ingestion/arrow-trace-json';
export {
  type TraceSpanTimingStatusCode,
  decodeTraceSpanTimingStatusCode,
  encodeTraceSpanTimingStatusCode
} from './ingestion/trace-span-timing-status-code';
export {
  TraceGraph,
  TRACE_SPAN_FILTER_MASK_NONE,
  TRACE_SPAN_FILTER_MASK_REGEXP,
  TRACE_SPAN_FILTER_MASK_SOURCE,
  hasTraceSpanNameFilter,
  hasTraceSpanRegexpFilter,
  hasTraceSpanSourceFilter,
  type TraceGraphDependencyLookupOptions,
  type TraceDirectionalDependencyRefSlice,
  type TraceGraphDescendantEntry,
  type TraceGraphDescendantOptions,
  type TraceGraphDescendantResult,
  type TraceSpanFilterMask,
  type TraceGraphPathBlockSource,
  type TraceGraphPathCrossProcessDependencySource,
  type TraceGraphPathDependencySource,
  type TraceGraphPathSameProcessDependencySource,
  type TraceGraphSelectedCrossProcessDependencySource,
  type TraceGraphSelectedSameProcessDependencySource,
  type TraceSelectedDependencyDirection,
  type TraceGraphSpanFilterReasonInput,
  type TraceGraphSpanFilterReason,
  type TraceGraphSpanFilterState,
  type TraceGraphSpanFilterNavigation,
  type TraceGraphSpanLookupStore,
  type TraceGraphSpanStoreAvailability,
  type TraceGraphSpanSearchRecord,
  type TraceGraphVisibleSpanSearchRecord,
  type TraceSpanDependencyDirection,
  type TraceSpanDirectionalDependencyRefs
} from './trace-graph/trace-graph';
export {
  type TraceGraphSpanSearchContext,
  type TraceGraphSpanStoreNavigationParams,
  type TraceGraphSpanStoreSearchParams,
  type TraceSpanDependencySelection
} from './trace-graph/trace-graph-types';
export {
  createTraceSpanNameSearchPredicate,
  createTraceSpanOmniBoxSearchPredicate
} from './trace-graph/trace-span-name-search';
export {
  buildTraceFilterSummary,
  hasTraceFilteredItems,
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
  estimateTraceGraphComponentSizes,
  estimateTraceGraphSize,
  type TraceGraphSizeComponent,
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
  type TraceStreamSameProcessDependencyUpdate,
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
  DEFAULT_TRACE_SPAN_CARD_DEPENDENCY_LIMIT,
  buildTraceCardCrossProcessDependency,
  buildTraceCardDependency,
  getTraceSpanCardModel,
  getTraceSpanChildDependencies,
  getTraceSpanDependencyChain,
  getTraceSpanDescendants,
  getTraceSpanEndpointsWithDependencies,
  getTraceSpanIncomingDependencyEntries,
  getTraceSpanOutgoingDependencyEntries,
  getTraceSpanParentDependencyChainEntries,
  getTraceSpanParentChainEntries,
  getTraceSpanVisibleDependencyChain,
  type TraceSpanCardChildDependency,
  type TraceCardCrossProcessDependency,
  type TraceCardDependency,
  type TraceSpanCardDependencyEntry,
  type TraceSpanCardDependencyEntryCollection,
  type TraceSpanCardDescendantEntry,
  type TraceSpanCardDescendantResult,
  type TraceSpanCardEndpointDependencyEntry,
  type TraceSpanCardEndpointDependencyEntryCollection,
  type TraceSpanCardModel,
  type TraceSpanCardParentChainEntry,
  type TraceCardSpan
} from './trace-graph/build-trace-span-card-data';
export {getTraceSpanDependencySelection} from './trace-graph/trace-graph-selection-utils';
export {
  type TraceCrossProcessDependencyArrowAccessParams,
  iterateTraceCrossProcessDependenciesFromArrowTable,
  materializeTraceCrossProcessDependenciesFromArrowTable,
  materializeTraceCrossProcessDependencyFromArrowRow
} from './trace-graph/trace-cross-process-dependency-table';
// Helper functions
export {
  appendCrossProcessDependenciesFromEndpoints,
  buildCrossProcessDependencies,
  buildCrossProcessDependenciesFromEndpoints,
  mergeCrossProcessDependencySpanRefLookups,
  setCrossProcessDependencySpanRef,
  type TraceCrossProcessDependencyAppendResult,
  type TraceCrossProcessDependencyBuildOptions,
  type TraceCrossProcessDependencySpanRefLookup
} from './trace-graph/trace-cross-process-dependency-utils';
export {
  type TraceCounterSource,
  type TraceCrossProcessDependencyRenderSource,
  type TraceDependencyRenderSource,
  type TraceDependencySource,
  type TraceEventSource,
  type TraceInstantSource,
  type TraceSameProcessDependencyRenderSource,
  type TraceSameProcessDependencySource,
  type TraceGraphSpanAccessorSource,
  type TraceGraphProcessSpanRefRow,
  type TraceProcessSource,
  type TraceRenderSpan,
  type TraceSpanDetailSource,
  type TraceThreadSource,
  getTraceGraphProcessSpanRowIndex,
  getTraceGraphSpanDetailSource,
  getTraceGraphSpanArrowColumnValues,
  getTraceGraphSpanNameUtf8,
  getUniqueTraceGraphSpanRef,
  getTraceGraphSpanRefProcessId,
  getTraceGraphSpanUserData,
  getTraceGraphSpanAttribute,
  iterateTraceGraphProcessSpanRefRows,
  iterateTraceGraphProcessSpanRefs,
  iterateTraceGraphSpanRefs
} from './trace-graph-accessors';
export {buildFastRowAccessorWithScratchGeneric} from '../arrow-utils/arrow-accessors';

export {getDependencyDurationMs} from './trace-graph/trace-dependency-utils';

// TRACE LAYOUT

export {
  type TraceLayout,
  type TraceLayoutBounds,
  type TraceLayoutCollapseState,
  type TraceLayoutGlobalEventRow,
  type TraceLayoutGeometryTuple,
  type TraceLayoutRenderConfiguration,
  type TraceLayoutOverflowLabelDatum,
  type TraceLayoutRow,
  type TraceLayoutSpanLaneAssignment,
  type TraceLayoutSpanLaneColumn,
  type TraceLayoutSpanLaneColumns,
  type TraceLayoutSpanVisibility,
  type TraceLayoutSpanVisibilityFlag,
  type TraceLayoutSpanVisibilityMask,
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
  fillTraceLayoutCrossProcessDependencyGeometry,
  fillTraceLayoutSameProcessDependencyGeometry,
  fillTraceLayoutSpanGeometry,
  getTraceLayoutSpanLaneIndex,
  hasTraceLayoutSpanLaneIndex,
  getTraceLayoutSpanVisibility,
  getTraceLayoutSpanVisibilityFlags,
  getTraceLayoutSpanVisibilityMask,
  hasTraceLayoutSpanVisibilityFlag,
  isTraceLayoutSpanVisible,
  traceLayoutSpanVisibilityFlags,
  buildTraceLayoutProcessLayoutMapByRef,
  buildTraceLayoutRows,
  getTraceLayoutProcessLayoutByRef,
  getTraceLayoutBoundsFromStructure,
  getTraceLayoutVerticalBounds
} from './trace-layout/trace-layout';
export {
  buildTraceLayoutGeometryDerivationContext,
  getTraceLayoutDependencyRenderSource,
  type TraceLayoutGeometryDerivationContext
} from './trace-layout/trace-derived-geometry';
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
  cloneTraceLayoutCollapseStateForGraphs,
  findProcessGraphIndex,
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
  buildTraceSelectionOverviewScenes,
  buildTracePreparedMinimapSpanIndicators,
  buildTracePreparedOverviewGraphScenes,
  buildTracePreparedOverviewViewModel,
  buildTracePreparedGraphScenes,
  buildTracePreparedProcessRows,
  createTraceComparisonModelMatrix,
  type BuildTraceSelectionOverviewScenesParams,
  type BuildTracePreparedOverviewGraphScenesParams,
  type BuildTracePreparedOverviewViewModelParams,
  type BuildTracePreparedGraphScenesParams,
  type BuildTracePreparedProcessRowsParams,
  type TraceComparisonTransform,
  type TracePreparedMinimapSpanIndicator,
  type TracePreparedMinimapSpanIndicatorKind,
  type TraceOverviewLoadedContentBounds,
  type TraceOverviewTimeRange,
  type TracePreparedGraphScene,
  type TracePreparedPathData,
  type TracePreparedOverviewViewModel,
  type TracePreparedProcessRow,
  type TraceViewBounds
} from './trace-view-state/trace-prepared-scene';
export {
  TraceEngine,
  type TraceEngineAction,
  type TraceEngineDiagnostics,
  type TraceEngineInputs,
  type TraceEngineUpdate
} from './trace-view-state/trace-engine';
export {type TraceRenderSnapshot} from './trace-view-state/trace-view-state';
export {
  buildTraceSelectedCrossProcessDependencySources,
  buildTraceSelectedDependencyDirectionMaps,
  buildTraceSelectedSameProcessDependencySourcesByProcessId,
  getImmediateDependencyRefsForSpan,
  getTraceSelectedSpanFromRef,
  getTraceSelectedSpanFromRenderSpan,
  getVisibleDependencyEndpointSpanRefs,
  type TraceSelectedCrossProcessDependencySources,
  type TraceSelectedDependencyDirectionMapInput,
  type TraceSelectedDependencyDirectionMaps,
  type TraceSelectedDependencySourceDirectionOptions,
  type TraceSelectedSameProcessDependencySourcesByProcessId,
  type TraceSelectedSpan,
  type TraceVisibleDependencyEndpointSpanRefInput,
  type TraceDependencyRefsForSpan
} from './trace-view-state/trace-view-selection';
export {
  type TraceDeckBinaryAttributeData,
  type TraceDeckBinaryBlockData,
  type TraceDeckBinaryCrossProcessDependencyLineData,
  type TraceDeckBinaryDependencyLineData,
  buildTraceDeckBinaryBlockData,
  buildTraceDeckBinaryCrossProcessDependencyLineData,
  buildTraceDeckBinaryDependencyLineData
} from './trace-view-state/trace-deck-binary-data';
export {
  buildTraceVisibleCrossProcessDependencyRefSource,
  type TraceCrossProcessDependencyRefSource,
  type TraceDenseSpanRefRange,
  type TraceSameProcessDependencyRefSource,
  type TraceSpanRefSource
} from './trace-view-state/trace-ref-source';
export {
  type CounterRenderData,
  type CounterSparkline,
  type DerivedTraceData,
  type GlobalEventRenderData,
  type InstantRenderData,
  type TraceDeckBinaryProcessActivityData,
  type TraceLayoutRowEnrichment,
  DEFAULT_COUNTER_COLOR,
  DEFAULT_INSTANT_COLOR,
  buildDerivedTraceData,
  buildTraceDeckBinaryProcessActivityData,
  buildTraceLayoutRowEnrichments
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
  createTraceGraphColorResolver,
  DEFAULT_PATH_HIGHLIGHT_TRAIL_LENGTH,
  getCrossRankDependencyLineColor,
  getDependencyLineColor,
  getSelectedCrossRankDependencyLineColor,
  getSelectedSameProcessDependencyLineColor,
  getTraceThreadColor,
  MAX_PATH_HIGHLIGHT_TRAIL_LENGTH,
  MIN_PATH_HIGHLIGHT_TRAIL_LENGTH,
  NOT_IN_PATH_FADE_FACTOR,
  PATH_HIGHLIGHT_TRAIL_LENGTH,
  SELECTED_SPAN_HIGHLIGHT_STYLES,
  TRACE_COLOR,
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
  collectTraceColorSchemeAttributePaths,
  getReadableSpanBorderColor,
  getTraceSpanAttributeValue,
  isTraceColorSchemeAvailable,
  PERFETTO_TRACE_COLOR_SCHEME,
  PROCESS_TRACE_COLOR_SCHEME,
  type TraceSpanColorAccessorSource,
  type TraceSpanColorContext,
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
} from './loaders/chrome-trace-loader';

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
  getColorFromUserData,
  getColorFromUserDataValues
} from './trace-chrome/chrome-color-scheme';

// SAME-PROCESS DEPENDENCY HELPERS

export {
  DEFAULT_SUBMIT_MIN_WAIT_TIME_MS,
  SUBMIT_MIN_WAIT_TIME_MS,
  shouldShowSameProcessDependencyByMode,
  shouldShowSameProcessDependencyByModeFields
} from './trace-layout/same-process-dependency-filter';

// UTILITIES

export {
  kahnLaneLayout,
  layoutLanesByOverlap,
  sortSpansByTime,
  visitKahnLaneAssignments
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
