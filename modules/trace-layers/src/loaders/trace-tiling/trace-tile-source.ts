/** One-dimensional tile coordinate used for trace timeline tiles. */
export type TraceTileIndex = {
  /** Tile zoom level. Higher zoom levels cover smaller time ranges. */
  readonly z: number;
  /** Horizontal tile coordinate within the zoom level. */
  readonly x: number;
  /** Vertical tile coordinate retained for TileSource-compatible call sites. Must be zero. */
  readonly y: number;
};

/** Time range covered by a trace tile, expressed in input milliseconds. */
export type TraceTileTimeRange = {
  /** Inclusive tile start time in milliseconds. */
  readonly startTimeMs: number;
  /** Exclusive tile end time in milliseconds. */
  readonly endTimeMs: number;
};

/** Stable span row accepted by the neutral trace tiler input table. */
export type TraceSpanTableRow = {
  /** Stable span identifier carried through tile outputs. */
  readonly spanId: string;
  /** Stable process identifier that owns the span. */
  readonly processId: string;
  /** Stable thread identifier that owns the span. */
  readonly threadId: string;
  /** Inclusive span start time in milliseconds. */
  readonly startTimeMs: number;
  /** Exclusive span end time in milliseconds. */
  readonly endTimeMs: number;
  /** Vertical lane number used by representative selection. */
  readonly lane: number;
  /** Human-readable span label. */
  readonly name: string;
  /** Optional category used by future renderers for grouping or color selection. */
  readonly category?: string;
  /** Optional CSS color, palette key, or caller-defined color token. */
  readonly color?: string;
  /** Optional status string preserved for future renderers and inspectors. */
  readonly status?: string;
  /** Optional caller metadata carried through tile outputs without interpretation. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Optional tile-local row id for one rendered fragment of this span. */
  readonly tileFragmentId?: string;
  /** Optional clipped start time for rendering this span inside one tile. */
  readonly visibleStartTimeMs?: number;
  /** Optional clipped end time for rendering this span inside one tile. */
  readonly visibleEndTimeMs?: number;
  /** Whether the renderer should draw the span border at visibleStartTimeMs. */
  readonly drawStartBorder?: boolean;
  /** Whether the renderer should draw the span border at visibleEndTimeMs. */
  readonly drawEndBorder?: boolean;
};

/** Neutral span table accepted by TraceTileSource and emitted by trace tiles. */
export type TraceSpanTable = {
  /** Row-oriented span payloads in stable source order. */
  readonly rows: readonly TraceSpanTableRow[];
};

/** Stable process metadata accepted by the neutral trace tiler input table. */
export type TraceProcessTableRow = {
  /** Stable process identifier referenced by span rows. */
  readonly processId: string;
  /** Optional process label for future renderers and inspectors. */
  readonly name?: string;
  /** Optional caller metadata carried through metadata APIs without interpretation. */
  readonly metadata?: Readonly<Record<string, unknown>>;
};

/** Neutral process metadata table accepted by TraceTileSource. */
export type TraceProcessTable = {
  /** Row-oriented process metadata payloads. */
  readonly rows: readonly TraceProcessTableRow[];
};

/** Stable thread metadata accepted by the neutral trace tiler input table. */
export type TraceThreadTableRow = {
  /** Stable thread identifier referenced by span rows. */
  readonly threadId: string;
  /** Stable process identifier that owns the thread. */
  readonly processId: string;
  /** Optional thread label for future renderers and inspectors. */
  readonly name?: string;
  /** Optional caller metadata carried through metadata APIs without interpretation. */
  readonly metadata?: Readonly<Record<string, unknown>>;
};

/** Neutral thread metadata table accepted by TraceTileSource. */
export type TraceThreadTable = {
  /** Row-oriented thread metadata payloads. */
  readonly rows: readonly TraceThreadTableRow[];
};

/** Neutral table bundle accepted by TraceTileSource. */
export type TraceTileTableInput = {
  /** Span table used as the source timeline data. */
  readonly spans: TraceSpanTable;
  /** Optional process metadata table retained for metadata and future rendering. */
  readonly processes?: TraceProcessTable;
  /** Optional thread metadata table retained for metadata and future rendering. */
  readonly threads?: TraceThreadTable;
};

