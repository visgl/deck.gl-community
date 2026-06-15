import {getSpanExtremalTiming, sortSpansByTime} from '../trace-graph-accessors';

import type {SpanTimeExtents, TimedEntity, TraceSpanLaneSource} from '../trace-graph-accessors';
import type {SpanRef} from '../trace-graph/trace-types';

export type {SpanTimeExtents, TimedEntity};
export {getSpanExtremalTiming, sortSpansByTime};

/** Minimal timed span shape accepted by lane assignment helpers. */
type LaneSpanSource = TimedEntity & {
  /** Canonical runtime span ref used for parent and assignment lookups. */
  spanRef?: SpanRef;
};

/**
 * Optional configuration for lane layout utilities.
 */
export type LaneLayoutOptions<SpanT extends LaneSpanSource = TraceSpanLaneSource> = {
  /** Provides a parent span ref to hint nesting when available. */
  getParentSpanRef?: (span: SpanT) => SpanRef | null | undefined;
  /** Provides a soft lane affinity key used to keep related spans on nearby legal lanes. */
  getLaneAffinityKey?: (span: SpanT) => string | number | bigint | null | undefined;
  /** Optional maximum end time for open spans. */
  maxTimeMs?: number;
};

export const MAX_LANES_PER_STREAM = 30;

/**
 * Result of assigning a lane to a trace span.
 */
export interface LaneAssignment<SpanT extends LaneSpanSource = TraceSpanLaneSource> {
  /** Event that was assigned to a lane. */
  span: SpanT;
  /** Lane index assigned to the span. */
  lane: number;
}

type SpanWindow = {
  startTimeMs: number;
  endTimeMs: number;
};

type LaneWindowState = {
  /** Non-overlapping finite span windows assigned to this lane, sorted by start time. */
  spans: SpanWindow[];
  /** Last appended finite window for the common already-sorted assignment path. */
  lastAppendedSpan: SpanWindow | undefined;
};

/** Span paired with the timing envelope used for lane assignment. */
type TimedSpan<SpanT extends LaneSpanSource> = {
  /** Source span assigned into lanes. */
  span: SpanT;
  /** Extremal timing envelope used while testing lane overlap. */
  timing: SpanTimeExtents;
};

type ActiveLane = {
  lane: number;
  endTimeMs: number;
};

/** Stable affinity bucket used to prefer nearby legal lanes for related spans. */
type LaneAffinityKey = string | number | bigint;

/** Mutable placement summary kept while assigning spans for one affinity bucket. */
type LaneAffinityState = {
  /** Smallest lane used by this affinity group. */
  minLane: number;
  /** Largest lane used by this affinity group. */
  maxLane: number;
  /** Most recently assigned lane for this affinity group. */
  recentLane: number;
  /** First assigned lane used as the top of this affinity group's soft home band. */
  homeLane: number;
  /** Preferred contiguous lane count reserved for this affinity group's observed overlap. */
  preferredWidth: number;
};

/** Time-sorted span index reused by the Kahn lane layout pass. */
type TimeSortedSpanOrder<SpanT extends LaneSpanSource> = {
  /** Spans in deterministic start-time order. */
  spans: SpanT[];
  /** Stable time-order index for each span. */
  indexBySpan: Map<SpanT, number>;
  /** Cached timing extents for each time-sorted span. */
  timingBySpan: Map<SpanT, SpanTimeExtents>;
};

/** Normalizes zero-width spans so point-like events still occupy visible lane space. */
function normalizeSpanWindow(span: {startTimeMs: number; endTimeMs: number}): SpanWindow {
  if (span.endTimeMs <= span.startTimeMs) {
    return {
      startTimeMs: span.startTimeMs,
      endTimeMs: span.startTimeMs + 1
    };
  }
  return span;
}

