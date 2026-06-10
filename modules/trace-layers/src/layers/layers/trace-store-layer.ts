import {CompositeLayer} from '@deck.gl/core';

import {TraceGraphLayer} from './trace-graph-layer';

import type {
  TraceChunkDescriptor,
  TraceChunkStore,
  TraceChunkStoreLoadResult,
  TraceChunkStoreProgress,
  TraceChunkWindowGraphSnapshot,
  TraceGraph,
  TraceWindow
} from '../../trace/index';
import type {Layer, LayerContext, UpdateParameters} from '@deck.gl/core';
import type {TraceGraphLayerProps} from './trace-graph-layer';

/** One store-backed trace source rendered by {@link TraceStoreLayer}. */
export type TraceStoreLayerSource<
  TPayload = unknown,
  TDescriptor extends TraceChunkDescriptor = TraceChunkDescriptor,
  TWindowGraphState = unknown
> = {
  /** Chunk store that owns descriptors, ready chunks, and trace-window materialization. */
  readonly traceChunkStore: TraceChunkStore<TPayload, TDescriptor, TWindowGraphState>;
  /** Active time window registered while this source is rendered. */
  readonly traceWindow: TraceWindow;
  /** Async source loader used by `TraceChunkStore.registerTraceWindows`. */
  readonly loadChunk: (descriptor: TDescriptor) => Promise<TraceChunkStoreLoadResult<TPayload>>;
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
  TDescriptor extends TraceChunkDescriptor = TraceChunkDescriptor,
  TWindowGraphState = unknown
> = Omit<TraceGraphLayerProps, 'traceGraphs'> & {
  /** Store-backed trace windows materialized into runtime graphs by this layer. */
  readonly traceSources: readonly TraceStoreLayerSource<TPayload, TDescriptor, TWindowGraphState>[];
};

type RegisteredTraceStoreLayerSource<
  TPayload,
  TDescriptor extends TraceChunkDescriptor,
  TWindowGraphState
> = {
  /** Original caller-owned source props used for graph materialization and cleanup. */
  readonly source: TraceStoreLayerSource<TPayload, TDescriptor, TWindowGraphState>;
  /** Wrapped trace window that invalidates the layer when chunks arrive. */
  readonly wrappedWindow: TraceWindow;
};

type TraceStoreLayerState<TPayload, TDescriptor extends TraceChunkDescriptor, TWindowGraphState> = {
  /** Monotonic token used to ignore stale async registration completions. */
  registrationGeneration: number;
  /** Currently registered store-backed trace sources. */
  registeredSources: readonly RegisteredTraceStoreLayerSource<
    TPayload,
    TDescriptor,
    TWindowGraphState
  >[];
  /** Latest materialized snapshots aligned with `registeredSources`. */
  snapshots: readonly (TraceChunkWindowGraphSnapshot | null)[];
  /** Runtime graphs resolved from the latest materialized snapshots. */
  traceGraphs: readonly TraceGraph[];
};

/** Owns trace-window registration, materializes store snapshots, and renders them through `TraceGraphLayer`. */
export class TraceStoreLayer<
  TPayload = unknown,
  TDescriptor extends TraceChunkDescriptor = TraceChunkDescriptor,
  TWindowGraphState = unknown
> extends CompositeLayer<TraceStoreLayerProps<TPayload, TDescriptor, TWindowGraphState>> {
  static override layerName = 'TraceStoreLayer';

  override state: TraceStoreLayerState<TPayload, TDescriptor, TWindowGraphState> = {
    registrationGeneration: 0,
    registeredSources: [],
    snapshots: [],
    traceGraphs: []
  };

  override get isLoaded(): boolean {
    const {traceSources} = this.props;
    return (
      super.isLoaded &&
      (traceSources.length === 0 ||
        (this.state.snapshots.length === traceSources.length &&
          this.state.snapshots.every(snapshot => snapshot?.readiness.isComplete === true)))
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
    traceSources: readonly TraceStoreLayerSource<TPayload, TDescriptor, TWindowGraphState>[]
  ): void {
    const registrationGeneration = this.state.registrationGeneration + 1;
    this.releaseRegisteredSources();
    const registeredSources = traceSources.map(source => ({
      source,
      wrappedWindow: {
        ...source.traceWindow,
        onChunksArrived: event => {
          source.traceWindow.onChunksArrived?.(event);
          this.refreshMaterializedGraphs(registrationGeneration);
        }
      }
    }));
    Object.assign(this.state, {
      registrationGeneration,
      registeredSources,
      snapshots: [],
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

  /** Reads latest materialized window snapshots and invalidates child graph rendering when changed. */
  private refreshMaterializedGraphs(registrationGeneration: number): void {
    if (registrationGeneration !== this.state.registrationGeneration) {
      return;
    }

    const snapshots = this.state.registeredSources.map(({source}) =>
      source.traceChunkStore.getTraceGraphForWindow(
        source.traceWindow.id,
        source.spanBudget ?? null
      )
    );
    if (areTraceChunkWindowGraphSnapshotsEqual(snapshots, this.state.snapshots)) {
      return;
    }

    this.setState({
      snapshots,
      traceGraphs: getTraceGraphsForSnapshots(snapshots)
    });
  }

  /** Routes async source errors through caller hooks or deck.gl's standard layer error path. */
  private handleSourceError(
    source: TraceStoreLayerSource<TPayload, TDescriptor, TWindowGraphState>,
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

/** Returns source-aligned graphs only after every active window has materialized a snapshot. */
function getTraceGraphsForSnapshots(
  snapshots: readonly (TraceChunkWindowGraphSnapshot | null)[]
): readonly TraceGraph[] {
  return snapshots.every(snapshot => snapshot != null)
    ? snapshots.map(snapshot => snapshot.traceGraph)
    : [];
}

/** Returns whether two source lists describe the same active store registrations. */
function areTraceStoreLayerSourcesEqual<
  TPayload,
  TDescriptor extends TraceChunkDescriptor,
  TWindowGraphState
>(
  sources: readonly TraceStoreLayerSource<TPayload, TDescriptor, TWindowGraphState>[],
  registeredSources: readonly RegisteredTraceStoreLayerSource<
    TPayload,
    TDescriptor,
    TWindowGraphState
  >[]
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
function areTraceStoreLayerSourcesEquivalent<
  TPayload,
  TDescriptor extends TraceChunkDescriptor,
  TWindowGraphState
>(
  left: TraceStoreLayerSource<TPayload, TDescriptor, TWindowGraphState>,
  right: TraceStoreLayerSource<TPayload, TDescriptor, TWindowGraphState>
): boolean {
  return (
    left.traceChunkStore === right.traceChunkStore &&
    left.loadChunk === right.loadChunk &&
    left.spanBudget === right.spanBudget &&
    left.onProgress === right.onProgress &&
    left.onError === right.onError &&
    left.traceWindow.id === right.traceWindow.id &&
    left.traceWindow.minTimeMs === right.traceWindow.minTimeMs &&
    left.traceWindow.maxTimeMs === right.traceWindow.maxTimeMs &&
    left.traceWindow.notifyIntervalMs === right.traceWindow.notifyIntervalMs &&
    left.traceWindow.onChunksArrived === right.traceWindow.onChunksArrived
  );
}

/** Returns whether two materialized snapshot lists have the same graph versions. */
function areTraceChunkWindowGraphSnapshotsEqual(
  left: readonly (TraceChunkWindowGraphSnapshot | null)[],
  right: readonly (TraceChunkWindowGraphSnapshot | null)[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((snapshot, index) => {
    const otherSnapshot = right[index];
    return (
      snapshot === otherSnapshot ||
      (snapshot != null &&
        otherSnapshot != null &&
        snapshot.windowId === otherSnapshot.windowId &&
        snapshot.version === otherSnapshot.version)
    );
  });
}

/** Normalizes unknown async failures into deck.gl's `Error` contract. */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
