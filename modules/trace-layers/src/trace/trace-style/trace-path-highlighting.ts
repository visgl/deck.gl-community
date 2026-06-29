import {
  DEFAULT_PATH_HIGHLIGHT_TRAIL_LENGTH,
  MAX_PATH_HIGHLIGHT_TRAIL_LENGTH,
  MIN_PATH_HIGHLIGHT_TRAIL_LENGTH
} from './trace-colors';

import type {TraceGraph, TraceGraphPathBlockSource} from '../trace-graph/trace-graph';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {SpanRef, TracePath} from '../trace-graph/trace-types';

export type PathHighlightTrailEntry = {
  /** Exact visible block source kept for runtime geometry and playback. */
  blockSource: TraceGraphPathBlockSource;
  /** Zero-based age within the active path playback trail. */
  age: number;
};

export type TracePathHighlightingResult = {
  /** Canonical visible span refs currently highlighted by path playback. */
  highlightedPathSpanRefs: Set<SpanRef>;
  /** Exact visible block sources currently highlighted at trail age zero. */
  highlightedPathBlockSources: TraceGraphPathBlockSource[];
  /** Ordered path playback trail entries keyed by visible span refs. */
  highlightedPathTrail: PathHighlightTrailEntry[];
  /** Effective trail length after clamping settings to supported bounds. */
  pathHighlightTrailLength: number;
  /** Whether path playback should animate for the current graph and settings. */
  shouldAnimatePaths: boolean;
};

export type TracePathHighlightingSettings = Pick<
  TraceVisSettings,
  'criticalPathTrailSpanLength' | 'followCriticalPathAnimationMode'
>;

function clampTrailLength(value: number): number {
  if (value < MIN_PATH_HIGHLIGHT_TRAIL_LENGTH) {
    return MIN_PATH_HIGHLIGHT_TRAIL_LENGTH;
  }
  if (value > MAX_PATH_HIGHLIGHT_TRAIL_LENGTH) {
    return MAX_PATH_HIGHLIGHT_TRAIL_LENGTH;
  }
  return value;
}

export function computeTracePathHighlighting({
  paths,
  traceGraph,
  animationStep,
  settings
}: {
  paths: TracePath[];
  traceGraph: Readonly<TraceGraph>;
  animationStep: number;
  settings: TracePathHighlightingSettings;
}): TracePathHighlightingResult {
  const orderedPathBlocks = paths
    .map(path => ({
      pathId: path.pathId,
      blockSources: traceGraph.getVisiblePathData([path]).pathBlockSources
    }))
    .filter(({blockSources}) => blockSources.length > 0);
  const hasPathAnimationTargets = orderedPathBlocks.length > 0;
  const pathHighlightTrailLength = clampTrailLength(
    Math.round(settings.criticalPathTrailSpanLength ?? DEFAULT_PATH_HIGHLIGHT_TRAIL_LENGTH)
  );
  const pathAnimationMode = settings.followCriticalPathAnimationMode ?? 'none';
  const shouldAnimatePaths = hasPathAnimationTargets && pathAnimationMode !== 'none';

  if (!shouldAnimatePaths) {
    return {
      highlightedPathSpanRefs: new Set<SpanRef>(),
      highlightedPathBlockSources: [],
      highlightedPathTrail: [],
      pathHighlightTrailLength,
      shouldAnimatePaths
    };
  }

  const highlighted = new Set<SpanRef>();
  const highlightedBlocks: TraceGraphPathBlockSource[] = [];
  const trailMap = new Map<SpanRef, {blockSource: TraceGraphPathBlockSource; age: number}>();

  orderedPathBlocks.forEach(({blockSources}) => {
    if (blockSources.length === 0) {
      return;
    }

    const blockCount = blockSources.length;
    const maxTrail = Math.min(pathHighlightTrailLength, blockCount);

    for (let age = 0; age < maxTrail; age += 1) {
      const stepIndex = (animationStep - age) % blockCount;
      const normalizedIndex = (stepIndex + blockCount) % blockCount;
      const blockSource = blockSources[normalizedIndex];
      if (!blockSource) {
        continue;
      }

      if (
        !trailMap.has(blockSource.spanRef) ||
        age < (trailMap.get(blockSource.spanRef)?.age ?? age)
      ) {
        trailMap.set(blockSource.spanRef, {blockSource, age});
      }

      highlighted.add(blockSource.spanRef);
      if (age === 0) {
        highlightedBlocks.push(blockSource);
      }
    }
  });

  const highlightedPathTrail = Array.from(trailMap.values()).sort((a, b) => a.age - b.age);

  return {
    highlightedPathSpanRefs: highlighted,
    highlightedPathBlockSources: highlightedBlocks,
    highlightedPathTrail,
    pathHighlightTrailLength,
    shouldAnimatePaths
  };
}