/** Strategy used to choose representative spans when a tile hides detail. */
export type TraceTileRepresentativeStrategy = 'duration' | 'lane-duration';

/** Options controlling timeline tile generation. */
export type TraceTileSourceOptions = {
  /** Maximum zoom level that can be requested. Values are clamped to the 0-24 range. */
  readonly maxZoom?: number;
  /** Maximum zoom level prebuilt during source initialization. */
  readonly indexMaxZoom?: number;
  /** Maximum number of spans returned by one tile before representative selection applies. */
  readonly maxSpansPerTile?: number;
  /** Width of one tile in virtual pixels, used with minSpanPixelWidth. */
  readonly tileSize?: number;
  /** Minimum projected span width required for a span to survive coarse tile filtering. */
  readonly minSpanPixelWidth?: number;
  /** Representative selection strategy used when a tile contains more spans than allowed. */
  readonly representativeStrategy?: TraceTileRepresentativeStrategy;
  /** Logging verbosity reserved for future diagnostics. */
  readonly debug?: number;
};

/** Required and normalized TraceTileSource options. */
export type RequiredTraceTileSourceOptions = {
  /** Maximum zoom level that can be requested. */
  readonly maxZoom: number;
  /** Maximum zoom level prebuilt during source initialization. */
  readonly indexMaxZoom: number;
  /** Maximum number of spans returned by one tile before representative selection applies. */
  readonly maxSpansPerTile: number;
  /** Width of one tile in virtual pixels, used with minSpanPixelWidth. */
  readonly tileSize: number;
  /** Minimum projected span width required for a span to survive coarse tile filtering. */
  readonly minSpanPixelWidth: number;
  /** Representative selection strategy used when a tile contains more spans than allowed. */
  readonly representativeStrategy: TraceTileRepresentativeStrategy;
  /** Logging verbosity reserved for future diagnostics. */
  readonly debug: number;
};

/** Metadata returned by TraceTileSource. */
export type TraceTileSourceMetadata = {
  /** Minimum zoom level supported by this source. */
  readonly minZoom: number;
  /** Maximum zoom level supported by this source. */
  readonly maxZoom: number;
  /** Full source time range in milliseconds. */
  readonly timeRange: TraceTileTimeRange;
  /** Number of input spans with finite positive time ranges. */
  readonly sourceSpanCount: number;
  /** Number of process metadata rows supplied by the input. */
  readonly processCount: number;
  /** Number of thread metadata rows supplied by the input. */
  readonly threadCount: number;
  /** Normalized options used by the source. */
  readonly options: RequiredTraceTileSourceOptions;
};

/** Level-of-detail metadata attached to each tile response. */
export type TraceTileLodMetadata = {
  /** Requested tile zoom level. */
  readonly zoom: number;
  /** LOD level used by future renderers; equal to zoom in this first iteration. */
  readonly level: number;
  /** Representative selection strategy used for this tile. */
  readonly representativeStrategy: TraceTileRepresentativeStrategy;
};

/** Trace-specific table payload returned by tile requests. */
export type TraceTileTable = {
  /** Payload discriminator for future loaders.gl adapters. */
  readonly shape: 'trace-tile-table';
  /** Tile coordinate that produced this payload. */
  readonly tileIndex: TraceTileIndex;
  /** Time range covered by this tile in milliseconds. */
  readonly timeRange: TraceTileTimeRange;
  /** Representative span rows selected for this tile. */
  readonly spans: TraceSpanTable;
  /** Number of input spans intersecting this tile before LOD selection. */
  readonly sourceSpanCount: number;
  /** Number of span rows returned in this tile. */
  readonly returnedSpanCount: number;
  /** Number of intersecting spans hidden by this tile's LOD selection. */
  readonly hiddenSpanCount: number;
  /** Level-of-detail metadata for this tile. */
  readonly lod: TraceTileLodMetadata;
};

/** Deck/loaders.gl-like tile data parameters accepted without importing loaders.gl types. */
export type TraceTileDataParameters = {
  /** Tile coordinate requested by a tile consumer. */
  readonly index: TraceTileIndex;
  /** Optional bounding box retained for future TileLayer-style adapters. */
  readonly bbox?: unknown;
  /** Optional viewport zoom retained for future TileLayer-style adapters. */
  readonly zoom?: number;
  /** Optional abort signal checked before generating tile data. */
  readonly signal?: AbortSignal;
};

