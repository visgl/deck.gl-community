import React from 'react';
import {ChevronLeft, ChevronRight} from 'lucide-react';

import {TRACE_SPAN_FILTER_MASK_NONE} from '../../trace/index';
import {colorToRgbaCss} from '../utils/trace-span-badge-style';
import {TraceSpanBadge} from './trace-span-badge';
import {cn} from './ui';
import {WithTooltip} from './with-tooltip';

import type {SpanRef, TraceGraph, TraceSpanFilterMask, TraceStyle} from '../../trace/index';

export type TraceBreadcrumbEntry = {
  /** Canonical span ref for the breadcrumb entry. */
  spanRef: SpanRef;
  /** Display name shown for the breadcrumb entry. */
  spanName?: string | null;
  /** Keyword labels copied from the selected span for badge styling. */
  spanKeywords?: string[] | null;
  /** Background color used by the breadcrumb badge. */
  blockColor?: string | null;
  /** Foreground text color used by the breadcrumb badge. */
  blockTextColor?: string | null;
  /** Exact graph filter provenance used to explain filtered breadcrumbs. */
  filterMask?: TraceSpanFilterMask | null;
  /** Whether the breadcrumb span is hidden by the current filtered view. */
  isFiltered?: boolean | null;
};

export type BreadcrumbNavigatorProps = {
  traceStyle: TraceStyle;
  /** Current graph used to resolve live filter state for breadcrumb span refs. */
  traceGraph?: Readonly<TraceGraph> | null;
  currentRank?: number | null;
  breadcrumb: TraceBreadcrumbEntry[];
  activeIndex: number;
  goToBreadcrumb: (index: number) => void;
  /** Canonical span-ref centered on selection when available. */
  zoomToSpanRef?: (spanRef: SpanRef) => void;
};

