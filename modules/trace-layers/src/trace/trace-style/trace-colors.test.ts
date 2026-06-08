import {describe, expect, it} from 'vitest';

import {
  COLORS,
  COLORS_LIST,
  createColorWheel,
  createTraceColorResolver,
  DEFAULT_TRACE_COLOR_SCHEME,
  getCrossRankDependencyLineColor,
  getDependencyLineColor,
  getPerfettoSliceColor,
  getSelectedCrossRankDependencyLineColor,
  getSelectedLocalDependencyLineColor,
  makeDeckColor,
  TRACE_COLOR
} from './trace-colors';

import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceLocalDependency,
  TraceSpan,
  TraceThread
} from '../trace-graph/trace-types';
import type {TraceColorScheme} from './trace-color-scheme';
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
    localDependencyIds: [],
    localDependencies: [],
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
  return createTraceColorResolver({colorScheme, settings, highlightedSpanRefs}).getSpanFillColor(
    span,
    path
  );
}

function resolveSpanBorderColor(
  span: TraceSpan,
  settings: TraceVisSettings,
  path?: 'path',
  colorScheme?: TraceColorScheme,
  highlightedSpanRefs?: ReadonlySet<SpanRef>
): TraceDeckColor {
  return createTraceColorResolver({
    colorScheme,
    settings,
    highlightedSpanRefs
  }).getSpanBorderColor(span, path);
}

function resolveSpanTextColor(
  span: TraceSpan,
  settings: TraceVisSettings,
  path?: 'path' | 'any',
  colorScheme?: TraceColorScheme,
  highlightedSpanRefs?: ReadonlySet<SpanRef>,
  labelPlacement: 'inside' | 'outside' = 'inside'
): TraceDeckColor {
  return createTraceColorResolver({colorScheme, settings, highlightedSpanRefs}).getSpanTextColor(
    span,
    path,
    labelPlacement
  );
}

function resolveThreadColor(
  thread: TraceThread | undefined,
  colorScheme?: TraceColorScheme
): TraceDeckColor | undefined {
  return createTraceColorResolver({
    colorScheme,
    settings: EMPTY_SETTINGS
  }).getThreadColor(thread);
}

function resolveSpanTextColorFromFill(fillColor: TraceDeckColor): TraceDeckColor {
  return createTraceColorResolver({
    colorScheme: {
      id: 'text-from-fill',
      name: 'Text From Fill',
      getSpanFillColor: () => fillColor
    },
    settings: EMPTY_SETTINGS
  }).getSpanTextColor(makeBlock(), 'any');
}

function makeLocalDependency(overrides?: Partial<TraceLocalDependency>): TraceLocalDependency {
  return {
    type: 'trace-local-dependency',
    dependencyRef: 0 as TraceLocalDependency['dependencyRef'],
    startSpanRef: 0 as SpanRef,
    endSpanRef: 1 as SpanRef,
    dependencyId: 'dep-1' as TraceLocalDependency['dependencyId'],
    startSpanId: 'span-1' as TraceLocalDependency['startSpanId'],
    endSpanId: 'span-2' as TraceLocalDependency['endSpanId'],
    keywords: new Set(),
    waitMode: 'end-to-start',
    bidirectional: false,
    waitTimeMs: 0,
    ...overrides
  };
}

