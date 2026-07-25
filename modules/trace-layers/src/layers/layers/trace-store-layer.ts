import {CompositeLayer} from '@deck.gl/core';

import {TraceGraphLayer} from './trace-graph-layer';

import type {
  TraceChunkDescriptor,
  TraceChunkLoadContext,
  TraceChunkReadyMaterializerParams,
  TraceChunkSelection,
  TraceChunkStore,
  TraceChunkStoreLoadResult,
  TraceChunkStoreProgress,
  TraceChunkStoreWindow,
  TraceChunkStoreWindowChunksArrivedEvent,
  TraceDataset,
  TraceGraph,
  TraceViewSnapshotOptions
} from '../../trace';
import {
  buildTraceViewSnapshot,
  TraceGraph as RuntimeTraceGraph,
  traceWindowToTraceChunkSelectionWindow
} from '../../trace';
import type {Layer, LayerContext, UpdateParameters} from '@deck.gl/core';
import type {TraceGraphLayerProps} from './trace-graph-layer';

/** One store-backed trace source rendered by {@link TraceStoreLayer}. */
export type TraceStoreLayerSource<
  TPayload = unknown,
  TDescriptor extends TraceChunkDescriptor = TraceChunkDescriptor
> = {
  /** Chunk store that owns descriptors, ready chunks, and the active trace-window load. */
  readonly traceChunkStore: TraceChunkStore<TPayload, TDescriptor>;
  /** Active time window loaded while this source is rendered. */
  readonly traceWindow: TraceChunkStoreWindow;
  /** Async source loader used by `TraceChunkStore.loadWindow`. */
  readonly loadChunk: (
    descriptor: TDescriptor,
    context: TraceChunkLoadContext
  ) => Promise<TraceChunkStoreLoadResult<TPayload>>;
  /** Caller-owned materializer that builds one selected trace window into an immutable dataset. */
  readonly materializeTraceDataset: (
    params: TraceChunkReadyMaterializerParams<TPayload, TDescriptor>
  ) => TraceDataset | null;
  /** Optional view filters applied when wrapping the materialized dataset in `TraceGraph`. */
  readonly traceViewSnapshotOptions?: TraceViewSnapshotOptions;
  /** Optional selected-descriptor span budget used while materializing the window dataset. */
  readonly spanBudget?: number | null;
  /** Optional readiness callback forwarded to `TraceChunkStore`. */
  readonly onProgress?: (progress: TraceChunkStoreProgress) => void;
  /** Optional throttled chunk-arrival callback forwarded to `TraceChunkStore`. */
  readonly onChunksArrived?: (event: TraceChunkStoreWindowChunksArrivedEvent) => void;
  /** Optional async load error callback. */
  readonly onError?: (error: unknown) => void;
};

/** Properties supported by {@link TraceStoreLayer}. */
export type TraceStoreLayerProps<
  TPayload = unknown,
  TDescriptor extends TraceChunkDescriptor = TraceChunkDescriptor
> = Omit<TraceGraphLayerProps, 'traceGraphs'> & {
  /** Store-backed trace windows materialized into runtime graphs by this layer. */
  readonly traceSources: readonly TraceStoreLayerSource<TPayload, TDescriptor>[];
};

type ActiveTraceStoreLayerSource<TPayload, TDescriptor extends TraceChunkDescriptor> = {
  /** Original caller-owned source props used for graph materialization and cleanup. */
  readonly source: TraceStoreLayerSource<TPayload, TDescriptor>;
};

type MaterializedTraceStoreLayerGraph = {
  /** Latest immutable dataset returned by the source-owned materializer. */
  readonly traceDataset: TraceDataset;
  /** Runtime graph wrapping `traceDataset` and its owning chunk store. */
  readonly traceGraph: TraceGraph;
  /** Whether every selected descriptor currently has a ready stored payload. */
  readonly isComplete: boolean;
};

type TraceStoreLayerState<TPayload, TDescriptor extends TraceChunkDescriptor> = {
  /** Monotonic token used to ignore stale async load completions. */
  loadGeneration: number;
  /** Currently active store-backed trace sources. */
  activeSources: readonly ActiveTraceStoreLayerSource<TPayload, TDescriptor>[];
  /** Latest materialized runtime graphs aligned with `activeSources`. */
  materializedGraphs: readonly (MaterializedTraceStoreLayerGraph | null)[];
  /** Runtime graphs resolved from the latest materialized datasets. */
  traceGraphs: readonly TraceGraph[];
};

