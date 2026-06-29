import {describe, expect, it} from 'vitest';

import {resolveDeckTraceGraphHoverPayload} from './deck-trace-graph-hover';

import type {EventRef, TraceEventId} from '../../../trace/index';

describe('resolveDeckTraceGraphHoverPayload', () => {
  it('ignores primitive selected-span picking payloads', () => {
    expect(resolveDeckTraceGraphHoverPayload(8_589_934_834)).toEqual({
      object: null,
      content: null
    });
  });

  it('unwraps overview marker datums returned by the minimap scatterplot layer', () => {
    const payload = resolveDeckTraceGraphHoverPayload({
      object: {
        id: 'marker-1',
        timeMs: 1_000,
        tooltip: 'Marker tooltip'
      }
    });

    expect(payload).toEqual({
      object: null,
      content: 'Marker tooltip'
    });
  });

  it('keeps graph-global run events on the trace-object tooltip path', () => {
    const event = {
      type: 'trace-event',
      eventId: 'event-1' as TraceEventId,
      eventRef: 1 as EventRef,
      name: 'Run event',
      atTimeMs: 1000
    } as const;

    expect(resolveDeckTraceGraphHoverPayload(event)).toEqual({
      object: event,
      content: null
    });
  });
});
