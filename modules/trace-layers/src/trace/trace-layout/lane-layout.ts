import {getSpanExtremalTiming, sortBlocksByTime} from '../trace-graph-accessors';

import type {TraceSpan, TraceSpanId} from '../trace-graph/index';
import type {BlockTimeExtents, TimedEntity} from '../trace-graph-accessors';

export type {BlockTimeExtents, TimedEntity};
export {getSpanExtremalTiming, sortBlocksByTime};

type LaneBlockSource = TimedEntity & {
  /** Stable block identifier used for parent and assignment lookups. */
  spanId: TraceSpanId;
};

/**
 * Optional configuration for lane layout utilities.
 */
export type LaneLayoutOptions<BlockT extends LaneBlockSource = TraceSpan> = {
  /** Provides a parent block id to hint nesting when available. */
  getParentSpanId?: (block: BlockT) => TraceSpanId | null | undefined;
  /** Provides a soft lane affinity key used to keep related spans on nearby legal lanes. */
  getLaneAffinityKey?: (block: BlockT) => string | number | bigint | null | undefined;
  /** Optional maximum end time for open spans. */
  maxTimeMs?: number;
};

export const MAX_LANES_PER_STREAM = 30;

/**
 * Result of assigning a lane to a trace block.
 */
export interface LaneAssignment<BlockT extends LaneBlockSource = TraceSpan> {
  /** Event that was assigned to a lane. */
  block: BlockT;
  /** Lane index assigned to the block. */
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

type TimedBlock<BlockT extends LaneBlockSource> = {
  block: BlockT;
  timing: BlockTimeExtents;
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

/** Time-sorted block index reused by the Kahn lane layout pass. */
type TimeSortedBlockOrder<BlockT extends LaneBlockSource> = {
  /** Blocks in deterministic start-time order. */
  blocks: BlockT[];
  /** Stable time-order index for each block. */
  indexByBlock: Map<BlockT, number>;
  /** Cached timing extents for each time-sorted block. */
  timingByBlock: Map<BlockT, BlockTimeExtents>;
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

function sortBlocksByTimeWithExtents<BlockT extends LaneBlockSource>(
  spans: readonly BlockT[],
  options: {maxTimeMs?: number} = {}
): TimedBlock<BlockT>[] {
  return spans
    .map(block => ({
      block,
      timing: getSpanExtremalTiming(block, options.maxTimeMs)
    }))
    .sort((a, b) => {
      if (a.timing.startTimeMs !== b.timing.startTimeMs) {
        return a.timing.startTimeMs - b.timing.startTimeMs;
      }
      return b.timing.endTimeMs - a.timing.endTimeMs;
    });
}

/** Builds one deterministic time-sorted block lookup bundle for Kahn assignment. */
function buildTimeSortedBlockOrder<BlockT extends LaneBlockSource>(
  spans: readonly BlockT[],
  options: {maxTimeMs?: number} = {}
): TimeSortedBlockOrder<BlockT> {
  const sortedBlocksWithExtents = sortBlocksByTimeWithExtents(spans, options);
  const blocks: BlockT[] = [];
  const indexByBlock = new Map<BlockT, number>();
  const timingByBlock = new Map<BlockT, BlockTimeExtents>();
  sortedBlocksWithExtents.forEach(({block, timing}, index) => {
    blocks.push(block);
    indexByBlock.set(block, index);
    timingByBlock.set(block, timing);
  });
  return {blocks, indexByBlock, timingByBlock};
}

function layoutSortedBlocksByOverlap<BlockT extends LaneBlockSource>(
  sortedBlocks: readonly TimedBlock<BlockT>[]
): LaneAssignment<BlockT>[] {
  const result: LaneAssignment<BlockT>[] = [];
  visitSortedBlockLaneAssignmentsByOverlap(sortedBlocks, (block, lane) => {
    result.push({block, lane});
  });
  return result;
}

function visitSortedBlockLaneAssignmentsByOverlap<BlockT extends LaneBlockSource>(
  sortedBlocks: readonly TimedBlock<BlockT>[],
  visitAssignment: (block: BlockT, lane: number) => void
): number {
  const activeLanes: ActiveLane[] = [];
  const availableLaneIndexes: number[] = [];
  let maxLane = -1;
  let nextLane = 0;

  for (const {block, timing} of sortedBlocks) {
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
      visitAssignment(block, lane);
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
    visitAssignment(block, lane);
  }

  return maxLane;
}

/** Assigns lanes with parent-chain traversal plus overlap fallback packing. */
export function layoutLanes<BlockT extends LaneBlockSource>(
  spans: readonly BlockT[],
  options: LaneLayoutOptions<BlockT> = {}
): LaneAssignment<BlockT>[] {
  const result: LaneAssignment<BlockT>[] = [];
  visitParentAwareLaneAssignments(spans, options, (block, lane) => {
    result.push({block, lane});
  });
  return result;
}

/**
 * Assigns lanes after preordering parent-safe batches with Kahn's algorithm.
 */
export function kahnLaneLayout<BlockT extends LaneBlockSource>(
  spans: readonly BlockT[],
  options: LaneLayoutOptions<BlockT> = {}
): LaneAssignment<BlockT>[] {
  const result: LaneAssignment<BlockT>[] = [];
  visitKahnLaneAssignments(spans, options, (block, lane) => {
    result.push({block, lane});
  });
  return result;
}

/**
 * Visits assigned lanes without allocating a `LaneAssignment` object for each block.
 *
 * @returns The largest assigned lane index, or -1 when no spans were assigned.
 */
export function visitLaneAssignments<BlockT extends LaneBlockSource>(
  spans: readonly BlockT[],
  options: LaneLayoutOptions<BlockT> = {},
  visitAssignment: (block: BlockT, lane: number) => void
): number {
  return visitParentAwareLaneAssignments(spans, options, visitAssignment);
}

/**
 * Visits assigned lanes with on-demand parent-chain traversal.
 *
 * @returns The largest assigned lane index, or -1 when no spans were assigned.
 */
export function visitParentAwareLaneAssignments<BlockT extends LaneBlockSource>(
  spans: readonly BlockT[],
  options: LaneLayoutOptions<BlockT> = {},
  visitAssignment: (block: BlockT, lane: number) => void
): number {
  const sortedBlocksWithExtents = sortBlocksByTimeWithExtents(spans, options);
  if (!options.getParentSpanId && !options.getLaneAffinityKey) {
    return visitSortedBlockLaneAssignmentsByOverlap(sortedBlocksWithExtents, visitAssignment);
  }
  const sortedBlocks = sortedBlocksWithExtents.map(({block}) => block);
  const laneStatesByIndex: LaneWindowState[] = [];
  const laneAssignments = new Map<BlockT, number>();
  const blockById = new Map<TraceSpanId, BlockT>();
  const getParentSpanId = options.getParentSpanId;
  const getLaneAffinityKey = options.getLaneAffinityKey;
  const affinityPreferredWidthByKey = buildLaneAffinityPreferredWidthByKey(
    sortedBlocksWithExtents,
    getLaneAffinityKey
  );
  const affinityStateByKey = new Map<LaneAffinityKey, LaneAffinityState>();
  const affinityOwnerByLane: Array<LaneAffinityKey | undefined> = [];
  const affinityReservationByLane: Array<LaneAffinityKey | undefined> = [];

  for (const block of sortedBlocks) {
    blockById.set(block.spanId, block);
  }

  /** Assigns one block to the first fitting lane at or above the requested minimum lane. */
  const assignBlockToLane = (
    block: BlockT,
    minimumLane: number,
    timing = getSpanExtremalTiming(block, options.maxTimeMs)
  ): number => {
    const existingLane = laneAssignments.get(block);
    if (existingLane != null) {
      return existingLane;
    }

    const affinityKey = getLaneAffinityKey?.(block);
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

    laneAssignments.set(block, assignedLane);
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

  /** Assigns one block after iteratively assigning any available parent hint. */
  const assignBlock = (block: BlockT): number => {
    const existingLane = laneAssignments.get(block);
    if (existingLane != null) {
      return existingLane;
    }

    const visitingBlocks = new Set<BlockT>();
    const blockStack: Array<{block: BlockT; phase: 'enter' | 'exit'}> = [{block, phase: 'enter'}];

    while (blockStack.length > 0) {
      const frame = blockStack.pop()!;
      const frameBlock = frame.block;

      if (frame.phase === 'enter') {
        if (laneAssignments.has(frameBlock)) {
          continue;
        }
        if (visitingBlocks.has(frameBlock)) {
          assignBlockToLane(frameBlock, 0);
          continue;
        }

        visitingBlocks.add(frameBlock);
        blockStack.push({block: frameBlock, phase: 'exit'});

        const parentId = getParentSpanId?.(frameBlock);
        if (parentId == null) {
          continue;
        }
        const parent = blockById.get(parentId);
        if (!parent || parent === frameBlock || laneAssignments.has(parent)) {
          continue;
        }
        if (visitingBlocks.has(parent)) {
          assignBlockToLane(parent, 0);
          continue;
        }
        blockStack.push({block: parent, phase: 'enter'});
        continue;
      }

      visitingBlocks.delete(frameBlock);
      let minimumLane = 0;
      const parentId = getParentSpanId?.(frameBlock);
      if (parentId != null) {
        const parent = blockById.get(parentId);
        if (parent && parent !== frameBlock) {
          const parentLane = laneAssignments.get(parent);
          if (parentLane != null) {
            minimumLane = parentLane + 1;
          }
        }
      }
      assignBlockToLane(
        frameBlock,
        minimumLane,
        getSpanExtremalTiming(frameBlock, options.maxTimeMs)
      );
    }

    return laneAssignments.get(block) ?? assignBlockToLane(block, 0);
  };

  for (const block of sortedBlocks) {
    assignBlock(block);
  }

  let maxLane = -1;
  for (const block of sortedBlocks) {
    const lane = laneAssignments.get(block) ?? 0;
    if (lane > maxLane) {
      maxLane = lane;
    }
    visitAssignment(block, lane);
  }
  return maxLane;
}

/**
 * Visits assigned lanes after building one parent-safe Kahn order for the whole batch.
 *
 * @returns The largest assigned lane index, or -1 when no spans were assigned.
 */
export function visitKahnLaneAssignments<BlockT extends LaneBlockSource>(
  spans: readonly BlockT[],
  options: LaneLayoutOptions<BlockT> = {},
  visitAssignment: (block: BlockT, lane: number) => void
): number {
  const timeSortedOrder = buildTimeSortedBlockOrder(spans, options);
  if (!options.getParentSpanId && !options.getLaneAffinityKey) {
    const sortedBlocksWithExtents = timeSortedOrder.blocks.map(block => ({
      block,
      timing: timeSortedOrder.timingByBlock.get(block)!
    }));
    return visitSortedBlockLaneAssignmentsByOverlap(sortedBlocksWithExtents, visitAssignment);
  }

  const laneStatesByIndex: LaneWindowState[] = [];
  const laneAssignments = new Map<BlockT, number>();
  const blockById = new Map<TraceSpanId, BlockT>();
  const getParentSpanId = options.getParentSpanId;
  const getLaneAffinityKey = options.getLaneAffinityKey;
  const affinityPreferredWidthByKey = buildLaneAffinityPreferredWidthByKey(
    timeSortedOrder.blocks.map(block => ({
      block,
      timing:
        timeSortedOrder.timingByBlock.get(block) ?? getSpanExtremalTiming(block, options.maxTimeMs)
    })),
    getLaneAffinityKey
  );
  const affinityStateByKey = new Map<LaneAffinityKey, LaneAffinityState>();
  const affinityOwnerByLane: Array<LaneAffinityKey | undefined> = [];
  const affinityReservationByLane: Array<LaneAffinityKey | undefined> = [];
  timeSortedOrder.blocks.forEach(block => {
    blockById.set(block.spanId, block);
  });

  const orderedBlocks = buildKahnParentSafeBlockOrder({
    blocks: timeSortedOrder.blocks,
    blockById,
    getParentSpanId
  });

  const assignBlockToLane = (block: BlockT): number => {
    const existingLane = laneAssignments.get(block);
    if (existingLane != null) {
      return existingLane;
    }

    let minimumLane = 0;
    const parentId = getParentSpanId?.(block);
    if (parentId != null) {
      const parent = blockById.get(parentId);
      if (parent && parent !== block) {
        const parentLane = laneAssignments.get(parent);
        if (parentLane != null) {
          minimumLane = parentLane + 1;
        }
      }
    }

    const timing =
      timeSortedOrder.timingByBlock.get(block) ?? getSpanExtremalTiming(block, options.maxTimeMs);
    const affinityKey = getLaneAffinityKey?.(block);
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

    laneAssignments.set(block, assignedLane);
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

  for (const block of orderedBlocks) {
    assignBlockToLane(block);
  }

  let maxLane = -1;
  for (const block of timeSortedOrder.blocks) {
    const lane = laneAssignments.get(block) ?? 0;
    if (lane > maxLane) {
      maxLane = lane;
    }
    visitAssignment(block, lane);
  }
  return maxLane;
}

/**
 * Assigns lanes strictly by interval overlap, ignoring nesting hints.
 */
export function layoutLanesByOverlap<BlockT extends LaneBlockSource>(
  spans: readonly BlockT[],
  options: Pick<LaneLayoutOptions<BlockT>, 'maxTimeMs'> = {}
): LaneAssignment<BlockT>[] {
  return layoutSortedBlocksByOverlap(sortBlocksByTimeWithExtents(spans, options));
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
function buildLaneAffinityPreferredWidthByKey<BlockT extends LaneBlockSource>(
  sortedBlocks: readonly TimedBlock<BlockT>[],
  getLaneAffinityKey: LaneLayoutOptions<BlockT>['getLaneAffinityKey']
): Map<LaneAffinityKey, number> {
  if (!getLaneAffinityKey) {
    return new Map();
  }

  const activeEndTimesByKey = new Map<LaneAffinityKey, number[]>();
  const preferredWidthByKey = new Map<LaneAffinityKey, number>();
  for (const {block, timing} of sortedBlocks) {
    const affinityKey = getLaneAffinityKey(block);
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
function buildKahnParentSafeBlockOrder<BlockT extends LaneBlockSource>(params: {
  blocks: readonly BlockT[];
  blockById: ReadonlyMap<TraceSpanId, BlockT>;
  getParentSpanId?: (block: BlockT) => TraceSpanId | null | undefined;
}): BlockT[] {
  if (!params.getParentSpanId) {
    return [...params.blocks];
  }

  const indegreeByBlock = new Map<BlockT, number>();
  const childrenByBlock = new Map<BlockT, BlockT[]>();
  const timeOrderIndexByBlock = new Map<BlockT, number>();
  params.blocks.forEach((block, index) => {
    indegreeByBlock.set(block, 0);
    timeOrderIndexByBlock.set(block, index);
  });
  params.blocks.forEach(block => {
    const parentId = params.getParentSpanId?.(block);
    if (parentId == null) {
      return;
    }
    const parent = params.blockById.get(parentId);
    if (!parent || parent === block) {
      return;
    }
    indegreeByBlock.set(block, (indegreeByBlock.get(block) ?? 0) + 1);
    const children = childrenByBlock.get(parent);
    if (children) {
      children.push(block);
    } else {
      childrenByBlock.set(parent, [block]);
    }
  });

  /*
   * Keep ready roots chronological. Lane windows rely on mostly append-only insertion in dense
   * traces; promoting later-starting spans here can force repeated ordered array splices.
   */
  const readyTimeOrderIndexes: number[] = [];
  params.blocks.forEach((block, index) => {
    if ((indegreeByBlock.get(block) ?? 0) === 0) {
      pushNumberHeap(readyTimeOrderIndexes, index);
    }
  });
  const orderedBlocks: BlockT[] = [];
  while (readyTimeOrderIndexes.length > 0) {
    const readyIndex = popNumberHeap(readyTimeOrderIndexes)!;
    const block = params.blocks[readyIndex]!;
    orderedBlocks.push(block);
    for (const child of childrenByBlock.get(block) ?? []) {
      const nextIndegree = (indegreeByBlock.get(child) ?? 0) - 1;
      indegreeByBlock.set(child, nextIndegree);
      if (nextIndegree === 0) {
        const childIndex = timeOrderIndexByBlock.get(child);
        if (childIndex != null) {
          pushNumberHeap(readyTimeOrderIndexes, childIndex);
        }
      }
    }
  }

  if (orderedBlocks.length === params.blocks.length) {
    return orderedBlocks;
  }

  const emittedBlocks = new Set(orderedBlocks);
  for (const block of params.blocks) {
    if (!emittedBlocks.has(block)) {
      orderedBlocks.push(block);
    }
  }
  return orderedBlocks;
}