/** Owns trace-window loading, materializes store datasets, and renders them through `TraceGraphLayer`. */
export class TraceStoreLayer<
  TPayload = unknown,
  TDescriptor extends TraceChunkDescriptor = TraceChunkDescriptor
> extends CompositeLayer<TraceStoreLayerProps<TPayload, TDescriptor>> {
  static override layerName = 'TraceStoreLayer';

  override state: TraceStoreLayerState<TPayload, TDescriptor> = {
    loadGeneration: 0,
    activeSources: [],
    materializedGraphs: [],
    traceGraphs: []
  };

  override get isLoaded(): boolean {
    const {traceSources} = this.props;
    return (
      super.isLoaded &&
      (traceSources.length === 0 ||
        (this.state.materializedGraphs.length === traceSources.length &&
          this.state.materializedGraphs.every(materializedGraph => materializedGraph?.isComplete)))
    );
  }

  override updateState({props}: UpdateParameters<this>): void {
    if (!areTraceStoreLayerSourcesEqual(props.traceSources, this.state.activeSources)) {
      this.syncTraceSources(props.traceSources);
      return;
    }

    this.refreshMaterializedGraphs(this.state.loadGeneration);
  }

  override finalizeState(context: LayerContext): void {
    this.releaseActiveSources();
    this.state.loadGeneration += 1;
    this.state.activeSources = [];
    super.finalizeState(context);
  }

  override renderLayers(): Layer | null {
    if (this.state.traceGraphs.length === 0) {
      return null;
    }

    const {traceSources: _traceSources, ...traceGraphLayerProps} = this.props;
    return new TraceGraphLayer({
      ...this.getSubLayerProps({id: 'graphs'}),
      ...traceGraphLayerProps,
      traceGraphs: this.state.traceGraphs
    });
  }

  /** Replaces active store window loads with the current source list. */
  private syncTraceSources(
    traceSources: readonly TraceStoreLayerSource<TPayload, TDescriptor>[]
  ): void {
    const loadGeneration = this.state.loadGeneration + 1;
    this.releaseActiveSources();
    const activeSources = traceSources.map(source => ({source}));
    Object.assign(this.state, {
      loadGeneration,
      activeSources,
      materializedGraphs: [],
      traceGraphs: []
    });

    activeSources.forEach(({source}) => {
      let loading: ReturnType<typeof source.traceChunkStore.loadWindow>;
      try {
        loading = source.traceChunkStore.loadWindow({
          window: source.traceWindow,
          loadChunk: source.loadChunk,
          onProgress: source.onProgress,
          onChunksArrived: event => {
            source.onChunksArrived?.(event);
            this.refreshMaterializedGraphs(loadGeneration);
          }
        });
      } catch (error) {
        this.handleSourceError(source, error, loadGeneration);
        return;
      }

      void loading
        .then(() => {
          this.refreshMaterializedGraphs(loadGeneration);
        })
        .catch(error => {
          this.handleSourceError(source, error, loadGeneration);
        });
    });

    this.refreshMaterializedGraphs(loadGeneration);
  }

  /** Removes active store window loads owned by this layer instance. */
  private releaseActiveSources(): void {
    this.state.activeSources.forEach(({source}) => {
      source.traceChunkStore.clearActiveWindow();
    });
  }

  /** Reads latest materialized window datasets and invalidates child graph rendering when changed. */
  private refreshMaterializedGraphs(loadGeneration: number): void {
    if (loadGeneration !== this.state.loadGeneration) {
      return;
    }

    const materializedGraphs = this.state.activeSources.map(({source}) =>
      materializeTraceStoreLayerGraph(source)
    );
    if (
      areMaterializedTraceStoreLayerGraphsEqual(materializedGraphs, this.state.materializedGraphs)
    ) {
      return;
    }

    this.setState({
      materializedGraphs,
      traceGraphs: getTraceGraphsForMaterializedGraphs(materializedGraphs)
    });
  }

  /** Routes async source errors through caller hooks or deck.gl's standard layer error path. */
  private handleSourceError(
    source: TraceStoreLayerSource<TPayload, TDescriptor>,
    error: unknown,
    loadGeneration: number
  ): void {
    if (loadGeneration !== this.state.loadGeneration) {
      return;
    }

    if (source.onError) {
      source.onError(error);
    } else {
      this.raiseError(toError(error), 'TraceStoreLayer failed to load trace window');
    }
    this.refreshMaterializedGraphs(loadGeneration);
  }
}