/** Returns the sorted insertion index for a span window in one lane. */
function findSpanWindowInsertionIndex(laneSpans: readonly SpanWindow[], span: SpanWindow): number {
  let low = 0;
  let high = laneSpans.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const midSpan = laneSpans[mid];
    if (midSpan && midSpan.startTimeMs < span.startTimeMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

/**
 * Checks whether a candidate span overlaps any span already assigned to a lane.
 */
function doesSpanFitInLane(
  laneState: LaneWindowState,
  candidateSpan: {startTimeMs: number; endTimeMs: number}
): boolean {
  if (!Number.isFinite(candidateSpan.startTimeMs) || !Number.isFinite(candidateSpan.endTimeMs)) {
    return false;
  }

  const normalizedCandidateSpan = normalizeSpanWindow(candidateSpan);
  const lastAppendedSpan = laneState.lastAppendedSpan;
  if (lastAppendedSpan && lastAppendedSpan.startTimeMs <= normalizedCandidateSpan.startTimeMs) {
    return lastAppendedSpan.endTimeMs <= normalizedCandidateSpan.startTimeMs;
  }

  const insertionIndex = findSpanWindowInsertionIndex(laneState.spans, normalizedCandidateSpan);
  const previousSpan = insertionIndex > 0 ? laneState.spans[insertionIndex - 1] : undefined;
  const nextSpan = laneState.spans[insertionIndex];
  return (
    (previousSpan == null || previousSpan.endTimeMs <= normalizedCandidateSpan.startTimeMs) &&
    (nextSpan == null || normalizedCandidateSpan.endTimeMs <= nextSpan.startTimeMs)
  );
}

/** Inserts a finite span window into one lane after the caller has verified it fits. */
function insertSpanIntoLane(
  laneState: LaneWindowState,
  candidateSpan: {startTimeMs: number; endTimeMs: number}
): void {
  if (!Number.isFinite(candidateSpan.startTimeMs) || !Number.isFinite(candidateSpan.endTimeMs)) {
    return;
  }

  const normalizedCandidateSpan = normalizeSpanWindow(candidateSpan);
  const lastAppendedSpan = laneState.lastAppendedSpan;
  if (!lastAppendedSpan || lastAppendedSpan.startTimeMs <= normalizedCandidateSpan.startTimeMs) {
    laneState.spans.push(normalizedCandidateSpan);
    laneState.lastAppendedSpan = normalizedCandidateSpan;
    return;
  }

  /*
   * Parent recursion can assign a later-starting parent before its earlier-starting child.
   * Keep the lane windows ordered so those rare out-of-order checks stay logarithmic instead
   * of scanning every previous tiny span in a hot lane.
   */
  const insertionIndex = findSpanWindowInsertionIndex(laneState.spans, normalizedCandidateSpan);
  laneState.spans.splice(insertionIndex, 0, normalizedCandidateSpan);
}

function pushNumberHeap(heap: number[], value: number): void {
  heap.push(value);
  let index = heap.length - 1;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (heap[parentIndex]! <= value) {
      break;
    }
    heap[index] = heap[parentIndex]!;
    index = parentIndex;
  }
  heap[index] = value;
}

function popNumberHeap(heap: number[]): number | undefined {
  if (heap.length === 0) {
    return undefined;
  }
  const first = heap[0]!;
  const last = heap.pop()!;
  if (heap.length === 0) {
    return first;
  }

  let index = 0;
  while (true) {
    const leftIndex = index * 2 + 1;
    const rightIndex = leftIndex + 1;
    if (leftIndex >= heap.length) {
      break;
    }
    const childIndex =
      rightIndex < heap.length && heap[rightIndex]! < heap[leftIndex]! ? rightIndex : leftIndex;
    if (heap[childIndex]! >= last) {
      break;
    }
    heap[index] = heap[childIndex]!;
    index = childIndex;
  }
  heap[index] = last;
  return first;
}

function isActiveLaneBefore(left: ActiveLane, right: ActiveLane): boolean {
  return (
    left.endTimeMs < right.endTimeMs ||
    (left.endTimeMs === right.endTimeMs && left.lane < right.lane)
  );
}

function pushActiveLaneHeap(heap: ActiveLane[], value: ActiveLane): void {
  heap.push(value);
  let index = heap.length - 1;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    const parent = heap[parentIndex]!;
    if (isActiveLaneBefore(parent, value)) {
      break;
    }
    heap[index] = parent;
    index = parentIndex;
  }
  heap[index] = value;
}

function popActiveLaneHeap(heap: ActiveLane[]): ActiveLane | undefined {
  if (heap.length === 0) {
    return undefined;
  }
  const first = heap[0]!;
  const last = heap.pop()!;
  if (heap.length === 0) {
    return first;
  }

  let index = 0;
  while (true) {
    const leftIndex = index * 2 + 1;
    const rightIndex = leftIndex + 1;
    if (leftIndex >= heap.length) {
      break;
    }
    const childIndex =
      rightIndex < heap.length && isActiveLaneBefore(heap[rightIndex]!, heap[leftIndex]!)
        ? rightIndex
        : leftIndex;
    if (!isActiveLaneBefore(heap[childIndex]!, last)) {
      break;
    }
    heap[index] = heap[childIndex]!;
    index = childIndex;
  }
  heap[index] = last;
  return first;
}

function peekActiveLaneHeap(heap: readonly ActiveLane[]): ActiveLane | undefined {
  return heap[0];
}

/** Returns spans sorted by start time with one resolved timing extent per span. */
function sortSpansByTimeWithExtents<SpanT extends LaneSpanSource>(
  spans: readonly SpanT[],
  options: {maxTimeMs?: number} = {}
): TimedSpan<SpanT>[] {
  return spans
    .map(span => ({
      span,
      timing: getSpanExtremalTiming(span, options.maxTimeMs)
    }))
    .sort((a, b) => {
      if (a.timing.startTimeMs !== b.timing.startTimeMs) {
        return a.timing.startTimeMs - b.timing.startTimeMs;
      }
      return b.timing.endTimeMs - a.timing.endTimeMs;
    });
}

