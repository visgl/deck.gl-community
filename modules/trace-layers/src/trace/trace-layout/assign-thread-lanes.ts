import {layoutLanes, MAX_LANES_PER_STREAM} from './lane-layout';

import type {TraceProcess, TraceSpan, TraceThreadId} from '..';

/**
 * Assigns per-thread lanes to trace spans on a process and records lane counts on threads.
 */
const MAX_LANE_INDEX = MAX_LANES_PER_STREAM - 1;

export function assignThreadLanes(process: TraceProcess): void {
  const spansByStream = new Map<TraceThreadId, TraceSpan[]>();

  process.spans.forEach(block => {
    const threadId = block.threadId;
    const list = spansByStream.get(threadId);
    if (list) {
      list.push(block);
      return;
    }
    spansByStream.set(threadId, [block]);
  });

  spansByStream.forEach((spans, threadId) => {
    if (spans.length === 0) {
      return;
    }

    const laneAssignments = layoutLanes(spans);
    let maxLane = 0;
    let exceededLaneLimit = false;

    laneAssignments.forEach(({lane}) => {
      maxLane = Math.max(maxLane, lane);
      if (lane > MAX_LANE_INDEX) {
        exceededLaneLimit = true;
      }
    });

    const thread = process.threadMap[threadId];
    if (!thread) {
      return;
    }

    thread.userData = {
      ...(thread.userData ?? {}),
      laneCount: exceededLaneLimit
        ? MAX_LANES_PER_STREAM
        : Math.min(Math.max(maxLane + 1, 1), MAX_LANES_PER_STREAM)
    };
  });
}
