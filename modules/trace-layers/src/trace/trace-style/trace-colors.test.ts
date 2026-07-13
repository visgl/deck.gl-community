import {describe, expect, it, vi} from 'vitest';

import {getTraceSpanAttributeValue} from './trace-color-scheme';
import {
  COLORS,
  COLORS_LIST,
  createColorWheel,
  createTraceGraphColorResolver,
  DEFAULT_TRACE_COLOR_SCHEME,
  getCrossRankDependencyLineColor,
  getDependencyLineColor,
  getPerfettoSliceColor,
  getReadableSpanBorderColor,
  getSelectedCrossRankDependencyLineColor,
  getSelectedSameProcessDependencyLineColor,
  getTraceThreadColor,
  makeDeckColor,
  TRACE_COLOR
} from './trace-colors';

import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceSameProcessDependency,
  TraceSpan,
  TraceThread
} from '../trace-graph/trace-types';
import type {TraceColorScheme, TraceSpanColorAccessorSource} from './trace-color-scheme';
import type {TraceDeckColor} from './trace-colors';

const EMPTY_SETTINGS = {} as TraceVisSettings;

function makeBlock(overrides?: Partial<TraceSpan>): TraceSpan {
  return {
    type: 'trace-span',
    spanRef: 0 as SpanRef,
    spanId: 'span-1' as TraceSpan['spanId'],
    threadId: 'stream-1' as TraceSpan['threadId'],
    processName: 'rank-1',
    name: 'span',
    primaryTimingKey: 'default',
    timings: {
      default: {
        status: 'finished',
        startTimeMs: 0,
        endTimeMs: 1,
        durationMs: 1,
        durationMsAsString: '1 ms'
      }
    },
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: [],
    ...overrides
  };
}

function makeThread(overrides?: Partial<TraceThread>): TraceThread {
  return {
    type: 'trace-thread',
    name: 'thread',
    threadId: 'stream-1' as TraceThread['threadId'],
    processId: 'rank-1',
    ...overrides
  };
}

function resolveSpanFillColor(
  span: TraceSpan,
  settings: TraceVisSettings,
  path?: 'path' | 'any',
  colorScheme?: TraceColorScheme,
  highlightedSpanRefs?: ReadonlySet<SpanRef>
): TraceDeckColor {
  const {colorResolver, spanRef} = createSpanColorResolver(
    span,
    settings,
    colorScheme,
    highlightedSpanRefs
  );
  return colorResolver.getSpanFillColor(spanRef, path);
}

function resolveSpanBorderColor(
  span: TraceSpan,
  settings: TraceVisSettings,
  path?: 'path',
  colorScheme?: TraceColorScheme,
  highlightedSpanRefs?: ReadonlySet<SpanRef>
): TraceDeckColor {
  const {colorResolver, spanRef} = createSpanColorResolver(
    span,
    settings,
    colorScheme,
    highlightedSpanRefs
  );
  return colorResolver.getSpanBorderColor(spanRef, path);
}

function resolveSpanTextColor(
  span: TraceSpan,
  settings: TraceVisSettings,
  path?: 'path' | 'any',
  colorScheme?: TraceColorScheme,
  highlightedSpanRefs?: ReadonlySet<SpanRef>,
  labelPlacement: 'inside' | 'outside' = 'inside'
): TraceDeckColor {
  const {colorResolver, spanRef} = createSpanColorResolver(
    span,
    settings,
    colorScheme,
    highlightedSpanRefs
  );
  return colorResolver.getSpanTextColor(spanRef, path, labelPlacement);
}

function resolveThreadColor(
  thread: TraceThread | undefined,
  colorScheme?: TraceColorScheme
): TraceDeckColor | undefined {
  return getTraceThreadColor(thread, colorScheme);
}

function resolveSpanTextColorFromFill(fillColor: TraceDeckColor): TraceDeckColor {
  return resolveSpanTextColor(makeBlock(), EMPTY_SETTINGS, 'any', {
    id: 'text-from-fill',
    name: 'Text From Fill',
    getSpanFillColorForRef: () => fillColor
  });
}

