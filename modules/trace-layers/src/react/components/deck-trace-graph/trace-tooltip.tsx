import {useMemo} from 'react';

import {
  getJSONForTraceObject,
  isVisibleCrossDependencyRef,
  isVisibleLocalDependencyRef
} from '../../../trace/index';
import {TraceCounterCard} from './cards/trace-counter-card';
import {TraceCrossProcessDependencyCard} from './cards/trace-cross-process-dependency-card';
import {TraceEventCard} from './cards/trace-event-card';
import {TraceInstantCard} from './cards/trace-instant-card';
import {TraceLocalDependencyCard} from './cards/trace-local-dependency-card';
import {TraceProcessCard} from './cards/trace-process-card';
import {TraceSpanCard} from './cards/trace-span-card';
import {TraceThreadCard} from './cards/trace-thread-card';
import {isTraceRenderSpanObject} from './deck-trace-graph-hover';
import {useCopyToClipboard} from './hooks/use-copy-to-clipboard';

import type {
  SpanRef,
  TraceEvent,
  TraceGraph,
  TraceLabels,
  TraceObject,
  TracePath,
  TraceProcessInfo,
  TraceRenderSpan,
  TraceStyle,
  TraceVisSettings
} from '../../../trace/index';
import type {TraceSpanCardTabOptions, TraceSpanDoubleClickAction} from './cards/trace-span-card';
import type {ReactNode} from 'react';

/** App-owned renderer for graph-global trace-event tooltip cards. */
export type TraceEventCardRenderer = (
  event: TraceEvent,
  labels: TraceLabels
) => ReactNode | null | undefined;

export type TraceTooltipProps = {
  /** deck.gl picking info including the Trace object */
  object: TraceObject | TraceRenderSpan | null;
  /** Filtered wrapper used by block and dependency cards */
  traceGraph: TraceGraph;
  traceLabels: TraceLabels;
  traceStyle: TraceStyle;
  traceSettings: TraceVisSettings;
  /** Optional tab and dependency-display overrides for block cards. */
  traceSpanCardOptions?: TraceSpanCardTabOptions;
  /** Critical paths currently highlighted */
  paths?: TracePath[];
  /** Text to copy to cliboard */
  getJSON?: (object?: TraceObject) => Record<string, unknown>;
  /** Action if a cross rank dependency is clicked */
  onRankClick?: (rankNum: number) => void;
  /** Action if a process-info node label is clicked. */
  onProcessInfoClick?: (processId: string, processInfo?: TraceProcessInfo) => void;
  /** Optional action when a span badge is double-clicked. */
  onSpanDoubleClick?: (spanRef: SpanRef, action: TraceSpanDoubleClickAction) => void;
  /** Optional app-owned renderer for graph-global trace-event tooltip cards. */
  renderTraceEventCard?: TraceEventCardRenderer;
};

/** Renders a tool tip for one object in the trace graph */
export function TraceTooltip(props: TraceTooltipProps) {
  const textToCopy = useMemo(
    () =>
      isTraceRenderSpanObject(props.object)
        ? JSON.stringify(
            {
              spanRef: props.object.spanRef,
              spanId: props.object.spanId,
              name: props.object.name
            },
            null,
            2
          )
        : getJSONForTraceObject(props.object || undefined, props.getJSON),
    [props.object, props.getJSON]
  );

  useCopyToClipboard(textToCopy);

  if (isTraceRenderSpanObject(props.object)) {
    return (
      <TraceSpanCard
        spanRef={props.object.spanRef}
        traceGraph={props.traceGraph}
        tabOptions={props.traceSpanCardOptions}
        paths={props.paths}
        onRankClick={props.onRankClick}
        onSpanDoubleClick={props.onSpanDoubleClick}
        traceLabels={props.traceLabels}
        traceStyle={props.traceStyle}
        traceSettings={props.traceSettings}
      />
    );
  }

  switch (props.object?.type) {
    case 'trace-thread':
      const stream = props.object;
      return (
        <TraceThreadCard
          stream={stream}
          processName={stream.processId}
          labels={props.traceLabels}
        />
      );

    case 'trace-span':
      const block = props.object;
      const spanRef = block.spanRef ?? null;
      if (spanRef == null) {
        return null;
      }
      return (
        <TraceSpanCard
          spanRef={spanRef}
          traceGraph={props.traceGraph}
          tabOptions={props.traceSpanCardOptions}
          paths={props.paths}
          onRankClick={props.onRankClick}
          onSpanDoubleClick={props.onSpanDoubleClick}
          traceLabels={props.traceLabels}
          traceStyle={props.traceStyle}
          traceSettings={props.traceSettings}
        />
      );

    case 'trace-process-info':
      const rankData = props.object;
      return (
        <TraceProcessCard
          processId={rankData.processId}
          rankNum={rankData.rankNum}
          processName={rankData.processName}
          processInfo={rankData.processInfo}
          labels={props.traceLabels}
          onOpenNode={props.onProcessInfoClick}
        />
      );

    case 'trace-instant':
      return <TraceInstantCard instant={props.object} labels={props.traceLabels} />;

    case 'trace-event': {
      const traceEventCard = props.renderTraceEventCard?.(props.object, props.traceLabels);
      return traceEventCard === undefined ? (
        <TraceEventCard event={props.object} labels={props.traceLabels} />
      ) : (
        traceEventCard
      );
    }

    case 'trace-counter':
      return <TraceCounterCard counter={props.object} labels={props.traceLabels} />;

    case 'trace-local-dependency': {
      const dependency = props.object;
      return (
        <TraceLocalDependencyCard
          dependency={dependency}
          dependencyRef={
            dependency.dependencyRef != null &&
            isVisibleLocalDependencyRef(dependency.dependencyRef)
              ? dependency.dependencyRef
              : undefined
          }
          traceGraph={props.traceGraph}
          labels={props.traceLabels}
          traceStyle={props.traceStyle}
          traceSettings={props.traceSettings}
        />
      );
    }

    case 'trace-cross-process-dependency':
      const crossDep = props.object;
      return (
        <TraceCrossProcessDependencyCard
          crossDep={crossDep}
          dependencyRef={
            crossDep.dependencyRef != null && isVisibleCrossDependencyRef(crossDep.dependencyRef)
              ? crossDep.dependencyRef
              : undefined
          }
          traceGraph={props.traceGraph}
          labels={props.traceLabels}
          traceStyle={props.traceStyle}
          traceSettings={props.traceSettings}
        />
      );

    default:
      return null;
  }
}