type InternalTraceSpan = TraceSpanTableRow & {
  /** Stable source row index used as a final deterministic tie-breaker. */
  readonly sourceIndex: number;
};

type InternalTraceTile = {
  /** Tile coordinate. */
  readonly tileIndex: TraceTileIndex;
  /** Tile time range. */
  readonly timeRange: TraceTileTimeRange;
  /** Input spans intersecting the tile before LOD selection. */
  readonly sourceSpans: readonly InternalTraceSpan[];
};

const DEFAULT_TRACE_TILE_SOURCE_OPTIONS: RequiredTraceTileSourceOptions = {
  maxZoom: 14,
  indexMaxZoom: 5,
  maxSpansPerTile: 1000,
  tileSize: 512,
  minSpanPixelWidth: 1.25,
  representativeStrategy: 'lane-duration',
  debug: 0
};

const MAX_TILE_ZOOM = 24;

/**
 * Dependency-free 1D timeline tile source with a loaders.gl-friendly method shape.
 */
export class TraceTileSource {
  /** Promise that resolves after input data has loaded and initial tiles are ready. */
  readonly ready: Promise<void>;

  /** Normalized options used by this source. */
  readonly options: RequiredTraceTileSourceOptions;

  private readonly input: TraceTileTableInput | Promise<TraceTileTableInput>;
  private readonly tiles = new Map<string, InternalTraceTile>();
  private initialized = false;
  private metadataValue: TraceTileSourceMetadata = {
    minZoom: 0,
    maxZoom: DEFAULT_TRACE_TILE_SOURCE_OPTIONS.maxZoom,
    timeRange: {startTimeMs: 0, endTimeMs: 0},
    sourceSpanCount: 0,
    processCount: 0,
    threadCount: 0,
    options: DEFAULT_TRACE_TILE_SOURCE_OPTIONS
  };

  /** Creates a tile source from neutral trace tables or a promise for those tables. */
  constructor(
    input: TraceTileTableInput | Promise<TraceTileTableInput>,
    options: TraceTileSourceOptions = {}
  ) {
    this.input = input;
    this.options = normalizeTraceTileSourceOptions(options);
    this.metadataValue = {
      ...this.metadataValue,
      maxZoom: this.options.maxZoom,
      options: this.options
    };
    this.ready = this.initializeAsync();
  }

  /** Returns source metadata after initial tiling has completed. */
  async getMetadata(): Promise<TraceTileSourceMetadata> {
    await this.ready;
    return this.metadataValue;
  }

  /** Returns one trace tile asynchronously. */
  async getTile(tileIndex: TraceTileIndex): Promise<TraceTileTable | null> {
    await this.ready;
    return this.getTileSync(tileIndex);
  }

  /** Returns one trace tile using TileLayer/loaders.gl-like parameters. */
  async getTileData(parameters: TraceTileDataParameters): Promise<TraceTileTable | null> {
    throwIfAborted(parameters.signal);
    await this.ready;
    throwIfAborted(parameters.signal);
    return this.getTileSync(parameters.index);
  }

  /**
   * Returns one trace tile synchronously.
   *
   * Callers must await {@link TraceTileSource.ready} before using this method.
   */
  getTileSync(tileIndex: TraceTileIndex): TraceTileTable | null {
    if (!this.initialized) {
      throw new Error('TraceTileSource is not ready. Await source.ready before getTileSync().');
    }
    if (!isValidTraceTileIndex(tileIndex, this.options.maxZoom)) {
      return null;
    }

    const tile = this.getInternalTile(tileIndex);
    return tile ? buildTraceTileTable(tile, this.options) : null;
  }

  private async initializeAsync(): Promise<void> {
    const input = await this.input;
    const spans = normalizeTraceSpans(input.spans.rows);
    const timeRange = getTraceSpanTimeRange(spans);
    this.metadataValue = {
      minZoom: 0,
      maxZoom: this.options.maxZoom,
      timeRange,
      sourceSpanCount: spans.length,
      processCount: input.processes?.rows.length ?? 0,
      threadCount: input.threads?.rows.length ?? 0,
      options: this.options
    };
    this.createRootTiles(spans);
    this.initialized = true;
  }