/** Builds one deterministic time-sorted span lookup bundle for Kahn assignment. */
function buildTimeSortedSpanOrder<SpanT extends LaneSpanSource>(
  spans: readonly SpanT[],
  options: {maxTimeMs?: number} = {}
): TimeSortedSpanOrder<SpanT> {
  const sortedSpansWithExtents = sortSpansByTimeWithExtents(spans, options);
  const sortedSpans: SpanT[] = [];
  const indexBySpan = new Map<SpanT, number>();
  const timingBySpan = new Map<SpanT, SpanTimeExtents>();
  sortedSpansWithExtents.forEach(({span, timing}, index) => {
    sortedSpans.push(span);
    indexBySpan.set(span, index);
    timingBySpan.set(span, timing);
  });
  return {spans: sortedSpans, indexBySpan, timingBySpan};
}

/** Assigns overlap-safe lanes to one time-sorted span collection. */
function layoutSortedSpansByOverlap<SpanT extends LaneSpanSource>(
  sortedSpans: readonly TimedSpan<SpanT>[]
): LaneAssignment<SpanT>[] {
  const result: LaneAssignment<SpanT>[] = [];
  visitSortedSpanLaneAssignmentsByOverlap(sortedSpans, (span, lane) => {
    result.push({span, lane});
  });
  return result;
}

/** Visits overlap-safe lane assignments for one time-sorted span collection. */
function visitSortedSpanLaneAssignmentsByOverlap<SpanT extends LaneSpanSource>(
  sortedSpans: readonly TimedSpan<SpanT>[],
  visitAssignment: (span: SpanT, lane: number) => void
): number {
  const activeLanes: ActiveLane[] = [];
  const availableLaneIndexes: number[] = [];
  let maxLane = -1;
  let nextLane = 0;

  for (const {span, timing} of sortedSpans) {
    if (!Number.isFinite(timing.startTimeMs) || !Number.isFinite(timing.endTimeMs)) {
      const availableLane = popNumberHeap(availableLaneIndexes);
      const lane = availableLane ?? nextLane;
      if (availableLane == null) {
        nextLane += 1;
      }
      pushNumberHeap(availableLaneIndexes, lane);
      if (lane > maxLane) {
        maxLane = lane;
      }
      visitAssignment(span, lane);
      continue;
    }

    const normalizedTiming = normalizeSpanWindow(timing);
    while (true) {
      const activeLane = peekActiveLaneHeap(activeLanes);
      if (!activeLane || activeLane.endTimeMs > normalizedTiming.startTimeMs) {
        break;
      }
      pushNumberHeap(availableLaneIndexes, popActiveLaneHeap(activeLanes)!.lane);
    }

    const availableLane = popNumberHeap(availableLaneIndexes);
    const lane = availableLane ?? nextLane;
    if (availableLane == null) {
      nextLane += 1;
    }
    pushActiveLaneHeap(activeLanes, {lane, endTimeMs: normalizedTiming.endTimeMs});
    if (lane > maxLane) {
      maxLane = lane;
    }
    visitAssignment(span, lane);
  }

  return maxLane;
}

/**
 * Assigns lanes with the historical on-demand parent-chain traversal plus overlap fallback packing.
 */
export function layoutLanes<SpanT extends LaneSpanSource>(
  spans: readonly SpanT[],
  options: LaneLayoutOptions<SpanT> = {}
): LaneAssignment<SpanT>[] {
  return legacyLaneLayout(spans, options);
}

/**
 * Assigns lanes with the historical on-demand parent-chain traversal plus overlap fallback packing.
 */
export function legacyLaneLayout<SpanT extends LaneSpanSource>(
  spans: readonly SpanT[],
  options: LaneLayoutOptions<SpanT> = {}
): LaneAssignment<SpanT>[] {
  const result: LaneAssignment<SpanT>[] = [];
  visitLegacyLaneAssignments(spans, options, (span, lane) => {
    result.push({span, lane});
  });
  return result;
}

/**
 * Assigns lanes after preordering parent-safe batches with Kahn's algorithm.
 */
export function kahnLaneLayout<SpanT extends LaneSpanSource>(
  spans: readonly SpanT[],
  options: LaneLayoutOptions<SpanT> = {}
): LaneAssignment<SpanT>[] {
  const result: LaneAssignment<SpanT>[] = [];
  visitKahnLaneAssignments(spans, options, (span, lane) => {
    result.push({span, lane});
  });
  return result;
}

/**
 * Visits assigned lanes without allocating a `LaneAssignment` object for each span.
 *
 * @returns The largest assigned lane index, or -1 when no spans were assigned.
 */
export function visitLaneAssignments<SpanT extends LaneSpanSource>(
  spans: readonly SpanT[],
  options: LaneLayoutOptions<SpanT> = {},
  visitAssignment: (span: SpanT, lane: number) => void
): number {
  return visitLegacyLaneAssignments(spans, options, visitAssignment);
}

/**
 * Visits assigned lanes with the historical on-demand parent-chain traversal.
 *
 * @returns The largest assigned lane index, or -1 when no spans were assigned.
 */
