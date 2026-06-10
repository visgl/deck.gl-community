import type {TraceObject, TraceRenderSpan} from '../../../trace/index';
import type {ReactNode} from 'react';

/**
 * Trace payloads that can render through the standard deck trace tooltip surface.
 */
export type DeckTraceGraphHoverObject = TraceObject | TraceRenderSpan;

/**
 * Normalized hover payload consumed by the shared deck trace tooltip renderer.
 */
export type DeckTraceGraphHoverPayload = {
  /** Trace object to render through the standard trace tooltip surface. */
  object: DeckTraceGraphHoverObject | null;
  /** Custom React tooltip content for non-trace hover targets. */
  content: ReactNode | null;
};

/**
 * Returns true when a deck.gl picking payload is a render-facing span payload.
 */
export function isTraceRenderSpanObject(value: unknown): value is TraceRenderSpan {
  return (
    isObjectLike(value) &&
    'spanRef' in value &&
    typeof value.spanRef === 'number' &&
    'spanId' in value &&
    typeof value.spanId === 'string'
  );
}

/**
 * Normalize deck.gl hover objects into either a trace-object tooltip or custom content.
 */
export function resolveDeckTraceGraphHoverPayload(
  objectFromInfo: unknown
): DeckTraceGraphHoverPayload {
  if (!isObjectLike(objectFromInfo)) {
    return {object: null, content: null};
  }
  if (isTraceObject(objectFromInfo)) {
    return {object: objectFromInfo, content: null};
  }
  if (isTraceRenderSpanObject(objectFromInfo)) {
    return {object: objectFromInfo, content: null};
  }
  if ('stream' in objectFromInfo) {
    return {
      object: isTraceObject(objectFromInfo.stream) ? objectFromInfo.stream : null,
      content: null
    };
  }
  if ('timeMs' in objectFromInfo) {
    return {object: null, content: (objectFromInfo.tooltip as ReactNode | undefined) ?? null};
  }
  if ('object' in objectFromInfo && isObjectLike(objectFromInfo.object)) {
    const nestedObject = objectFromInfo.object;
    if (
      'type' in nestedObject &&
      typeof nestedObject.type === 'string' &&
      nestedObject.type.startsWith('trace-')
    ) {
      return {object: nestedObject as unknown as TraceObject, content: null};
    }
    return {object: null, content: (nestedObject.tooltip as ReactNode | undefined) ?? null};
  }
  return {object: null, content: null};
}

/** Returns true when a deck.gl picking payload is a normalized trace object. */
function isTraceObject(value: unknown): value is TraceObject {
  return (
    isObjectLike(value) &&
    'type' in value &&
    typeof value.type === 'string' &&
    value.type.startsWith('trace-')
  );
}

/** Returns true when a deck.gl picking payload can safely be inspected with property guards. */
function isObjectLike(value: unknown): value is Record<PropertyKey, unknown> {
  return value !== null && typeof value === 'object';
}
