// deck.gl-community
// SPDX-License-Identifier: MIT
import type {Table} from 'apache-arrow';
import type {PlaygroundQueryProvider} from './runtime/playground-data-source-manager';

/** Host-owned, named Arrow tables available to the experimental SQL provider. */
export type PlaygroundSQLTables = {
  /** Looks up a table at execution time. Returning undefined rejects the query. */
  getTable: (name: string) => Table | undefined;
};

/**
 * Creates an opt-in, local SQL provider using math.gl parsing and loaders.gl execution.
 * Supports one named Arrow table per SELECT. Parameters, catalog commands, and remote sources
 * are deliberately excluded from this POC. Imports are deferred until the first query.
 * The host owns input tables; this adapter neither registers nor finalizes them.
 */
export function createPlaygroundSQLProvider({
  getTable
}: PlaygroundSQLTables): PlaygroundQueryProvider {
  return {
    async execute(request, {signal} = {}) {
      signal?.throwIfAborted();
      if (request.parameters !== undefined) {
        throw new Error('The SQL POC does not support parameters');
      }
      const [{parseSQLQuery}, {query}] = await Promise.all([
        import('@math.gl/sql/parser'),
        import('@loaders.gl/core/query')
      ]);
      signal?.throwIfAborted();
      const parsed = parseSQLQuery(request.sql);
      if ('command' in parsed || typeof parsed.from !== 'string') {
        throw new Error('The SQL POC requires SELECT from one named Arrow table');
      }
      const table = getTable(parsed.from);
      if (!table) throw new Error(`Unknown SQL table: ${parsed.from}`);
      // Resolve FROM exclusively through the host allowlist; never interpret it as a URL.
      const selection = {...parsed, from: undefined};
      const result = await query(selection, {source: table, signal});
      signal?.throwIfAborted();
      return {data: Array.from(result, row => toPlainValue(row))};
    }
  };
}

function toPlainValue(value: unknown): any {
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value) || Array.isArray(value)) {
    return Array.from(value as ArrayLike<unknown>, toPlainValue);
  }
  if ('toJSON' in value && typeof value.toJSON === 'function') return toPlainValue(value.toJSON());
  if (Symbol.iterator in value) return Array.from(value as Iterable<unknown>, toPlainValue);
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, toPlainValue(child)])
  );
}
