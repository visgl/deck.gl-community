// utils
export {log} from './utils/log';
export {safeJsonParse} from './utils/safe-json-parse';
export {arrowTableToJSON} from '../arrow-utils/arrow-utils';
export {validateArrowTableAgainstZod} from '../arrow-utils/arrow-zod-utils';

// Components
export {BreadcrumbNavigator} from './components/breadcrumb-navigator';
export {TraceSpanBadge} from './components/trace-span-badge';
export {Accordion, AccordionSection} from './components/accordion-section';
export {PerfettoIcon} from './components/icons/perfetto-icon';
export {
  CompactQueryStatus,
  createOrUpdateQueryStatus,
  createQueryStatus,
  resetQueryStatus,
  updateQueryStatus,
  type CompactQueryStatusProps,
  type CompactQueryStatusState,
  type QueryStatus
} from './components/query-status';
export {
  WithTooltip,
  type WithTooltipProps,
  type WithTooltipVariant
} from './components/with-tooltip';
export {
  HeapMemoryInfoBar,
  type HeapMemoryInfoBarProps,
  type TraceMemoryReport
} from './components/heap-memory-info-bar';

export {useElapsedTime} from './components/use-elapsed-time';
export {getTraceSpanBadgeStyle} from './utils/trace-span-badge-style';
export {colorToRgbaCss} from './utils/trace-span-badge-style';
export type {TraceSpanBadgeStyle} from './utils/trace-span-badge-style';
export {getRankNumForSpanRef} from './utils/trace-graph-utils';

// DeckTraceGraph
export {
  DeckTraceGraph,
  type DeckTraceGraphControlWidgetPlacement,
  type DeckTraceGraphExternalOmniBoxResult,
  type DeckTraceGraphExternalOmniBoxSearchProvider,
  type DeckTraceGraphFilterSummaryProvider,
  type DeckTraceGraphHandle,
  type DeckTraceGraphHelpLink,
  type DeckTraceGraphOverviewMarker,
  type DeckTraceGraphPickedObject,
  type DeckTraceGraphPickedObjectResolver,
  type DeckTraceGraphProps,
  type DeckTraceGraphConfig,
  type DeckTraceGraphTimeRange,
  type DeckTraceGraphTraceEventCardRenderer,
  type TraceSelectedSpan
} from './components/deck-trace-graph/deck-trace-graph';
export {
  createStudioSettingsPanel,
  Panel,
  StudioSettingsIcon,
  StudioSettingsPanel,
  type SettingDescriptor,
  type SettingPersistenceTarget,
  type SettingsSchema,
  type SettingsSectionDescriptor,
  type SettingsState,
  type StudioDependencyShape,
  type StudioSettingsIconName,
  type StudioSettingsIconProps,
  type StudioSettingsPanelProps,
  type StudioSettingsRowLayout,
  type StudioSettingsTabId
} from '@deck.gl-community/panels';
export {
  createStudioSettingsWidget,
  SidebarPanelWidget,
  updateStudioSettingsWidget,
  type SidebarPanelWidgetProps,
  type StudioSettingsWidgetProps
} from '@deck.gl-community/widgets';
export {
  TraceSpanCard,
  TraceSpanExternalSpanIdValue,
  type TraceSpanCardProps,
  type TraceSpanExternalSpanIdValueProps,
  getSameNameNavigation,
  getThreadNavigation,
  type SameNameNavigation,
  type ThreadNavigation
} from './components/deck-trace-graph/cards/trace-span-card';
export type {TraceSpanDoubleClickAction} from './components/deck-trace-graph/cards/trace-span-name-badge';
export {
  PrettyTable,
  type PrettyTableProps
} from './components/deck-trace-graph/components/pretty-table';
export {
  filterTraceSpanTableRows,
  TraceSpanTableFilter,
  type TraceSpanTableFilterProps,
  type TraceSpanTableFilterValue
} from './components/deck-trace-graph/cards/trace-span-card/trace-span-table-filter';
export {SpanInspectorPopup} from './components/deck-trace-graph/span-inspector-popup';
export {
  SpanInspectorHiddenSpanNotice,
  type SpanInspectorHiddenSpanNoticeProps
} from './components/deck-trace-graph/span-inspector-hidden-span-notice';
export {SPAN_INSPECTOR_DEFAULT_WIDTH_PX} from './components/deck-trace-graph/span-inspector-popup-utils';
export {
  TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX,
  type TraceSpanCardCustomTab,
  type TraceSpanCardTabId,
  type TraceSpanCardTabOptions
} from './components/deck-trace-graph/cards/trace-span-card/trace-span-card-types';
export {
  TraceThreadCard,
  type TraceThreadCardProps
} from './components/deck-trace-graph/cards/trace-thread-card';
export {
  TraceInstantCard,
  type TraceInstantCardProps
} from './components/deck-trace-graph/cards/trace-instant-card';
export {
  TraceCounterCard,
  type TraceCounterCardProps
} from './components/deck-trace-graph/cards/trace-counter-card';
export {
  TraceLocalDependencyCard,
  type TraceLocalDependencyCardProps
} from './components/deck-trace-graph/cards/trace-local-dependency-card';
export {
  TraceCrossProcessDependencyCard,
  type TraceCrossProcessDependencyCardProps
} from './components/deck-trace-graph/cards/trace-cross-process-dependency-card';
export {
  TraceProcessCard,
  type TraceProcessCardProps
} from './components/deck-trace-graph/cards/trace-process-card';

// KEYBOARD SHORTCUTS
export {TRACEVIS_SHORTCUTS} from './constants/tracevis-shortcuts';
