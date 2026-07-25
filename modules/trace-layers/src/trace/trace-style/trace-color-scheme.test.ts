import {describe, expect, it, vi} from 'vitest';

import {
  DEFAULT_TRACE_COLOR_SCHEME,
  getReadableSpanBorderColor,
  getTraceSpanAttributeValue,
  PERFETTO_TRACE_COLOR_SCHEME,
  PROCESS_TRACE_COLOR_SCHEME
} from './trace-color-scheme';

import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {SpanRef, TraceSpan} from '../trace-graph/trace-types';
import type {
  TraceColor,
  TraceColorScheme,
  TraceSpanColorAccessorSource,
  TraceSpanColorRefParams
} from './trace-color-scheme';

const EMPTY_SETTINGS = {} as TraceVisSettings;

/** Builds one materialized span row for ref-native color-scheme tests. */
function makeSpanColorBlock(name: string): TraceSpan {
  return {
    type: 'trace-span',
    spanRef: 0 as SpanRef,
    spanId: 'span-1' as TraceSpan['spanId'],
    threadId: 'stream-1' as TraceSpan['threadId'],
    processName: 'rank-1',
    name,
    primaryTimingKey: 'default',
    timings: {},
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: [],
    userData: {}
  };
}

function makeRefParams(span: TraceSpan): TraceSpanColorRefParams {
  return {
    spanRef: span.spanRef ?? (0 as SpanRef),
    traceGraph: createSpanColorAccessorSource(span),
    settings: EMPTY_SETTINGS
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

describe('TraceColorScheme', () => {
  it('supports keyword presentation hooks in the scheme contract', () => {
    const scheme: TraceColorScheme = {
      id: 'demo',
      name: 'Demo',
      getKeywordPresentation: ({keywords}) => {
        const keyword = keywords[0];
        if (keyword !== 'ATTN') {
          return undefined;
        }

        return {
          color: [1, 2, 3, 255] as TraceColor,
          description: 'Attention span'
        };
      }
    };

    expect(scheme.getKeywordPresentation?.({keywords: ['ATTN', 'OTHER']})).toEqual({
      color: [1, 2, 3, 255],
      description: 'Attention span'
    });
    expect(scheme.getKeywordPresentation?.({keywords: ['OTHER']})).toBeUndefined();
    expect(DEFAULT_TRACE_COLOR_SCHEME.id).toBe('processes');
    expect(DEFAULT_TRACE_COLOR_SCHEME).toBe(PROCESS_TRACE_COLOR_SCHEME);
  });

  it('assigns default wheel colors by normalized span name in the Perfetto scheme', () => {
    const firstStyle = PERFETTO_TRACE_COLOR_SCHEME.getSpanStyleForRef?.(
      makeRefParams(makeSpanColorBlock('decode'))
    );
    const firstColor = firstStyle?.spanFillColor;
    const secondStyle = PERFETTO_TRACE_COLOR_SCHEME.getSpanStyleForRef?.(
      makeRefParams(makeSpanColorBlock('decode'))
    );
    const secondColor = secondStyle?.spanFillColor;
    const numberedColor = PERFETTO_TRACE_COLOR_SCHEME.getSpanStyleForRef?.(
      makeRefParams(makeSpanColorBlock('decode 123'))
    )?.spanFillColor;
    const otherColor = PERFETTO_TRACE_COLOR_SCHEME.getSpanStyleForRef?.(
      makeRefParams(makeSpanColorBlock('sample'))
    )?.spanFillColor;

    expect(firstColor).toEqual(secondColor);
    expect(firstStyle?.spanBorderColor).toEqual(secondStyle?.spanBorderColor);
    expect(firstStyle?.spanBorderColor).toEqual(getReadableSpanBorderColor(firstColor!));
    expect(firstStyle?.spanBorderColor).not.toEqual(firstColor);
    expect(numberedColor).toEqual(firstColor);
    expect(firstColor).not.toEqual(otherColor);
  });

  it('colors by canonical process name without reading row attributes', () => {
    const firstParams = makeRefParams({
      ...makeSpanColorBlock('first'),
      processName: 'rank-a',
      userData: {processId: 'shared-user-process'}
    });
    const sameNameParams = makeRefParams({
      ...makeSpanColorBlock('second'),
      processName: 'rank-a',
      userData: {processId: 'different-user-process'}
    });
    const otherNameParams = makeRefParams({
      ...makeSpanColorBlock('third'),
      processName: 'rank-b',
      userData: {processId: 'shared-user-process'}
    });
    const firstAttributeSpy = vi.spyOn(firstParams.traceGraph, 'getSpanAttribute');
    const sameNameAttributeSpy = vi.spyOn(sameNameParams.traceGraph, 'getSpanAttribute');
    const otherNameAttributeSpy = vi.spyOn(otherNameParams.traceGraph, 'getSpanAttribute');

    const firstColor = PROCESS_TRACE_COLOR_SCHEME.getSpanFillColorForRef?.(firstParams);
    const sameNameColor = PROCESS_TRACE_COLOR_SCHEME.getSpanFillColorForRef?.(sameNameParams);
    const otherNameColor = PROCESS_TRACE_COLOR_SCHEME.getSpanFillColorForRef?.(otherNameParams);
    const firstLineColor = PROCESS_TRACE_COLOR_SCHEME.getSpanBorderColorForRef?.(firstParams);

    expect(PROCESS_TRACE_COLOR_SCHEME.requiredSpanAttributePaths).toBeUndefined();
    expect(sameNameColor).toEqual(firstColor);
    expect(otherNameColor).not.toEqual(firstColor);
    expect(firstLineColor).toEqual(getReadableSpanBorderColor(firstColor!));
    expect(firstLineColor).not.toEqual(firstColor);
    expect(firstAttributeSpy).not.toHaveBeenCalled();
    expect(sameNameAttributeSpy).not.toHaveBeenCalled();
    expect(otherNameAttributeSpy).not.toHaveBeenCalled();
  });
});
