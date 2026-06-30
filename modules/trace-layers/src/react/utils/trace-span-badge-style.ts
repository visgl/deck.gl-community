import {createTraceColorResolver, createTraceGraphColorResolver} from '../../trace/index';

import type {
  SpanRef,
  TraceColorScheme,
  TraceGraph,
  TraceSpan,
  TraceSpanColorSource,
  TraceVisSettings
} from '../../trace/index';

export type TraceSpanBadgeStyle = {
  backgroundColor?: string;
  color?: string;
};

export const colorToRgbaCss = (
  color: Readonly<[number, number, number, number]>,
  background: Readonly<[number, number, number]> = [255, 255, 255]
) => {
  let [r, g, b] = color;
  const alpha = Math.max(0, Math.min(1, color[3] / 255));
  if (alpha < 1) {
    const [r0, g0, b0] = background;
    r = lerp(r, r0, alpha);
    g = lerp(g, g0, alpha);
    b = lerp(b, b0, alpha);
  }
  return `rgb(${r},${g},${b})`;
};

function lerp(from: number, to: number, ratio: number) {
  return from * ratio + to * (1 - ratio);
}

export function getTraceSpanBadgeStyle(
  block: TraceSpanColorSource | TraceSpan | null | undefined,
  settings: TraceVisSettings,
  colorScheme: TraceColorScheme,
  highlightedSpanRefs?: ReadonlySet<SpanRef>
): TraceSpanBadgeStyle {
  if (!block) {
    return {};
  }

  const colorResolver = createTraceColorResolver({colorScheme, settings, highlightedSpanRefs});
  const fillColor = colorResolver.getSpanFillColor(block, 'any');
  const textColor = colorResolver.getSpanTextColor(block, 'any', 'inside');

  return {
    backgroundColor: colorToRgbaCss(fillColor),
    color: colorToRgbaCss(textColor)
  };
}

/**
 * Returns span badge colors for one span ref using TraceGraph field accessors.
 */
export function getTraceSpanBadgeStyleForRef(
  traceGraph: Readonly<TraceGraph>,
  spanRef: SpanRef | null | undefined,
  settings: TraceVisSettings,
  colorScheme: TraceColorScheme,
  highlightedSpanRefs?: ReadonlySet<SpanRef>
): TraceSpanBadgeStyle {
  if (spanRef == null) {
    return {};
  }

  const colorResolver = createTraceGraphColorResolver({
    traceGraph,
    colorScheme,
    settings,
    highlightedSpanRefs
  });
  const fillColor = colorResolver.getSpanFillColor(spanRef, 'any');
  const textColor = colorResolver.getSpanTextColor(spanRef, 'any', 'inside');

  return {
    backgroundColor: colorToRgbaCss(fillColor),
    color: colorToRgbaCss(textColor)
  };
}