export function visitLegacyLaneAssignments<SpanT extends LaneSpanSource>(
  spans: readonly SpanT[],
  options: LaneLayoutOptions<SpanT> = {},
  visitAssignment: (span: SpanT, lane: number) => void
): number {
  const sortedSpansWithExtents = sortSpansByTimeWithExtents(spans, options);
  if (!options.getParentSpanRef && !options.getLaneAffinityKey) {
    return visitSortedSpanLaneAssignmentsByOverlap(sortedSpansWithExtents, visitAssignment);
  }
  const sortedSpans = sortedSpansWithExtents.map(({span}) => span);
  const laneStatesByIndex: LaneWindowState[] = [];
  const laneAssignments = new Map<SpanT, number>();
  const spanByRef = new Map<SpanRef, SpanT>();
  const getParentSpanRef = options.getParentSpanRef;
  const getLaneAffinityKey = options.getLaneAffinityKey;
  const affinityPreferredWidthByKey = buildLaneAffinityPreferredWidthByKey(
    sortedSpansWithExtents,
    getLaneAffinityKey
  );
  const affinityStateByKey = new Map<LaneAffinityKey, LaneAffinityState>();
  const affinityOwnerByLane: Array<LaneAffinityKey | undefined> = [];
  const affinityReservationByLane: Array<LaneAffinityKey | undefined> = [];

  for (const span of sortedSpans) {
    if (span.spanRef != null) {
      spanByRef.set(span.spanRef, span);
    }
  }

  /** Assigns one span to the first fitting lane at or above the requested minimum lane. */
  const assignSpanToLane = (
    span: SpanT,
    minimumLane: number,
    timing = getSpanExtremalTiming(span, options.maxTimeMs)
  ): number => {
    const existingLane = laneAssignments.get(span);
    if (existingLane != null) {
      return existingLane;
    }

    const affinityKey = getLaneAffinityKey?.(span);
    const affinityState = affinityKey == null ? undefined : affinityStateByKey.get(affinityKey);
    const affinityPreferredWidth =
      affinityKey == null ? undefined : affinityPreferredWidthByKey.get(affinityKey);
    let assignedLane: number | undefined;
    let assignedLaneReservationPenalty = Number.POSITIVE_INFINITY;
    let assignedLaneOwnershipPenalty = Number.POSITIVE_INFINITY;
    let assignedLaneBandDistance = Number.POSITIVE_INFINITY;
    let assignedLaneRecentDistance = Number.POSITIVE_INFINITY;
    for (let lane = minimumLane; lane < laneStatesByIndex.length; lane += 1) {
      const laneState = laneStatesByIndex[lane];
      if (laneState && doesSpanFitInLane(laneState, timing)) {
        const laneReservationOwner = affinityReservationByLane[lane];
        const laneOwner = affinityOwnerByLane[lane];
        const laneReservationPenalty = getLaneAffinityReservationPenalty(
          affinityKey,
          laneReservationOwner
        );
        const laneOwnershipPenalty = getLaneAffinityOwnershipPenalty(affinityKey, laneOwner);
        const laneBandDistance = getLaneAffinityBandDistance(lane, affinityState);
        const laneRecentDistance = getLaneAffinityRecentDistance(lane, affinityState);
        if (
          assignedLane == null ||
          isLaneAffinityCandidatePreferred({
            lane,
            reservationPenalty: laneReservationPenalty,
            ownershipPenalty: laneOwnershipPenalty,
            bandDistance: laneBandDistance,
            recentDistance: laneRecentDistance,
            assignedLane,
            assignedReservationPenalty: assignedLaneReservationPenalty,
            assignedOwnershipPenalty: assignedLaneOwnershipPenalty,
            assignedBandDistance: assignedLaneBandDistance,
            assignedRecentDistance: assignedLaneRecentDistance
          })
        ) {
          assignedLane = lane;
          assignedLaneReservationPenalty = laneReservationPenalty;
          assignedLaneOwnershipPenalty = laneOwnershipPenalty;
          assignedLaneBandDistance = laneBandDistance;
          assignedLaneRecentDistance = laneRecentDistance;
        }
        if (
          laneReservationPenalty === 0 &&
          laneOwnershipPenalty === 0 &&
          laneBandDistance === 0 &&
          laneRecentDistance === 0
        ) {
          break;
        }
      }
    }

    if (assignedLane == null) {
      assignedLane = Math.max(minimumLane, laneStatesByIndex.length);
    }

    while (assignedLane >= laneStatesByIndex.length) {
      laneStatesByIndex.push({spans: [], lastAppendedSpan: undefined});
      affinityOwnerByLane.push(undefined);
      affinityReservationByLane.push(undefined);
    }

    laneAssignments.set(span, assignedLane);
    const assignedLaneState = laneStatesByIndex[assignedLane];
    if (assignedLaneState) {
      insertSpanIntoLane(assignedLaneState, timing);
    }
    if (affinityKey != null) {
      const nextAffinityState = extendLaneAffinityState(
        affinityState,
        assignedLane,
        affinityPreferredWidth ?? 1
      );
      affinityStateByKey.set(affinityKey, nextAffinityState);
      if (affinityOwnerByLane[assignedLane] == null) {
        affinityOwnerByLane[assignedLane] = affinityKey;
      }
      reserveLaneAffinityHomeBand({
        affinityKey,
        affinityReservationByLane,
        affinityState: nextAffinityState
      });
    }
    return assignedLane;
  };

  /** Assigns one span after iteratively assigning any available parent hint. */
  const assignSpan = (span: SpanT): number => {
    const existingLane = laneAssignments.get(span);
    if (existingLane != null) {
      return existingLane;
    }

    const visitingSpans = new Set<SpanT>();
    const spanStack: Array<{
      /** Span visited while assigning hinted parents before children. */
      span: SpanT;
      /** Traversal phase for the iterative parent-first walk. */
      phase: 'enter' | 'exit';
    }> = [{span, phase: 'enter'}];

    while (spanStack.length > 0) {
      const frame = spanStack.pop()!;
      const frameSpan = frame.span;

      if (frame.phase === 'enter') {
        if (laneAssignments.has(frameSpan)) {
          continue;
        }
        if (visitingSpans.has(frameSpan)) {
          assignSpanToLane(frameSpan, 0);
          continue;
        }

        visitingSpans.add(frameSpan);
        spanStack.push({span: frameSpan, phase: 'exit'});

        const parentRef = getParentSpanRef?.(frameSpan);
        if (parentRef == null) {
          continue;
        }
        const parent = spanByRef.get(parentRef);
        if (!parent || parent === frameSpan || laneAssignments.has(parent)) {
          continue;
        }
        if (visitingSpans.has(parent)) {
          assignSpanToLane(parent, 0);
          continue;
        }
        spanStack.push({span: parent, phase: 'enter'});
        continue;
      }

      visitingSpans.delete(frameSpan);
      let minimumLane = 0;
      const parentRef = getParentSpanRef?.(frameSpan);
      if (parentRef != null) {
        const parent = spanByRef.get(parentRef);
        if (parent && parent !== frameSpan) {
          const parentLane = laneAssignments.get(parent);
          if (parentLane != null) {
            minimumLane = parentLane + 1;
          }
        }
      }
      assignSpanToLane(frameSpan, minimumLane, getSpanExtremalTiming(frameSpan, options.maxTimeMs));
    }

    return laneAssignments.get(span) ?? assignSpanToLane(span, 0);
  };

  for (const span of sortedSpans) {
    assignSpan(span);
  }

  let maxLane = -1;
  for (const span of sortedSpans) {
    const lane = laneAssignments.get(span) ?? 0;
    if (lane > maxLane) {
      maxLane = lane;
    }
    visitAssignment(span, lane);
  }
  return maxLane;
}

