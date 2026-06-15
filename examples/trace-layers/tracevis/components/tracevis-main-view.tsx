import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {OrthographicView} from '@deck.gl/core';
import {DeckGL} from '@deck.gl/react';
import {DarkTheme, LightTheme, ThemeWidget} from '@deck.gl/widgets';
import {createPortal} from 'react-dom';
import {imperativeDeckController} from '@deck.gl-community/trace-layers/layers';
import {
  BreadcrumbNavigator,
  DeckTraceGraph,
  getRankNumForSpanRef,
  getSameNameNavigation,
  getThreadNavigation,
  SPAN_INSPECTOR_DEFAULT_WIDTH_PX,
  SpanInspectorHiddenSpanNotice,
  SpanInspectorPopup,
  TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX,
  TraceSpanCard,
  TRACEVIS_SHORTCUTS
} from '@deck.gl-community/trace-layers/react';
import {
  buildJSONTrace,
  buildTraceChunkDataFromJSONTrace,
  createStaticTraceGraphRuntimeSource,
  createTraceColorResolver,
  DEFAULT_TRACE_STYLE,
  materializeJSONTrace,
  TraceEngine,
  TraceGraph
} from '@deck.gl-community/trace-layers/trace';
import {createStudioSettingsWidget, SidebarPanelWidget} from '@deck.gl-community/widgets';

import {TRACEVIS_EXAMPLE_TRACES} from '../examples/tracevis-examples';
import {
  getVisSettingsSchema,
  getVisSettingsUpdatesFromPanelState,
  toVisSettingsState
} from '../lib/vis-settings-panel-definitions';
import {roomStore, useRoomStore} from '../tracevis-store';
import {TraceCatalogPanel} from '../widgets/trace-catalog-widget';
import {DismissibleBadge, ErrorMessage, WithTooltip} from './infovis-primitives';

import type {TraceBreadcrumbEntry} from '../tracevis-store';
import type {Widget} from '@deck.gl/core';
import type {DeckWidgetTheme} from '@deck.gl/widgets';
import type {DeckTraceGraphHandle, ThreadNavigation} from '@deck.gl-community/trace-layers/react';
import type {
  SpanRef,
  TraceCardSpan,
  TraceColorScheme,
  TraceEngineUpdate,
  TraceObject,
  TracePath,
  TraceProcessInfo,
  TraceSpanColorSource,
  TraceVisSettings
} from '@deck.gl-community/trace-layers/trace';

const EMPTY_SHELL_VIEW = new OrthographicView({id: 'empty-main'});
const EMPTY_TRACE_PATH_LIST: TracePath[] = [];
const EMPTY_PROCESS_INFO_MAP: Record<string, TraceProcessInfo> = {};
const EMPTY_SHELL_VIEW_STATE: {
  target: [number, number, number];
  zoom: number;
} = {
  target: [0.5, 0.5, 0],
  zoom: 0
};
const TRACE_CATALOG_TRIGGER_ICON =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M4 6.25A1.25 1.25 0 0 1 5.25 5h13.5A1.25 1.25 0 0 1 20 6.25v11.5A1.25 1.25 0 0 1 18.75 19H5.25A1.25 1.25 0 0 1 4 17.75V6.25Zm2.5 1.25a.75.75 0 0 0-.75.75v1.5c0 .414.336.75.75.75H10a.75.75 0 0 0 .75-.75v-1.5A.75.75 0 0 0 10 7.5H6.5Zm6.75 0a.75.75 0 0 0-.75.75v1.5c0 .414.336.75.75.75h4.25a.75.75 0 0 0 .75-.75v-1.5a.75.75 0 0 0-.75-.75h-4.25Zm-6.75 5a.75.75 0 0 0-.75.75v1.5c0 .414.336.75.75.75h4.25a.75.75 0 0 0 .75-.75v-1.5a.75.75 0 0 0-.75-.75H6.5Zm6.75 0a.75.75 0 0 0-.75.75v1.5c0 .414.336.75.75.75h2.5a.75.75 0 0 0 .75-.75v-1.5a.75.75 0 0 0-.75-.75h-2.5Z'/%3E%3C/svg%3E";

/**
 * Renders the widget-capable deck shell used before any trace data is loaded.
 */
function TracevisEmptyStateDeck({
  deckWidgetTheme,
  widgets
}: {
  deckWidgetTheme: DeckWidgetTheme;
  widgets: Widget[];
}) {
  return (
    <div
      className="absolute w-full h-full bg-white overflow-hidden"
      style={deckWidgetTheme as React.CSSProperties}
    >
      <DeckGL
        style={{position: 'relative', width: '100%', height: '100%'}}
        views={EMPTY_SHELL_VIEW}
        viewState={EMPTY_SHELL_VIEW_STATE}
        controller={false}
        layers={[]}
        widgets={widgets}
        getCursor={() => 'default'}
      />
    </div>
  );
}

