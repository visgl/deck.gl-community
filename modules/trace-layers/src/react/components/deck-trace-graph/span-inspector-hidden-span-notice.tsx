import {TriangleAlert} from 'lucide-react';

import {getTraceSpanFilterReasonLabel} from '../../utils/trace-span-filter-reason';

import type {SpanRef, TraceSpanFilterMask} from '../../../trace/index';

/** Props for the hidden-span notice rendered above an inspector span card. */
export type SpanInspectorHiddenSpanNoticeProps = {
  /** Exact active filter provenance for the inspected hidden span. */
  filterMask?: TraceSpanFilterMask;
  /** Explicit reason text for app-owned hidden spans outside generic graph filters. */
  reasonLabel?: string;
  /** First visible descendant suitable for explicit navigation, when available. */
  visibleDescendantSpanRef: SpanRef | null;
  /** Nearest visible ancestor suitable for explicit navigation, when available. */
  visibleAncestorSpanRef: SpanRef | null;
  /** Inspector-owned navigation callback for explicit visible-target actions. */
  onNavigateToSpanRef: (spanRef: SpanRef) => void;
};

/** Render a prominent inspector notice for spans hidden from the rendered timeline. */
export function SpanInspectorHiddenSpanNotice(props: SpanInspectorHiddenSpanNoticeProps) {
  const reasonLabel =
    props.reasonLabel ?? getTraceSpanFilterReasonLabel(props.filterMask) ?? 'Hidden Span';
  const visibleDescendantSpanRef = props.visibleDescendantSpanRef;
  const visibleAncestorSpanRef = props.visibleAncestorSpanRef;
  const hasVisibleNavigation = visibleDescendantSpanRef != null || visibleAncestorSpanRef != null;

  return (
    <div className="rounded border border-border bg-muted/60 px-3 py-2 text-xs text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <TriangleAlert className="size-4 shrink-0 text-orange-500" aria-hidden="true" />
        <span className="font-semibold">Hidden Span</span>
        {hasVisibleNavigation ? (
          <>
            <span className="text-muted-foreground">Go to closest visible</span>
            {visibleAncestorSpanRef != null ? (
              <button
                type="button"
                className="rounded border border-border bg-background px-2 py-0.5 text-xs transition hover:bg-accent"
                onClick={() => {
                  props.onNavigateToSpanRef(visibleAncestorSpanRef);
                }}
              >
                Ancestor
              </button>
            ) : null}
            {visibleDescendantSpanRef != null ? (
              <button
                type="button"
                className="rounded border border-border bg-background px-2 py-0.5 text-xs transition hover:bg-accent"
                onClick={() => {
                  props.onNavigateToSpanRef(visibleDescendantSpanRef);
                }}
              >
                Descendant
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="mt-1 text-muted-foreground">{reasonLabel}</div>
    </div>
  );
}