/**
 * Visits assigned lanes after building one parent-safe Kahn order for the whole batch.
 *
 * @returns The largest assigned lane index, or -1 when no spans were assigned.
 */
export function visitKahnLaneAssignments<SpanT extends LaneSpanSource>(
  spans: readonly SpanT[],
  options: LaneLayoutOptions<SpanT> = {},
  visitAssignment: (span: SpanT, lane: number) => void
): number {
  const timeSortedOrder = buildTimeSortedSpanOrder(spans, options);
  if (!options.getParentSpanRef && !options.getLaneAffinityKey) {
    const sortedSpansWithExtents = timeSortedOrder.spans.map(span => ({
      span,
      timing: timeSortedOrder.timingBySpan.get(span)!
    }));
    return visitSortedSpanLaneAssignmentsByOverlap(sortedSpansWithExtents, visitAssignment);
  }

  const laneStatesByIndex: LaneWindowState[] = [];
  const laneAssignments = new Map<SpanT, number>();
  const spanByRef = new Map<SpanRef, SpanT>();
  const getParentSpanRef = options.getParentSpanRef;
  const getLaneAffinityKey = options.getLaneAffinityKey;
  const affinityPreferredWidthByKey = buildLaneAffinityPreferredWidthByKey(
    timeSortedOrder.spans.map(span => ({
      span,
      timing:
        timeSortedOrder.timingBySpan.get(span) ?? getSpanExtremalTiming(span, options.maxTimeMs)
    })),
    getLaneAffinityKey
  );
  const affinityStateByKey = new Map<LaneAffinityKey, LaneAffinityState>();
  const affinityOwnerByLane: Array<LaneAffinityKey | undefined> = [];
  const affinityReservationByLane: Array<LaneAffinityKey | undefined> = [];
  timeSortedOrder.spans.forEach(span => {
    if (span.spanRef != null) {
      spanByRef.set(span.spanRef, span);
    }
  });

  const orderedSpans = buildKahnParentSafeSpanOrder({
    spans: timeSortedOrder.spans,
    spanByRef,
    getParentSpanRef
  });

  const assignSpanToLane = (span: SpanT): number => {
    const existingLane = laneAssignments.get(span);
    if (existingLane != null) {
      return existingLane;
    }

    let minimumLane = 0;
    const parentRef = getParentSpanRef?.(span);
    if (parentRef != null) {
      const parent = spanByRef.get(parentRef);
      if (parent && parent !== span) {
        const parentLane = laneAssignments.get(parent);
        if (parentLane != null) {
          minimumLane = parentLane + 1;
        }
      }
    }

    const timing =
      timeSortedOrder.timingBySpan.get(span) ?? getSpanExtremalTiming(span, options.maxTimeMs);
    const affinityKey = getLaneAffinityKey?.(span);
    const affinityState = affinityKey == null ? undefined : affinityStateByKey.get(affinityKey);
    const affinityPreferredWidth =
      affinityKey == null ? undefined : affinityPreferredWidthByKey.get(affinityKey);
    let assignedLane: number | undefined;
    let assignedLaneReservationPenalty = Number.POSITIVE_INFINITY;
    let assignedLaneOwnershipPenalty = Number.POSITIVE_INFINITY;
    let assignedLaneBandDistance = Number.POSITIVE_INFINITY;
    let assignedLaneRecentDistance = Number.POSITIVE_INFINITY;
    const candidateLanes = buildBoundedKahnLaneCandidateIndexes({
      affinityState,
      laneCount: laneStatesByIndex.length,
      minimumLane
    });
    for (const lane of candidateLanes) {
      const laneState = laneStatesByIndex[lane];
      if (!laneState || !doesSpanFitInLane(laneState, timing)) {
        continue;
      }
      const laneReservationOwner = affinityReservationByLane[lane];
      const laneOwner = affinityOwnerByLane[lane];
      const laneReservationPenalty = getLaneAffinityReservationPenalty(
        affinityKey,
        laneReservationOwner
      );
      const laneOwnershipPenalty = getLaneAffinityOwnershipPenalty(affinityKey, laneOwner);
      const laneBandDistance = getLaneAffinityBandDistance(lane, affinityState);
      const laneRecentDistance = getLaneAffinityRecentDistance(lane, affinityState);
      if (
        assignedLane == null ||
        isLaneAffinityCandidatePreferred({
          lane,
          reservationPenalty: laneReservationPenalty,
          ownershipPenalty: laneOwnershipPenalty,
          bandDistance: laneBandDistance,
          recentDistance: laneRecentDistance,
          assignedLane,
          assignedReservationPenalty: assignedLaneReservationPenalty,
          assignedOwnershipPenalty: assignedLaneOwnershipPenalty,
          assignedBandDistance: assignedLaneBandDistance,
          assignedRecentDistance: assignedLaneRecentDistance
        })
      ) {
        assignedLane = lane;
        assignedLaneReservationPenalty = laneReservationPenalty;
        assignedLaneOwnershipPenalty = laneOwnershipPenalty;
        assignedLaneBandDistance = laneBandDistance;
        assignedLaneRecentDistance = laneRecentDistance;
      }
      if (
        laneReservationPenalty === 0 &&
        laneOwnershipPenalty === 0 &&
        laneBandDistance === 0 &&
        laneRecentDistance === 0
      ) {
        break;
      }
    }

    if (assignedLane == null) {
      assignedLane = Math.max(minimumLane, laneStatesByIndex.length);
    }

    while (assignedLane >= laneStatesByIndex.length) {
      laneStatesByIndex.push({spans: [], lastAppendedSpan: undefined});
      affinityOwnerByLane.push(undefined);
      affinityReservationByLane.push(undefined);
    }

    laneAssignments.set(span, assignedLane);
    const assignedLaneState = laneStatesByIndex[assignedLane];
    if (assignedLaneState) {
      insertSpanIntoLane(assignedLaneState, timing);
    }
    if (affinityKey != null) {
      const nextAffinityState = extendLaneAffinityState(
        affinityState,
        assignedLane,
        affinityPreferredWidth ?? 1
      );
      affinityStateByKey.set(affinityKey, nextAffinityState);
      if (affinityOwnerByLane[assignedLane] == null) {
        affinityOwnerByLane[assignedLane] = affinityKey;
      }
      reserveLaneAffinityHomeBand({
        affinityKey,
        affinityReservationByLane,
        affinityState: nextAffinityState
      });
    }
    return assignedLane;
  };

  for (const span of orderedSpans) {
    assignSpanToLane(span);
  }

  let maxLane = -1;
  for (const span of timeSortedOrder.spans) {
    const lane = laneAssignments.get(span) ?? 0;
    if (lane > maxLane) {
      maxLane = lane;
    }
    visitAssignment(span, lane);
  }
  return maxLane;
}

