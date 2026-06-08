import {ComponentProps, ReactNode, useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {formatTimeMs, formatTS, getDependencyDurationMs} from '../../../../../trace/index';
import {getTraceSpanBadgeStyle} from '../../../../utils/trace-span-badge-style';
import {Badge, Tabs, TabsList, TabsTrigger} from '../../../ui';
import {TraceSpanNameBadge} from '../trace-span-name-badge';
import {TraceSpanCommPill} from './trace-span-card-comm-pill';
import {
  buildTraceSpanCardConfiguration,
  TraceSpanCardConfiguration
} from './trace-span-card-configuration';
import {
  TraceSpanCrossDependencies,
  TraceSpanCrossDependenciesHorizontal
} from './trace-span-card-cross-dependencies';
import {getSameNameNavigation, getThreadNavigation} from './trace-span-card-stream-navigation';
import {TraceSpanChildrenTab} from './trace-span-card-tab-children';
import {TraceSpanDependenciesTab} from './trace-span-card-tab-dependencies';
import {TraceSpanHistogramsTab} from './trace-span-card-tab-histogram';
import {TraceSpanExternalSpanIdValue, TraceSpanSpanDataTab} from './trace-span-card-tab-span-data';
import {TraceSpanTimingsTab} from './trace-span-card-tab-timings';
import {
  TRACE_BLOCK_CARD_EMPTY_TAB_CLASS,
  TRACE_BLOCK_CARD_TAB_LABELS,
  TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX
} from './trace-span-card-types';

import type {
  SpanRef,
  TraceCardSpan,
  TraceDependency,
  TraceGraph,
  TraceLabels,
  TracePath,
  TraceSpanCardDescendantResult,
  TraceSpanCardParentChainEntry,
  TraceSpanId,
  TraceStyle,
  TraceVisSettings
} from '../../../../../trace/index';
import type {QueryStatus} from '../../../query-status';
import type {TraceSpanDoubleClickAction} from '../trace-span-name-badge';
import type {SameNameNavigation, ThreadNavigation} from './trace-span-card-stream-navigation';
import type {
  TraceSpanCardCustomTab,
  TraceSpanCardTab,
  TraceSpanCardTabId,
  TraceSpanCardTabOptions,
  TraceSpanDependencyMetricColumn,
  TraceSpanTableSpanVisibilityControl
} from './trace-span-card-types';
import type {CSSProperties} from 'react';

export {TraceSpanCrossDependencies, getSameNameNavigation, getThreadNavigation};
export {TraceSpanExternalSpanIdValue} from './trace-span-card-tab-span-data';
export type {TraceSpanExternalSpanIdValueProps} from './trace-span-card-tab-span-data';
export type {SameNameNavigation, ThreadNavigation, TraceSpanDoubleClickAction};
const TRACE_BLOCK_CHILDREN_TRAVERSAL_BUDGET = 1000;

/**
 * Props for the main TraceSpanCard surface.
 */
export type TraceSpanCardProps = {
  /** Exact span ref to render. */
  spanRef: SpanRef;
  /** Filtered graph wrapper used for related dependency and child lookups. */
  traceGraph: Readonly<TraceGraph>;
  /** Trace labels supplied by the owning view. */
  traceLabels: TraceLabels;
  /** Trace style used for block badges and accents. */
  traceStyle: TraceStyle;
  /** Active visualization settings used for timing summaries and formatting. */
  traceSettings: TraceVisSettings;
  /** Optional tab and dependency-display overrides from the owning view. */
  tabOptions?: TraceSpanCardTabOptions;
  /** Optional caller-owned traversal controls rendered in a Traversal tab. */
  traversalContent?: ReactNode;
  /** Optional caller-owned tabs rendered after built-in TraceSpanCard tabs. */
  customTabs?: readonly TraceSpanCardCustomTab[];
  /** Whether the card should expose interactive tabs and tab-level controls. */
  interactive?: boolean;
  /** Optional caller-selected interactive tab restored ahead of localStorage state. */
  selectedTab?: TraceSpanCardTabId;
  /** Callback fired when the active interactive tab changes. */
  onSelectedTabChange?: (selectedTab: TraceSpanCardTabId) => void;
  /** Optional localStorage key used to persist the selected interactive tab. */
  selectedTabStorageKey?: string;
  /** Optional tab-body height override used by the Span Inspector shell. */
  tabBodyHeightPx?: number;
  /** Highlighted paths relevant to this block. */
  paths?: TracePath[];
  /** Callback when a rank in the cross-rank summary is clicked. */
  onRankClick?: (rankNum: number) => void;
  /** Callback when a cross-rank navigation action requests a target block. */
  onNavigateToBlock?: (spanId: TraceSpanId, rankNum: number) => void;
  /** Callback when a block badge is clicked for the exact span ref. */
  onSpanClick?: (spanRef: SpanRef) => void;
  /** Callback when a block badge is double-clicked for the exact span ref. */
  onSpanDoubleClick?: (spanRef: SpanRef, action: TraceSpanDoubleClickAction) => void;
  /** Callback when dependency hover should highlight exact span refs. */
  onBlockHover?: (spanRef: SpanRef | null) => void;
  /** Optional rank query statuses used by the cross-rank summary. */
  rankQueryStatusMap?: Readonly<Record<string, QueryStatus | undefined>>;
};

/**
 * Render the primary TraceSpanCard, including the header, summary, tabs, and cross-rank footer.
 */
export function TraceSpanCard(props: TraceSpanCardProps) {
  const tabBodyHeightPx = props.tabBodyHeightPx ?? TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX;
  const configuration = useMemo(
    () =>
      buildTraceSpanCardConfiguration({
        spanRef: props.spanRef,
        traceGraph: props.traceGraph,
        traceLabels: props.traceLabels,
        traceSettings: props.traceSettings,
        interactive: props.interactive,
        tabOptions: props.tabOptions,
        hasTraversalContent: Boolean(props.traversalContent)
      }),
    [
      props.spanRef,
      props.traceGraph,
      props.interactive,
      props.tabOptions,
      props.traversalContent,
      props.traceLabels,
      props.traceSettings
    ]
  );
  const badgeStyle = useMemo(
    () =>
      getTraceSpanBadgeStyle(configuration.span, props.traceSettings, props.traceStyle.colorScheme),
    [configuration.span, props.traceSettings, props.traceStyle.colorScheme]
  );
  const [selectedDependencyDurationTimingKeys, setSelectedDependencyDurationTimingKeys] = useState<
    readonly [string, string]
  >(() => configuration.defaultDependencyDurationTimingKeys);
  useEffect(() => {
    setSelectedDependencyDurationTimingKeys(currentTimingKeys =>
      resolveTraceSpanDependencyDurationTimingKeys({
        currentTimingKeys,
        defaultTimingKeys: configuration.defaultDependencyDurationTimingKeys,
        availableTimingKeys: configuration.dependencyDurationTimingKeys
      })
    );
  }, [
    configuration.defaultDependencyDurationTimingKeys,
    configuration.dependencyDurationTimingKeys
  ]);
  const handleDependencyDurationTimingKeyChange = useCallback(
    (columnIndex: 0 | 1, timingKey: string) => {
      setSelectedDependencyDurationTimingKeys(currentTimingKeys => {
        if (currentTimingKeys[columnIndex] === timingKey) {
          return currentTimingKeys;
        }
        return columnIndex === 0
          ? [timingKey, currentTimingKeys[1]]
          : [currentTimingKeys[0], timingKey];
      });
    },
    []
  );
  const dependencyMetricColumns = useMemo(
    () =>
      getTraceSpanDependencyMetricColumns({
        dependencyMetric: configuration.tabOptions.dependencyMetric,
        selectedDurationTimingKeys: selectedDependencyDurationTimingKeys,
        durationTimingOptions: configuration.dependencyDurationTimingKeys,
        interactive: Boolean(props.interactive),
        onDurationTimingKeyChange: handleDependencyDurationTimingKeyChange
      }),
    [
      configuration.dependencyDurationTimingKeys,
      configuration.tabOptions.dependencyMetric,
      handleDependencyDurationTimingKeyChange,
      props.interactive,
      selectedDependencyDurationTimingKeys
    ]
  );
  const getDependencyBadgeStyle = useCallback(
    (targetSpan: TraceCardSpan): CSSProperties =>
      getTraceSpanBadgeStyle(targetSpan, props.traceSettings, props.traceStyle.colorScheme),
    [props.traceSettings, props.traceStyle.colorScheme]
  );
  const getDependencyMetricValues = useCallback(
    (params: TraceSpanDependencyMetricValueParams): string[] =>
      getTraceSpanDependencyMetricValues({
        span: params.span,
        dependency: params.dependency,
        rowKind: params.rowKind,
        metricColumns: dependencyMetricColumns,
        activeTimingKey: configuration.activeTimingKey
      }),
    [configuration.activeTimingKey, dependencyMetricColumns]
  );
  const childrenDescendants = useRef<{
    spanRef: SpanRef | null;
    traceGraph: Readonly<TraceGraph> | null;
    raw: TraceSpanCardDescendantResult | null;
    visible: TraceSpanCardDescendantResult | null;
  }>({
    spanRef: null,
    traceGraph: null,
    raw: null,
    visible: null
  });
  if (
    childrenDescendants.current.spanRef !== configuration.span.spanRef ||
    childrenDescendants.current.traceGraph !== props.traceGraph
  ) {
    childrenDescendants.current = {
      spanRef: configuration.span.spanRef,
      traceGraph: props.traceGraph,
      raw: null,
      visible: null
    };
  }
  const getTraceSpanDescendants = useCallback<TraceSpanChildrenResultLoader>(
    params => {
      if (!childrenDescendants.current.raw) {
        childrenDescendants.current.raw = props.traceGraph.getTraceSpanDescendants(
          configuration.span.spanRef,
          {
            includeHidden: true,
            computeExactTruncatedCount: false,
            maxTraversalNodes: TRACE_BLOCK_CHILDREN_TRAVERSAL_BUDGET
          }
        );
      }

      if (params.includeHidden) {
        return childrenDescendants.current.raw;
      }

      if (!childrenDescendants.current.visible) {
        childrenDescendants.current.visible = filterHiddenTraceSpanDescendants(
          childrenDescendants.current.raw
        );
      }
      return childrenDescendants.current.visible;
    },
    [configuration.span.spanRef, props.traceGraph]
  );
  const visibleInitialTabIds = useMemo<TraceSpanCardTabId[]>(
    () =>
      insertTraceSpanCustomTabIds({
        builtInTabIds: configuration.availableTabs.filter(tab => tab !== 'all'),
        customTabs: props.customTabs
      }),
    [configuration.availableTabs, props.customTabs]
  );
  const defaultInteractiveTab = visibleInitialTabIds[0] ?? null;
  const preferredDefaultInteractiveTab = visibleInitialTabIds.includes('dependencies')
    ? 'dependencies'
    : defaultInteractiveTab;
  const initialTabSelection = getInitialTraceSpanTabSelection({
    availableTabs: visibleInitialTabIds,
    defaultTab: preferredDefaultInteractiveTab,
    selectedTab: props.selectedTab,
    storageKey: props.selectedTabStorageKey
  });
  const [selectedInteractiveTab, setSelectedInteractiveTab] = useState<TraceSpanCardTabId | null>(
    () => initialTabSelection.selectedTab
  );
  const showFilteredSpansByDefault = props.interactive !== false;
  const [showHiddenParents, setShowHiddenParents] = useState<boolean>(
    () => showFilteredSpansByDefault && initialTabSelection.showHiddenParents
  );
  const [showHiddenChildren, setShowHiddenChildren] = useState<boolean>(
    () => showFilteredSpansByDefault
  );
  const [showHiddenOutgoingDependencies, setShowHiddenOutgoingDependencies] = useState<boolean>(
    () => showFilteredSpansByDefault
  );
  const tabDefinitions = useMemo(
    () =>
      createTraceSpanTabDefinitions({
        configuration,
        showHiddenParents,
        showHiddenChildren,
        showHiddenOutgoingDependencies,
        traceGraph: props.traceGraph,
        interactive: props.interactive,
        dependencyMetricColumns,
        getDependencyBadgeStyle,
        getDependencyMetricValues,
        getTraceSpanDescendants,
        onSpanClick: props.onSpanClick,
        onSpanDoubleClick: props.onSpanDoubleClick,
        onBlockHover: props.onBlockHover,
        onRankClick: props.onRankClick,
        onNavigateToBlock: props.onNavigateToBlock,
        rankQueryStatusMap: props.rankQueryStatusMap,
        traversalContent: props.traversalContent,
        customTabs: props.customTabs,
        traceStyle: props.traceStyle,
        tabBodyHeightPx,
        onShowHiddenParentsChange: setShowHiddenParents,
        onShowHiddenChildrenChange: setShowHiddenChildren,
        onShowHiddenOutgoingDependenciesChange: setShowHiddenOutgoingDependencies
      }),
    [
      configuration,
      showHiddenChildren,
      showHiddenOutgoingDependencies,
      showHiddenParents,
      props.traceGraph,
      props.interactive,
      dependencyMetricColumns,
      getDependencyBadgeStyle,
      getDependencyMetricValues,
      getTraceSpanDescendants,
      props.onSpanClick,
      props.onSpanDoubleClick,
      props.onBlockHover,
      props.onRankClick,
      props.onNavigateToBlock,
      props.rankQueryStatusMap,
      props.traversalContent,
      props.customTabs,
      props.traceStyle,
      tabBodyHeightPx,
      showHiddenParents,
      showHiddenChildren
    ]
  );
  const availableTabs = useMemo(
    () => tabDefinitions.filter(definition => definition.isAvailable),
    [tabDefinitions]
  );
  const availableTabIds = useMemo(
    () => tabDefinitions.filter(definition => definition.isAvailable).map(tab => tab.id),
    [tabDefinitions]
  );
  const defaultTabFromDefinitions = availableTabIds[0] ?? null;
  const preferredAvailableTab = availableTabIds.includes('dependencies')
    ? 'dependencies'
    : defaultTabFromDefinitions;
  const activeTabDefinition =
    availableTabs.find(definition => definition.id === selectedInteractiveTab) ?? null;
  const dependencyTabDefinition = tabDefinitions.find(
    definition => definition.id === 'dependencies'
  );

  useEffect(() => {
    const nextSelection = getInitialTraceSpanTabSelection({
      availableTabs: availableTabIds,
      defaultTab: preferredAvailableTab,
      selectedTab: props.selectedTab,
      storageKey: props.selectedTabStorageKey
    });
    setSelectedInteractiveTab(currentTab => {
      if (props.selectedTab != null) {
        return nextSelection.selectedTab;
      }
      if (currentTab && availableTabIds.includes(currentTab)) {
        return currentTab;
      }

      setShowHiddenParents(showFilteredSpansByDefault && nextSelection.showHiddenParents);
      return nextSelection.selectedTab;
    });
  }, [
    availableTabIds,
    preferredAvailableTab,
    props.selectedTab,
    props.selectedTabStorageKey,
    showFilteredSpansByDefault
  ]);

  useEffect(() => {
    persistTraceSpanTabSelection({
      selectedTab: selectedInteractiveTab,
      storageKey: props.selectedTabStorageKey
    });
  }, [props.selectedTabStorageKey, selectedInteractiveTab]);

  useEffect(() => {
    if (selectedInteractiveTab != null) {
      props.onSelectedTabChange?.(selectedInteractiveTab);
    }
  }, [props.onSelectedTabChange, selectedInteractiveTab]);

  return (
    <div className="min-w-[400px] w-full space-y-2 bg-muted-background px-3 py-2 text-narrow">
      <TraceSpanCardHeader
        configuration={configuration}
        traceGraph={props.traceGraph}
        badgeStyle={badgeStyle}
        interactive={props.interactive}
        onSpanClick={props.onSpanClick}
        onSpanDoubleClick={props.onSpanDoubleClick}
        colorScheme={props.traceStyle.colorScheme}
      />

      {(!props.interactive || !configuration.spanTimings) && (
        <TraceSpanCardSummary
          configuration={configuration}
          timezone={props.traceSettings.timezone}
        />
      )}

      {props.interactive && configuration.spanTimings && (
        <div className="space-y-1">
          <TraceSpanCardSummary
            configuration={configuration}
            timezone={props.traceSettings.timezone}
          />
        </div>
      )}

      {props.interactive ? (
        activeTabDefinition ? (
          <div className="space-y-0">
            <TraceSpanCardTabs
              tabs={availableTabs}
              selectedTab={selectedInteractiveTab}
              onTabChange={setSelectedInteractiveTab}
            />
            {activeTabDefinition.render()}
          </div>
        ) : null
      ) : dependencyTabDefinition?.isAvailable ? (
        dependencyTabDefinition.render()
      ) : (
        <div className="text-xs text-blue-400">
          {configuration.traceLabels.spanLabel} has no parents
        </div>
      )}

      {!props.interactive && <TraceSpanCrossRankSection configuration={configuration} />}

      {!props.interactive &&
        configuration.tabOptions.showCrossProcessDependencies &&
        configuration.endpointsWithDeps.length > 0 && (
          <TraceSpanCrossDependenciesHorizontal
            endpointsWithDeps={configuration.endpointsWithDeps}
            maxRanks={6}
            onRankClick={props.onRankClick}
            onNavigateToBlock={props.onNavigateToBlock}
            interactive={props.interactive}
            rankQueryStatusMap={props.rankQueryStatusMap}
            currentSpanId={configuration.span.spanId}
            traceLabels={configuration.traceLabels}
          />
        )}
    </div>
  );
}

/** Removes filtered child rows from a raw descendant list while preserving row metadata. */
function filterHiddenTraceSpanDescendants(
  descendants: TraceSpanCardDescendantResult
): TraceSpanCardDescendantResult {
  return {
    ...descendants,
    entries: descendants.entries.filter(entry => !entry.childSpan.isFiltered)
  };
}

/**
 * Props for the header section at the top of the card.
 */
type TraceSpanCardHeaderProps = {
  /** Prepared card configuration for the current block. */
  configuration: TraceSpanCardConfiguration;
  /** Current graph used as the source of truth for header badge filter state. */
  traceGraph: Readonly<TraceGraph>;
  /** Precomputed badge style for the current block. */
  badgeStyle: CSSProperties;
  /** Whether the card is interactive and should show the block id row. */
  interactive?: boolean;
  /** Callback when the main block badge is clicked. */
  onSpanClick?: (spanRef: SpanRef) => void;
  /** Callback when the main block badge is double-clicked. */
  onSpanDoubleClick?: (spanRef: SpanRef, action: TraceSpanDoubleClickAction) => void;
  /** Active trace color scheme used by the block badge. */
  colorScheme: TraceStyle['colorScheme'];
};

/**
 * Render the title, block badge, process/thread labels, and optional block id row.
 */
function TraceSpanCardHeader(props: TraceSpanCardHeaderProps) {
  return (
    <div>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-1 text-xs font-bold">
          <div>
            {props.configuration.isAggregatedSpan
              ? `AGGREGATED ${props.configuration.traceLabels.spanLabelUpper}`
              : props.configuration.traceLabels.spanLabelUpper}
          </div>
          <TraceSpanNameBadge
            traceGraph={props.traceGraph}
            spanRef={props.configuration.span.spanRef}
            span={props.configuration.span}
            colorScheme={props.colorScheme}
            interactive={props.interactive}
            onSpanClick={props.onSpanClick}
            onSpanDoubleClick={props.onSpanDoubleClick}
            style={props.badgeStyle}
          />
          {props.configuration.aggregateParticipantsLabel && (
            <span className="font-normal text-muted-foreground">
              {props.configuration.aggregateParticipantsLabel}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs font-normal">
          <div>
            <span className="text-muted-foreground">
              {props.configuration.traceLabels.processLabelUpper}{' '}
            </span>
            <span className="text-foreground">{props.configuration.processName}</span>
          </div>
          <div>
            <span className="text-muted-foreground">
              {props.configuration.traceLabels.threadLabelUpper}{' '}
            </span>
            <span className="text-foreground">{props.configuration.streamLabel}</span>
          </div>
          {props.configuration.externalSpanId ? (
            <div className="min-w-0">
              <span className="text-muted-foreground">ID </span>
              <span className="text-foreground">
                <TraceSpanExternalSpanIdValue value={props.configuration.externalSpanId} />
              </span>
            </div>
          ) : null}
          {props.configuration.spanSource ? (
            <div className="min-w-0">
              <span className="text-muted-foreground">SOURCE </span>
              <span className="text-foreground">{props.configuration.spanSource}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Props for the compact summary row beneath the card header.
 */
type TraceSpanCardSummaryProps = {
  /** Prepared card configuration containing the active timing and labels. */
  configuration: TraceSpanCardConfiguration;
  /** Optional timezone used for wall-clock formatting. */
  timezone?: string;
};

/**
 * Render the compact timing summary shown above the tab content.
 */
function TraceSpanCardSummary(props: TraceSpanCardSummaryProps) {
  const containerClass = 'flex flex-wrap items-center gap-2 text-xs text-muted-foreground';

  if (props.configuration.isAggregatedSpan) {
    const aggregatedDurationSummary = props.configuration.aggregatedDurationSummary;
    return (
      <div className={containerClass}>
        {aggregatedDurationSummary?.envelopeTiming ? (
          <TraceSpanDurationSummaryMetric
            label="Envelope duration"
            timing={aggregatedDurationSummary.envelopeTiming}
          />
        ) : null}
        {aggregatedDurationSummary?.representativeTiming &&
        aggregatedDurationSummary.representativeTimingKey ? (
          <TraceSpanDurationSummaryMetric
            label={`${formatTraceSpanTimingMetricLabel(aggregatedDurationSummary.representativeTimingKey)} duration`}
            timing={aggregatedDurationSummary.representativeTiming}
          />
        ) : null}
        <span>
          Start Time:{' '}
          <span className="text-foreground">
            {formatTimeMs(props.configuration.relativeStartTimeMs, {
              space: false,
              roundDigits: 3
            })}
          </span>
        </span>
        <span className="text-foreground">{props.configuration.activeTimingKey}</span>
        <span>{formatTS(props.configuration.blockTiming.startTimeMs, props.timezone)}</span>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <span>{props.configuration.activeTimingKey}</span>
      <b className="font-bold text-foreground">
        {props.configuration.blockTiming.durationMsAsString}
      </b>
      <span>
        start{' '}
        <b className="font-bold text-foreground">
          {formatTimeMs(props.configuration.relativeStartTimeMs, {
            space: false,
            roundDigits: 3
          })}
        </b>
      </span>
      <span>
        {formatTS(new Date(props.configuration.blockTiming.startTimeMs), props.timezone, 3)}
      </span>
    </div>
  );
}

/**
 * Render one labeled duration metric in the aggregated span summary.
 */
function TraceSpanDurationSummaryMetric(props: {
  /** Visible metric label preceding the duration value. */
  label: string;
  /** Timing whose duration should be displayed. */
  timing: TraceSpanCardConfiguration['blockTiming'];
}) {
  return (
    <span>
      {props.label}:{' '}
      <span className="text-foreground">
        {props.timing.durationMsAsString ||
          formatTimeMs(props.timing.durationMs, {space: false, roundDigits: 3})}
      </span>
    </span>
  );
}

/**
 * Props for the cross-rank communication metadata section.
 */
type TraceSpanCrossRankSectionProps = {
  /** Prepared card configuration for the current block. */
  configuration: TraceSpanCardConfiguration;
};

/**
 * Render the communication metadata shown with the cross-rank table.
 */
function TraceSpanCrossRankSection(props: TraceSpanCrossRankSectionProps): ReactNode {
  const {configuration} = props;

  if (!configuration.hasCommBytes && !configuration.operation) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {configuration.hasCommBytes ? (
        <TraceSpanCommPill
          traceLabels={configuration.traceLabels}
          operation={configuration.operation}
          processCount={configuration.endpointsWithDeps.length + 1}
          durationMs={configuration.blockTiming.durationMs}
          recvBytes={
            typeof configuration.recvBytes === 'number' && configuration.recvBytes >= 0
              ? configuration.recvBytes
              : null
          }
          sendBytes={
            typeof configuration.sendBytes === 'number' && configuration.sendBytes >= 0
              ? configuration.sendBytes
              : null
          }
        />
      ) : (
        <>
          <Badge variant="outline" className="my-px rounded-xl py-px text-foreground">
            COMM OP &nbsp;<b>{configuration.operation}</b>&nbsp;
          </Badge>
          {configuration.endpointsWithDeps.length > 0 && (
            <Badge variant="outline" className="my-px rounded-xl py-px text-foreground">
              # {configuration.traceLabels.processLabelPlural}:{' '}
              <b>{configuration.endpointsWithDeps.length + 1}</b>
            </Badge>
          )}
          {configuration.topology && (
            <Badge variant="outline" className="my-px rounded-xl py-px text-foreground">
              <b>{configuration.topology}</b>&nbsp;
            </Badge>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Props for the interactive tab strip.
 */
type TraceSpanCardTabsProps = {
  /** Ordered tab definitions currently available for the card. */
  tabs: TraceSpanCardTabDefinition[];
  /** Currently selected interactive tab. */
  selectedTab: TraceSpanCardTabId | null;
  /** Callback when the selected interactive tab changes. */
  onTabChange: (tab: TraceSpanCardTabId) => void;
};

/**
 * Render the interactive tab strip when more than one tab is available.
 */
function TraceSpanCardTabs(props: TraceSpanCardTabsProps) {
  if (props.tabs.length <= 1 || !props.selectedTab) {
    return null;
  }

  return (
    <Tabs value={props.selectedTab} onValueChange={value => props.onTabChange(value)}>
      <TabsList
        className="inline-flex w-full flex-wrap justify-center gap-1 rounded-md border border-white/10 bg-white/5 px-1 py-0.5"
        role="tablist"
      >
        {props.tabs.map(tab => {
          const isSelectedTab = tab.id === props.selectedTab;

          return (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              aria-selected={isSelectedTab}
              className={`rounded-sm border px-2.5 py-0.5 text-xs font-medium leading-5 transition-colors ${
                isSelectedTab
                  ? 'border-border bg-background text-foreground shadow-sm ring-1 ring-border'
                  : 'border-transparent bg-white/5 text-muted-foreground hover:bg-white/7 hover:text-foreground'
              }`}
              data-state={isSelectedTab ? 'active' : 'inactive'}
              onClick={() => props.onTabChange(tab.id)}
              role="tab"
            >
              {tab.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

type TraceSpanCombinedDependencySectionProps = {
  /** Visible section title shown above one dependency table. */
  title: string;
  /** Section body rendered below the heading row. */
  children: ReactNode;
};

/**
 * Render one labeled section inside the combined All tab.
 */
function TraceSpanCombinedDependencySection(
  props: TraceSpanCombinedDependencySectionProps
): ReactNode {
  return (
    <section className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">{props.title}</div>
      {props.children}
    </section>
  );
}

/**
 * Shared parameters for building dependency tab props.
 */
type TraceSpanDependencyTabPropsBuilderParams = {
  /** Prepared card configuration for the current block. */
  configuration: TraceSpanCardConfiguration;
  /** Dependency rows to render for the current visibility mode. */
  dependencies: TraceSpanCardConfiguration['inDependencies'];
  /** Directional peer span rendered by each dependency row. */
  direction: 'incoming' | 'outgoing';
  /** Filtered graph wrapper used by the dependency table. */
  traceGraph: Readonly<TraceGraph>;
  /** Parent-chain rows visible in the table. */
  parentChain: readonly TraceSpanCardParentChainEntry[];
  /** Whether the dependency table should be interactive. */
  interactive?: boolean;
  /** Leading metric columns rendered by dependency-style tables. */
  dependencyMetricColumns: readonly TraceSpanDependencyMetricColumn[];
  /** Optional filtered-span selector rendered in the span column header. */
  spanVisibilityControl?: TraceSpanTableSpanVisibilityControl | null;
  /** Optional label enabling one compact row filter above the dependency table. */
  filterLabel?: string | null;
  /** Callback used to compute dependency badge styles. */
  getDependencyBadgeStyle: (dependencySpan: TraceCardSpan) => CSSProperties;
  /** Callback used to compute the leading metric cells for dependency rows. */
  getDependencyMetricValues: (params: TraceSpanDependencyMetricValueParams) => string[];
  /** Active trace style for dependency badges. */
  traceStyle: TraceStyle;
  /** Callback when a dependency-target span is clicked. */
  onSpanClick?: (spanRef: SpanRef) => void;
  /** Callback when a dependency-target span is double-clicked. */
  onSpanDoubleClick?: (spanRef: SpanRef, action: TraceSpanDoubleClickAction) => void;
  /** Callback when dependency hover should highlight exact span refs. */
  onBlockHover?: (spanRef: SpanRef | null) => void;
};

type TraceSpanChildrenResultLoaderParams = {
  /** Whether filtered spans should be included in descendants. */
  includeHidden: boolean;
};

type TraceSpanChildrenResultLoader = (
  params: TraceSpanChildrenResultLoaderParams
) => TraceSpanCardDescendantResult;

/**
 * Parameters for computing the leading dependency-table metric cell.
 */
type TraceSpanDependencyMetricValueParams = {
  /** Span whose duration or dependency wait should be shown. */
  span: TraceCardSpan;
  /** Dependency associated with the row, when the row represents an edge. */
  dependency: TraceDependency | null;
  /** Logical row kind used to choose the metric source. */
  rowKind: 'dependency' | 'parent' | 'child';
};

/**
 * Parameters for creating the complete tab registry for one card render.
 */
type TraceSpanTabDefinitionFactoryParams = {
  /** Prepared card configuration for the current block. */
  configuration: TraceSpanCardConfiguration;
  /** Filtered graph wrapper used by the dependency and child tabs. */
  traceGraph: Readonly<TraceGraph>;
  /** Whether the card should render interactive dependency tables. */
  interactive?: boolean;
  /** Leading metric columns rendered by dependency-style tables. */
  dependencyMetricColumns: readonly TraceSpanDependencyMetricColumn[];
  /** Callback used to compute dependency badge styles. */
  getDependencyBadgeStyle: (dependencySpan: TraceCardSpan) => CSSProperties;
  /** Callback used to compute the leading metric cells for dependency rows. */
  getDependencyMetricValues: (params: TraceSpanDependencyMetricValueParams) => string[];
  /** Active trace style for dependency badges. */
  traceStyle: TraceStyle;
  /** Whether to include hidden parent rows in the parents tab. */
  showHiddenParents: boolean;
  /** Whether to include hidden child rows in the children tab. */
  showHiddenChildren: boolean;
  /** Whether to include hidden outgoing rows in the outgoing dependency tab. */
  showHiddenOutgoingDependencies: boolean;
  /** Callback when the parents hidden-rows toggle changes. */
  onShowHiddenParentsChange: (showHidden: boolean) => void;
  /** Callback when the children hidden-rows toggle changes. */
  onShowHiddenChildrenChange: (showHidden: boolean) => void;
  /** Callback when the outgoing hidden-rows toggle changes. */
  onShowHiddenOutgoingDependenciesChange: (showHidden: boolean) => void;
  /** Callback used to resolve descendants for the current block. */
  getTraceSpanDescendants: TraceSpanChildrenResultLoader;
  /** Callback when a dependency-target span is clicked. */
  onSpanClick?: (spanRef: SpanRef) => void;
  /** Callback when a dependency-target span is double-clicked. */
  onSpanDoubleClick?: (spanRef: SpanRef, action: TraceSpanDoubleClickAction) => void;
  /** Callback when dependency hover should highlight exact span refs. */
  onBlockHover?: (spanRef: SpanRef | null) => void;
  /** Callback when a rank in the cross-rank tab is clicked. */
  onRankClick?: (rankNum: number) => void;
  /** Callback when cross-rank navigation requests a target block. */
  onNavigateToBlock?: (spanId: TraceSpanId, rankNum: number) => void;
  /** Optional rank query statuses used by the cross-rank tab. */
  rankQueryStatusMap?: Readonly<Record<string, QueryStatus | undefined>>;
  /** Optional caller-owned traversal controls rendered in a Traversal tab. */
  traversalContent?: ReactNode;
  /** Optional caller-owned tabs rendered after built-in tabs. */
  customTabs?: readonly TraceSpanCardCustomTab[];
  /** Resolved tab-body height shared across all interactive tab panes. */
  tabBodyHeightPx: number;
};

/**
 * Props for the shared fixed-height tab-body wrapper.
 */
type TraceSpanCardTabBodyProps = {
  /** Exact tab-body height in pixels. */
  heightPx: number;
  /** Optional extra classes applied to the tab wrapper. */
  className?: string;
  /** Tab content rendered inside the fixed-height wrapper. */
  children: ReactNode;
};

/**
 * One tab entry in the card-local tab registry.
 */
type TraceSpanCardTabDefinition = {
  /** Stable tab id. */
  id: TraceSpanCardTabId;
  /** Visible tab label. */
  label: string;
  /** Whether the tab is currently available. */
  isAvailable: boolean;
  /** Render function for the tab body or non-interactive fallback. */
  render: () => ReactNode;
};

/**
 * Render the shared fixed-height wrapper used by interactive TraceSpanCard tabs.
 */
function TraceSpanCardTabBody(props: TraceSpanCardTabBodyProps): ReactNode {
  return (
    <div
      data-testid="trace-span-card-tab-body"
      className={props.className ? `overflow-hidden ${props.className}` : 'overflow-hidden'}
      style={{height: `${props.heightPx}px`}}
    >
      {props.children}
    </div>
  );
}

/**
 * Build the local dependency tab props for one of the two parent/dependency surfaces.
 */
function getTraceSpanDependencyTabProps(
  params: TraceSpanDependencyTabPropsBuilderParams
): ComponentProps<typeof TraceSpanDependenciesTab> {
  const onDependencyClick = (targetSpanRef: SpanRef) => params.onSpanClick?.(targetSpanRef);

  return {
    dependencies: params.dependencies,
    direction: params.direction,
    currentSpan: params.configuration.span,
    parentChain: params.parentChain,
    parentIndexBySpanId: params.configuration.parentIndexBySpanId,
    metricColumns: params.dependencyMetricColumns,
    spanVisibilityControl: params.spanVisibilityControl,
    filterLabel: params.filterLabel,
    getMetricValues: metricParams =>
      params.getDependencyMetricValues({
        span: metricParams.span,
        dependency: metricParams.dependency,
        rowKind: metricParams.rowKind
      }),
    getDependencyBadgeStyle: params.getDependencyBadgeStyle,
    interactive: params.interactive,
    onSpanClick: params.onSpanClick,
    onSpanDoubleClick: params.onSpanDoubleClick,
    onBlockHover: params.onBlockHover,
    onDependencyClick,
    traceLabels: params.configuration.traceLabels,
    traceStyle: params.traceStyle
  };
}

/**
 * Build the optional filtered-span selector state for one dependency-style table.
 */
function getTraceSpanTableSpanVisibilityControl(params: {
  /** Whether the surrounding card should render interactive controls. */
  interactive?: boolean;
  /** Whether filtered spans are currently included in the table rows. */
  showHiddenSpans: boolean;
  /** Callback fired when the table visibility selector changes. */
  onShowHiddenSpansChange: (showHiddenSpans: boolean) => void;
}): TraceSpanTableSpanVisibilityControl | null {
  return params.interactive
    ? {
        showHiddenSpans: params.showHiddenSpans,
        onShowHiddenSpansChange: params.onShowHiddenSpansChange
      }
    : null;
}

/**
 * Build the tab registry used for both the interactive tab strip and the fallback rendering path.
 */
function createTraceSpanTabDefinitions(
  params: TraceSpanTabDefinitionFactoryParams
): TraceSpanCardTabDefinition[] {
  const parentSpanVisibilityControl = getTraceSpanTableSpanVisibilityControl({
    interactive: params.interactive,
    showHiddenSpans: params.showHiddenParents,
    onShowHiddenSpansChange: params.onShowHiddenParentsChange
  });
  const outgoingSpanVisibilityControl = getTraceSpanTableSpanVisibilityControl({
    interactive: params.interactive,
    showHiddenSpans: params.showHiddenOutgoingDependencies,
    onShowHiddenSpansChange: params.onShowHiddenOutgoingDependenciesChange
  });
  const childSpanVisibilityControl = getTraceSpanTableSpanVisibilityControl({
    interactive: params.interactive,
    showHiddenSpans: params.showHiddenChildren,
    onShowHiddenSpansChange: params.onShowHiddenChildrenChange
  });
  const parentFilterLabel =
    params.interactive && params.configuration.tabOptions.dependencyLabel === 'Parents'
      ? getTraceSpanTableFilterLabel(params.configuration.tabOptions.dependencyLabel)
      : null;
  const visibleDependencyTabProps = getTraceSpanDependencyTabProps({
    configuration: params.configuration,
    dependencies: params.configuration.inDependencies,
    direction: 'incoming',
    parentChain: params.configuration.visibleParentChain,
    traceGraph: params.traceGraph,
    interactive: params.interactive,
    dependencyMetricColumns: params.dependencyMetricColumns,
    spanVisibilityControl: parentSpanVisibilityControl,
    filterLabel: parentFilterLabel,
    getDependencyBadgeStyle: params.getDependencyBadgeStyle,
    getDependencyMetricValues: params.getDependencyMetricValues,
    traceStyle: params.traceStyle,
    onSpanClick: params.onSpanClick,
    onSpanDoubleClick: params.onSpanDoubleClick,
    onBlockHover: params.onBlockHover
  });
  const fullDependencyTabProps = getTraceSpanDependencyTabProps({
    configuration: params.configuration,
    dependencies: params.configuration.fullInDependencies,
    direction: 'incoming',
    parentChain: params.configuration.fullParentChain,
    traceGraph: params.traceGraph,
    interactive: params.interactive,
    dependencyMetricColumns: params.dependencyMetricColumns,
    spanVisibilityControl: parentSpanVisibilityControl,
    filterLabel: parentFilterLabel,
    getDependencyBadgeStyle: params.getDependencyBadgeStyle,
    getDependencyMetricValues: params.getDependencyMetricValues,
    traceStyle: params.traceStyle,
    onSpanClick: params.onSpanClick,
    onSpanDoubleClick: params.onSpanDoubleClick,
    onBlockHover: params.onBlockHover
  });
  const visibleOutgoingDependencyTabProps = getTraceSpanDependencyTabProps({
    configuration: params.configuration,
    dependencies: params.configuration.outDependencies,
    direction: 'outgoing',
    parentChain: [],
    traceGraph: params.traceGraph,
    interactive: params.interactive,
    dependencyMetricColumns: params.dependencyMetricColumns,
    spanVisibilityControl: outgoingSpanVisibilityControl,
    getDependencyBadgeStyle: params.getDependencyBadgeStyle,
    getDependencyMetricValues: params.getDependencyMetricValues,
    traceStyle: params.traceStyle,
    onSpanClick: params.onSpanClick,
    onSpanDoubleClick: params.onSpanDoubleClick,
    onBlockHover: params.onBlockHover
  });
  const fullOutgoingDependencyTabProps = getTraceSpanDependencyTabProps({
    configuration: params.configuration,
    dependencies: params.configuration.fullOutDependencies,
    direction: 'outgoing',
    parentChain: [],
    traceGraph: params.traceGraph,
    interactive: params.interactive,
    dependencyMetricColumns: params.dependencyMetricColumns,
    spanVisibilityControl: outgoingSpanVisibilityControl,
    getDependencyBadgeStyle: params.getDependencyBadgeStyle,
    getDependencyMetricValues: params.getDependencyMetricValues,
    traceStyle: params.traceStyle,
    onSpanClick: params.onSpanClick,
    onSpanDoubleClick: params.onSpanDoubleClick,
    onBlockHover: params.onBlockHover
  });

  const builtInTabs: TraceSpanCardTabDefinition[] = [
    {
      id: 'all',
      label: getTraceSpanTabLabel(params.configuration, 'all'),
      isAvailable: params.configuration.tabAvailability['all'],
      render: () => {
        const descendants = params.getTraceSpanDescendants({
          includeHidden: params.showHiddenChildren
        });
        return (
          <TraceSpanCardTabBody
            heightPx={params.tabBodyHeightPx}
            className="space-y-3 overflow-y-auto"
          >
            <TraceSpanCombinedDependencySection
              title={params.configuration.tabOptions.dependencyLabel}
            >
              {params.configuration.hasDependencyTab ? (
                <TraceSpanDependenciesTab
                  {...(params.showHiddenParents
                    ? fullDependencyTabProps
                    : visibleDependencyTabProps)}
                  scrollable={false}
                />
              ) : (
                <div className="text-xs text-blue-400">
                  {params.configuration.traceLabels.spanLabel} has no parents
                </div>
              )}
            </TraceSpanCombinedDependencySection>
            <TraceSpanCombinedDependencySection title={TRACE_BLOCK_CARD_TAB_LABELS['children']}>
              {descendants.entries.length > 0 ? (
                <TraceSpanChildrenTab
                  descendants={descendants}
                  currentSpan={params.configuration.span}
                  metricColumns={params.dependencyMetricColumns}
                  spanVisibilityControl={childSpanVisibilityControl}
                  getMetricValues={metricParams =>
                    params.getDependencyMetricValues({
                      span: metricParams.span,
                      dependency: metricParams.dependency,
                      rowKind: 'child'
                    })
                  }
                  getDependencyBadgeStyle={params.getDependencyBadgeStyle}
                  onSpanClick={params.onSpanClick}
                  onSpanDoubleClick={params.onSpanDoubleClick}
                  onBlockHover={params.onBlockHover}
                  traceLabels={params.configuration.traceLabels}
                  traceStyle={params.traceStyle}
                  scrollable={false}
                />
              ) : (
                <div className="text-xs text-blue-400">
                  {params.configuration.traceLabels.spanLabel} has no children
                </div>
              )}
            </TraceSpanCombinedDependencySection>
          </TraceSpanCardTabBody>
        );
      }
    },
    {
      id: 'dependencies',
      label: getTraceSpanTabLabel(params.configuration, 'dependencies'),
      isAvailable: params.configuration.tabAvailability['dependencies'],
      render: () =>
        params.configuration.hasDependencyTab ? (
          <TraceSpanCardTabBody heightPx={params.tabBodyHeightPx} className="flex flex-col">
            <TraceSpanDependenciesTab
              {...(params.showHiddenParents ? fullDependencyTabProps : visibleDependencyTabProps)}
            />
          </TraceSpanCardTabBody>
        ) : (
          renderTraceSpanTabEmptyState(
            `${params.configuration.traceLabels.spanLabel} has no parents`,
            params.tabBodyHeightPx
          )
        )
    },
    {
      id: 'outgoing-dependencies',
      label: getTraceSpanTabLabel(params.configuration, 'outgoing-dependencies'),
      isAvailable: params.configuration.tabAvailability['outgoing-dependencies'],
      render: () =>
        params.configuration.hasOutgoingDependencyTab ? (
          <TraceSpanCardTabBody heightPx={params.tabBodyHeightPx} className="flex flex-col">
            <TraceSpanDependenciesTab
              {...(params.showHiddenOutgoingDependencies
                ? fullOutgoingDependencyTabProps
                : visibleOutgoingDependencyTabProps)}
            />
          </TraceSpanCardTabBody>
        ) : (
          renderTraceSpanTabEmptyState(
            `${params.configuration.traceLabels.spanLabel} has no outgoing dependencies`,
            params.tabBodyHeightPx
          )
        )
    },
    {
      id: 'cross-rank',
      label: getTraceSpanTabLabel(params.configuration, 'cross-rank'),
      isAvailable: params.configuration.tabAvailability['cross-rank'],
      render: () => (
        <TraceSpanCardTabBody
          heightPx={params.tabBodyHeightPx}
          className="space-y-2 overflow-y-auto"
        >
          <TraceSpanCrossRankSection configuration={params.configuration} />
          {params.configuration.endpointsWithDeps.length > 0 ? (
            <TraceSpanCrossDependenciesHorizontal
              endpointsWithDeps={params.configuration.endpointsWithDeps}
              maxRanks={6}
              onRankClick={params.onRankClick}
              onNavigateToBlock={params.onNavigateToBlock}
              interactive={params.interactive}
              rankQueryStatusMap={params.rankQueryStatusMap}
              currentSpanId={params.configuration.span.spanId}
              traceLabels={params.configuration.traceLabels}
            />
          ) : (
            <div className={TRACE_BLOCK_CARD_EMPTY_TAB_CLASS}>
              {params.configuration.traceLabels.spanLabel} has no cross-rank endpoints
            </div>
          )}
        </TraceSpanCardTabBody>
      )
    },
    {
      id: 'traversal',
      label: getTraceSpanTabLabel(params.configuration, 'traversal'),
      isAvailable: params.configuration.tabAvailability['traversal'],
      render: () =>
        params.traversalContent ? (
          // The traversal tab is a caller-owned slot so OSS Tracevis can host domain-specific
          // controls without depending on any particular trace backend or API client.
          <TraceSpanCardTabBody
            heightPx={params.tabBodyHeightPx}
            className="flex flex-col overflow-hidden"
          >
            {params.traversalContent}
          </TraceSpanCardTabBody>
        ) : (
          renderTraceSpanTabEmptyState(
            `${params.configuration.traceLabels.spanLabel} has no traversal controls`,
            params.tabBodyHeightPx
          )
        )
    },
    {
      id: 'children',
      label: getTraceSpanTabLabel(params.configuration, 'children'),
      isAvailable: params.configuration.tabAvailability['children'],
      render: () => {
        const descendants = params.getTraceSpanDescendants({
          includeHidden: params.showHiddenChildren
        });
        return descendants.entries.length > 0 ? (
          <TraceSpanCardTabBody heightPx={params.tabBodyHeightPx} className="flex flex-col">
            <TraceSpanChildrenTab
              descendants={descendants}
              currentSpan={params.configuration.span}
              metricColumns={params.dependencyMetricColumns}
              spanVisibilityControl={childSpanVisibilityControl}
              getMetricValues={metricParams =>
                params.getDependencyMetricValues({
                  span: metricParams.span,
                  dependency: metricParams.dependency,
                  rowKind: 'child'
                })
              }
              getDependencyBadgeStyle={params.getDependencyBadgeStyle}
              onSpanClick={params.onSpanClick}
              onSpanDoubleClick={params.onSpanDoubleClick}
              onBlockHover={params.onBlockHover}
              traceLabels={params.configuration.traceLabels}
              traceStyle={params.traceStyle}
            />
          </TraceSpanCardTabBody>
        ) : (
          renderTraceSpanTabEmptyState(
            `${params.configuration.traceLabels.spanLabel} has no children`,
            params.tabBodyHeightPx
          )
        );
      }
    },
    {
      id: 'histogram',
      label: getTraceSpanTabLabel(params.configuration, 'histogram'),
      isAvailable: params.configuration.tabAvailability['histogram'],
      render: () =>
        params.configuration.histogramSpecs.length > 0 ? (
          <TraceSpanCardTabBody heightPx={params.tabBodyHeightPx}>
            <TraceSpanHistogramsTab
              histograms={params.configuration.histogramSpecs}
              interactive={params.interactive}
            />
          </TraceSpanCardTabBody>
        ) : (
          renderTraceSpanTabEmptyState(
            `${params.configuration.traceLabels.spanLabel} has no histogram data`,
            params.tabBodyHeightPx
          )
        )
    },
    {
      id: 'timings',
      label: getTraceSpanTabLabel(params.configuration, 'timings'),
      isAvailable: params.configuration.tabAvailability['timings'],
      render: () =>
        params.configuration.spanTimings ? (
          <TraceSpanCardTabBody heightPx={params.tabBodyHeightPx}>
            <TraceSpanTimingsTab
              timings={params.configuration.spanTimings}
              highlightedColumnIndexes={
                params.configuration.highlightedTimingColumnIndex >= 0
                  ? [params.configuration.highlightedTimingColumnIndex]
                  : undefined
              }
            />
          </TraceSpanCardTabBody>
        ) : (
          renderTraceSpanTabEmptyState(
            params.configuration.tabOptions.timingsEmptyMessage ||
              `${params.configuration.traceLabels.spanLabel} has no aggregated timings`,
            params.tabBodyHeightPx
          )
        )
    },
    {
      id: 'span-data',
      label: getTraceSpanTabLabel(params.configuration, 'span-data'),
      isAvailable: params.configuration.tabAvailability['span-data'],
      render: () =>
        params.configuration.userDataRows.length > 0 ? (
          <TraceSpanCardTabBody heightPx={params.tabBodyHeightPx}>
            <TraceSpanSpanDataTab rows={params.configuration.userDataRows} />
          </TraceSpanCardTabBody>
        ) : (
          renderTraceSpanTabEmptyState(
            `${params.configuration.traceLabels.spanLabel} has no span data`,
            params.tabBodyHeightPx
          )
        )
    }
  ];

  // Keep the combined dependency surface hidden so app-level custom tabs keep the inspector compact.
  const visibleBuiltInTabs = builtInTabs.filter(tab => tab.id !== 'all');

  const customTabDefinitions = (params.customTabs ?? []).map(tab => ({
    id: tab.id,
    label: tab.label,
    isAvailable: tab.isAvailable ?? true,
    render: () => (
      <TraceSpanCardTabBody
        heightPx={params.tabBodyHeightPx}
        className="flex flex-col overflow-hidden"
      >
        {tab.content}
      </TraceSpanCardTabBody>
    )
  }));

  return insertTraceSpanCustomTabDefinitions({
    builtInTabs: visibleBuiltInTabs,
    customTabs: params.customTabs,
    customTabDefinitions
  });
}

/**
 * Inserts available caller-owned tab ids at their requested positions in the built-in tab order.
 */
function insertTraceSpanCustomTabIds(params: {
  /** Built-in tab ids already filtered for visibility. */
  builtInTabIds: readonly TraceSpanCardTabId[];
  /** Caller-owned tabs that may request an insertion point. */
  customTabs?: readonly TraceSpanCardCustomTab[];
}): TraceSpanCardTabId[] {
  const tabIds = [...params.builtInTabIds];
  for (const customTab of params.customTabs ?? []) {
    if (customTab.isAvailable === false) {
      continue;
    }
    insertTraceSpanCustomTabItem({
      items: tabIds,
      item: customTab.id,
      insertBeforeTabId: customTab.insertBeforeTabId,
      getId: tabId => tabId
    });
  }
  return tabIds;
}

/**
 * Inserts caller-owned tab definitions at their requested positions in the built-in tab order.
 */
function insertTraceSpanCustomTabDefinitions(params: {
  /** Built-in tab definitions already filtered for visibility. */
  builtInTabs: readonly TraceSpanCardTabDefinition[];
  /** Caller-owned tabs that may request an insertion point. */
  customTabs?: readonly TraceSpanCardCustomTab[];
  /** Renderable tab definitions derived from `customTabs` in matching order. */
  customTabDefinitions: readonly TraceSpanCardTabDefinition[];
}): TraceSpanCardTabDefinition[] {
  const tabDefinitions = [...params.builtInTabs];
  for (const [index, customTabDefinition] of params.customTabDefinitions.entries()) {
    const customTab = params.customTabs?.[index];
    insertTraceSpanCustomTabItem({
      items: tabDefinitions,
      item: customTabDefinition,
      insertBeforeTabId: customTab?.insertBeforeTabId,
      getId: definition => definition.id
    });
  }
  return tabDefinitions;
}

/**
 * Inserts one custom tab item before its requested tab id, or appends it when no target exists.
 */
function insertTraceSpanCustomTabItem<T>(params: {
  /** Mutable tab item list being assembled for render order. */
  items: T[];
  /** Item to insert into the tab list. */
  item: T;
  /** Optional tab id before which the item should be inserted. */
  insertBeforeTabId: TraceSpanCardTabId | undefined;
  /** Returns the stable tab id for one existing item. */
  getId: (item: T) => TraceSpanCardTabId;
}): void {
  const insertIndex = params.insertBeforeTabId
    ? params.items.findIndex(item => params.getId(item) === params.insertBeforeTabId)
    : -1;
  if (insertIndex === -1) {
    params.items.push(params.item);
    return;
  }
  params.items.splice(insertIndex, 0, params.item);
}

/**
 * Resolve the visible tab label, including caller-provided dependency tab overrides.
 */
function getTraceSpanTabLabel(
  configuration: TraceSpanCardConfiguration,
  tab: TraceSpanCardTab
): string {
  if (tab === 'dependencies') {
    return configuration.tabOptions.dependencyLabel;
  }
  if (tab === 'outgoing-dependencies') {
    return configuration.tabOptions.outgoingDependencyLabel;
  }
  return TRACE_BLOCK_CARD_TAB_LABELS[tab];
}

/**
 * Builds one accessible filter label from a visible table tab label.
 */
function getTraceSpanTableFilterLabel(tabLabel: string): string {
  return `Filter ${tabLabel.toLowerCase()}`;
}

/**
 * Render a standard empty-state panel for one interactive tab body.
 */
function renderTraceSpanTabEmptyState(message: string, tabBodyHeightPx: number): ReactNode {
  return (
    <TraceSpanCardTabBody heightPx={tabBodyHeightPx} className={TRACE_BLOCK_CARD_EMPTY_TAB_CLASS}>
      {message}
    </TraceSpanCardTabBody>
  );
}

/**
 * Compute the leading dependency-table metric texts for one row.
 */
function getTraceSpanDependencyMetricValues(params: {
  /** Span whose duration or dependency wait should be shown. */
  span: TraceCardSpan;
  /** Dependency associated with the row, when the row represents an edge. */
  dependency: TraceDependency | null;
  /** Logical row kind used to choose the metric source. */
  rowKind: 'dependency' | 'parent' | 'child';
  /** Leading metric columns requested by the owning dependency table. */
  metricColumns: readonly TraceSpanDependencyMetricColumn[];
  /** Active timing key used for duration-based rows. */
  activeTimingKey: string;
}): string[] {
  return params.metricColumns.map(column => {
    if (column.metric === 'duration') {
      return getTraceSpanDurationLabel({
        span: params.span,
        timingKey: column.timingKey,
        activeTimingKey: params.activeTimingKey,
        fallbackToActiveTiming: column.fallbackToActiveTiming
      });
    }
    if (params.rowKind === 'parent' || !params.dependency) {
      return '-';
    }
    return formatTimeMs(Math.abs(getDependencyDurationMs(params.dependency)), {
      space: false,
      roundDigits: 3
    });
  });
}

/**
 * Format a block duration using the requested timing fallback chain.
 */
function getTraceSpanDurationLabel(params: {
  /** Span whose duration should be formatted. */
  span: TraceCardSpan;
  /** Preferred timing key for the duration lookup, or null to use no preferred timing. */
  timingKey: string | null;
  /** Active timing key selected by the owning trace view. */
  activeTimingKey: string;
  /** Whether missing preferred timings may fall back to the active or primary timing. */
  fallbackToActiveTiming: boolean;
}): string {
  const timing =
    (params.timingKey ? params.span.timings[params.timingKey] : null) ??
    (params.fallbackToActiveTiming
      ? (params.span.timings[params.activeTimingKey] ??
        params.span.timings[params.span.primaryTimingKey])
      : null);
  if (!timing) {
    return '-';
  }
  return (
    timing.durationMsAsString || formatTimeMs(timing.durationMs, {space: false, roundDigits: 3})
  );
}

/**
 * Parameters for resolving duration-column selections against available timing keys.
 */
type ResolveTraceSpanDependencyDurationTimingKeysParams = {
  /** Timing keys currently selected by the two duration columns. */
  currentTimingKeys: readonly [string, string];
  /** Default timing keys derived from the selected span. */
  defaultTimingKeys: readonly [string, string];
  /** Timing keys available on the selected span. */
  availableTimingKeys: readonly string[];
};

/**
 * Parameters for building dependency-table metric columns.
 */
type TraceSpanDependencyMetricColumnsParams = {
  /** Active dependency metric mode chosen by the owning view. */
  dependencyMetric: NonNullable<TraceSpanCardTabOptions['dependencyMetric']>;
  /** Timing keys selected by the two duration columns. */
  selectedDurationTimingKeys: readonly [string, string];
  /** Timing keys available to the duration-column pickers. */
  durationTimingOptions: readonly string[];
  /** Whether interactive timing pickers should be shown. */
  interactive: boolean;
  /** Callback fired when one duration-column timing key changes. */
  onDurationTimingKeyChange: (columnIndex: 0 | 1, timingKey: string) => void;
};

/**
 * Keep duration-column selections when they remain meaningful for the next selected span.
 */
function resolveTraceSpanDependencyDurationTimingKeys(
  params: ResolveTraceSpanDependencyDurationTimingKeysParams
): readonly [string, string] {
  const availableTimingKeys = new Set(params.availableTimingKeys);
  const currentTimingKeysRemainAvailable = params.currentTimingKeys.every(timingKey =>
    availableTimingKeys.has(timingKey)
  );
  return currentTimingKeysRemainAvailable ? params.currentTimingKeys : params.defaultTimingKeys;
}

/**
 * Build dependency-table metric columns for the active wait or duration mode.
 */
function getTraceSpanDependencyMetricColumns(
  params: TraceSpanDependencyMetricColumnsParams
): readonly TraceSpanDependencyMetricColumn[] {
  if (params.dependencyMetric === 'wait') {
    return [
      {
        id: 'wait',
        label: 'Wait',
        metric: 'wait',
        timingKey: null,
        timingOptions: [],
        timingPickerAriaLabel: null,
        fallbackToActiveTiming: false
      }
    ];
  }

  return [getTraceSpanDurationMetricColumn(params, 0), getTraceSpanDurationMetricColumn(params, 1)];
}

/**
 * Build one selectable duration metric column.
 */
function getTraceSpanDurationMetricColumn(
  params: TraceSpanDependencyMetricColumnsParams,
  columnIndex: 0 | 1
): TraceSpanDependencyMetricColumn {
  const timingKey = params.selectedDurationTimingKeys[columnIndex];
  return {
    id: `duration-${columnIndex}`,
    label: formatTraceSpanTimingMetricLabel(timingKey),
    metric: 'duration',
    timingKey,
    timingOptions: getTraceSpanDurationTimingPickerOptions({
      timingKey,
      durationTimingOptions: params.durationTimingOptions
    }),
    timingPickerAriaLabel: params.interactive
      ? `${columnIndex === 0 ? 'First' : 'Second'} duration metric`
      : null,
    onTimingKeyChange: params.interactive
      ? (nextTimingKey: string) => params.onDurationTimingKeyChange(columnIndex, nextTimingKey)
      : undefined,
    fallbackToActiveTiming: timingKey === 'envelope'
  };
}

/**
 * Keep the selected duration timing visible in its picker even when it is absent on this span.
 */
function getTraceSpanDurationTimingPickerOptions(params: {
  /** Timing key selected for one duration column. */
  timingKey: string;
  /** Timing keys available on the selected span. */
  durationTimingOptions: readonly string[];
}): readonly string[] {
  return params.durationTimingOptions.includes(params.timingKey)
    ? params.durationTimingOptions
    : [params.timingKey, ...params.durationTimingOptions];
}

/**
 * Convert one timing key into the compact label used by duration summaries and column headers.
 */
function formatTraceSpanTimingMetricLabel(timingKey: string): string {
  return timingKey
    .split('_')
    .map(segment => {
      if (/^p\d+$/i.test(segment)) {
        return segment.toUpperCase();
      }
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(' ');
}

/**
 * Parameters for restoring the initial selected tab from local storage.
 */
type InitialTraceSpanTabSelectionParams = {
  /** Ordered tab definitions currently available for the card. */
  availableTabs: ReadonlyArray<TraceSpanCardTabId>;
  /** Fallback tab when no persisted selection is available. */
  defaultTab: TraceSpanCardTabId | null;
  /** Optional caller-selected tab restored ahead of localStorage state. */
  selectedTab?: TraceSpanCardTabId;
  /** Optional localStorage key used to restore the selected tab. */
  storageKey?: string;
};

type InitialTraceSpanTabSelectionResult = {
  /** Restored interactive tab. */
  selectedTab: TraceSpanCardTabId | null;
  /** Whether to show filtered spans in the parents tab after restoring state. */
  showHiddenParents: boolean;
};

/**
 * Parameters for persisting the selected tab into local storage.
 */
type PersistTraceSpanTabSelectionParams = {
  /** Currently selected interactive tab. */
  selectedTab: TraceSpanCardTabId | null;
  /** Optional localStorage key used to persist the selected tab. */
  storageKey?: string;
};

/**
 * Restore the initial selected tab from local storage when the stored tab is still available.
 */
function getInitialTraceSpanTabSelection(
  params: InitialTraceSpanTabSelectionParams
): InitialTraceSpanTabSelectionResult {
  if (params.selectedTab != null) {
    return {
      selectedTab: params.availableTabs.includes(params.selectedTab)
        ? params.selectedTab
        : params.defaultTab,
      showHiddenParents: true
    };
  }

  if (!params.storageKey || typeof window === 'undefined') {
    return {
      selectedTab: params.defaultTab,
      showHiddenParents: true
    };
  }

  try {
    const storedValue = window.localStorage.getItem(params.storageKey);
    if (storedValue === 'dependencies-all') {
      return {
        selectedTab: 'dependencies',
        showHiddenParents: true
      };
    }
    if (storedValue && params.availableTabs.includes(storedValue)) {
      return {
        selectedTab: storedValue,
        showHiddenParents: true
      };
    }
  } catch {
    return {
      selectedTab: params.defaultTab,
      showHiddenParents: true
    };
  }

  return {
    selectedTab: params.defaultTab,
    showHiddenParents: true
  };
}

/**
 * Persist the currently selected interactive tab into local storage.
 */
function persistTraceSpanTabSelection(params: PersistTraceSpanTabSelectionParams): void {
  if (!params.storageKey || !params.selectedTab || typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(params.storageKey, params.selectedTab);
  } catch {
    // Ignore storage failures so card rendering stays resilient in restricted environments.
  }
}
