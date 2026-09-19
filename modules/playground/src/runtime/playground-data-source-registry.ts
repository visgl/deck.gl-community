// deck.gl-community
// SPDX-License-Identifier: MIT

import type {PlaygroundDataBinding} from './playground-registry';

/** Loads a shared row binding, with cancellation when its registration is replaced or removed. */
export type PlaygroundDataSourceLoader = (options: {
  /** Aborted when the registry no longer owns this registration. */
  signal: AbortSignal;
}) => PlaygroundDataBinding | Promise<PlaygroundDataBinding>;

/** Immediate rows or a loader started once for each registration. */
export type PlaygroundDataSource = PlaygroundDataBinding | PlaygroundDataSourceLoader;

/** Current loading status of a registered source. */
export type PlaygroundDataSourceState =
  | {readonly status: 'loading'}
  | {readonly status: 'ready'}
  | {readonly status: 'error'; readonly error: Error};

type SourceRegistration = {
  binding?: PlaygroundDataBinding;
  state: PlaygroundDataSourceState;
  controller?: AbortController;
};

/** Named row sources shared independently of any playground's lifetime. */
export class PlaygroundDataSourceRegistry {
  private sources = new Map<string, SourceRegistration>();
  private listeners = new Set<(name: string) => void>();

  /**
   * Registers rows or a loader, replacing and aborting any previous registration.
   * Loaders run once in a microtask; all consumers share the original rows.
   * Returns a cleanup function that removes only this registration.
   */
  register(name: string, source: PlaygroundDataSource): () => void {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('Playground data source names must be nonempty strings');
    }
    const registration: SourceRegistration =
      typeof source === 'function'
        ? {state: Object.freeze({status: 'loading'}), controller: new AbortController()}
        : {state: Object.freeze({status: 'ready'}), binding: createBinding(name, source)};
    const previous = this.sources.get(name);
    this.sources.set(name, registration);
    if (typeof source === 'function') {
      void this.loadSource(name, registration, source).catch(console.error);
    }
    previous?.controller?.abort();
    this.notifySubscribers(name);

    return () => {
      if (this.sources.get(name) === registration) {
        this.unregister(name);
      }
    };
  }

  /** Returns the frozen binding descriptor only when the named source is ready. */
  get(name: string): PlaygroundDataBinding | undefined {
    return this.sources.get(name)?.binding;
  }

  /** Returns a frozen status snapshot, or `undefined` if the name is not registered. */
  getState(name: string): PlaygroundDataSourceState | undefined {
    return this.sources.get(name)?.state;
  }

  /** Removes a source, aborting its loader. Returns false when the name is absent. */
  unregister(name: string): boolean {
    const registration = this.sources.get(name);
    if (!registration) {
      return false;
    }
    this.sources.delete(name);
    registration.controller?.abort();
    this.notifySubscribers(name);
    return true;
  }

  /** Observes changed source names; returns an unsubscribe function. */
  subscribe(listener: (name: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async loadSource(
    name: string,
    registration: SourceRegistration,
    loader: PlaygroundDataSourceLoader
  ): Promise<void> {
    // Defer execution so replacement or cleanup can cancel before loading starts.
    await Promise.resolve();
    if (this.sources.get(name) !== registration) return;
    try {
      const binding = await loader({signal: registration.controller!.signal});
      if (this.sources.get(name) !== registration) return;
      registration.binding = createBinding(name, binding);
      registration.state = Object.freeze({status: 'ready'});
    } catch (error) {
      if (this.sources.get(name) !== registration) return;
      registration.state = Object.freeze({
        status: 'error',
        error: error instanceof Error ? error : new Error(String(error))
      });
    }
    this.notifySubscribers(name);
  }

  private notifySubscribers(name: string): void {
    for (const listener of this.listeners) listener(name);
  }
}

function createBinding(name: string, binding: PlaygroundDataBinding): PlaygroundDataBinding {
  if (!Array.isArray(binding?.data)) {
    throw new Error(`Playground data source "${name}" must contain a row array`);
  }
  const {data, getRowId} = binding;
  if (getRowId !== undefined && typeof getRowId !== 'function') {
    throw new Error(`Playground data source "${name}" getRowId must be a function`);
  }
  return Object.freeze({data, getRowId});
}
