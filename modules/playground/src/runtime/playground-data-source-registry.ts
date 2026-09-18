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

/** Immutable loading status of a registered source. */
export type PlaygroundDataSourceState =
  | {readonly status: 'loading'}
  | {readonly status: 'ready'}
  | {readonly status: 'error'; readonly error: Error};

type SourceRegistration = {
  binding?: PlaygroundDataBinding;
  state: PlaygroundDataSourceState;
  controller?: AbortController;
};

/**
 * Named row sources shared by independent producers and playground instances.
 *
 * Each registry has its own lifetime. Registrations retain the original row array and row
 * objects, while the binding descriptor is copied and frozen. Register a replacement to
 * notify consumers when rows or their selection identity change. Loaders run once per
 * registration, starting in a microtask, and their results are shared by all consumers.
 */
export class PlaygroundDataSourceRegistry {
  private sources = new Map<string, SourceRegistration>();
  private listeners = new Set<(name: string) => void>();

  /**
   * Adds or replaces a named source and synchronously notifies subscribers.
   *
   * @param name - A nonempty source name, matched exactly by `@@data` references.
   * @param source - A row binding or loader returning a binding. Loaders receive an abort
   * signal and must perform their own loading; the registry never fetches URLs itself.
   * Failed loaders retain an error status until replaced or removed.
   * @returns An idempotent cleanup function that removes only this registration. It cannot
   * remove a replacement registered later under the same name.
   * @throws If the name or immediate binding is invalid, before changing any registrations.
   * @throws An `AggregateError` after notifying all subscribers if any subscriber throws.
   * The source remains registered in this case.
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
      this.loadSource(name, registration, source);
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

  /**
   * Removes the current registration for a name and synchronously notifies subscribers.
   *
   * @returns Whether a registration was removed. Absent names do not trigger notifications.
   * @throws An `AggregateError` after notifying all subscribers if any subscriber throws.
   * The source remains removed in this case.
   */
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

  /**
   * Subscribes to future source changes, receiving the changed name after the mutation.
   *
   * Every subscription is independent, including repeated subscriptions of the same
   * callback. Dispatch uses a snapshot: subscriptions added or removed during a callback
   * affect subsequent dispatches. All callbacks run even if another callback throws.
   * Subscriber failures during asynchronous completion are reported through the host's
   * `reportError`, or `console.error` when unavailable, without changing the source state.
   *
   * @returns An idempotent function that removes this subscription.
   */
  subscribe(listener: (name: string) => void): () => void {
    const subscription = (name: string) => listener(name);
    this.listeners.add(subscription);
    return () => {
      this.listeners.delete(subscription);
    };
  }

  private loadSource(
    name: string,
    registration: SourceRegistration,
    loader: PlaygroundDataSourceLoader
  ): void {
    const notify = () => {
      try {
        this.notifySubscribers(name);
      } catch (failure) {
        if (typeof globalThis.reportError === 'function') {
          globalThis.reportError(failure);
        } else {
          console.error(failure);
        }
      }
    };
    const fail = (error: unknown) => {
      if (this.sources.get(name) !== registration) {
        return;
      }
      registration.state = Object.freeze({
        status: 'error',
        error: error instanceof Error ? error : new Error(String(error))
      });
      notify();
    };
    const finish = (binding: PlaygroundDataBinding) => {
      if (this.sources.get(name) !== registration) {
        return;
      }
      try {
        registration.binding = createBinding(name, binding);
        registration.state = Object.freeze({status: 'ready'});
      } catch (error) {
        fail(error);
        return;
      }
      notify();
    };
    void Promise.resolve()
      .then(() => {
        if (this.sources.get(name) === registration) {
          return loader({signal: registration.controller!.signal});
        }
        return undefined;
      })
      .then(finish, fail);
  }

  private notifySubscribers(name: string): void {
    const errors: unknown[] = [];
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(name);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `Playground data source subscribers failed for "${name}"`);
    }
  }
}

function createBinding(name: string, binding: PlaygroundDataBinding): PlaygroundDataBinding {
  if (!binding || typeof binding !== 'object') {
    throw new Error(`Playground data source "${name}" must contain a row array`);
  }
  const {data, getRowId} = binding;
  if (!Array.isArray(data)) {
    throw new Error(`Playground data source "${name}" must contain a row array`);
  }
  if (getRowId !== undefined && typeof getRowId !== 'function') {
    throw new Error(`Playground data source "${name}" getRowId must be a function`);
  }
  return Object.freeze({data, getRowId});
}