/**
 * Assigns lanes strictly by interval overlap, ignoring nesting hints.
 */
export function layoutLanesByOverlap<SpanT extends LaneSpanSource>(
  spans: readonly SpanT[],
  options: Pick<LaneLayoutOptions<SpanT>, 'maxTimeMs'> = {}
): LaneAssignment<SpanT>[] {
  return layoutSortedSpansByOverlap(sortSpansByTimeWithExtents(spans, options));
}

/** Maximum local Kahn lane probes kept independent of existing lane count. */
const MAX_KAHN_LOCAL_LANE_PROBES = MAX_LANES_PER_STREAM * 2;

/**
 * Builds the bounded legal-lane probe set used by Kahn assignment.
 *
 * The affinity scorer is deliberately local: it checks the affinity band's own lanes plus a
 * compact window near the parent-imposed minimum lane, then creates a new lane if those candidates
 * are unavailable. This keeps assignment bounded even for traces that accumulate thousands of
 * rendered lanes.
 */
function buildBoundedKahnLaneCandidateIndexes(params: {
  readonly affinityState: LaneAffinityState | undefined;
  readonly laneCount: number;
  readonly minimumLane: number;
}): number[] {
  if (params.laneCount <= params.minimumLane) {
    return [];
  }

  const candidateLanes = new Set<number>();
  const addLane = (lane: number): void => {
    if (lane >= params.minimumLane && lane < params.laneCount) {
      candidateLanes.add(lane);
    }
  };

  const affinityState = params.affinityState;
  if (affinityState) {
    addLane(affinityState.recentLane);
    const homeBandEndLane = affinityState.homeLane + Math.max(1, affinityState.preferredWidth) - 1;
    for (let lane = affinityState.homeLane; lane <= homeBandEndLane; lane += 1) {
      addLane(lane);
    }
  }

  const localLaneEnd = Math.min(params.laneCount, params.minimumLane + MAX_KAHN_LOCAL_LANE_PROBES);
  for (let lane = params.minimumLane; lane < localLaneEnd; lane += 1) {
    addLane(lane);
  }
  return [...candidateLanes];
}

