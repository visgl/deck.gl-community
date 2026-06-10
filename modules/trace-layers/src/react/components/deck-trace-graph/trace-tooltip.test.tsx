import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {TraceTooltip} from './trace-tooltip';

import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceGraph,
  TraceSpanId,
  TraceStyle,
  TraceVisSettings
} from '../../../trace/index';
import type {Root} from 'react-dom/client';

vi.mock('./cards/trace-cross-process-dependency-card', () => ({
  TraceCrossProcessDependencyCard: ({crossDep}: {crossDep: TraceCrossProcessDependency}) => (
    <div data-testid="cross-dependency-card">{crossDep.dependencyId}</div>
  )
}));

vi.mock('./cards/trace-span-card', () => ({
  TraceSpanCard: () => <div data-testid="trace-span-card">span-card</div>
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

describe('TraceTooltip', () => {
  afterEach(() => {
    root?.unmount();
    root = null;
    container?.remove();
    container = null;
    document.body.innerHTML = '';
  });

  it('renders direct cross-dependency hover cards when span cards hide cross-process deps', () => {
    const dependency = makeCrossDependency();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <TraceTooltip
          object={dependency}
          traceGraph={{} as TraceGraph}
          traceLabels={{processLabel: 'Process', spanLabel: 'Span', threadLabel: 'Thread'}}
          traceStyle={{} as TraceStyle}
          traceSettings={{} as TraceVisSettings}
          traceSpanCardOptions={{showCrossProcessDependencies: false}}
        />
      );
    });

    expect(container.querySelector('[data-testid="cross-dependency-card"]')).not.toBeNull();
    expect(container.textContent).toContain('cross-dependency');
  });

  it('renders span hover cards through TraceSpanCard', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <TraceTooltip
          object={{
            type: 'trace-span',
            spanRef: 1 as SpanRef,
            spanId: 'span-1' as TraceSpanId,
            threadId: 'thread-1' as never,
            processName: 'rank-1',
            name: 'span-1',
            keywords: [],
            primaryTimingKey: 'primary',
            timings: {
              primary: {
                status: 'finished',
                startTimeMs: 0,
                endTimeMs: 1,
                durationMs: 1,
                durationMsAsString: '1ms'
              }
            },
            localDependencyIds: [],
            localDependencies: [],
            crossProcessEndpointId: null,
            crossProcessDependencyEndpoints: []
          }}
          traceGraph={{} as TraceGraph}
          traceLabels={{processLabel: 'Process', spanLabel: 'Span', threadLabel: 'Thread'}}
          traceStyle={{} as TraceStyle}
          traceSettings={{} as TraceVisSettings}
        />
      );
    });

    expect(container.querySelector('[data-testid="trace-span-card"]')?.textContent).toBe(
      'span-card'
    );
  });

  it('renders app-owned trace-event cards when provided', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <TraceTooltip
          object={{
            type: 'trace-event',
            eventId: 'event-1' as never,
            name: 'deployment',
            atTimeMs: 1
          }}
          traceGraph={{} as TraceGraph}
          traceLabels={{processLabel: 'Process', spanLabel: 'Span', threadLabel: 'Thread'}}
          traceStyle={{} as TraceStyle}
          traceSettings={{} as TraceVisSettings}
          renderTraceEventCard={event => <div data-testid="trace-event-card">{event.name}</div>}
        />
      );
    });

    expect(container.querySelector('[data-testid="trace-event-card"]')?.textContent).toBe(
      'deployment'
    );
  });
});

function makeCrossDependency(): TraceCrossProcessDependency {
  return {
    type: 'trace-cross-process-dependency',
    dependencyId: 'cross-dependency' as TraceDependencyId,
    endpointId: 'cross-dependency:endpoint' as TraceCrossProcessEndpointId,
    startRankNum: 0,
    endRankNum: 1,
    startSpanId: 'start-span' as TraceSpanId,
    endSpanId: 'end-span' as TraceSpanId,
    waitMode: 'end-to-start',
    bidirectional: false,
    topology: 'cross',
    waitTimeMs: 100,
    waiting: false,
    waitNotFinished: false,
    keywords: new Set<string>()
  };
}
