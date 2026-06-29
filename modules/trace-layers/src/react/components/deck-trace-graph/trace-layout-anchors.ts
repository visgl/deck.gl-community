import {fillTraceLayoutSpanGeometry, getTraceLayoutProcessLayoutByRef} from '../../../trace/index';

import type {SpanBoundingBox, SpanRef, ThreadRef, TraceLayout} from '../../../trace/index';

/** Label anchor resolved from trace layout coordinates. */
export type TraceLayoutLabelAnchor = {
  /** Y position of the rank or thread label in trace coordinates. */
  readonly labelY: number;
};

/** Span anchor resolved from trace layout coordinates. */
export type TraceLayoutSpanAnchor = {
  /** Distinguishes span anchors from label anchors. */
  readonly kind: 'span';
  /** Canonical span ref whose block center should stay anchored. */
  readonly spanRef: SpanRef;
  /** Y position of the block center in trace coordinates. */
  readonly centerY: number;
};

/** Pending label anchor captured before a trace layout update. */
export type PendingTraceLayoutLabelAnchor =
  | {
      /** Preserves a toggled rank label position across layout rebuilds. */
      readonly kind: 'rank';
      /** Identifies the rank id whose label should stay visually anchored. */
      readonly id: string;
      /** Optional graph index used to disambiguate duplicate rank ids across compared graphs. */
      readonly graphIndex?: number;
      /** Captures the pre-layout-rebuild label Y position in trace coordinates. */
      readonly labelY: number;
    }
  | {
      /** Preserves a toggled thread label position across layout rebuilds. */
      readonly kind: 'stream';
      /** Identifies the ingestion thread id used by interaction payloads. */
      readonly id: string;
      /** Canonical runtime thread ref whose label should stay visually anchored. */
      readonly threadRef: ThreadRef;
      /** Optional graph index used to disambiguate compared graphs. */
      readonly graphIndex?: number;
      /** Captures the pre-layout-rebuild label Y position in trace coordinates. */
      readonly labelY: number;
    };

/** Pending view anchor used to preserve a label or clicked span across layout rebuilds. */
export type PendingTraceLayoutAnchor = PendingTraceLayoutLabelAnchor | TraceLayoutSpanAnchor;

/** Resolves the current Y position for a rank label in trace coordinates. */
export function findTraceLayoutRankLabelAnchor(params: {
  /** Trace layouts to scan by graph index. */
  traceLayouts: readonly TraceLayout[];
  /** Rank id to locate in render rows. */
  processId: string;
  /** Optional graph index used to disambiguate duplicate rank ids. */
  graphIndexHint?: number;
}): TraceLayoutLabelAnchor | null {
  const graphIndexes =
    params.graphIndexHint == null
      ? params.traceLayouts.map((_, graphIndex) => graphIndex)
      : [params.graphIndexHint];
  for (const graphIndex of graphIndexes) {
    const layout = params.traceLayouts[graphIndex] ?? params.traceLayouts[0];
    if (!layout) {
      continue;
    }
    const processRow = layout.renderRows.find(row => row.processId === params.processId);
    if (!processRow) {
      continue;
    }
    const labelY = getTraceLayoutProcessLayoutByRef(layout, processRow.processRef)?.labelY ?? 0;
    return {labelY};
  }
  return null;
}

/** Resolves the current Y position for a thread label in trace coordinates. */
export function findTraceLayoutThreadLabelAnchor(params: {
  /** Trace layouts to scan by graph index. */
  traceLayouts: readonly TraceLayout[];
  /** Canonical runtime thread ref whose label should be located. */
  threadRef: ThreadRef;
}): TraceLayoutLabelAnchor | null {
  for (const layout of params.traceLayouts) {
    for (const processRow of layout.renderRows) {
      const threadIndex = processRow.threadRefs.indexOf(params.threadRef);
      if (threadIndex === -1) {
        continue;
      }
      const threadLayout =
        layout.threadLayoutMapByRef.get(params.threadRef) ??
        getTraceLayoutProcessLayoutByRef(layout, processRow.processRef)?.threadLayouts?.[
          threadIndex
        ];
      if (!threadLayout) {
        return null;
      }
      const laneYPositions = threadLayout.lanes?.laneYPositions;
      const labelY =
        laneYPositions && laneYPositions.length > 0
          ? getMinimumLaneYPosition(laneYPositions)
          : (threadLayout.startPosition?.[1] ??
            (Number.isFinite(threadLayout.yPosition) ? threadLayout.yPosition : null));
      if (!Number.isFinite(labelY)) {
        return null;
      }
      return {labelY};
    }
  }
  return null;
}

