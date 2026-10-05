// deck.gl-community
// SPDX-License-Identifier: MIT

import {z} from 'zod';
import type {
  PlaygroundDataSourceManager,
  PlaygroundDataSourceManagerLike
} from './playground-data-source-manager';
import {decodePlaygroundArrow} from './decode-playground-arrow';
import {MAX_DATA_BYTES, validatePlaygroundRows} from './playground-webmcp-data';

/** Explicit source capabilities granted to one WebMCP registration. */
export type PlaygroundWebMCPDataSources = {
  /** The same host-owned manager supplied to consumers such as DeckPlayground. */
  manager: PlaygroundDataSourceManagerLike & Pick<PlaygroundDataSourceManager, 'add'>;
  /** IDs whose status and row samples may be disclosed. Defaults to none. */
  read?: readonly string[];
  /** IDs that may be created or fully replaced, including existing sources. Defaults to none. */
  write?: readonly string[];
};

const IDS = z
  .array(
    z
      .string()
      .max(32)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*(?![\s\S])/)
  )
  .max(32);
const GRANTS = z.strictObject({
  manager: z.custom<PlaygroundWebMCPDataSources['manager']>(
    value =>
      value &&
      typeof value === 'object' &&
      'protocol' in value &&
      typeof value.protocol === 'string' &&
      ['add', 'subscribe', 'unsubscribe', 'listDataSources'].every(
        method => typeof value[method] === 'function'
      )
  ),
  read: IDS.default([]),
  write: IDS.default([])
});

export class PlaygroundWebMCPSources {
  readonly read: string[];
  readonly write: string[];
  private readonly manager: PlaygroundWebMCPDataSources['manager'];
  private importing = false;

  constructor(options: PlaygroundWebMCPDataSources) {
    const grants = GRANTS.parse({...options});
    this.manager = grants.manager;
    this.read = [...new Set(grants.read)];
    this.write = [...new Set(grants.write)];
    if (
      this.manager.protocol &&
      [...this.read, ...this.write].some(id => id.startsWith(this.manager.protocol))
    ) {
      throw new Error('WebMCP grants require bare source IDs');
    }
  }

  list() {
    const entries = this.manager.listDataSources();
    return [...new Set([...this.read, ...this.write])].map(id => ({
      id,
      // A write-only grant does not disclose whether a source already exists.
      ...(this.read.includes(id)
        ? {status: entries.find(entry => entry.dataSourceId === id)?.status ?? 'missing'}
        : {}),
      readable: this.read.includes(id),
      writable: this.write.includes(id)
    }));
  }

  inspect(id: string, limit: number) {
    if (!this.read.includes(id)) throw new Error('Source is not readable');
    const info = this.list().find(entry => entry.id === id)!;
    if (info.status !== 'ready') return info;
    const source = this.getSource(id);
    const data = source && Object.getOwnPropertyDescriptor(source, 'data')?.value;
    if (!Array.isArray(data)) return {...info, inspectable: false};
    const sample = validatePlaygroundRows(
      Array.from({length: Math.min(data.length, limit)}, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(data, index);
        if (!descriptor || !('value' in descriptor)) throw new Error('Expected JSON rows');
        return descriptor.value;
      }),
      16 * 1024
    );
    return {
      ...info,
      rowCount: data.length,
      columns: [...new Set(sample.flatMap(Object.keys))],
      sample
    };
  }

  private getSource(id: string): unknown {
    const consumerId = `webmcp-${crypto.randomUUID()}`;
    try {
      return this.manager.subscribe({dataSourceId: id, consumerId, onChange() {}});
    } finally {
      this.manager.unsubscribe({consumerId});
    }
  }

  async set(input: {id: string; format: 'json' | 'arrow'; data: string}, signal: AbortSignal) {
    if (!this.write.includes(input.id) || this.importing) throw new Error('Source is not writable');
    this.importing = true;
    const consumerId = `webmcp-${crypto.randomUUID()}`;
    let changed = false;
    try {
      const previous = this.manager.subscribe({
        dataSourceId: input.id,
        consumerId,
        onChange() {
          changed = true;
        }
      });
      let rows: Record<string, unknown>[];
      if (input.format === 'json') {
        if (new TextEncoder().encode(input.data).byteLength > MAX_DATA_BYTES)
          throw new Error('Data is too large');
        rows = validatePlaygroundRows(JSON.parse(input.data));
      } else {
        if (input.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}(?![\s\S])/.test(input.data))
          throw new Error('Invalid base64');
        const decoded = atob(input.data);
        if (!decoded.length || decoded.length > MAX_DATA_BYTES) throw new Error('Invalid IPC size');
        const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
        rows = validatePlaygroundRows(await decodePlaygroundArrow(bytes, signal));
      }
      signal.throwIfAborted();
      if (changed || this.getSource(input.id) !== previous)
        throw new Error('Source changed during import');
      this.manager.add({dataSourceId: input.id, dataSource: {data: rows}});
      return {id: input.id, rowCount: rows.length, status: 'registered'};
    } finally {
      this.importing = false;
      this.manager.unsubscribe({consumerId});
    }
  }
}