function makeCrossDependency(
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

  it('prefers explicit span fill color over keyword presentation', () => {
    const colorScheme = {
      id: 'override-scheme',
      name: 'Override',
      getKeywordPresentation: () => ({
        color: [1, 2, 3, 255] as TraceDeckColor
      }),
      getSpanFillColor: () => [255, 0, 0, 255] as const
    } satisfies TraceColorScheme;

    expect(
      resolveSpanFillColor(makeBlock({keywords: ['ATTN']}), EMPTY_SETTINGS, undefined, colorScheme)
    ).toEqual([255, 0, 0, 255]);
  });

  it('preserves color-scheme fill colors for unfinished spans', () => {
    const colorScheme = {
      id: 'unfinished-override-scheme',
      name: 'Unfinished Override',
      getSpanFillColor: () => [255, 0, 255, 255] as const
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

  it('does not use the cross-rank pink fallback for unfinished spans', () => {
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
          },
          crossProcessDependencyEndpoints: [
            {} as TraceSpan['crossProcessDependencyEndpoints'][number]
          ]
        }),
        EMPTY_SETTINGS,
        undefined,
        undefined
      )
    ).toEqual(TRACE_COLOR.SPAN_FINISHED_FILL);
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
      getSpanFillColor: () => [0, 0, 255, 255] as const,
      getSpanBorderColor: () => [0, 0, 0, 255] as const
    };

    expect(resolveSpanTextColor(makeBlock(), EMPTY_SETTINGS, 'any', strategy)).toEqual([
      255, 255, 255, 255
    ]);
  });

  it('prefers strategy text color when provided', () => {
    const strategy = {
      id: 'strategy',
      name: 'Strategy',
      getSpanFillColor: () => [240, 240, 240, 255] as const,
      getSpanTextColor: () => [255, 0, 0, 255] as const,
      getSpanBorderColor: () => [0, 0, 0, 255] as const
    };

    expect(resolveSpanTextColor(makeBlock(), EMPTY_SETTINGS, 'any', strategy)).toEqual([
      255, 0, 0, 255
    ]);
  });

  it('prefers style span text color when provided', () => {
    const strategy = {
      id: 'strategy',
      name: 'Strategy',
      getSpanStyle: () => ({
        spanTextColor: [0, 255, 0, 255] as const
      }),
      getSpanFillColor: () => [240, 240, 240, 255] as const,
      getSpanBorderColor: () => [0, 0, 0, 255] as const
    };

    expect(resolveSpanTextColor(makeBlock(), EMPTY_SETTINGS, 'any', strategy)).toEqual([
      0, 255, 0, 255
    ]);
  });

  it('uses white text for dark spans and black for light spans by default contrast', () => {
    const lightFillStrategy = {
      id: 'light',
      name: 'Light',
      getSpanFillColor: () => [240, 240, 240, 255] as const,
      getSpanBorderColor: () => [0, 0, 0, 255] as const
    };

    const darkFillStrategy = {
      id: 'dark',
      name: 'Dark',
      getSpanFillColor: () => [30, 30, 30, 255] as const,
      getSpanBorderColor: () => [0, 0, 0, 255] as const
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
      getSpanFillColor: () => [240, 240, 240, 255] as const,
      getSpanBorderColor: () => [0, 0, 0, 255] as const
    };
    const darkFillStrategy = {
      id: 'dark',
      name: 'Dark',
      getSpanFillColor: () => [10, 10, 10, 255] as const,
      getSpanBorderColor: () => [0, 0, 0, 255] as const
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
      getSpanFillColor: () => [171, 71, 188, 80] as const,
      getSpanBorderColor: () => [0, 0, 0, 255] as const
    };

    expect(
      resolveSpanTextColor(makeBlock(), EMPTY_SETTINGS, 'any', translucentFillStrategy)
    ).toEqual([0, 0, 0, 255]);
    expect(
      resolveSpanTextColor(makeBlock(), EMPTY_SETTINGS, 'any', {
        ...translucentFillStrategy,
        getSpanFillColor: () => [0, 95, 204, 255] as const
      })
    ).toEqual([255, 255, 255, 255]);
  });

  it('keeps text fully opaque when non-selected spans are faded', () => {
    const strategy = {
      id: 'selection-fade',
      name: 'Selection fade',
      getSpanFillColor: () => [30, 30, 30, 255] as const,
      getSpanBorderColor: () => [0, 0, 0, 255] as const
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
      getSpanFillColor: () => [30, 30, 30, 255] as const,
      getSpanStyle: () => ({
        spanTextColor: [255, 255, 255, 255] as const
      }),
      getSpanBorderColor: () => [0, 0, 0, 255] as const
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
      makeBlock({processName: 'starling/actor-hierarchy/1'}),
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

  it('renders ordinary local dependencies in a distinct saturated yellow', () => {
    expect(getDependencyLineColor(makeLocalDependency(), EMPTY_SETTINGS)).toEqual(
      makeDeckColor('#eab308ff')
    );
  });

  it('renders cross-rank dependencies in a distinct saturated blue', () => {
    expect(getCrossRankDependencyLineColor(makeCrossDependency(), EMPTY_SETTINGS)).toEqual(
      makeDeckColor('#0ea5e9ff')
    );
  });

  it('keeps submit warning dependencies red', () => {
    expect(
      getDependencyLineColor(
        makeLocalDependency({
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
        makeLocalDependency({
          keywords: new Set(['SUBMIT']),
          waitTimeMs: 2_000
        }),
        EMPTY_SETTINGS
      )
    ).toEqual(makeDeckColor('#ec407a'));
  });

  it('uses a red gradient for selected local dependencies', () => {
    expect(
      getDependencyLineColor(makeLocalDependency({waitTimeMs: 2_000}), EMPTY_SETTINGS, 'selected')
    ).toEqual(makeDeckColor('#ff0000ff'));
  });

  it('uses a red gradient for incoming selected local dependencies', () => {
    expect(getSelectedLocalDependencyLineColor(2_000, 'incoming')).toEqual(
      makeDeckColor('#ff0000ff')
    );
  });

  it('uses a red-purple gradient for outgoing selected local dependencies', () => {
    expect(getSelectedLocalDependencyLineColor(2_000, 'outgoing')).toEqual(
      makeDeckColor('#a21cafff')
    );
  });

  it('keeps short selected local dependencies in an opaque red tone', () => {
    expect(
      getDependencyLineColor(makeLocalDependency({waitTimeMs: 0}), EMPTY_SETTINGS, 'selected')
    ).toEqual(makeDeckColor('#ff2525ff'));
  });

  it('keeps selected cross dependencies on the red gradient', () => {
    expect(
      getCrossRankDependencyLineColor(
        makeCrossDependency({waitTimeMs: 2_000}),
        EMPTY_SETTINGS,
        'selected'
      )
    ).toEqual(makeDeckColor('#ff0000ff'));
  });

  it('uses a red gradient for incoming selected cross dependencies', () => {
    expect(getSelectedCrossRankDependencyLineColor(2_000, 'incoming')).toEqual(
      makeDeckColor('#ff0000ff')
    );
  });

  it('uses a red-purple gradient for outgoing selected cross dependencies', () => {
    expect(getSelectedCrossRankDependencyLineColor(2_000, 'outgoing')).toEqual(
      makeDeckColor('#a21cafff')
    );
  });

  it('keeps short selected cross dependencies in an opaque red tone', () => {
    expect(
      getCrossRankDependencyLineColor(
        makeCrossDependency({waitTimeMs: 0}),
        EMPTY_SETTINGS,
        'selected'
      )
    ).toEqual(makeDeckColor('#ff2525ff'));
  });
});