  private createRootTiles(spans: readonly InternalTraceSpan[]): void {
    const rootIndex: TraceTileIndex = {z: 0, x: 0, y: 0};
    const rootTile: InternalTraceTile = {
      tileIndex: rootIndex,
      timeRange: getTraceTileTimeRange(rootIndex, this.metadataValue.timeRange),
      sourceSpans: spans
    };
    this.tiles.set(toTraceTileKey(rootIndex), rootTile);
    this.splitTile(rootTile, this.options.indexMaxZoom);
  }

  private getInternalTile(tileIndex: TraceTileIndex): InternalTraceTile | null {
    const key = toTraceTileKey(tileIndex);
    const cached = this.tiles.get(key);
    if (cached) {
      return cached;
    }

    const parent = this.findNearestParentTile(tileIndex);
    if (!parent) {
      return null;
    }
    this.splitTile(parent, tileIndex.z, tileIndex);
    return this.tiles.get(key) ?? null;
  }

  private findNearestParentTile(tileIndex: TraceTileIndex): InternalTraceTile | null {
    for (let z = tileIndex.z - 1; z >= 0; z -= 1) {
      const zoomSteps = tileIndex.z - z;
      const parentIndex: TraceTileIndex = {
        z,
        x: tileIndex.x >> zoomSteps,
        y: 0
      };
      const parent = this.tiles.get(toTraceTileKey(parentIndex));
      if (parent) {
        return parent;
      }
    }
    return null;
  }

  private splitTile(
    startTile: InternalTraceTile,
    targetZoom: number,
    targetTileIndex?: TraceTileIndex
  ): void {
    const stack: InternalTraceTile[] = [startTile];
    while (stack.length > 0) {
      const tile = stack.pop()!;
      const {z, x} = tile.tileIndex;
      if (z >= targetZoom || z >= this.options.maxZoom) {
        continue;
      }
      if (!targetTileIndex && tile.sourceSpans.length <= this.options.maxSpansPerTile) {
        continue;
      }

      const nextZ = z + 1;
      const children = [
        this.buildChildTile(tile, {z: nextZ, x: x * 2, y: 0}),
        this.buildChildTile(tile, {z: nextZ, x: x * 2 + 1, y: 0})
      ];
      for (const child of children) {
        this.tiles.set(toTraceTileKey(child.tileIndex), child);
      }

      if (targetTileIndex) {
        const nextChildX = targetTileIndex.x >> (targetTileIndex.z - nextZ);
        const nextChild = children.find(child => child.tileIndex.x === nextChildX);
        if (nextChild) {
          stack.push(nextChild);
        }
      } else {
        stack.push(...children);
      }
    }
  }

  private buildChildTile(
    parentTile: InternalTraceTile,
    tileIndex: TraceTileIndex
  ): InternalTraceTile {
    const timeRange = getTraceTileTimeRange(tileIndex, this.metadataValue.timeRange);
    return {
      tileIndex,
      timeRange,
      sourceSpans: parentTile.sourceSpans.filter(span => spanIntersectsTimeRange(span, timeRange))
    };
  }
}

function normalizeTraceTileSourceOptions(
  options: TraceTileSourceOptions
): RequiredTraceTileSourceOptions {
  const maxZoom = clampInteger(
    options.maxZoom ?? DEFAULT_TRACE_TILE_SOURCE_OPTIONS.maxZoom,
    0,
    MAX_TILE_ZOOM
  );
  const indexMaxZoom = clampInteger(
    options.indexMaxZoom ?? DEFAULT_TRACE_TILE_SOURCE_OPTIONS.indexMaxZoom,
    0,
    maxZoom
  );
  return {
    maxZoom,
    indexMaxZoom,
    maxSpansPerTile: Math.max(
      1,
      Math.floor(options.maxSpansPerTile ?? DEFAULT_TRACE_TILE_SOURCE_OPTIONS.maxSpansPerTile)
    ),
    tileSize: Math.max(1, options.tileSize ?? DEFAULT_TRACE_TILE_SOURCE_OPTIONS.tileSize),
    minSpanPixelWidth: Math.max(
      0,
      options.minSpanPixelWidth ?? DEFAULT_TRACE_TILE_SOURCE_OPTIONS.minSpanPixelWidth
    ),
    representativeStrategy:
      options.representativeStrategy ?? DEFAULT_TRACE_TILE_SOURCE_OPTIONS.representativeStrategy,
    debug: Math.max(0, Math.floor(options.debug ?? DEFAULT_TRACE_TILE_SOURCE_OPTIONS.debug))
  };
}

