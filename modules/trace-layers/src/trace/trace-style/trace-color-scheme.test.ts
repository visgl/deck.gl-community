import {describe, expect, it} from 'vitest';

import {
  DEFAULT_TRACE_COLOR_SCHEME,
  getReadableSpanBorderColor,
  PERFETTO_TRACE_COLOR_SCHEME,
  PROCESS_TRACE_COLOR_SCHEME
} from './trace-color-scheme';

import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {TraceColor, TraceColorScheme, TraceSpanColorSource} from './trace-color-scheme';

const EMPTY_SETTINGS = {} as TraceVisSettings;

/** Builds the minimal span payload required by span-name color-scheme tests. */
function makeSpanColorBlock(name: string): TraceSpanColorSource {
  return {
    spanId: 'span-1' as TraceSpanColorSource['spanId'],
    threadId: 'stream-1' as TraceSpanColorSource['threadId'],
    processName: 'rank-1',
    name,
    primaryTimingKey: 'default',
    timings: {},
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: [],
    userData: {}
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
    const firstStyle = PERFETTO_TRACE_COLOR_SCHEME.getSpanStyle?.({
      span: makeSpanColorBlock('decode'),
      settings: EMPTY_SETTINGS
    });
    const firstColor = firstStyle?.spanFillColor;
    const secondStyle = PERFETTO_TRACE_COLOR_SCHEME.getSpanStyle?.({
      span: makeSpanColorBlock('decode'),
      settings: EMPTY_SETTINGS
    });
    const secondColor = secondStyle?.spanFillColor;
    const numberedColor = PERFETTO_TRACE_COLOR_SCHEME.getSpanStyle?.({
      span: makeSpanColorBlock('decode 123'),
      settings: EMPTY_SETTINGS
    })?.spanFillColor;
    const otherColor = PERFETTO_TRACE_COLOR_SCHEME.getSpanStyle?.({
      span: makeSpanColorBlock('sample'),
      settings: EMPTY_SETTINGS
    })?.spanFillColor;

    expect(firstColor).toEqual(secondColor);
    expect(firstStyle?.spanBorderColor).toEqual(secondStyle?.spanBorderColor);
    expect(firstStyle?.spanBorderColor).toEqual(getReadableSpanBorderColor(firstColor!));
    expect(firstStyle?.spanBorderColor).not.toEqual(firstColor);
    expect(numberedColor).toEqual(firstColor);
    expect(firstColor).not.toEqual(otherColor);
  });

  it('prefers userData.processId over processName in the process-id scheme', () => {
    const firstColor = PROCESS_TRACE_COLOR_SCHEME.getSpanFillColor?.({
      span: {
        ...makeSpanColorBlock('first'),
        processName: 'rank-a',
        userData: {processId: 'process-1'}
      },
      settings: EMPTY_SETTINGS
    });
    const secondColor = PROCESS_TRACE_COLOR_SCHEME.getSpanFillColor?.({
      span: {
        ...makeSpanColorBlock('second'),
        processName: 'rank-b',
        userData: {processId: 'process-1'}
      },
      settings: EMPTY_SETTINGS
    });
    const thirdColor = PROCESS_TRACE_COLOR_SCHEME.getSpanFillColor?.({
      span: {
        ...makeSpanColorBlock('third'),
        processName: 'rank-c',
        userData: {processId: 'process-2'}
      },
      settings: EMPTY_SETTINGS
    });
    const firstLineColor = PROCESS_TRACE_COLOR_SCHEME.getSpanBorderColor?.({
      span: {
        ...makeSpanColorBlock('first'),
        processName: 'rank-a',
        userData: {processId: 'process-1'}
      },
      settings: EMPTY_SETTINGS
    });
    const secondLineColor = PROCESS_TRACE_COLOR_SCHEME.getSpanBorderColor?.({
      span: {
        ...makeSpanColorBlock('second'),
        processName: 'rank-b',
        userData: {processId: 'process-1'}
      },
      settings: EMPTY_SETTINGS
    });

    expect(secondColor).toEqual(firstColor);
    expect(secondLineColor).toEqual(firstLineColor);
    expect(firstLineColor).toEqual(getReadableSpanBorderColor(firstColor!));
    expect(firstLineColor).not.toEqual(firstColor);
    expect(thirdColor).not.toEqual(firstColor);
  });
});
