export type Slice = {
  id: number;
  ts: number;
  dur: number;
  depth: number;
};

export type MipmapRow = {
  id: number;
  ts: number;
  dur: number;
  depth: number;
  bucketIndex: number;
  bucketStart: number;
  bucketEnd: number;
  sampleCount: number;
};

export function sliceMipmap(
  slices: readonly Slice[],
  start: number,
  end: number,
  step: number,
  opts?: {
    includeOverlappingPrev?: boolean;
    perfettoOverlapHeuristic?: boolean;
    sortOutput?: boolean;
  }
): MipmapRow[] {
  if (!(step > 0) || !Number.isFinite(step)) {
    throw new Error('step must be > 0');
  }
  if (!(end > start)) {
    return [];
  }

  const includeOverlappingPrev = opts?.includeOverlappingPrev ?? true;
  const perfettoOverlapHeuristic = opts?.perfettoOverlapHeuristic ?? false;
  const sortOutput = opts?.sortOutput ?? true;

  const byDepth = new Map<number, Slice[]>();
  for (const slice of slices) {
    let arr = byDepth.get(slice.depth);
    if (!arr) {
      arr = [];
      byDepth.set(slice.depth, arr);
    }
    arr.push(slice);
  }

  for (const arr of byDepth.values()) {
    arr.sort((a, b) => a.ts - b.ts);
  }

  const out: MipmapRow[] = [];

  for (const [depth, arr] of byDepth) {
    if (arr.length === 0) {
      continue;
    }

    let i = lowerBoundTs(arr, start);
    const active: Slice[] = [];
    if (includeOverlappingPrev && i > 0) {
      if (!perfettoOverlapHeuristic) {
        let back = i - 1;
        while (back >= 0 && arr[back].ts + arr[back].dur > start) {
          active.push(arr[back]);
          back -= 1;
        }
      } else {
        const prev = arr[i - 1];
        const cur = i < arr.length ? arr[i] : undefined;
        const includePrevious =
          i === arr.length || (cur ? cur.ts !== start && cur.ts + cur.dur > start : false);
        if (includePrevious) {
          active.push(prev);
        }
      }
    }

    let bucketIndex = 0;
    for (let bucketStart = start; bucketStart < end; bucketStart += step, bucketIndex += 1) {
      const bucketEnd = bucketStart + step;
      while (i < arr.length && arr[i].ts < bucketEnd) {
        active.push(arr[i]);
        i += 1;
      }

      let activeCount = 0;
      let best: Slice | undefined;
      for (const candidate of active) {
        if (candidate.ts + candidate.dur <= bucketStart || candidate.ts >= bucketEnd) {
          continue;
        }
        activeCount += 1;
        if (!best || candidate.dur > best.dur) {
          best = candidate;
        }
      }

      if (best) {
        out.push({
          id: best.id,
          ts: best.ts,
          dur: best.dur,
          depth,
          bucketIndex,
          bucketStart,
          bucketEnd,
          sampleCount: activeCount
        });
      }

      if (active.length > 0) {
        let write = 0;
        for (let read = 0; read < active.length; read += 1) {
          const candidate = active[read];
          if (candidate.ts + candidate.dur > bucketEnd) {
            active[write] = candidate;
            write += 1;
          }
        }
        active.length = write;
      }

      if (i >= arr.length && active.length === 0) {
        break;
      }
    }
  }

  if (sortOutput) {
    out.sort((a, b) => a.depth - b.depth || a.bucketIndex - b.bucketIndex || a.ts - b.ts);
  }

  return out;
}

function lowerBoundTs(arr: readonly Slice[], targetTs: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].ts < targetTs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}