function buildTraceTileTable(
  tile: InternalTraceTile,
  options: RequiredTraceTileSourceOptions
): TraceTileTable {
  const selectedSpans = selectTraceTileSpans(tile, options);
  return {
    shape: 'trace-tile-table',
    tileIndex: tile.tileIndex,
    timeRange: tile.timeRange,
    spans: {
      rows: selectedSpans.map(span => buildTraceTileSpanRow(span, tile))
    },
    sourceSpanCount: tile.sourceSpans.length,
    returnedSpanCount: selectedSpans.length,
    hiddenSpanCount: Math.max(0, tile.sourceSpans.length - selectedSpans.length),
    lod: {
      zoom: tile.tileIndex.z,
      level: tile.tileIndex.z,
      representativeStrategy: options.representativeStrategy
    }
  };
}

function selectTraceTileSpans(
  tile: InternalTraceTile,
  options: RequiredTraceTileSourceOptions
): readonly InternalTraceSpan[] {
  if (tile.sourceSpans.length <= options.maxSpansPerTile) {
    return tile.sourceSpans;
  }

  const tileDuration = Math.max(tile.timeRange.endTimeMs - tile.timeRange.startTimeMs, 1);
  const pixelVisibleSpans = tile.sourceSpans.filter(span => {
    const spanDuration = Math.max(0, span.endTimeMs - span.startTimeMs);
    return (spanDuration / tileDuration) * options.tileSize >= options.minSpanPixelWidth;
  });
  const candidateSpans = pixelVisibleSpans.length > 0 ? pixelVisibleSpans : tile.sourceSpans;
  return sortRepresentativeSpans(candidateSpans, options.representativeStrategy)
    .slice(0, options.maxSpansPerTile)
    .sort(compareTraceSpansByTimeAndSource);
}

function sortRepresentativeSpans(
  spans: readonly InternalTraceSpan[],
  strategy: TraceTileRepresentativeStrategy
): InternalTraceSpan[] {
  if (strategy === 'lane-duration') {
    return sortRepresentativeSpansByLaneDuration(spans);
  }

  return [...spans].sort((left, right) => {
    return (
      getTraceSpanDuration(right) - getTraceSpanDuration(left) ||
      left.startTimeMs - right.startTimeMs ||
      left.sourceIndex - right.sourceIndex
    );
  });
}

function sortRepresentativeSpansByLaneDuration(
  spans: readonly InternalTraceSpan[]
): InternalTraceSpan[] {
  const spansByLane = new Map<number, InternalTraceSpan[]>();
  for (const span of spans) {
    const laneSpans = spansByLane.get(span.lane);
    if (laneSpans) {
      laneSpans.push(span);
    } else {
      spansByLane.set(span.lane, [span]);
    }
  }

  const sortedLaneEntries = [...spansByLane.entries()]
    .sort(([leftLane], [rightLane]) => leftLane - rightLane)
    .map(
      ([lane, laneSpans]) =>
        [
          lane,
          laneSpans.sort(
            (left, right) =>
              getTraceSpanDuration(right) - getTraceSpanDuration(left) ||
              left.startTimeMs - right.startTimeMs ||
              left.sourceIndex - right.sourceIndex
          )
        ] as const
    );

  const selectedSpans: InternalTraceSpan[] = [];
  let laneOffset = 0;
  let didSelectSpan = true;
  while (didSelectSpan) {
    didSelectSpan = false;
    for (const [, laneSpans] of sortedLaneEntries) {
      const span = laneSpans[laneOffset];
      if (span) {
        selectedSpans.push(span);
        didSelectSpan = true;
      }
    }
    laneOffset += 1;
  }

  return selectedSpans;
}

function normalizeTraceSpans(spans: readonly TraceSpanTableRow[]): readonly InternalTraceSpan[] {
  return spans.flatMap((span, sourceIndex) => {
    if (
      !Number.isFinite(span.startTimeMs) ||
      !Number.isFinite(span.endTimeMs) ||
      span.endTimeMs <= span.startTimeMs
    ) {
      return [];
    }
    return [
      {
        ...span,
        lane: Number.isFinite(span.lane) ? span.lane : 0,
        sourceIndex
      }
    ];
  });
}