/** Returns whether one affinity-scored lane candidate outranks the current best legal lane. */
function isLaneAffinityCandidatePreferred(params: {
  readonly lane: number;
  readonly reservationPenalty: number;
  readonly ownershipPenalty: number;
  readonly bandDistance: number;
  readonly recentDistance: number;
  readonly assignedLane: number;
  readonly assignedReservationPenalty: number;
  readonly assignedOwnershipPenalty: number;
  readonly assignedBandDistance: number;
  readonly assignedRecentDistance: number;
}): boolean {
  if (params.reservationPenalty !== params.assignedReservationPenalty) {
    return params.reservationPenalty < params.assignedReservationPenalty;
  }
  if (params.ownershipPenalty !== params.assignedOwnershipPenalty) {
    return params.ownershipPenalty < params.assignedOwnershipPenalty;
  }
  if (params.bandDistance !== params.assignedBandDistance) {
    return params.bandDistance < params.assignedBandDistance;
  }
  if (params.recentDistance !== params.assignedRecentDistance) {
    return params.recentDistance < params.assignedRecentDistance;
  }
  return params.lane < params.assignedLane;
}

/** Prefers lanes reserved for the same affinity key, then currently unreserved lanes. */
function getLaneAffinityReservationPenalty(
  affinityKey: LaneAffinityKey | null | undefined,
  laneReservationOwner: LaneAffinityKey | undefined
): number {
  if (laneReservationOwner == null) {
    return affinityKey == null ? 0 : 1;
  }
  return laneReservationOwner === affinityKey ? 0 : 2;
}

/** Prefers lanes previously claimed by the same affinity key, then unclaimed lanes. */
function getLaneAffinityOwnershipPenalty(
  affinityKey: LaneAffinityKey | null | undefined,
  laneOwner: LaneAffinityKey | undefined
): number {
  if (affinityKey == null) {
    return 0;
  }
  if (laneOwner == null) {
    return 1;
  }
  return laneOwner === affinityKey ? 0 : 2;
}

/** Returns how far one lane falls outside the affinity group's established lane band. */
function getLaneAffinityBandDistance(
  lane: number,
  affinityState: LaneAffinityState | undefined
): number {
  if (!affinityState) {
    return 0;
  }
  if (lane < affinityState.minLane) {
    return affinityState.minLane - lane;
  }
  if (lane > affinityState.maxLane) {
    return lane - affinityState.maxLane;
  }
  return 0;
}

/** Returns how far one lane is from the affinity group's most recently assigned lane. */
function getLaneAffinityRecentDistance(
  lane: number,
  affinityState: LaneAffinityState | undefined
): number {
  return affinityState ? Math.abs(lane - affinityState.recentLane) : 0;
}

/** Returns the next placement summary after assigning one lane to an affinity bucket. */
function extendLaneAffinityState(
  affinityState: LaneAffinityState | undefined,
  lane: number,
  preferredWidth: number
): LaneAffinityState {
  if (!affinityState) {
    return {
      minLane: lane,
      maxLane: lane,
      recentLane: lane,
      homeLane: lane,
      preferredWidth
    };
  }
  return {
    minLane: Math.min(affinityState.minLane, lane),
    maxLane: Math.max(affinityState.maxLane, lane),
    recentLane: lane,
    homeLane: affinityState.homeLane,
    preferredWidth: Math.max(affinityState.preferredWidth, preferredWidth)
  };
}

/**
 * Computes a soft contiguous home-band width from each affinity group's observed overlap.
 */