/** Converts a trace RGBA byte tuple into a CSS rgba() color. */
const toRgbaCss = (color: readonly [number, number, number, number]) => {
  const alpha = Math.max(0, Math.min(1, color[3] / 255));
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
};

/** Resolves breadcrumb badge colors from the same color resolver used by trace rendering. */
const getTraceBreadcrumbStyle = (
  block: TraceSpanColorSource | undefined | null,
  settings: TraceVisSettings,
  colorScheme: TraceColorScheme
) => {
  if (!block) {
    return {};
  }
  const colorResolver = createTraceColorResolver({colorScheme, settings});
  const blockFillColor = colorResolver.getSpanFillColor(block, 'any');
  const blockTextColor = colorResolver.getSpanTextColor(block, 'any', 'inside');
  return {
    blockColor: toRgbaCss(blockFillColor),
    blockTextColor: toRgbaCss(blockTextColor)
  };
};

/** Compares ordered scalar arrays used by demo selection and expansion state. */
const areScalarArraysEqual = (
  left: readonly (string | number)[],
  right: readonly (string | number)[]
) => left.length === right.length && left.every((value, index) => value === right[index]);

/**
 * Resolves the persisted widget-theme setting to the concrete deck.gl theme mode.
 */
const getResolvedWidgetThemeMode = (widgetTheme: string | undefined): 'light' | 'dark' => {
  if (widgetTheme === 'dark') {
    return 'dark';
  }
  if (widgetTheme === 'auto' && typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
};

/** Main standalone Tracevis demo view. */
export const MainView: React.FC = () => {
  const traceStyle = DEFAULT_TRACE_STYLE;

  const errorMap = useRoomStore(s => s.tracevis.errorMap);
  const visSettings = useRoomStore(s => s.tracevis.visSettings);
  const colorScheme = useRoomStore(state => state.tracevis.getSelectedTraceColorScheme());
  const traceColorSchemes = useRoomStore(state => state.tracevis.traceColorSchemes);
  const setVisSettings = useRoomStore(s => s.tracevis.setVisSettings);

  const setSelectedTimeRange = useRoomStore(state => state.tracevis.setSelectedTimeRange);

  const uploadedTraces = useRoomStore(s => s.tracevis.uploadedTraces);
  const uploadedTraceMetadatas = useRoomStore(s => s.tracevis.uploadedTraceMetadatas);
  const loadTrace = useRoomStore(s => s.tracevis.loadTrace);
  const exampleTraceSelectionMap = useRoomStore(s => s.tracevis.exampleTraceSelectionMap ?? {});
  const uploadedTraceSelectionMap = useRoomStore(s => s.tracevis.uploadedTraceSelectionMap ?? {});
  const selectedDemoTraces = useMemo(() => {
    const selectedExampleTraces = TRACEVIS_EXAMPLE_TRACES.filter(
      example => exampleTraceSelectionMap[example.traceId]
    ).map(example => ({
      traceId: example.traceId,
      source: 'example' as const,
      displayName: example.name
    }));
    const uploadedMetadataById = new Map(
      uploadedTraceMetadatas.map(metadata => [metadata.traceId, metadata])
    );
    const selectedUploadedTraceIds = [
      ...uploadedTraceMetadatas
        .map(metadata => metadata.traceId)
        .filter(traceId => uploadedTraceSelectionMap[traceId]),
      ...Object.keys(uploadedTraceSelectionMap).filter(
        traceId => uploadedTraceSelectionMap[traceId] && !uploadedMetadataById.has(traceId)
      )
    ].filter(traceId => uploadedTraces[traceId]);
    const selectedUploadedTraces = selectedUploadedTraceIds.map(traceId => ({
      traceId,
      source: 'uploaded' as const,
      displayName: uploadedMetadataById.get(traceId)?.name ?? traceId
    }));

    return [...selectedExampleTraces, ...selectedUploadedTraces];
  }, [exampleTraceSelectionMap, uploadedTraceMetadatas, uploadedTraceSelectionMap, uploadedTraces]);

  const MAX_SELECTED_TRACE_COUNT = 2;
  const traceSelectionOverflowCount = Math.max(
    0,
    selectedDemoTraces.length - MAX_SELECTED_TRACE_COUNT
  );
  const [primarySelectedTraceGraph, setPrimarySelectedTraceGraph] = useState<TraceGraph | null>(
    null
  );
  const [secondarySelectedTraceGraph, setSecondarySelectedTraceGraph] = useState<TraceGraph | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;

    async function loadSelectedTraceGraphs() {
      if (selectedDemoTraces.length === 0) {
        setPrimarySelectedTraceGraph(null);
        setSecondarySelectedTraceGraph(null);
        return;
      }

      const graphs: Array<TraceGraph | null> = [];
      const traceSelections = selectedDemoTraces.slice(0, MAX_SELECTED_TRACE_COUNT);

      for (const traceSelection of traceSelections) {
        try {
          const traceData = await loadTrace({
            traceId: traceSelection.traceId,
            source: traceSelection.source
          });
          if (!traceData) {
            graphs.push(null);
            continue;
          }
          const jsonTrace = buildJSONTrace(traceData.ranks, traceData.crossDependencies, {
            name: traceSelection.displayName,
            spanLayout: traceData.spanLayout
          });
          const materializedTrace = materializeJSONTrace(jsonTrace);
          const graph = new TraceGraph(
            createStaticTraceGraphRuntimeSource({
              identityKey: `tracevis-demo:${traceSelection.traceId}`,
              name: traceSelection.displayName,
              spanLayout: materializedTrace.spanLayout,
              chunks: buildTraceChunkDataFromJSONTrace(materializedTrace),
              crossDependencies: materializedTrace.crossDependencies,
              events: materializedTrace.events,
              timeExtents: {
                minTimeMs: materializedTrace.minTimeMs,
                maxTimeMs: materializedTrace.maxTimeMs
              },
              stats: materializedTrace.stats
            })
          );
          graphs.push(graph);
        } catch (error) {
          console.error('Failed to load demo trace', traceSelection.traceId, error);
          graphs.push(null);
        }
      }

      if (!cancelled) {
        setPrimarySelectedTraceGraph(graphs[0] ?? null);
        setSecondarySelectedTraceGraph(graphs[1] ?? null);
      }
    }

    loadSelectedTraceGraphs();

    return () => {
      cancelled = true;
    };
  }, [loadTrace, selectedDemoTraces]);

  const getTraceObjectJSON = useCallback(
    (object?: TraceObject | null) => object as Record<string, unknown>,
    []
  );

  const selectedSpanRefs = useRoomStore(state => state.tracevis.selectedSpanRefs ?? []);
  const setSelectedSpanRefs = useRoomStore(state => state.tracevis.setSelectedSpanRefs);
  const defaultSelectionState = useRoomStore(state => state.tracevis.defaultSelectionState);
  const expandedProcessIds = useRoomStore(state => state.tracevis.expandedProcessIds ?? []);
  const setExpandedProcessIds = useRoomStore(state => state.tracevis.setExpandedProcessIds);
  const pushBreadcrumb = useRoomStore(state => state.tracevis.pushBreadcrumb);
  const highlightedSpanRefs = useRoomStore(state => state.tracevis.highlightedSpanRefs ?? []);
  const extendedSelectionMode = useRoomStore(state => state.tracevis.extendedSelectionMode);
  const traceGraph = primarySelectedTraceGraph;
  const secondaryTraceGraph = secondarySelectedTraceGraph;
  const highlightedSpanRefSet = useMemo(
    () => (highlightedSpanRefs.length > 0 ? new Set(highlightedSpanRefs) : undefined),
    [highlightedSpanRefs]
  );

  const selectedSpan = useMemo<TraceCardSpan | null>(() => {
    if (!traceGraph || selectedSpanRefs[0] == null) {
      return null;
    }
    return traceGraph.getTraceSpanCardModel(selectedSpanRefs[0])?.span ?? null;
  }, [selectedSpanRefs, traceGraph]);

  const selectedBlockRank = useMemo(
    () =>
      selectedSpanRefs[0] != null && traceGraph
        ? traceGraph.getRankNumBySpanRef(selectedSpanRefs[0])
        : getRankNumForSpanRef(traceGraph, selectedSpan?.spanRef ?? null),
    [traceGraph, selectedSpan?.spanRef, selectedSpanRefs]
  );
  const [spanInspectorTabBodyHeightPx, setSpanInspectorTabBodyHeightPx] = useState(
    TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX
  );
  const [spanInspectorWidthPx, setSpanInspectorWidthPx] = useState(SPAN_INSPECTOR_DEFAULT_WIDTH_PX);
  const selectedSpanRef = selectedSpanRefs[0] ?? null;
  const [closedInspectorSpanRef, setClosedInspectorSpanRef] = useState<SpanRef | null>(null);
  const isSpanInspectorClosed = closedInspectorSpanRef === selectedSpanRef;
  useEffect(() => {
    if (selectedSpanRef == null || closedInspectorSpanRef == null) {
      return;
    }
    if (closedInspectorSpanRef !== selectedSpanRef) {
      setClosedInspectorSpanRef(null);
    }
  }, [closedInspectorSpanRef, selectedSpanRef]);

  // TODO - separate the vis settings more clearly
  const settings = useMemo(() => {
    const mode = visSettings.localDependencyMode;
    const showWarningsOnly = mode === 'warnings';
    const showSubmitOnly = mode === 'submit';
    const useExtendedSelectionFadeOpacity = extendedSelectionMode === 'fade';
    const settings: TraceVisSettings = {
      traceColorSchemeId: visSettings.traceColorSchemeId ?? 'processes',
      showDependencies: mode !== 'none',
      localDependencyMode: showWarningsOnly ? 'warnings' : showSubmitOnly ? 'submit' : 'all',
      showCrossProcessDependencies: visSettings.crossDependencyMode === 'all',
      trackAggregationMode: visSettings.trackAggregationMode,
      showInstants: visSettings.showInstants,
      showCounters: visSettings.showCounters,
      transitions: visSettings.transitions,
      followCriticalPathAnimationMode: visSettings.followCriticalPathAnimationMode ?? 'none',
      criticalPathAnimationIntervalMs: visSettings.criticalPathAnimationIntervalMs ?? 75,
      criticalPathTrailSpanLength: visSettings.criticalPathTrailLength ?? 1,
      showPathsOnly: visSettings.showPathsOnly,
      showOverview: visSettings.showOverview,
      dependencyDisplayMode: 'all',
      dependencyKeywords: [],
      dependencyOpacity: visSettings.dependencyOpacity,
      highlightFadeFactor: visSettings.highlightFadeFactor,
      extendedSelectionFadeOpacity: visSettings.extendedSelectionFadeOpacity,
      useExtendedSelectionFadeOpacity,
      minSpanTimeMs: visSettings.minBlockTimeMs,
      threadDisplayMode: visSettings.threadDisplayMode,
      selectedThreadNames: visSettings.selectedThreadNames,
      sortThreads: visSettings.sortThreads,
      lineRoutingMode: visSettings.lineRoutingMode,
      processLayoutMode: visSettings.processLayoutMode,
      showEmptyProcesses: visSettings.showEmptyProcesses,
      layoutDensity: visSettings.layoutDensity ?? 'comfortable',
      maxVisibleLanesPerThread: visSettings.maxVisibleLanesPerThread,
      maxVisibleLanesUnlimited: visSettings.maxVisibleLanesUnlimited,
      traceOffsetMs: visSettings.traceOffsetMs ?? 0,
      traceScale: visSettings.traceScale ?? 1,
      interactionMode: visSettings.interactionMode,
      enableFastTextLayer: visSettings.enableFastTextLayer
    };
    return settings;
  }, [extendedSelectionMode, visSettings]);
  const traceSelectionPolicy = useMemo(
    () => ({type: 'dependency-chain' as const, keywords: ['PARENT']}),
    []
  );
  const resolvedExpandedProcessIds = useMemo(
    () => [
      ...new Set([...(defaultSelectionState.expandedProcessIds ?? []), ...expandedProcessIds])
    ],
    [defaultSelectionState.expandedProcessIds, expandedProcessIds]
  );
  const traceEngineInputs = useMemo(
    () =>
      traceGraph
        ? {
            traceGraph,
            secondaryTraceGraph,
            traceStyle,
            paths: EMPTY_TRACE_PATH_LIST,
            settings,
            colorScheme,
            highlightedSpanRefs: highlightedSpanRefSet,
            selectedSpanRefs,
            selectionPolicy: traceSelectionPolicy,
            extendedSelectionMode,
            defaultExpandProcess: true,
            defaultExpandedProcessIds: resolvedExpandedProcessIds,
            defaultSelectedSpanRefs: defaultSelectionState.selectedSpanRefs ?? [],
            showCollapsedActivitySummary: true
          }
        : null,
    [
      colorScheme,
      defaultSelectionState.selectedSpanRefs,
      extendedSelectionMode,
      highlightedSpanRefSet,
      resolvedExpandedProcessIds,
      selectedSpanRefs,
      secondaryTraceGraph,
      settings,
      traceGraph,
      traceSelectionPolicy,
      traceStyle
    ]
  );
  const traceEngineRef = useRef<TraceEngine | null>(null);
  if (!traceEngineInputs) {
    traceEngineRef.current = null;
  } else if (!traceEngineRef.current) {
    traceEngineRef.current = new TraceEngine(traceEngineInputs);
  }
  const traceEngine = traceEngineRef.current;
  useLayoutEffect(() => {
    if (!traceEngine || !traceEngineInputs) {
      return;
    }
    traceEngine.sync(traceEngineInputs);
  }, [traceEngine, traceEngineInputs]);
  const handleTraceEngineUpdate = useCallback(
    (update: TraceEngineUpdate) => {
      if (update.reason === 'sync') {
        return;
      }
      if (
        update.expandedProcessIdsChanged &&
        !areScalarArraysEqual(expandedProcessIds, update.serializedExpandedProcessIds)
      ) {
        setExpandedProcessIds([...update.serializedExpandedProcessIds]);
      }
      if (!update.selectionChanged) {
        return;
      }
      if (!areScalarArraysEqual(update.selectedSpanRefs, selectedSpanRefs)) {
        setSelectedSpanRefs([...update.selectedSpanRefs]);
      }
      const primarySpanRef = update.selectedSpanRefs[0] ?? null;
      const primarySpan = update.selectedSpans[0]?.span ?? null;
      if (primarySpan && primarySpanRef != null) {
        const breadcrumbEntry: TraceBreadcrumbEntry = {
          spanRef: primarySpanRef,
          spanName: primarySpan.name,
          spanKeywords: primarySpan.keywords,
          ...getTraceBreadcrumbStyle(primarySpan, settings, colorScheme)
        };
        pushBreadcrumb(breadcrumbEntry);
      }
    },
    [
      colorScheme,
      expandedProcessIds,
      pushBreadcrumb,
      selectedSpanRefs,
      setExpandedProcessIds,
      setSelectedSpanRefs,
      settings
    ]
  );
  useEffect(() => {
    if (!traceEngine) {
      return;
    }
    return traceEngine.subscribe(handleTraceEngineUpdate);
  }, [handleTraceEngineUpdate, traceEngine]);

  const deckTraceGraphRef = useRef<DeckTraceGraphHandle>(null);

  const {breadcrumb, activeIndex, goToBreadcrumb} = useBreadcrumbState();
  const zoomToSpanRef = useCallback(
    (spanRef: SpanRef) => imperativeDeckController.zoomToSpanRef(spanRef),
    []
  );
  const streamNavigation: ThreadNavigation | null = useMemo(() => {
    if (!traceGraph || selectedSpanRefs[0] == null) {
      return null;
    }
    return getThreadNavigation(selectedSpanRefs[0], traceGraph);
  }, [traceGraph, selectedSpanRefs]);
  const sameNameNavigation = useMemo(() => {
    if (!traceGraph || selectedSpanRefs[0] == null) {
      return null;
    }
    return getSameNameNavigation(selectedSpanRefs[0], traceGraph);
  }, [traceGraph, selectedSpanRefs]);
  const selectedSpanFilterNavigation = useMemo(() => {
    if (!traceGraph || selectedSpanRef == null || !selectedSpan?.isFiltered) {
      return null;
    }
    return traceGraph.getTraceSpanFilterNavigation(selectedSpanRef);
  }, [selectedSpan?.isFiltered, selectedSpanRef, traceGraph]);
  const navigateToSpanRef = useCallback(
    (targetSpanRef: SpanRef | null) => {
      if (!traceGraph || targetSpanRef == null) {
        return;
      }

      const targetSpan = traceGraph.getTraceSpanCardModel(targetSpanRef)?.span ?? null;
      if (!targetSpan) {
        return;
      }

      pushBreadcrumb({
        spanRef: targetSpanRef,
        spanName: targetSpan.name,
        spanKeywords: targetSpan.keywords,
        ...getTraceBreadcrumbStyle(targetSpan, settings, colorScheme)
      });
      setSelectedSpanRefs([targetSpanRef]);
      deckTraceGraphRef.current?.zoomToSpanRef(targetSpanRef);
    },
    [colorScheme, pushBreadcrumb, setSelectedSpanRefs, settings, traceGraph]
  );

  const handleSettingsWidgetChange = useCallback(
    (nextPanelSettings: Record<string, unknown>) => {
      const updates = getVisSettingsUpdatesFromPanelState(visSettings, nextPanelSettings, {
        traceColorSchemeId: traceColorSchemes.map(scheme => scheme.id)
      });
      if (Object.keys(updates).length === 0) {
        return;
      }
      setVisSettings(updates);
    },
    [setVisSettings, traceColorSchemes, visSettings]
  );

  const settingsConfig = useMemo(
    () => ({
      label: 'Visualization settings',
      placement: 'top-right' as const,
      visualizationSchema: getVisSettingsSchema(traceColorSchemes),
      showStudioSettingsWidget: false,
      settings: toVisSettingsState(visSettings),
      onSettingsChange: handleSettingsWidgetChange
    }),
    [handleSettingsWidgetChange, traceColorSchemes, visSettings]
  );
  const studioSettingsWidget = useMemo(() => {
    return createStudioSettingsWidget({
      id: 'tracevis-studio-settings',
      title: 'Visualization settings',
      triggerLabel: 'Visualization settings',
      placement: 'top-right',
      schema: getVisSettingsSchema(traceColorSchemes),
      settings: toVisSettingsState(visSettings),
      onSettingsChange: handleSettingsWidgetChange
    });
  }, [handleSettingsWidgetChange, traceColorSchemes, visSettings]);
  const resolvedWidgetThemeMode = getResolvedWidgetThemeMode(visSettings.widgetTheme);
  const deckWidgetTheme = useMemo(
    () => (resolvedWidgetThemeMode === 'dark' ? DarkTheme : LightTheme),
    [resolvedWidgetThemeMode]
  );
  const themeWidget = useMemo(() => {
    return new ThemeWidget({
      id: 'tracevis-theme',
      placement: 'top-right',
      themeMode: resolvedWidgetThemeMode,
      lightModeTheme: LightTheme,
      darkModeTheme: DarkTheme,
      lightModeLabel: 'Light theme',
      darkModeLabel: 'Dark theme',
      onThemeModeChange: themeMode => setVisSettings({widgetTheme: themeMode})
    });
  }, [resolvedWidgetThemeMode, setVisSettings]);
  const traceCatalogWidget = useMemo(() => {
    return new SidebarPanelWidget({
      id: 'tracevis-trace-catalog',
      title: 'Traces',
      triggerLabel: 'Traces',
      triggerIcon: TRACE_CATALOG_TRIGGER_ICON,
      placement: 'top-left',
      side: 'left',
      widthPx: 320,
      defaultOpen: true,
      button: true,
      dockTriggerWhenOpen: false,
      showBackdrop: false,
      panel: new TraceCatalogPanel({
        store: roomStore
      })
    });
  }, []);
  const emptyDeckWidgets = useMemo(
    () => [traceCatalogWidget, themeWidget, studioSettingsWidget],
    [studioSettingsWidget, themeWidget, traceCatalogWidget]
  );
  const traceDeckWidgets = useMemo(
    () => [themeWidget, studioSettingsWidget, traceCatalogWidget],
    [studioSettingsWidget, themeWidget, traceCatalogWidget]
  );
  const handleProcessInfoClick = useCallback(
    (_processId: string, processInfo?: TraceProcessInfo) => {
      console.log('PROCESS INFO CLICK', processInfo);
    },
    []
  );
  const deckTraceGraphConfig = useMemo(
    () => ({
      processInfoMap: EMPTY_PROCESS_INFO_MAP,
      getJSONForTraceObject: getTraceObjectJSON,
      onTimeRangeSelectionChange: setSelectedTimeRange,
      onProcessInfoClick: handleProcessInfoClick,
      keyboardShortcuts: TRACEVIS_SHORTCUTS,
      settingsConfig,
      deckWidgetTheme,
      controlWidgetPlacement: 'top-right' as const,
      showDefaultWidgets: true,
      widgets: traceDeckWidgets
    }),
    [
      deckWidgetTheme,
      getTraceObjectJSON,
      handleProcessInfoClick,
      setSelectedTimeRange,
      settingsConfig,
      traceDeckWidgets
    ]
  );

  return (
    <div className="w-full h-full flex flex-col gap-2 overflow-y-auto">
      <div className="flex flex-col items-center justify-center w-full px-4">
        <div className="text-sm">
          {Object.entries(errorMap).map(([name, error]) => (
            <WithTooltip className="bg-red-100" tooltip={<ErrorMessage error={error} />} key={name}>
              <DismissibleBadge className="text-red-500" variant="destructive">
                ❌ {name}
              </DismissibleBadge>
            </WithTooltip>
          ))}
          {traceSelectionOverflowCount > 0 && (
            <DismissibleBadge className="mt-2 bg-yellow-100 text-yellow-800" variant="default">
              Showing only the first two selected traces. Deselect {traceSelectionOverflowCount}{' '}
              extra {traceSelectionOverflowCount === 1 ? 'selection' : 'selections'} to compare a
              different pair.
            </DismissibleBadge>
          )}
        </div>
      </div>
      {!traceGraph ? (
        <div className="relative flex items-center justify-center w-full h-full">
          <TracevisEmptyStateDeck deckWidgetTheme={deckWidgetTheme} widgets={emptyDeckWidgets} />
        </div>
      ) : (
        <DeckTraceGraph
          ref={deckTraceGraphRef}
          className="w-full bg-white overflow-visible"
          engine={traceEngine!}
          reactConfig={deckTraceGraphConfig}
        />
      )}

      {traceGraph &&
        selectedSpan &&
        selectedSpanRef != null &&
        !isSpanInspectorClosed &&
        createPortal(
          <EventBoundary>
            <div className="fixed bottom-2 right-4 z-50 flex justify-end w-full">
              <div className="overflow-x-auto max-w-full px-2 py-2 flex gap-2 pointer-events-none">
                <SpanInspectorPopup
                  key={selectedSpan.spanId}
                  widthPx={spanInspectorWidthPx}
                  onWidthChange={setSpanInspectorWidthPx}
                  tabBodyHeightPx={spanInspectorTabBodyHeightPx}
                  onTabBodyHeightChange={setSpanInspectorTabBodyHeightPx}
                  title="Span Inspector"
                  closeLabel="Close Span Inspector"
                  onClose={() => setClosedInspectorSpanRef(selectedSpanRef)}
                >
                  <div className="space-y-2 pb-3">
                    {selectedSpanFilterNavigation ? (
                      <SpanInspectorHiddenSpanNotice
                        filterMask={selectedSpanFilterNavigation.filterMask}
                        visibleDescendantSpanRef={
                          selectedSpanFilterNavigation.visibleDescendantSpanRef
                        }
                        visibleAncestorSpanRef={selectedSpanFilterNavigation.visibleAncestorSpanRef}
                        onNavigateToSpanRef={spanRef => navigateToSpanRef(spanRef)}
                      />
                    ) : null}
                    {/* <Dismissible key={block.spanId}> </Dismissible> */}
                    <TraceSpanCard
                      spanRef={selectedSpanRef}
                      traceGraph={traceGraph}
                      tabBodyHeightPx={spanInspectorTabBodyHeightPx}
                      traceStyle={traceStyle}
                      traceLabels={traceStyle.labels}
                      traceSettings={settings}
                      interactive
                      paths={EMPTY_TRACE_PATH_LIST}
                      rankQueryStatusMap={{}}
                      onRankClick={rankNum => console.log(String(rankNum), true)}
                      onSpanClick={(...args) => {
                        console.log('block click', selectedSpanRef, ...args);
                      }}
                      onSpanDoubleClick={(clickedSpanRef: SpanRef) => {
                        console.log('block dbl click', selectedSpanRef);
                        const clickedSpan =
                          traceGraph.getTraceSpanCardModel(clickedSpanRef)?.span ?? null;
                        pushBreadcrumb({
                          spanRef: clickedSpanRef,
                          spanName: clickedSpan?.name ?? selectedSpan.name,
                          spanKeywords: clickedSpan?.keywords,
                          ...getTraceBreadcrumbStyle(clickedSpan, settings, colorScheme)
                        });
                        setSelectedSpanRefs([clickedSpanRef]);
                        deckTraceGraphRef.current?.zoomToSpanRef(clickedSpanRef);
                      }}
                    />
                    {streamNavigation && (
                      <div className="flex items-center justify-between px-2">
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <span className="rounded-xl bg-white py-0 my-0 px-2">
                            stream {streamNavigation.streamName ?? 'unknown'}
                          </span>
                          {streamNavigation.positionLabel && (
                            <span className="text-foreground">
                              block {streamNavigation.positionLabel.replace(' / ', ' of ')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <WithTooltip tooltip="Previous block in stream">
                            <button
                              type="button"
                              className="h-7 w-7 inline-flex items-center justify-center rounded border border-border bg-card text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                              onClick={() => navigateToSpanRef(streamNavigation.previousSpanRef)}
                              disabled={!streamNavigation.previousSpanRef}
                            >
                              &lt;
                            </button>
                          </WithTooltip>
                          <WithTooltip tooltip="Next block in stream">
                            <button
                              type="button"
                              className="h-7 w-7 inline-flex items-center justify-center rounded border border-border bg-card text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                              onClick={() => navigateToSpanRef(streamNavigation.nextSpanRef)}
                              disabled={!streamNavigation.nextSpanRef}
                            >
                              &gt;
                            </button>
                          </WithTooltip>
                        </div>
                      </div>
                    )}
                    {sameNameNavigation?.positionLabel && (
                      <div className="flex items-center justify-between px-2">
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <span className="text-foreground">
                            {`span ${sameNameNavigation.positionLabel.replace(
                              ' / ',
                              ' of '
                            )} with the same name`}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <WithTooltip tooltip="Previous span with the same name">
                            <button
                              type="button"
                              className="h-7 w-7 inline-flex items-center justify-center rounded border border-border bg-card text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                              onClick={() => navigateToSpanRef(sameNameNavigation.previousSpanRef)}
                              disabled={!sameNameNavigation.previousSpanRef}
                            >
                              &lt;
                            </button>
                          </WithTooltip>
                          <WithTooltip tooltip="Next span with the same name">
                            <button
                              type="button"
                              className="h-7 w-7 inline-flex items-center justify-center rounded border border-border bg-card text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                              onClick={() => navigateToSpanRef(sameNameNavigation.nextSpanRef)}
                              disabled={!sameNameNavigation.nextSpanRef}
                            >
                              &gt;
                            </button>
                          </WithTooltip>
                        </div>
                      </div>
                    )}
                    <BreadcrumbNavigator
                      traceStyle={traceStyle}
                      currentRank={selectedBlockRank ?? undefined}
                      breadcrumb={breadcrumb}
                      activeIndex={activeIndex}
                      goToBreadcrumb={goToBreadcrumb!}
                      zoomToSpanRef={zoomToSpanRef}
                    />
                  </div>
                </SpanInspectorPopup>
              </div>
            </div>
          </EventBoundary>,
          document.fullscreenElement || document.getElementById('root') || document.body
        )}
    </div>
  );
};

function useBreadcrumbState(): {
  breadcrumb: TraceBreadcrumbEntry[];
  activeIndex: number;
  goToBreadcrumb?: (index: number) => void;
} {
  const breadcrumb =
    useRoomStore(state => state.tracevis.breadcrumb as TraceBreadcrumbEntry[] | undefined) || [];
  const goToBreadcrumb = useRoomStore(
    state => state.tracevis.goToBreadcrumb as ((index: number) => void) | undefined
  );
  const breadcrumbIndex =
    useRoomStore(state => state.tracevis.breadcrumbIndex as number | undefined) ?? -1;
  const activeIndex =
    breadcrumbIndex >= 0 && breadcrumbIndex < breadcrumb.length
      ? breadcrumbIndex
      : breadcrumb.length - 1;

  return {breadcrumb, goToBreadcrumb, activeIndex};
}

/** Props for the local dismissible content wrapper. */
type DismissibleProps = {
  /** Content shown until the wrapper is dismissed. */
  children: React.ReactNode;
};

/** Props for the span inspector event isolation boundary. */
type EventBoundaryProps = {
  /** Optional class name appended to the boundary container. */
  className?: string;
  /** Popup content protected from deck.gl controller events. */
  children: React.ReactNode;
};

/** Renders content with a small inline dismiss button. */
export function Dismissible({children}: DismissibleProps) {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  return (
    <div className="bg-muted">
      <div className="relative inline-flex items-center text-sm font-medium bg-muted text-muted-foreground rounded">
        {children}
        <button
          onClick={() => setVisible(false)}
          className="absolute top-2 right-3 translate-x-1/2 -translate-y-1/2 rounded-full  bg-background shadow-sm hover:bg-muted-foreground/10 focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Dismiss"
        >
          ❌
        </button>
      </div>
    </div>
  );
}

/** Prevents pointer events from bubbling from popups into the deck.gl controller. */
function EventBoundary(props: EventBoundaryProps) {
  const stopMjolnir = (e: React.SyntheticEvent) => {
    // Let the element itself handle the event…
    // but stop it from going any further.
    e.stopPropagation();
    // …and kill native propagation so mjolnir never sees it
    e.nativeEvent?.stopImmediatePropagation?.();
  };

  return (
    <div
      className={`relative z-10 pointer-events-none ${props.className || ''}`}
      // Bubble phase: children get their onClick, onPointerDown, etc.
      onPointerDown={stopMjolnir}
      onPointerUp={stopMjolnir}
      onClick={stopMjolnir}
      onDoubleClick={stopMjolnir}
      onMouseDown={stopMjolnir}
      onMouseUp={stopMjolnir}
      onWheel={stopMjolnir}
      onContextMenu={stopMjolnir}
    >
      {props.children}
    </div>
  );
}

// function InsulatedCard({ children }: { children: React.ReactNode }) {
//   const stopAll = (e: React.MouseEvent) => {
//     e.preventDefault();
//     e.stopPropagation();
//     e.nativeEvent.stopImmediatePropagation?.();
//   };

//   return (
//     <div
//       className="relative z-10 pointer-events-auto"
//       onClickCapture={stopAll}
//       onMouseDownCapture={stopAll}
//       onPointerDownCapture={stopAll}
//     >
//       {children}
//     </div>
//   );
// }