function getTraceSpanTimeRange(spans: readonly InternalTraceSpan[]): TraceTileTimeRange {
  if (spans.length === 0) {
    return {startTimeMs: 0, endTimeMs: 0};
  }

  let startTimeMs = Number.POSITIVE_INFINITY;
  let endTimeMs = Number.NEGATIVE_INFINITY;
  for (const span of spans) {
    startTimeMs = Math.min(startTimeMs, span.startTimeMs);
    endTimeMs = Math.max(endTimeMs, span.endTimeMs);
  }
  return {startTimeMs, endTimeMs};
}

function getTraceTileTimeRange(
  tileIndex: TraceTileIndex,
  sourceTimeRange: TraceTileTimeRange
): TraceTileTimeRange {
  const sourceDuration = sourceTimeRange.endTimeMs - sourceTimeRange.startTimeMs;
  if (sourceDuration <= 0) {
    return {...sourceTimeRange};
  }

  const tileCount = 2 ** tileIndex.z;
  const tileDuration = sourceDuration / tileCount;
  return {
    startTimeMs: sourceTimeRange.startTimeMs + tileDuration * tileIndex.x,
    endTimeMs: sourceTimeRange.startTimeMs + tileDuration * (tileIndex.x + 1)
  };
}

function spanIntersectsTimeRange(span: TraceSpanTableRow, timeRange: TraceTileTimeRange): boolean {
  return span.startTimeMs < timeRange.endTimeMs && span.endTimeMs > timeRange.startTimeMs;
}

function isValidTraceTileIndex(tileIndex: TraceTileIndex, maxZoom: number): boolean {
  if (
    !Number.isInteger(tileIndex.z) ||
    !Number.isInteger(tileIndex.x) ||
    !Number.isInteger(tileIndex.y) ||
    tileIndex.y !== 0 ||
    tileIndex.z < 0 ||
    tileIndex.z > maxZoom
  ) {
    return false;
  }

  const tileCount = 2 ** tileIndex.z;
  return tileIndex.x >= 0 && tileIndex.x < tileCount;
}

function buildTraceTileSpanRow(
  span: InternalTraceSpan,
  tile: InternalTraceTile
): TraceSpanTableRow {
  const sourceRow = stripInternalTraceSpanFields(span);
  const visibleStartTimeMs = Math.max(span.startTimeMs, tile.timeRange.startTimeMs);
  const visibleEndTimeMs = Math.min(span.endTimeMs, tile.timeRange.endTimeMs);
  return {
    ...sourceRow,
    tileFragmentId: `${span.spanId}@${toTraceTileKey(tile.tileIndex)}`,
    visibleStartTimeMs,
    visibleEndTimeMs,
    drawStartBorder: span.startTimeMs >= tile.timeRange.startTimeMs,
    drawEndBorder: span.endTimeMs <= tile.timeRange.endTimeMs
  };
}

function stripInternalTraceSpanFields(span: InternalTraceSpan): TraceSpanTableRow {
  const row: TraceSpanTableRow = {
    spanId: span.spanId,
    processId: span.processId,
    threadId: span.threadId,
    startTimeMs: span.startTimeMs,
    endTimeMs: span.endTimeMs,
    lane: span.lane,
    name: span.name,
    category: span.category,
    color: span.color,
    status: span.status,
    metadata: span.metadata,
    tileFragmentId: span.tileFragmentId,
    visibleStartTimeMs: span.visibleStartTimeMs,
    visibleEndTimeMs: span.visibleEndTimeMs,
    drawStartBorder: span.drawStartBorder,
    drawEndBorder: span.drawEndBorder
  };
  return row;
}

function getTraceSpanDuration(span: TraceSpanTableRow): number {
  return span.endTimeMs - span.startTimeMs;
}

function compareTraceSpansByTimeAndSource(
  left: InternalTraceSpan,
  right: InternalTraceSpan
): number {
  return left.startTimeMs - right.startTimeMs || left.sourceIndex - right.sourceIndex;
}

function toTraceTileKey(tileIndex: TraceTileIndex): string {
  return `${tileIndex.z}/${tileIndex.x}/${tileIndex.y}`;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error('Trace tile request aborted.');
    error.name = 'AbortError';
    throw error;
  }
}