/** Materializes one active trace window into a runtime dataset and graph. */
function materializeTraceStoreLayerGraph<TPayload, TDescriptor extends TraceChunkDescriptor>(
  source: TraceStoreLayerSource<TPayload, TDescriptor>
): MaterializedTraceStoreLayerGraph | null {
  const selection = getTraceStoreLayerSelection(source);
  const traceDataset = source.traceChunkStore.withReadyChunks(
    selection,
    source.materializeTraceDataset
  );
  if (!traceDataset) {
    return null;
  }

  return {
    traceDataset,
    traceGraph: new RuntimeTraceGraph(
      {traceDataset, traceStore: source.traceChunkStore},
      buildTraceViewSnapshot(traceDataset, source.traceViewSnapshotOptions)
    ),
    isComplete:
      source.traceChunkStore.getReadyChunks(selection.selectedDescriptors).length ===
      selection.selectedDescriptors.length
  };
}

/** Selects visible descriptors for one active trace-store layer source. */
function getTraceStoreLayerSelection<TPayload, TDescriptor extends TraceChunkDescriptor>(
  source: TraceStoreLayerSource<TPayload, TDescriptor>
): TraceChunkSelection<TDescriptor> {
  return source.traceChunkStore.select({
    window: traceWindowToTraceChunkSelectionWindow(source.traceWindow),
    spanBudget: source.spanBudget ?? null
  });
}

/** Returns source-aligned graphs only after every active window has materialized graph data. */
function getTraceGraphsForMaterializedGraphs(
  materializedGraphs: readonly (MaterializedTraceStoreLayerGraph | null)[]
): readonly TraceGraph[] {
  return materializedGraphs.every(materializedGraph => materializedGraph != null)
    ? materializedGraphs.map(materializedGraph => materializedGraph.traceGraph)
    : [];
}

/** Returns whether two source lists describe the same active store loads. */
function areTraceStoreLayerSourcesEqual<TPayload, TDescriptor extends TraceChunkDescriptor>(
  sources: readonly TraceStoreLayerSource<TPayload, TDescriptor>[],
  activeSources: readonly ActiveTraceStoreLayerSource<TPayload, TDescriptor>[]
): boolean {
  if (sources.length !== activeSources.length) {
    return false;
  }

  return sources.every((source, index) => {
    const activeSource = activeSources[index]?.source;
    return activeSource != null && areTraceStoreLayerSourcesEquivalent(source, activeSource);
  });
}

/** Returns whether two source props can reuse one store window load. */
function areTraceStoreLayerSourcesEquivalent<TPayload, TDescriptor extends TraceChunkDescriptor>(
  left: TraceStoreLayerSource<TPayload, TDescriptor>,
  right: TraceStoreLayerSource<TPayload, TDescriptor>
): boolean {
  return (
    left.traceChunkStore === right.traceChunkStore &&
    left.traceWindow.id === right.traceWindow.id &&
    left.traceWindow.minTimeMs === right.traceWindow.minTimeMs &&
    left.traceWindow.maxTimeMs === right.traceWindow.maxTimeMs &&
    left.traceWindow.notifyIntervalMs === right.traceWindow.notifyIntervalMs &&
    left.loadChunk === right.loadChunk &&
    left.materializeTraceDataset === right.materializeTraceDataset &&
    left.traceViewSnapshotOptions === right.traceViewSnapshotOptions &&
    left.spanBudget === right.spanBudget &&
    left.onProgress === right.onProgress &&
    left.onChunksArrived === right.onChunksArrived &&
    left.onError === right.onError
  );
}

/** Returns whether two materialized graph lists can reuse current child graph rendering. */
function areMaterializedTraceStoreLayerGraphsEqual(
  left: readonly (MaterializedTraceStoreLayerGraph | null)[],
  right: readonly (MaterializedTraceStoreLayerGraph | null)[]
): boolean {
  return (
    left.length === right.length &&
    left.every((materializedGraph, index) => {
      const previousGraph = right[index];
      return (
        materializedGraph?.traceDataset === previousGraph?.traceDataset &&
        materializedGraph?.isComplete === previousGraph?.isComplete
      );
    })
  );
}

/** Normalizes thrown values before forwarding them to deck.gl layer errors. */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
