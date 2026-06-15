import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {encodeVisibleCrossDependencyRef} from '../../../trace/index';
import {TraceTooltip} from './trace-tooltip';

import type {
  SpanRef,
  TraceCrossDependencyRenderSource,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceGraph,
  TraceSpanId,
  TraceStyle,
  TraceVisSettings,
  VisibleCrossDependencyRef
} from '../../../trace/index';
import type {Root} from 'react-dom/client';

const traceCrossProcessDependencyCardSpy = vi.hoisted(() => vi.fn());

vi.mock('./cards/trace-cross-process-dependency-card', () => ({
  TraceCrossProcessDependencyCard: (props: {
    /** Optional descriptive dependency passed by existing full hover payloads. */
    crossDep?: TraceCrossProcessDependency;
    /** Optional visible dependency ref passed by lightweight hover payloads. */
    dependencyRef?: VisibleCrossDependencyRef;
  }) => {
    traceCrossProcessDependencyCardSpy(props);
    return (
      <div data-testid="cross-dependency-card">
        {props.crossDep?.dependencyId ?? String(props.dependencyRef)}
      </div>
    );
  }
}));

vi.mock('./cards/trace-span-card', () => ({
  TraceSpanCard: () => <div data-testid="trace-span-card">span-card</div>
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

describe('TraceTooltip', () => {
  afterEach(() => {
    traceCrossProcessDependencyCardSpy.mockClear();
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

  it('passes minimal dependency picks to the card for descriptive upgrade', () => {
    const dependencyRef = encodeVisibleCrossDependencyRef(7) as VisibleCrossDependencyRef;
    const dependency = {
      type: 'trace-cross-process-dependency',
      dependencyRef,
      startSpanRef: 1 as SpanRef,
      endSpanRef: 2 as SpanRef,
      waitMode: 'end-to-start',
      bidirectional: false,
      waitTimeMs: 100,
      isParent: false,
      startRankNum: 0,
      endRankNum: 1
    } satisfies TraceCrossDependencyRenderSource;
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
        />
      );
    });

    expect(traceCrossProcessDependencyCardSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        crossDep: undefined,
        dependencyRef
      })
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