function createSpanColorResolver(
  span: TraceSpan,
  settings: TraceVisSettings,
  colorScheme?: TraceColorScheme,
  highlightedSpanRefs?: ReadonlySet<SpanRef>
) {
  const traceGraph = createSpanColorAccessorSource(span);
  const spanRef = span.spanRef ?? (0 as SpanRef);
  return {
    colorResolver: createTraceGraphColorResolver({
      colorScheme,
      settings,
      highlightedSpanRefs,
      traceGraph
    }),
    spanRef
  };
}

/** Builds ref-native color accessors for one synthetic span row. */
function createSpanColorAccessorSource(span: TraceSpan): TraceSpanColorAccessorSource {
  const getTiming = () => span.timings[span.primaryTimingKey] ?? null;
  return {
    getSpanRankName: () => span.processName,
    getSpanStreamId: () => span.threadId,
    getSpanName: () => span.name,
    getSpanKeywords: () => span.keywords ?? [],
    getSpanAttribute: (_spanRef, path) => getTraceSpanAttributeValue(span.userData, path),
    getSpanPrimaryTimingKey: () => span.primaryTimingKey,
    getSpanStatus: () => getTiming()?.status ?? null,
    getSpanStartTimeMs: () => getTiming()?.startTimeMs ?? null,
    getSpanEndTimeMs: () => getTiming()?.endTimeMs ?? null
  };
}

function makeSameProcessDependency(
  overrides?: Partial<TraceSameProcessDependency>
): TraceSameProcessDependency {
  return {
    type: 'trace-same-process-dependency',
    dependencyRef: 0 as TraceSameProcessDependency['dependencyRef'],
    startSpanRef: 0 as SpanRef,
    endSpanRef: 1 as SpanRef,
    dependencyId: 'dep-1' as TraceSameProcessDependency['dependencyId'],
    startSpanId: 'span-1' as TraceSameProcessDependency['startSpanId'],
    endSpanId: 'span-2' as TraceSameProcessDependency['endSpanId'],
    keywords: new Set(),
    waitMode: 'end-to-start',
    bidirectional: false,
    waitTimeMs: 0,
    ...overrides
  };
}

function makeCrossProcessDependency(
  overrides?: Partial<TraceCrossProcessDependency>
): TraceCrossProcessDependency {
  return {
    type: 'trace-cross-process-dependency',
    dependencyRef: 0 as TraceCrossProcessDependency['dependencyRef'],
    startSpanRef: 0 as SpanRef,
    endSpanRef: 1 as SpanRef,
    dependencyId: 'cross-dep-1' as TraceCrossProcessDependency['dependencyId'],
    endpointId: 'endpoint-1' as TraceCrossProcessDependency['endpointId'],
    startRankNum: 0,
    endRankNum: 1,
    startSpanId: 'span-1' as TraceCrossProcessDependency['startSpanId'],
    endSpanId: 'span-2' as TraceCrossProcessDependency['endSpanId'],
    waitMode: 'end-to-start',
    bidirectional: false,
    topology: 'rpc',
    waitTimeMs: 0,
    waiting: false,
    waitNotFinished: false,
    keywords: new Set(),
    ...overrides
  };
}

