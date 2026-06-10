import {brand} from './trace-types';

import type {TraceDependencyId, TraceSpanId} from './trace-types';

export function encodeGlobalDependencyId(
  spanId1: TraceSpanId,
  spanId2: TraceSpanId,
  type: 'directed' | 'bidirectional'
): TraceDependencyId {
  if (type === 'bidirectional') {
    // Ensure the order of the two spans is always the same for two-way dependencies so that we can match the dependency regardless of the direction.
    if (spanId1.localeCompare(spanId2) > 0) {
      [spanId1, spanId2] = [spanId2, spanId1];
    }
    // For directed dependencies, the order of the spans matters
    return brand<'dependency', string>(`dep-bidirectional(${spanId1} <-> ${spanId2})`);
  }
  return brand<'dependency', string>(`dep-directed(${spanId1} -> ${spanId2})`);
}