function buildLaneAffinityPreferredWidthByKey<SpanT extends LaneSpanSource>(
  sortedSpans: readonly TimedSpan<SpanT>[],
  getLaneAffinityKey: LaneLayoutOptions<SpanT>['getLaneAffinityKey']
): Map<LaneAffinityKey, number> {
  if (!getLaneAffinityKey) {
    return new Map();
  }

  const activeEndTimesByKey = new Map<LaneAffinityKey, number[]>();
  const preferredWidthByKey = new Map<LaneAffinityKey, number>();
  for (const {span, timing} of sortedSpans) {
    const affinityKey = getLaneAffinityKey(span);
    if (affinityKey == null) {
      continue;
    }

    if (!Number.isFinite(timing.startTimeMs) || !Number.isFinite(timing.endTimeMs)) {
      preferredWidthByKey.set(affinityKey, Math.max(preferredWidthByKey.get(affinityKey) ?? 0, 1));
      continue;
    }

    const normalizedTiming = normalizeSpanWindow(timing);
    const activeEndTimes = activeEndTimesByKey.get(affinityKey) ?? [];
    while ((activeEndTimes[0] ?? Number.POSITIVE_INFINITY) <= normalizedTiming.startTimeMs) {
      popNumberHeap(activeEndTimes);
    }
    pushNumberHeap(activeEndTimes, normalizedTiming.endTimeMs);
    activeEndTimesByKey.set(affinityKey, activeEndTimes);
    preferredWidthByKey.set(
      affinityKey,
      Math.max(preferredWidthByKey.get(affinityKey) ?? 0, activeEndTimes.length)
    );
  }

  const affinityPreferredWidthByKey = new Map<LaneAffinityKey, number>();
  for (const [affinityKey, observedWidth] of preferredWidthByKey) {
    affinityPreferredWidthByKey.set(
      affinityKey,
      Math.max(1, Math.min(observedWidth, MAX_LANES_PER_STREAM))
    );
  }
  return affinityPreferredWidthByKey;
}

/**
 * Soft-reserves the affinity group's contiguous home band without displacing prior reservations.
 */
function reserveLaneAffinityHomeBand(params: {
  readonly affinityKey: LaneAffinityKey;
  readonly affinityReservationByLane: Array<LaneAffinityKey | undefined>;
  readonly affinityState: LaneAffinityState;
}): void {
  const homeBandEndLane =
    params.affinityState.homeLane + Math.max(1, params.affinityState.preferredWidth) - 1;
  for (let lane = params.affinityState.homeLane; lane <= homeBandEndLane; lane += 1) {
    if (params.affinityReservationByLane[lane] == null) {
      params.affinityReservationByLane[lane] = params.affinityKey;
    }
  }
}

/** Produces a parent-safe topological order while preserving chronological order among ready spans. */
function buildKahnParentSafeSpanOrder<SpanT extends LaneSpanSource>(params: {
  /** Spans already sorted chronologically before parent-safe reordering. */
  spans: readonly SpanT[];
  /** Span lookup keyed by canonical runtime span ref. */
  spanByRef: ReadonlyMap<SpanRef, SpanT>;
  /** Optional callback resolving each span's parent ref. */
  getParentSpanRef?: (span: SpanT) => SpanRef | null | undefined;
}): SpanT[] {
  if (!params.getParentSpanRef) {
    return [...params.spans];
  }

  const indegreeBySpan = new Map<SpanT, number>();
  const childrenBySpan = new Map<SpanT, SpanT[]>();
  const timeOrderIndexBySpan = new Map<SpanT, number>();
  params.spans.forEach((span, index) => {
    indegreeBySpan.set(span, 0);
    timeOrderIndexBySpan.set(span, index);
  });
  params.spans.forEach(span => {
    const parentRef = params.getParentSpanRef?.(span);
    if (parentRef == null) {
      return;
    }
    const parent = params.spanByRef.get(parentRef);
    if (!parent || parent === span) {
      return;
    }
    indegreeBySpan.set(span, (indegreeBySpan.get(span) ?? 0) + 1);
    const children = childrenBySpan.get(parent);
    if (children) {
      children.push(span);
    } else {
      childrenBySpan.set(parent, [span]);
    }
  });

  /*
   * Keep ready roots chronological. Lane windows rely on mostly append-only insertion in dense
   * traces; promoting later-starting spans here can force repeated ordered array splices.
   */
  const readyTimeOrderIndexes: number[] = [];
  params.spans.forEach((span, index) => {
    if ((indegreeBySpan.get(span) ?? 0) === 0) {
      pushNumberHeap(readyTimeOrderIndexes, index);
    }
  });
  const orderedSpans: SpanT[] = [];
  while (readyTimeOrderIndexes.length > 0) {
    const readyIndex = popNumberHeap(readyTimeOrderIndexes)!;
    const span = params.spans[readyIndex]!;
    orderedSpans.push(span);
    for (const child of childrenBySpan.get(span) ?? []) {
      const nextIndegree = (indegreeBySpan.get(child) ?? 0) - 1;
      indegreeBySpan.set(child, nextIndegree);
      if (nextIndegree === 0) {
        const childIndex = timeOrderIndexBySpan.get(child);
        if (childIndex != null) {
          pushNumberHeap(readyTimeOrderIndexes, childIndex);
        }
      }
    }
  }

  if (orderedSpans.length === params.spans.length) {
    return orderedSpans;
  }

  const emittedSpans = new Set(orderedSpans);
  for (const span of params.spans) {
    if (!emittedSpans.has(span)) {
      orderedSpans.push(span);
    }
  }
  return orderedSpans;
}
