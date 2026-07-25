import type {SpanTimeExtents} from '../trace-graph-accessors';

/** Stable caller-provided affinity key used to group overlapping related spans. */
export type LaneAffinityKey = string | number | bigint;

/** Normalized finite timing window used while refining lane affinity. */
export type LaneAffinitySpanWindow = {
  /** Inclusive normalized start time for one affinity span window. */
  startTimeMs: number;
  /** Exclusive normalized end time for one affinity span window. */
  endTimeMs: number;
};

/** One overlap-connected affinity placement whose lane ownership expires with its last span. */
export type LaneAffinityPlacement = {
  /** Earliest normalized start time before which this placement does not own lane affinity. */
  startTimeMs: number;
  /** Latest normalized end time after which this placement no longer owns lane affinity. */
  endTimeMs: number;
};

/** Time-sorted span record accepted by the optional lane-affinity refinement. */
export type LaneAffinityTimedSpan<SpanT> = {
  /** Source span used to resolve the caller-provided raw affinity key. */
  span: SpanT;
  /** Extremal timing envelope used while splitting disconnected raw-key activity. */
  timing: SpanTimeExtents;
  /** Lane scorer placement assigned when this span participates in lane affinity. */
  affinityPlacement?: LaneAffinityPlacement;
};

/** Precomputed compact placement metadata reused by one affinity-aware lane assignment pass. */
export type LaneAffinityRefinement = {
  /** Preferred contiguous lane width for each lane scorer placement. */
  preferredWidthByPlacement: ReadonlyMap<LaneAffinityPlacement, number>;
};

/**
 * Refines raw affinity keys into overlap-connected placements with expiring lane ownership.
 *
 * @remarks
 * This optional preprocessing keeps the core lane scorer keyed by one placement token while making
 * stale raw-key activity compact independently. The input is already time sorted. Each finite
 * affinity span enters one active-end heap, leaves that heap at most once, and records its placement
 * on the existing timed-span record for the assignment pass.
 */
export function refineLaneAffinityPlacements<SpanT>(params: {
  /** Spans already sorted by deterministic lane-assignment time order. */
  readonly sortedSpans: readonly LaneAffinityTimedSpan<SpanT>[];
  /** Optional callback resolving one raw affinity key from a source span. */
  readonly getLaneAffinityKey?: (span: SpanT) => LaneAffinityKey | null | undefined;
  /** Maximum preferred placement width retained for the later bounded lane scorer. */
  readonly maxPreferredWidth: number;
}): LaneAffinityRefinement {
  const preferredWidthByPlacement = new Map<LaneAffinityPlacement, number>();
  if (!params.getLaneAffinityKey) {
    return {preferredWidthByPlacement};
  }

  const activePlacementByAffinityKey = new Map<LaneAffinityKey, ActiveLaneAffinityPlacement>();
  for (const timedSpan of params.sortedSpans) {
    const {span, timing} = timedSpan;
    const affinityKey = params.getLaneAffinityKey(span);
    if (affinityKey == null) {
      continue;
    }

    const normalizedTiming = getNormalizedFiniteLaneAffinitySpanWindow(timing);
    if (!normalizedTiming) {
      continue;
    }

    let activePlacement = activePlacementByAffinityKey.get(affinityKey);
    // An idle raw-key gap ends the placement so later same-key activity may compact upward.
    if (!activePlacement || activePlacement.placement.endTimeMs <= normalizedTiming.startTimeMs) {
      activePlacement = {
        placement: {
          startTimeMs: normalizedTiming.startTimeMs,
          endTimeMs: normalizedTiming.endTimeMs
        },
        activeEndTimes: []
      };
      activePlacementByAffinityKey.set(affinityKey, activePlacement);
    }
    activePlacement.placement.endTimeMs = Math.max(
      activePlacement.placement.endTimeMs,
      normalizedTiming.endTimeMs
    );
    while (
      (activePlacement.activeEndTimes[0] ?? Number.POSITIVE_INFINITY) <=
      normalizedTiming.startTimeMs
    ) {
      popNumberHeap(activePlacement.activeEndTimes);
    }
    // Active end times measure this component's simultaneous width without rescanning prior spans.
    pushNumberHeap(activePlacement.activeEndTimes, normalizedTiming.endTimeMs);
    timedSpan.affinityPlacement = activePlacement.placement;
    preferredWidthByPlacement.set(
      activePlacement.placement,
      Math.max(
        preferredWidthByPlacement.get(activePlacement.placement) ?? 0,
        Math.min(activePlacement.activeEndTimes.length, params.maxPreferredWidth)
      )
    );
  }
  return {preferredWidthByPlacement};
}

/**
 * Returns one lane-affinity placement while its compact component is active at a candidate start.
 *
 * Owner and reservation arrays may retain expired placement objects; callers treat null here as an
 * unclaimed lane without sweeping every lane eagerly.
 */
export function getActiveLaneAffinityPlacement(
  affinityPlacement: LaneAffinityPlacement | undefined,
  candidateWindow: LaneAffinitySpanWindow
): LaneAffinityPlacement | undefined {
  return affinityPlacement &&
    affinityPlacement.startTimeMs <= candidateWindow.startTimeMs &&
    affinityPlacement.endTimeMs > candidateWindow.startTimeMs
    ? affinityPlacement
    : undefined;
}

/** Current overlap-connected placement state while scanning one affinity key in time order. */
type ActiveLaneAffinityPlacement = {
  /** Placement component assigned to the currently active affinity spans. */
  placement: LaneAffinityPlacement;
  /** Active normalized end times used to measure this placement's overlap width. */
  activeEndTimes: number[];
};

/** Returns one normalized finite affinity span window, or null for non-finite timing. */
function getNormalizedFiniteLaneAffinitySpanWindow(
  candidateSpan: SpanTimeExtents
): LaneAffinitySpanWindow | null {
  if (!Number.isFinite(candidateSpan.startTimeMs) || !Number.isFinite(candidateSpan.endTimeMs)) {
    return null;
  }
  if (candidateSpan.endTimeMs <= candidateSpan.startTimeMs) {
    return {
      startTimeMs: candidateSpan.startTimeMs,
      endTimeMs: candidateSpan.startTimeMs + 1
    };
  }
  return candidateSpan;
}

/** Pushes one number into a min-heap. */
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

/** Pops the smallest number from a min-heap. */
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
