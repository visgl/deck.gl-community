import {isValidElement} from 'react';
import {describe, expect, it, vi} from 'vitest';

import {TRACE_SPAN_FILTER_MASK_NONE} from '../../../../../trace/index';
import {
  emitDependencyHoverFromResolvedBlocks,
  renderDependencyProcessBadge
} from './trace-span-card-dependency-shared';

import type {SpanRef, TraceCardSpan, TraceSpanId} from '../../../../../trace/index';
import type {ReactNode} from 'react';

/** Builds one minimal selected-card span row for dependency-hover tests. */
function createSpan(spanId: string, processName = 'rank', spanRef = 0): TraceCardSpan {
  return {
    spanRef: spanRef as SpanRef,
    spanId: spanId as TraceSpanId,
    threadId: 'stream' as TraceCardSpan['threadId'],
    processName,
    name: spanId,
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: [],
    primaryTimingKey: 'primary',
    timings: {},
    filterMask: TRACE_SPAN_FILTER_MASK_NONE,
    isFiltered: false
  };
}

describe('emitDependencyHoverFromResolvedBlocks', () => {
  it('clears stale dependency hover refs before emitting the next row endpoints', () => {
    const onBlockHover = vi.fn();

    emitDependencyHoverFromResolvedBlocks({
      startSpan: createSpan('parent', 'rank', 0),
      endSpan: createSpan('child', 'rank', 1),
      onBlockHover
    });

    expect(onBlockHover.mock.calls).toEqual([[null], [0], [1]]);
  });
});

describe('renderDependencyProcessBadge', () => {
  it('labels spans in the selected span process as same', () => {
    const badge = renderDependencyProcessBadge({
      span: createSpan('child', 'rank-one'),
      currentSpan: createSpan('current', 'rank-one'),
      traceLabels: {
        processLabel: 'Process',
        processLabelUpper: 'PROCESS',
        processLabelLower: 'process',
        processLabelPlural: 'Processes',
        spanLabel: 'Span',
        spanLabelUpper: 'SPAN',
        spanLabelLower: 'span',
        spanLabelPlural: 'Spans',
        threadLabel: 'Thread',
        threadLabelUpper: 'THREAD',
        threadLabelLower: 'thread'
      }
    });

    expect(badge).toBe('<same>');
  });

  it('omits the tooltip when the process label is not truncated', () => {
    const badge = renderDependencyProcessBadge({
      span: createSpan('child', 'rank-two'),
      currentSpan: createSpan('current', 'rank-one'),
      traceLabels: {
        processLabel: 'Process',
        processLabelUpper: 'PROCESS',
        processLabelLower: 'process',
        processLabelPlural: 'Processes',
        spanLabel: 'Span',
        spanLabelUpper: 'SPAN',
        spanLabelLower: 'span',
        spanLabelPlural: 'Spans',
        threadLabel: 'Thread',
        threadLabelUpper: 'THREAD',
        threadLabelLower: 'thread'
      }
    });

    expect(isValidElement<{children?: ReactNode}>(badge)).toBe(true);
    if (!isValidElement<{children?: ReactNode}>(badge)) {
      throw new Error('Expected dependency process badge element');
    }
    expect(badge.type).toBe('div');
    expect(badge.props.children).toBe('rank-two');
  });

  it('front-truncates long process labels and keeps the full label in the tooltip', () => {
    const badge = renderDependencyProcessBadge({
      span: createSpan('child', 'starling/client/very/deep/process'),
      currentSpan: createSpan('current', 'rank-one'),
      traceLabels: {
        processLabel: 'Process',
        processLabelUpper: 'PROCESS',
        processLabelLower: 'process',
        processLabelPlural: 'Processes',
        spanLabel: 'Span',
        spanLabelUpper: 'SPAN',
        spanLabelLower: 'span',
        spanLabelPlural: 'Spans',
        threadLabel: 'Thread',
        threadLabelUpper: 'THREAD',
        threadLabelLower: 'thread'
      }
    });

    expect(isValidElement<{children?: ReactNode; tooltip?: ReactNode}>(badge)).toBe(true);
    if (!isValidElement<{children?: ReactNode; tooltip?: ReactNode}>(badge)) {
      throw new Error('Expected dependency process tooltip element');
    }
    expect(badge.props.tooltip).toBe('Process: starling/client/very/deep/process');
    const child = badge.props.children;
    expect(isValidElement<{children?: ReactNode}>(child)).toBe(true);
    if (!isValidElement<{children?: ReactNode}>(child)) {
      throw new Error('Expected dependency process badge tooltip child');
    }
    expect(child.props.children).toBe('...p/process');
  });
});