describe('trace color styling', () => {
  it('uses keyword presentation color as span fill fallback', () => {
    const colorScheme = {
      id: 'keyword-scheme',
      name: 'Keyword',
      getKeywordPresentation: ({keywords}: {keywords: readonly string[]}) =>
        keywords.includes('ATTN')
          ? {
              color: [66, 77, 88, 255] as TraceDeckColor,
              description: 'attention'
            }
          : undefined
    } satisfies TraceColorScheme;

    expect(
      resolveSpanFillColor(makeBlock({keywords: ['ATTN']}), EMPTY_SETTINGS, undefined, colorScheme)
    ).toEqual([66, 77, 88, 255]);
  });

  it('uses default colors after ref-native hooks decline', () => {
    const renderSource = makeBlock({name: 'render-span'});
    const colorScheme = {
      id: 'ref-native-declines',
      name: 'Ref Native Declines',
      getSpanStyleForRef: () => undefined
    } satisfies TraceColorScheme;
    const traceGraph = {
      getSpanRankName: () => renderSource.processName,
      getSpanStreamId: () => renderSource.threadId,
      getSpanName: () => renderSource.name,
      getSpanKeywords: () => [],
      getSpanAttribute: () => {
        throw new Error('user data values should not be read');
      },
      getSpanPrimaryTimingKey: () => renderSource.primaryTimingKey,
      getSpanStatus: () => renderSource.timings[renderSource.primaryTimingKey]!.status,
      getSpanStartTimeMs: () => renderSource.timings[renderSource.primaryTimingKey]!.startTimeMs,
      getSpanEndTimeMs: () => renderSource.timings[renderSource.primaryTimingKey]!.endTimeMs
    } satisfies Parameters<typeof createTraceGraphColorResolver>[0]['traceGraph'];

    const resolver = createTraceGraphColorResolver({
      colorScheme,
      settings: EMPTY_SETTINGS,
      traceGraph
    });

    expect(resolver.getSpanFillColor(0 as SpanRef, 'any')).toEqual(TRACE_COLOR.SPAN_FINISHED_FILL);
    expect(resolver.getSpanBorderColor(0 as SpanRef)).toEqual(
      getReadableSpanBorderColor(TRACE_COLOR.SPAN_FINISHED_FILL)
    );
  });

  it('writes custom block colors with style parity while skipping text work', () => {
    const renderSource = makeBlock({name: 'render-span'});
    const baseTraceGraph = createSpanColorAccessorSource(renderSource);
    const getSpanStartTimeMs = vi.fn(baseTraceGraph.getSpanStartTimeMs);
    const getSpanEndTimeMs = vi.fn(baseTraceGraph.getSpanEndTimeMs);
    const traceGraph = {
      ...baseTraceGraph,
      getSpanStartTimeMs,
      getSpanEndTimeMs
    } satisfies Parameters<typeof createTraceGraphColorResolver>[0]['traceGraph'];
    const getSpanStyleForRef = vi.fn(() => ({
      spanFillColor: [12, 34, 56, 255] as TraceDeckColor,
      spanBorderColor: [78, 90, 12, 255] as TraceDeckColor
    }));
    const getSpanTextColorForRef = vi.fn(() => [1, 2, 3, 255] as TraceDeckColor);
    const colorScheme = {
      id: 'block-color-writer',
      name: 'Block Color Writer',
      getSpanStyleForRef,
      getSpanTextColorForRef
    } satisfies TraceColorScheme;
    const resolver = createTraceGraphColorResolver({
      colorScheme,
      settings: EMPTY_SETTINGS,
      traceGraph
    });
    getSpanStyleForRef.mockClear();
    getSpanTextColorForRef.mockClear();
    getSpanStartTimeMs.mockClear();
    getSpanEndTimeMs.mockClear();

    const fillColors = new Uint8Array(8);
    const lineColors = new Uint8Array(9);
    resolver.writeSpanBlockColors(0 as SpanRef, fillColors, 2, lineColors, 3, 'any');

    expect(Array.from(fillColors.slice(2, 6))).toEqual([12, 34, 56, 255]);
    expect(Array.from(lineColors.slice(3, 7))).toEqual([78, 90, 12, 255]);
    expect(getSpanStyleForRef).toHaveBeenCalledTimes(1);
    expect(getSpanTextColorForRef).not.toHaveBeenCalled();
    expect(getSpanStartTimeMs).toHaveBeenCalledTimes(1);
    expect(getSpanEndTimeMs).toHaveBeenCalledTimes(1);
  });

  it('writes default block bytes with the same visibility-adjusted alpha as full styles', () => {
    const renderSource = makeBlock();
    const traceGraph = createSpanColorAccessorSource(renderSource);
    const settings = {
      showPathsOnly: true,
      minSpanTimeMs: 2,
      highlightFadeFactor: 0.5
    } as TraceVisSettings;
    const highlightedSpanRefs = new Set<SpanRef>([1 as SpanRef]);
    const resolver = createTraceGraphColorResolver({
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      settings,
      highlightedSpanRefs,
      traceGraph
    });
    const expectedFillColor = resolver.getSpanFillColor(0 as SpanRef, 'any');
    const expectedBorderColor = resolver.getSpanBorderColor(0 as SpanRef);
    const fillColors = new Uint8Array(4);
    const lineColors = new Uint8Array(4);

    resolver.writeSpanBlockColors(0 as SpanRef, fillColors, 0, lineColors, 0, 'any');

    expect(Array.from(fillColors)).toEqual(Array.from(Uint8Array.from(expectedFillColor)));
    expect(Array.from(lineColors)).toEqual(Array.from(Uint8Array.from(expectedBorderColor)));
  });

  it('uses caller-owned primary timing fields without graph timing reads', () => {
    const renderSource = makeBlock();
    const baseTraceGraph = createSpanColorAccessorSource(renderSource);
    const getSpanStartTimeMs = vi.fn(() => {
      throw new Error('raw block timing should avoid start-time access');
    });
    const getSpanEndTimeMs = vi.fn(() => {
      throw new Error('raw block timing should avoid end-time access');
    });
    const traceGraph = {
      ...baseTraceGraph,
      getSpanStartTimeMs,
      getSpanEndTimeMs
    } satisfies Parameters<typeof createTraceGraphColorResolver>[0]['traceGraph'];
    const colorScheme = {
      id: 'raw-block-timing',
      name: 'Raw Block Timing',
      getSpanStyleForRef: () => ({
        spanFillColor: [12, 34, 56, 255] as TraceDeckColor,
        spanBorderColor: [78, 90, 12, 255] as TraceDeckColor
      })
    } satisfies TraceColorScheme;
    const resolver = createTraceGraphColorResolver({
      colorScheme,
      settings: {minSpanTimeMs: 2} as TraceVisSettings,
      traceGraph
    });
    const fillColors = new Uint8Array(4);
    const lineColors = new Uint8Array(4);

    resolver.writeSpanBlockColors(0 as SpanRef, fillColors, 0, lineColors, 0, 'any', 0, 1);

    expect(Array.from(fillColors)).toEqual([12, 34, 56, 51]);
    expect(Array.from(lineColors)).toEqual([78, 90, 12, 51]);
    expect(getSpanStartTimeMs).not.toHaveBeenCalled();
    expect(getSpanEndTimeMs).not.toHaveBeenCalled();

    resolver.writeSpanBlockColors(0 as SpanRef, fillColors, 0, lineColors, 0, 'any', null, null);

    expect(Array.from(fillColors)).toEqual([12, 34, 56, 255]);
    expect(Array.from(lineColors)).toEqual([78, 90, 12, 255]);
    expect(getSpanStartTimeMs).not.toHaveBeenCalled();
    expect(getSpanEndTimeMs).not.toHaveBeenCalled();
  });

  it('writes critical-path block bytes without invoking color or timing hooks', () => {
    const renderSource = makeBlock();
    const baseTraceGraph = createSpanColorAccessorSource(renderSource);
    const getSpanStartTimeMs = vi.fn(baseTraceGraph.getSpanStartTimeMs);
    const getSpanEndTimeMs = vi.fn(baseTraceGraph.getSpanEndTimeMs);
    const traceGraph = {
      ...baseTraceGraph,
      getSpanStartTimeMs,
      getSpanEndTimeMs
    } satisfies Parameters<typeof createTraceGraphColorResolver>[0]['traceGraph'];
    const getSpanStyleForRef = vi.fn(() => ({
      spanFillColor: [12, 34, 56, 255] as TraceDeckColor,
      spanBorderColor: [78, 90, 12, 255] as TraceDeckColor
    }));
    const colorScheme = {
      id: 'critical-path-block-color-writer',
      name: 'Critical Path Block Color Writer',
      getSpanStyleForRef
    } satisfies TraceColorScheme;
    const resolver = createTraceGraphColorResolver({
      colorScheme,
      settings: EMPTY_SETTINGS,
      traceGraph
    });
    const fillColors = new Uint8Array(4);
    const lineColors = new Uint8Array(4);

    resolver.writeSpanBlockColors(0 as SpanRef, fillColors, 0, lineColors, 0, 'path');

    expect(Array.from(fillColors)).toEqual(TRACE_COLOR.SPAN_IN_CRITICAL_PATH_FILL);
    expect(Array.from(lineColors)).toEqual(TRACE_COLOR.SPAN_IN_CRITICAL_PATH_LINE);
    expect(getSpanStyleForRef).not.toHaveBeenCalled();
    expect(getSpanStartTimeMs).not.toHaveBeenCalled();
    expect(getSpanEndTimeMs).not.toHaveBeenCalled();
  });

  it('prefers explicit span fill color over keyword presentation', () => {
    const colorScheme = {
      id: 'override-scheme',
      name: 'Override',
      getKeywordPresentation: () => ({
        color: [1, 2, 3, 255] as TraceDeckColor
      }),
      getSpanFillColorForRef: () => [255, 0, 0, 255] as const
    } satisfies TraceColorScheme;

    expect(
      resolveSpanFillColor(makeBlock({keywords: ['ATTN']}), EMPTY_SETTINGS, undefined, colorScheme)
    ).toEqual([255, 0, 0, 255]);
  });

  it('preserves color-scheme fill colors for unfinished spans', () => {
    const colorScheme = {
      id: 'unfinished-override-scheme',
      name: 'Unfinished Override',
      getSpanFillColorForRef: () => [255, 0, 255, 255] as const
    } satisfies TraceColorScheme;

    expect(
      resolveSpanFillColor(
        makeBlock({
          timings: {
            default: {
              status: 'not-finished',
              startTimeMs: 0,
              endTimeMs: 1,
              durationMs: 1,
              durationMsAsString: '1 ms'
            }
          }
        }),
        EMPTY_SETTINGS,
        undefined,
        colorScheme
      )
    ).toEqual([255, 0, 255, 255]);
  });

  it('derives readable border colors from unfinished span fill fallback', () => {
    expect(
      resolveSpanBorderColor(
        makeBlock({
          timings: {
            default: {
              status: 'not-finished',
              startTimeMs: 0,
              endTimeMs: 1,
              durationMs: 1,
              durationMsAsString: '1 ms'
            }
          }
        }),
        EMPTY_SETTINGS
      )
    ).toEqual([97, 162, 186, 255]);
  });

  it('returns white text for saturated blue backgrounds by default', () => {
    const strategy = {
      id: 'blue',
      name: 'Blue',
      getSpanFillColorForRef: () => [0, 0, 255, 255] as const,
      getSpanBorderColorForRef: () => [0, 0, 0, 255] as const
    };

    expect(resolveSpanTextColor(makeBlock(), EMPTY_SETTINGS, 'any', strategy)).toEqual([
      255, 255, 255, 255
    ]);
  });

  it('prefers strategy text color when provided', () => {
    const strategy = {
      id: 'strategy',
      name: 'Strategy',
      getSpanFillColorForRef: () => [240, 240, 240, 255] as const,
      getSpanTextColorForRef: () => [255, 0, 0, 255] as const,
      getSpanBorderColorForRef: () => [0, 0, 0, 255] as const
    };

    expect(resolveSpanTextColor(makeBlock(), EMPTY_SETTINGS, 'any', strategy)).toEqual([
      255, 0, 0, 255
    ]);
  });

  it('prefers style span text color when provided', () => {
    const strategy = {
      id: 'strategy',
      name: 'Strategy',
      getSpanStyleForRef: () => ({
        spanTextColor: [0, 255, 0, 255] as const
      }),
      getSpanFillColorForRef: () => [240, 240, 240, 255] as const,
      getSpanBorderColorForRef: () => [0, 0, 0, 255] as const
    };

    expect(resolveSpanTextColor(makeBlock(), EMPTY_SETTINGS, 'any', strategy)).toEqual([
      0, 255, 0, 255
    ]);
  });

  it('uses white text for dark spans and black for light spans by default contrast', () => {
    const lightFillStrategy = {
      id: 'light',
      name: 'Light',
      getSpanFillColorForRef: () => [240, 240, 240, 255] as const,
      getSpanBorderColorForRef: () => [0, 0, 0, 255] as const
    };

    const darkFillStrategy = {
      id: 'dark',
      name: 'Dark',
      getSpanFillColorForRef: () => [30, 30, 30, 255] as const,
      getSpanBorderColorForRef: () => [0, 0, 0, 255] as const
    };

    expect(resolveSpanTextColor(makeBlock(), EMPTY_SETTINGS, 'any', lightFillStrategy)).toEqual([
      0, 0, 0, 255
    ]);
    expect(resolveSpanTextColor(makeBlock(), EMPTY_SETTINGS, 'any', darkFillStrategy)).toEqual([
      255, 255, 255, 255
    ]);
  });

  it('forces outside-label text to black regardless of span fill color', () => {
    const lightFillStrategy = {
      id: 'light',
      name: 'Light',
      getSpanFillColorForRef: () => [240, 240, 240, 255] as const,
      getSpanBorderColorForRef: () => [0, 0, 0, 255] as const
    };
    const darkFillStrategy = {
      id: 'dark',
      name: 'Dark',
      getSpanFillColorForRef: () => [10, 10, 10, 255] as const,
      getSpanBorderColorForRef: () => [0, 0, 0, 255] as const
    };

    expect(
      resolveSpanTextColor(
        makeBlock(),
        EMPTY_SETTINGS,
        'any',
        lightFillStrategy,
        undefined,
        'outside'
      )
    ).toEqual([0, 0, 0, 255]);
    expect(
      resolveSpanTextColor(
        makeBlock(),
        EMPTY_SETTINGS,
        'any',
        darkFillStrategy,
        undefined,
        'outside'
      )
    ).toEqual([0, 0, 0, 255]);
  });

  it('uses alpha-aware text contrast for inside labels', () => {
    const translucentFillStrategy = {
      id: 'translucent',
      name: 'Translucent',
      getSpanFillColorForRef: () => [171, 71, 188, 80] as const,
      getSpanBorderColorForRef: () => [0, 0, 0, 255] as const
    };

    expect(
      resolveSpanTextColor(makeBlock(), EMPTY_SETTINGS, 'any', translucentFillStrategy)
    ).toEqual([0, 0, 0, 255]);
    expect(
      resolveSpanTextColor(makeBlock(), EMPTY_SETTINGS, 'any', {
        ...translucentFillStrategy,
        getSpanFillColorForRef: () => [0, 95, 204, 255] as const
      })
    ).toEqual([255, 255, 255, 255]);
  });

  it('keeps text fully opaque when non-selected spans are faded', () => {
    const strategy = {
      id: 'selection-fade',
      name: 'Selection fade',
      getSpanFillColorForRef: () => [30, 30, 30, 255] as const,
      getSpanBorderColorForRef: () => [0, 0, 0, 255] as const
    };
    const settings = {
      highlightFadeFactor: 0.2
    } as TraceVisSettings;
    const highlightedSpanRefs = new Set<SpanRef>([1 as SpanRef]);

    expect(
      resolveSpanFillColor(makeBlock(), settings, 'any', strategy, highlightedSpanRefs)
    ).toEqual([30, 30, 30, 51]);
    const textColor = resolveSpanTextColor(
      makeBlock(),
      settings,
      'any',
      strategy,
      highlightedSpanRefs
    );
    expect(textColor[3]).toBeGreaterThan(51);
    expect(textColor[3]).toBeLessThan(255);
  });

  it('switches faded light inside labels to a muted dark color', () => {
    const strategy = {
      id: 'selection-fade-white-text',
      name: 'Selection fade white text',
      getSpanFillColorForRef: () => [30, 30, 30, 255] as const,
      getSpanStyleForRef: () => ({
        spanTextColor: [255, 255, 255, 255] as const
      }),
      getSpanBorderColorForRef: () => [0, 0, 0, 255] as const
    };
    const settings = {
      highlightFadeFactor: 0.5
    } as TraceVisSettings;
    const highlightedSpanRefs = new Set<SpanRef>([1 as SpanRef]);

    const textColor = resolveSpanTextColor(
      makeBlock(),
      settings,
      'any',
      strategy,
      highlightedSpanRefs
    );

    expect(textColor.slice(0, 3)).toEqual([95, 99, 104]);
  });

  it('reuses colors per key and advances the color wheel for new keys', () => {
    const colorWheel = createColorWheel();

    const first = colorWheel.getColorByKey('thread-A');
    const again = colorWheel.getColorByKey('thread-A');
    const second = colorWheel.getColorByKey('thread-B');

    expect(again).toEqual(first);
    expect(second).not.toEqual(first);
  });

  it('keeps red-adjacent semantic colors out of the shared color wheel', () => {
    expect(COLORS_LIST).not.toContainEqual(COLORS.RED);
    expect(COLORS_LIST).not.toContainEqual(COLORS.MAGENTA);
  });

  it('maps normalized Perfetto slice names onto the shared palette wheel', () => {
    const decode = getPerfettoSliceColor('decode');
    const decodeWithNumericSuffix = getPerfettoSliceColor('decode 123');
    const sample = getPerfettoSliceColor('sample');

    expect(decode).toEqual(decodeWithNumericSuffix);
    expect(decode).not.toEqual(sample);
    expect(decode[3]).toBe(255);
  });

  it('colors spans and streams consistently by process id in the default scheme', () => {
    const rankAColor = resolveSpanFillColor(
      makeBlock({processName: 'rank-a'}),
      EMPTY_SETTINGS,
      undefined,
      DEFAULT_TRACE_COLOR_SCHEME
    );
    const rankAStreamColor = resolveThreadColor(
      makeThread({processId: 'rank-a', threadId: 'stream-a' as TraceThread['threadId']}),
      DEFAULT_TRACE_COLOR_SCHEME
    );
    const rankBColor = resolveSpanFillColor(
      makeBlock({processName: 'rank-b'}),
      EMPTY_SETTINGS,
      undefined,
      DEFAULT_TRACE_COLOR_SCHEME
    );

    expect(rankAStreamColor).toEqual(rankAColor);
    expect(rankBColor).not.toEqual(rankAColor);
    expect(
      resolveSpanFillColor(
        makeBlock({processName: 'rank-a', threadId: 'stream-other' as TraceSpan['threadId']}),
        EMPTY_SETTINGS,
        undefined,
        DEFAULT_TRACE_COLOR_SCHEME
      )
    ).toEqual(rankAColor);
  });

  it('assigns distinct process colors to head and logical processes', () => {
    const headProcessColor = resolveSpanFillColor(
      makeBlock({
        processName: 'head-process/2487504/pod/1614d83a-c9e8-406c-ba85-0562cd978805'
      }),
      EMPTY_SETTINGS,
      undefined,
      DEFAULT_TRACE_COLOR_SCHEME
    );
    const logicalProcessColor = resolveSpanFillColor(
      makeBlock({processName: 'logical/actor-hierarchy/1'}),
      EMPTY_SETTINGS,
      undefined,
      DEFAULT_TRACE_COLOR_SCHEME
    );

    expect(logicalProcessColor).not.toEqual(headProcessColor);
  });

  it('chooses black text for translucent light text fills on white background', () => {
    expect(resolveSpanTextColorFromFill([171, 71, 188, 80])).toEqual([0, 0, 0, 255]);
  });

  it('keeps white text for fully opaque dark text fills', () => {
    expect(resolveSpanTextColorFromFill([0, 95, 204, 255])).toEqual([255, 255, 255, 255]);
  });

  it('renders ordinary same process dependencies in a distinct saturated yellow', () => {
    expect(getDependencyLineColor(makeSameProcessDependency(), EMPTY_SETTINGS)).toEqual(
      makeDeckColor('#eab308ff')
    );
  });

  it('renders cross-rank dependencies in a distinct saturated blue', () => {
    expect(getCrossRankDependencyLineColor(makeCrossProcessDependency(), EMPTY_SETTINGS)).toEqual(
      makeDeckColor('#0ea5e9ff')
    );
  });

  it('keeps submit warning dependencies red', () => {
    expect(
      getDependencyLineColor(
        makeSameProcessDependency({
          keywords: new Set(['SUBMIT']),
          waitTimeMs: 1
        }),
        EMPTY_SETTINGS
      )
    ).toEqual(makeDeckColor('#ef4444ff'));
  });

  it('keeps non-warning submit dependencies distinct from warnings', () => {
    expect(
      getDependencyLineColor(
        makeSameProcessDependency({
          keywords: new Set(['SUBMIT']),
          waitTimeMs: 2_000
        }),
        EMPTY_SETTINGS
      )
    ).toEqual(makeDeckColor('#ec407a'));
  });

  it('uses a red gradient for selected same process dependencies', () => {
    expect(
      getDependencyLineColor(
        makeSameProcessDependency({waitTimeMs: 2_000}),
        EMPTY_SETTINGS,
        'selected'
      )
    ).toEqual(makeDeckColor('#ff0000ff'));
  });

  it('uses a red gradient for incoming selected same process dependencies', () => {
    expect(getSelectedSameProcessDependencyLineColor(2_000, 'incoming')).toEqual(
      makeDeckColor('#ff0000ff')
    );
  });

  it('uses a red-purple gradient for outgoing selected same process dependencies', () => {
    expect(getSelectedSameProcessDependencyLineColor(2_000, 'outgoing')).toEqual(
      makeDeckColor('#a21cafff')
    );
  });

  it('keeps short selected same process dependencies in an opaque red tone', () => {
    expect(
      getDependencyLineColor(makeSameProcessDependency({waitTimeMs: 0}), EMPTY_SETTINGS, 'selected')
    ).toEqual(makeDeckColor('#ff2525ff'));
  });

  it('keeps selected cross process dependencies on the red gradient', () => {
    expect(
      getCrossRankDependencyLineColor(
        makeCrossProcessDependency({waitTimeMs: 2_000}),
        EMPTY_SETTINGS,
        'selected'
      )
    ).toEqual(makeDeckColor('#ff0000ff'));
  });

  it('uses a red gradient for incoming selected cross process dependencies', () => {
    expect(getSelectedCrossRankDependencyLineColor(2_000, 'incoming')).toEqual(
      makeDeckColor('#ff0000ff')
    );
  });

  it('uses a red-purple gradient for outgoing selected cross process dependencies', () => {
    expect(getSelectedCrossRankDependencyLineColor(2_000, 'outgoing')).toEqual(
      makeDeckColor('#a21cafff')
    );
  });

  it('keeps short selected cross process dependencies in an opaque red tone', () => {
    expect(
      getCrossRankDependencyLineColor(
        makeCrossProcessDependency({waitTimeMs: 0}),
        EMPTY_SETTINGS,
        'selected'
      )
    ).toEqual(makeDeckColor('#ff2525ff'));
  });
});
