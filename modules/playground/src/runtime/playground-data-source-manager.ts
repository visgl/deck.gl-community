// deck.gl-community
// SPDX-License-Identifier: MIT

/** Read-only lifecycle information for one named source. */
export type PlaygroundDataSourceEntryInfo = {
  readonly dataSourceId: string;
  readonly status: 'ready' | 'pending' | 'placeholder' | 'error';
  readonly error?: Error;
};

/** One source request, identified independently within its consumer. */
export type PlaygroundDataSourceSubscription = {
  dataSourceId: string;
  consumerId: string;
  requestId?: string;
  /** Receives a source, a promise to await, or a null placeholder. */
  onChange: (source: unknown) => void;
};

/** Consumer-facing subset shared with loaders.gl's DataSourceManager. */
export type PlaygroundDataSourceManagerLike = {
  readonly protocol: string;
  subscribe(parameters: PlaygroundDataSourceSubscription): unknown;
  unsubscribe(parameters: {consumerId: string}): void;
  listDataSources(): readonly PlaygroundDataSourceEntryInfo[];
};

type SourceValue = object | Promise<object> | null;
type Registration = {
  input: SourceValue;
  value: SourceValue;
  status: PlaygroundDataSourceEntryInfo['status'];
  error?: Error;
};
type Entry = {registration?: Registration; subscribers: Set<Subscription>};
type Subscription = {entry: Entry; onChange: (source: unknown) => void};

/**
 * Persistent, owned source handles with a loaders.gl v5-shaped API.
 * Consumers await pending values and only unsubscribe on teardown. Source owners remove or
 * finalize registrations; use a null placeholder to retain subscriptions during replacement.
 */
export class PlaygroundDataSourceManager implements PlaygroundDataSourceManagerLike {
  readonly protocol: string;
  private sources = new Map<string, Entry>();
  private consumers = new Map<string, Map<string, Subscription>>();

  constructor(props: {protocol?: string} = {}) {
    this.protocol = props.protocol || 'datasource://';
  }

  /** Whether an id is registered or denotes a deferred source. */
  contains(dataSourceId: string): boolean {
    return dataSourceId.startsWith(this.protocol) || this.sources.has(dataSourceId);
  }

  /**
   * Adds an owned source, promise, or placeholder; replacements release the previous source.
   * Use forceUpdate to notify consumers again when the same source object has changed.
   */
  add({
    dataSourceId,
    dataSource,
    forceUpdate = false
  }: {
    dataSourceId: string;
    dataSource: SourceValue;
    forceUpdate?: boolean;
  }): void {
    const id = this.normalizeId(dataSourceId);
    if (!id.trim()) throw new Error('Data source ids must be nonempty');
    if (dataSource !== null && typeof dataSource !== 'object') {
      throw new Error('A data source must be an object, promise, or null');
    }
    const entry = this.sources.get(id) || {subscribers: new Set<Subscription>()};
    const previous = entry.registration;
    if (previous?.input === dataSource) {
      if (forceUpdate) this.notify(entry);
      return;
    }
    const registration: Registration = {
      input: dataSource,
      value: dataSource,
      status:
        dataSource === null ? 'placeholder' : dataSource instanceof Promise ? 'pending' : 'ready'
    };
    entry.registration = registration;
    this.sources.set(id, entry);
    if (dataSource instanceof Promise) {
      const pending = this.resolveSource(entry, registration, dataSource);
      registration.value = pending;
      void pending.catch(() => {});
    }
    if (previous?.status === 'ready' && previous.value !== dataSource) {
      void closeSource(previous.value!).catch(console.error);
    }
    this.notify(entry);
  }

  /** Returns the current value; only subsequent replacements invoke onChange. */
  subscribe({
    dataSourceId,
    consumerId,
    requestId = 'default',
    onChange
  }: PlaygroundDataSourceSubscription): unknown {
    const id = this.normalizeId(dataSourceId);
    if (dataSourceId.startsWith(this.protocol) && !this.sources.has(id)) {
      this.add({dataSourceId: id, dataSource: null});
    }
    const consumer = this.consumers.get(consumerId) || new Map<string, Subscription>();
    const previous = consumer.get(requestId);
    previous?.entry.subscribers.delete(previous);
    consumer.delete(requestId);
    const entry = this.sources.get(id);
    if (!entry) return undefined;
    const subscription = {entry, onChange};
    consumer.set(requestId, subscription);
    this.consumers.set(consumerId, consumer);
    entry.subscribers.add(subscription);
    return entry.registration!.value;
  }

  /** Detaches every request owned by a consumer without releasing shared sources. */
  unsubscribe({consumerId}: {consumerId: string}): void {
    const consumer = this.consumers.get(consumerId);
    for (const subscription of consumer?.values() || []) {
      subscription.entry.subscribers.delete(subscription);
    }
    this.consumers.delete(consumerId);
  }

  /** Returns lifecycle snapshots in registration order. */
  listDataSources(): readonly PlaygroundDataSourceEntryInfo[] {
    return Array.from(this.sources, ([dataSourceId, {registration}]) => ({
      dataSourceId,
      status: registration!.status,
      ...(registration!.error ? {error: registration!.error} : {})
    }));
  }

  /** Releases a source and silently removes its subscriptions, matching loaders.gl. */
  async remove(dataSourceId: string): Promise<void> {
    const id = this.normalizeId(dataSourceId);
    const entry = this.sources.get(id);
    if (!entry) return;
    this.sources.delete(id);
    entry.subscribers.clear();
    const registration = entry.registration;
    entry.registration = undefined;
    if (registration?.status === 'ready') await closeSource(registration.value!);
  }

  /** Releases all source handles and consumer subscriptions. */
  async finalize(): Promise<void> {
    this.consumers.clear();
    await Promise.all(Array.from(this.sources.keys(), id => this.remove(id)));
  }

  private normalizeId(id: string): string {
    return id.startsWith(this.protocol) ? id.slice(this.protocol.length) : id;
  }

  private notify(entry: Entry): void {
    for (const subscriber of entry.subscribers) subscriber.onChange(entry.registration!.value);
  }

  private async resolveSource(
    entry: Entry,
    registration: Registration,
    promise: Promise<object>
  ): Promise<object> {
    try {
      const source = await promise;
      if (!source || typeof source !== 'object') throw new Error('A data source must be an object');
      if (entry.registration === registration) {
        registration.value = source;
        registration.status = 'ready';
      } else {
        await closeSource(source);
      }
      return source;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      if (entry.registration === registration) {
        registration.status = 'error';
        registration.error = normalizedError;
      }
      throw normalizedError;
    }
  }
}

async function closeSource(source: object): Promise<void> {
  for (const method of ['close', 'finalize', 'destroy'] as const) {
    const close = (source as Record<string, unknown>)[method];
    if (typeof close === 'function') {
      await close.call(source);
      return;
    }
  }
}