function getMinimumLaneYPosition(laneYPositions: readonly number[]): number {
  let minimumYPosition = laneYPositions[0] ?? 0;
  for (let index = 1; index < laneYPositions.length; index++) {
    const laneYPosition = laneYPositions[index]!;
    if (laneYPosition < minimumYPosition) {
      minimumYPosition = laneYPosition;
    }
  }
  return minimumYPosition;
}

/** Resolves the current block geometry for one canonical span ref. */
export function findTraceLayoutSpanGeometry(params: {
  /** Trace layouts to scan for span geometry. */
  traceLayouts: readonly TraceLayout[];
  /** Canonical span ref whose geometry should be resolved. */
  spanRef: SpanRef;
}): SpanBoundingBox | null {
  const target = {x1: 0, y1: 0, x2: 0, y2: 0};
  for (const layout of params.traceLayouts) {
    if (
      fillTraceLayoutSpanGeometry({
        traceLayout: layout,
        spanRef: params.spanRef,
        target
      })
    ) {
      return new Float32Array([target.x1, target.y1, target.x2, target.y2]) as SpanBoundingBox;
    }
  }
  return null;
}

/** Resolves the current block-center anchor for one canonical span ref. */
export function findTraceLayoutSpanAnchor(params: {
  /** Trace layouts to scan for span geometry. */
  traceLayouts: readonly TraceLayout[];
  /** Canonical span ref whose block center should be anchored. */
  spanRef: SpanRef;
}): TraceLayoutSpanAnchor | null {
  const geometry = findTraceLayoutSpanGeometry(params);
  if (!geometry) {
    return null;
  }
  return {
    kind: 'span',
    spanRef: params.spanRef,
    centerY: getSpanCenterY(geometry)
  };
}

/** Computes the trace-coordinate Y delta for a span anchor between two layout snapshots. */
export function getTraceLayoutSpanAnchorDeltaY(params: {
  /** Layout snapshot before the transition. */
  previousTraceLayouts: readonly TraceLayout[];
  /** Layout snapshot after the transition. */
  nextTraceLayouts: readonly TraceLayout[];
  /** Canonical span ref whose block center should stay visually anchored. */
  spanRef: SpanRef;
}): number | null {
  const previousAnchor = findTraceLayoutSpanAnchor({
    traceLayouts: params.previousTraceLayouts,
    spanRef: params.spanRef
  });
  if (!previousAnchor) {
    return null;
  }
  const nextAnchor = findTraceLayoutSpanAnchor({
    traceLayouts: params.nextTraceLayouts,
    spanRef: params.spanRef
  });
  if (!nextAnchor) {
    return null;
  }
  const deltaY = nextAnchor.centerY - previousAnchor.centerY;
  return Number.isFinite(deltaY) ? deltaY : null;
}

/** Resolves a pending anchor against the latest trace layouts. */
export function resolvePendingTraceLayoutAnchor(params: {
  /** Pending anchor captured before the trace layout update. */
  pendingAnchor: PendingTraceLayoutAnchor;
  /** Latest trace layouts to scan. */
  traceLayouts: readonly TraceLayout[];
}): TraceLayoutLabelAnchor | TraceLayoutSpanAnchor | null {
  const {pendingAnchor, traceLayouts} = params;
  if (pendingAnchor.kind === 'span') {
    return findTraceLayoutSpanAnchor({traceLayouts, spanRef: pendingAnchor.spanRef});
  }
  if (pendingAnchor.kind === 'rank') {
    return findTraceLayoutRankLabelAnchor({
      traceLayouts,
      processId: pendingAnchor.id,
      graphIndexHint: pendingAnchor.graphIndex
    });
  }
  return findTraceLayoutThreadLabelAnchor({
    traceLayouts,
    threadRef: pendingAnchor.threadRef
  });
}

function getSpanCenterY(geometry: SpanBoundingBox): number {
  return (geometry[1] + geometry[3]) / 2;
}
