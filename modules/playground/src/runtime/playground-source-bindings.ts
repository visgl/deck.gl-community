// deck.gl-community
// SPDX-License-Identifier: MIT

import type {
  PlaygroundDataSourceManagerLike,
  PlaygroundQuery,
  PlaygroundQueryableDataSourceManagerLike
} from './playground-data-source-manager';
import type {PlaygroundDataBinding} from './playground-registry';

type SourceState = {status: 'ready' | 'loading'} | {status: 'error'; error: Error};

/** Row access used by the document resolver, independent of source ownership. */
export type PlaygroundBindingProvider = {
  get(name: string): PlaygroundDataBinding | undefined;
  getState(name: string): SourceState | undefined;
  addQuery?(parameters: {dataSourceId: string; query: PlaygroundQuery}): void;
};

type Subscription = {
  consumerId: string;
  version: number;
  source?: unknown;
  error?: Error | null;
  binding?: PlaygroundDataBinding;
  state?: SourceState;
};
let nextConsumerId = 0;

/** Adapts the loaders.gl manager subscription contract to synchronous row snapshots. */
export class PlaygroundSourceBindings implements PlaygroundBindingProvider {
  private subscriptions = new Map<string, Subscription>();
  private notifying = false;

  constructor(
    private readonly manager: PlaygroundDataSourceManagerLike,
    private readonly onChange: (name: string) => void
  ) {}

  get(name: string): PlaygroundDataBinding | undefined {
    return this.getState(name)?.status === 'ready'
      ? this.subscriptions.get(name)?.binding
      : undefined;
  }

  getState(name: string): SourceState | undefined {
    let subscription = this.subscriptions.get(name);
    const initial = !subscription;
    const info = this.manager
      .listDataSources()
      .find(entry => entry.dataSourceId === this.normalizeId(name));
    const error = info?.status === 'error' ? info.error : null;
    if (!subscription) {
      subscription = {consumerId: `playground-source-${nextConsumerId++}`, version: 0};
      this.subscriptions.set(name, subscription);
    }
    // Refresh silent removals on reads, but never mutate a manager's live subscriber set
    // from its notification callback. Only initial lookups create deferred placeholders.
    if (initial || (!this.notifying && (error === null || error !== subscription.error))) {
      const source = this.manager.subscribe({
        dataSourceId: `${initial ? this.manager.protocol : ''}${this.normalizeId(name)}`,
        consumerId: subscription.consumerId,
        onChange: value => this.handleChange(name, subscription!, value)
      });
      if (initial || source !== subscription.source) this.update(name, subscription, source, false);
    }
    subscription.error = error;
    if (!info) return undefined;
    if (info.status === 'error') {
      return {status: 'error', error: info.error ?? new Error(`Failed data source: ${name}`)};
    }
    return subscription.state;
  }

  addQuery({dataSourceId, query}: {dataSourceId: string; query: PlaygroundQuery}): void {
    const manager = this.manager as PlaygroundDataSourceManagerLike &
      Partial<Pick<PlaygroundQueryableDataSourceManagerLike, 'addQuery'>>;
    if (!manager.addQuery) throw new Error('This data source manager has no query provider');
    manager.addQuery({dataSourceId, query});
  }

  /** Releases subscriptions left behind by edits or local overrides. */
  retain(names: Iterable<string>): void {
    const retained = new Set(names);
    for (const [name, subscription] of this.subscriptions) {
      if (!retained.has(name)) {
        this.manager.unsubscribe({consumerId: subscription.consumerId});
        this.subscriptions.delete(name);
      }
    }
  }

  /** Unsubscribes without closing the independently owned manager or its sources. */
  finalize(): void {
    this.retain([]);
  }

  private normalizeId(name: string): string {
    return name.startsWith(this.manager.protocol) ? name.slice(this.manager.protocol.length) : name;
  }

  private update(name: string, subscription: Subscription, source: unknown, notify: boolean): void {
    const version = ++subscription.version;
    subscription.source = source;
    subscription.error = null;
    subscription.binding = undefined;
    subscription.state = undefined;
    if (source instanceof Promise) {
      subscription.state = {status: 'loading'};
      void source.then(
        value => {
          if (this.subscriptions.get(name) === subscription && subscription.version === version) {
            this.update(name, subscription, value, true);
          }
        },
        error => {
          if (this.subscriptions.get(name) === subscription && subscription.version === version) {
            subscription.error = asError(error);
            subscription.state = {status: 'error', error: subscription.error};
            this.onChange(name);
          }
        }
      );
    } else if (source !== null && source !== undefined) {
      try {
        const {data, getRowId} = source as PlaygroundDataBinding;
        if (!Array.isArray(data))
          throw new Error(`Playground data source "${name}" must contain a row array`);
        if (getRowId !== undefined && typeof getRowId !== 'function') {
          throw new Error(`Playground data source "${name}" getRowId must be a function`);
        }
        subscription.binding = Object.freeze({data, getRowId});
        subscription.state = {status: 'ready'};
      } catch (error) {
        subscription.state = {status: 'error', error: asError(error)};
      }
    }
    if (notify) this.onChange(name);
  }

  private handleChange(name: string, subscription: Subscription, source: unknown): void {
    const notifying = this.notifying;
    this.notifying = true;
    try {
      this.update(name, subscription, source, true);
    } finally {
      this.notifying = notifying;
    }
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
