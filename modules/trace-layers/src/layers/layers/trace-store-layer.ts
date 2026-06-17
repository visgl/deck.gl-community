import {CompositeLayer} from '@deck.gl/core';

import {TraceGraphLayer} from './trace-graph-layer';

import type {
  TraceChunkDescriptor,
  TraceChunkSelection,
  TraceChunkStore,
  TraceChunkStoreLoadResult,
  TraceChunkStoreProgress,
  TraceChunkWindowGraphMaterializer,
  TraceGraph,
  TraceGraphData,
  TraceGraphFilterOptions,
  TraceWindow,
  TraceWindowChunksArrivedEvent
} from '../../trace/index';
import {
  TraceGraph as RuntimeTraceGraph,
  traceWindowToTraceChunkSelectionWindow
} from '../../trace/index';
import type {Layer, LayerContext, UpdateParameters} from '@deck.gl/core';
import type {TraceGraphLayerProps} from './trace-graph-layer';

/** One store-backed trace source rendered by {@link TraceStoreLayer}. */
export type TraceStoreLayerSource<
  TPayload = unknown,
  TDescriptor extends TraceChunkDescriptor = TraceChunkDescriptor
> = {
  /** Chunk store that owns descriptors, ready chunks, and trace-window subscriptions. */
  readonly traceChunkStore: TraceChunkStore<TPayload, TDescriptor>;
  /** Active time window registered while this source is rendered. */
  readonly traceWindow: TraceWindow;
  /** Async source loader used by `TraceChunkStore.registerTraceWindows`. */
  readonly loadChunk: (descriptor: TDescriptor) => Promise<TraceChunkStoreLoadResult<TPayload>>;
  /** Caller-owned materializer that builds one selected trace window into immutable graph data. */
  readonly materializeTraceGraphData: TraceChunkWindowGraphMaterializer<TPayload, TDescriptor>;
  /** Optional filters applied when wrapping materialized graph data in `TraceGraph`. */
  readonly traceGraphFilterOptions?: TraceGraphFilterOptions;
  /** Optional selected-descriptor span budget used while materializing the window graph. */
  readonly spanBudget?: number | null;
  /** Optional readiness callback forwarded to `TraceChunkStore`. */
  readonly onProgress?: (progress: TraceChunkStoreProgress) => void;
  /** Optional async registration/load error callback. */
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

type RegisteredTraceStoreLayerSource<TPayload, TDescriptor extends TraceChunkDescriptor> = {
  /** Original caller-owned source props used for graph materialization and cleanup. */
  readonly source: TraceStoreLayerSource<TPayload, TDescriptor>;
  /** Wrapped trace window that invalidates the layer when chunks arrive. */
  readonly wrappedWindow: TraceWindow;
};

type MaterializedTraceStoreLayerGraph = {
  /** Latest immutable graph data returned by the source-owned materializer. */
  readonly traceGraphData: TraceGraphData;
  /** Runtime graph wrapping `traceGraphData` and its owning chunk store. */
  readonly traceGraph: TraceGraph;
  /** Whether every selected descriptor currently has a ready stored payload. */
  readonly isComplete: boolean;
};

type TraceStoreLayerState<TPayload, TDescriptor extends TraceChunkDescriptor> = {
  /** Monotonic token used to ignore stale async registration completions. */
  registrationGeneration: number;
  /** Currently registered store-backed trace sources. */
  registeredSources: readonly RegisteredTraceStoreLayerSource<TPayload, TDescriptor>[];
  /** Latest materialized runtime graphs aligned with `registeredSources`. */
  materializedGraphs: readonly (MaterializedTraceStoreLayerGraph | null)[];
  /** Runtime graphs resolved from the latest materialized graph data. */
  traceGraphs: readonly TraceGraph[];
};

/** Owns trace-window registration, materializes store graph data, and renders it through `TraceGraphLayer`. */
export class TraceStoreLayer<
  TPayload = unknown,
  TDescriptor extends TraceChunkDescriptor = TraceChunkDescriptor
> extends CompositeLayer<TraceStoreLayerProps<TPayload, TDescriptor>> {
  static override layerName = 'TraceStoreLayer';

  override state: TraceStoreLayerState<TPayload, TDescriptor> = {
    registrationGeneration: 0,
    registeredSources: [],
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
    if (!areTraceStoreLayerSourcesEqual(props.traceSources, this.state.registeredSources)) {
      this.syncTraceSources(props.traceSources);
      return;
    }

    this.refreshMaterializedGraphs(this.state.registrationGeneration);
  }

  override finalizeState(context: LayerContext): void {
    this.releaseRegisteredSources();
    this.state.registrationGeneration += 1;
    this.state.registeredSources = [];
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

  /** Replaces active store subscriptions with the current source list. */
  private syncTraceSources(
    traceSources: readonly TraceStoreLayerSource<TPayload, TDescriptor>[]
  ): void {
    const registrationGeneration = this.state.registrationGeneration + 1;
    this.releaseRegisteredSources();
    const registeredSources = traceSources.map(source => ({
      source,
      wrappedWindow: {
        ...source.traceWindow,
        onChunksArrived: (event: TraceWindowChunksArrivedEvent) => {
          source.traceWindow.onChunksArrived?.(event);
          this.refreshMaterializedGraphs(registrationGeneration);
        }
      }
    }));
    Object.assign(this.state, {
      registrationGeneration,
      registeredSources,
      materializedGraphs: [],
      traceGraphs: []
    });

    registeredSources.forEach(({source, wrappedWindow}) => {
      let registration: ReturnType<typeof source.traceChunkStore.registerTraceWindows>;
      try {
        registration = source.traceChunkStore.registerTraceWindows({
          windows: [wrappedWindow],
          loadChunk: source.loadChunk,
          onProgress: source.onProgress
        });
      } catch (error) {
        this.handleSourceError(source, error, registrationGeneration);
        return;
      }

      void registration
        .then(() => {
          this.refreshMaterializedGraphs(registrationGeneration);
        })
        .catch(error => {
          this.handleSourceError(source, error, registrationGeneration);
        });
    });

    this.refreshMaterializedGraphs(registrationGeneration);
  }

  /** Removes active store window subscriptions owned by this layer instance. */
  private releaseRegisteredSources(): void {
    this.state.registeredSources.forEach(({source}) => {
      source.traceChunkStore.removeTraceWindow(source.traceWindow.id);
    });
  }

  /** Reads latest materialized window graph data and invalidates child graph rendering when changed. */
  private refreshMaterializedGraphs(registrationGeneration: number): void {
    if (registrationGeneration !== this.state.registrationGeneration) {
      return;
    }

    const materializedGraphs = this.state.registeredSources.map(({source}) =>
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
    registrationGeneration: number
  ): void {
    if (registrationGeneration !== this.state.registrationGeneration) {
      return;
    }

    if (source.onError) {
      source.onError(error);
    } else {
      this.raiseError(toError(error), 'TraceStoreLayer failed to register trace window');
    }
    this.refreshMaterializedGraphs(registrationGeneration);
  }
}

/** Materializes one registered trace window into runtime graph data and a runtime graph. */
function materializeTraceStoreLayerGraph<TPayload, TDescriptor extends TraceChunkDescriptor>(
  source: TraceStoreLayerSource<TPayload, TDescriptor>
): MaterializedTraceStoreLayerGraph | null {
  const selection = getTraceStoreLayerSelection(source);
  const traceGraphData = source.traceChunkStore.materializeTraceGraphDataForWindow(
    source.traceWindow.id,
    selection,
    source.materializeTraceGraphData
  );
  if (!traceGraphData) {
    return null;
  }

  return {
    traceGraphData,
    traceGraph: new RuntimeTraceGraph(
      {traceGraphData, traceStore: source.traceChunkStore},
      source.traceGraphFilterOptions
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

/** Returns whether two source lists describe the same active store registrations. */
function areTraceStoreLayerSourcesEqual<TPayload, TDescriptor extends TraceChunkDescriptor>(
  sources: readonly TraceStoreLayerSource<TPayload, TDescriptor>[],
  registeredSources: readonly RegisteredTraceStoreLayerSource<TPayload, TDescriptor>[]
): boolean {
  if (sources.length !== registeredSources.length) {
    return false;
  }

  return sources.every((source, index) => {
    const registeredSource = registeredSources[index]?.source;
    return (
      registeredSource != null && areTraceStoreLayerSourcesEquivalent(source, registeredSource)
    );
  });
}

/** Returns whether two source props can reuse one store window registration. */
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
    left.traceWindow.onChunksArrived === right.traceWindow.onChunksArrived &&
    left.loadChunk === right.loadChunk &&
    left.materializeTraceGraphData === right.materializeTraceGraphData &&
    left.traceGraphFilterOptions === right.traceGraphFilterOptions &&
    left.spanBudget === right.spanBudget &&
    left.onProgress === right.onProgress &&
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
        materializedGraph?.traceGraphData === previousGraph?.traceGraphData &&
        materializedGraph?.isComplete === previousGraph?.isComplete
      );
    })
  );
}

/** Normalizes thrown values before forwarding them to deck.gl layer errors. */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