export const BreadcrumbNavigator: React.FC<BreadcrumbNavigatorProps> = props => {
  const {
    traceStyle,
    traceGraph,
    currentRank,
    breadcrumb,
    goToBreadcrumb,
    activeIndex,
    zoomToSpanRef
  } = props;
  const activeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const activeRank = currentRank ?? null;

  React.useEffect(() => {
    const activeButton = activeButtonRef.current;
    if (!activeButton) {
      return;
    }

    activeButton.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center'
    });
  }, [activeIndex, breadcrumb.length]);

  if (!breadcrumb.length) {
    return null;
  }

  const handleJump = (targetIndex: number) => {
    const entry = breadcrumb[targetIndex];
    if (!entry) {
      return;
    }

    goToBreadcrumb?.(targetIndex);
    if (entry.spanRef != null) {
      zoomToSpanRef?.(entry.spanRef);
    }
  };

  const handleStep = (direction: 1 | -1) => {
    const nextIndex = activeIndex + direction;
    if (nextIndex < 0 || nextIndex >= breadcrumb.length) {
      return;
    }
    handleJump(nextIndex);
  };

  const canStepBack = breadcrumb.length > 1 && activeIndex > 0;
  const canStepForward = breadcrumb.length > 1 && activeIndex < breadcrumb.length - 1;

  return (
    <div className="pointer-events-auto w-full">
      <nav
        aria-label="Trace breadcrumb trail"
        className="flex flex-col gap-1.5 rounded-md px-2 text-xs"
      >
        <div className="flex items-center gap-2">
          <ol className="flex min-h-[1.9rem] flex-1 items-center gap-1 pl-1 overflow-x-auto">
            {breadcrumb.map((entry, index) => {
              const label = entry.spanName || String(entry.spanRef);
              const isActive = index === activeIndex;
              const colorPresentation =
                entry.spanKeywords?.length && traceStyle.colorScheme?.getKeywordPresentation
                  ? traceStyle.colorScheme.getKeywordPresentation({keywords: entry.spanKeywords})
                  : undefined;
              const color = colorPresentation?.color
                ? colorToRgbaCss(colorPresentation.color)
                : undefined;
              const badgeBackgroundColor = entry.blockColor ?? color;
              const badgeTextColor = entry.blockTextColor;
              const tooltip = entry.spanKeywords?.length
                ? colorPresentation?.description || entry.spanName
                : undefined;
              const filterState = getTraceBreadcrumbFilterState(entry, traceGraph);
              const filterMask = filterState.filterMask;
              const isFiltered = filterState.isFiltered;
              const badgeStyle = badgeBackgroundColor
                ? {
                    backgroundColor: badgeBackgroundColor,
                    ...(badgeTextColor ? {color: badgeTextColor} : undefined)
                  }
                : undefined;

              const crumbButton = (
                <button
                  ref={isActive ? activeButtonRef : undefined}
                  type="button"
                  onClick={() => handleJump(index)}
                  className={cn(
                    'group flex max-w-[12rem] shrink-0 items-center rounded-full text-left transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    isActive
                      ? 'scale-[1.015]'
                      : 'opacity-60 hover:opacity-90 focus-visible:opacity-100'
                  )}
                  aria-current={isActive ? 'step' : undefined}
                >
                  <TraceSpanBadge
                    className={cn(
                      'pointer-events-none flex min-w-0 items-center gap-2 rounded-full border px-2.5 py-[0.15rem] text-[11px] font-medium leading-4 shadow-sm transition-shadow',
                      isActive ? 'shadow-md ring-2' : undefined,
                      isActive && !isFiltered ? 'border-white' : undefined
                    )}
                    style={badgeStyle}
                    maxLabelLength={25}
                    label={String(label)}
                    baseTooltipText={tooltip ?? String(label)}
                    filtered={isFiltered}
                    filterMask={filterMask}
                    blockRank={null}
                    showRank
                    currentRank={activeRank}
                    traceLabels={traceStyle.labels}
                  />
                </button>
              );

              const crumbContent = tooltip ? (
                <WithTooltip tooltip={tooltip}>{crumbButton}</WithTooltip>
              ) : (
                crumbButton
              );

              return (
                <li key={`${entry.spanRef}-${index}`} className="flex items-center gap-1">
                  {index > 0 && (
                    <ChevronRight aria-hidden className="h-2.5 w-2.5 text-muted-foreground" />
                  )}
                  {crumbContent}
                </li>
              );
            })}
          </ol>
          <div className="flex items-center gap-1">
            <WithTooltip tooltip="Previous breadcrumb">
              <button
                type="button"
                className="h-7 w-7 inline-flex items-center justify-center rounded border border-border bg-card text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!canStepBack}
                onClick={() => handleStep(-1)}
                aria-label="Go to previous breadcrumb"
              >
                <ChevronLeft size={16} />
              </button>
            </WithTooltip>
            <WithTooltip tooltip="Next breadcrumb">
              <button
                type="button"
                className="h-7 w-7 inline-flex items-center justify-center rounded border border-border bg-card text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!canStepForward}
                onClick={() => handleStep(1)}
                aria-label="Go to next breadcrumb"
              >
                <ChevronRight size={16} />
              </button>
            </WithTooltip>
          </div>
        </div>
      </nav>
    </div>
  );
};

/**
 * Resolves breadcrumb filter state from the current graph before falling back to stored entry data.
 */
function getTraceBreadcrumbFilterState(
  entry: TraceBreadcrumbEntry,
  traceGraph: Readonly<TraceGraph> | null | undefined
): {filterMask: TraceSpanFilterMask; isFiltered: boolean} {
  const graphHasSpan = traceGraph?.getSpanName(entry.spanRef) != null;
  if (traceGraph && graphHasSpan) {
    const reason = traceGraph.spanFilterReason(entry.spanRef);
    return {
      filterMask: reason.filterMask,
      isFiltered: reason.isFiltered
    };
  }

  const filterMask = entry.filterMask ?? TRACE_SPAN_FILTER_MASK_NONE;
  return {
    filterMask,
    isFiltered: Boolean(entry.isFiltered) || filterMask !== TRACE_SPAN_FILTER_MASK_NONE
  };
}
