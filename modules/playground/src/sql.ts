// deck.gl-community
// SPDX-License-Identifier: MIT
import type {Table} from 'apache-arrow';
import {PLAYGROUND_SQL_JSON_FUNCTIONS} from './runtime/playground-sql-json-functions';
import type {ArrowFunctionPackage} from '@math.gl/sql/arrow';
import type {SQLParameters} from '@math.gl/sql/parser';
import type {PlaygroundQueryProvider} from './runtime/playground-data-source-manager';

/** Restores a row from a lossless table encoding after a single-table SELECT *. */
export type PlaygroundSQLRowAdapter = (row: Record<string, unknown>) => Record<string, unknown>;

/** Host-owned named Arrow tables and optional live catalog information. */
export type PlaygroundSQLTables = {
  /** Resolves an allowlisted table at execution time; undefined rejects the query. */
  getTable: (name: string) => Table | undefined;
  /** Enumerates allowlisted names for SHOW TABLES and SHOW SOURCES. */
  listTables?: () => Iterable<string>;
  /** Optional row restoration for SELECT *; explicit projections remain SQL result rows. */
  getRowAdapter?: (name: string) => PlaygroundSQLRowAdapter | undefined;
  /** Notifies when catalog inputs change. The manager releases the returned subscription. */
  subscribe?: (onChange: () => void) => () => void;
  /** Project this unique string/number column to retain stable picking identities. */
  rowIdColumn?: string;
  /** Explicit math.gl scalar, aggregate, or table function packages available to this provider. */
  functions?: readonly ArrowFunctionPackage[];
};

/**
 * Creates a local Arrow SQL provider with math.gl parsing and loaders.gl execution.
 * Relational queries use math.gl's engine for joins, grouping, ordering and UNION ALL.
 * Named parameters bind as values, never SQL text. Inputs remain host-owned; no URL is loaded.
 * Input change notifications refresh managed queries; cancellation preserves the accepted preview.
 */
export function createPlaygroundSQLProvider({
  getTable,
  listTables,
  getRowAdapter,
  subscribe,
  rowIdColumn,
  functions = []
}: PlaygroundSQLTables): PlaygroundQueryProvider {
  const sqlFunctions = [...PLAYGROUND_SQL_JSON_FUNCTIONS, ...functions];
  return {
    subscribe: subscribe && ((_request, onChange) => subscribe(onChange)),
    async execute(request, {signal} = {}) {
      signal?.throwIfAborted();
      if (Array.isArray(request.parameters)) {
        throw new Error('SQL parameters must be a named object, such as {minimum: 2}');
      }
      const {parseSQLQuery, parseSQLSelectCompound, prepareSQLParameters} = await import(
        '@math.gl/sql/parser'
      );
      signal?.throwIfAborted();
      const parameters =
        request.parameters === undefined
          ? undefined
          : prepareSQLParameters(request.parameters as SQLParameters);
      const options = {parameters, functions: sqlFunctions};
      // The simple parser also handles metadata. Relational syntax is planned separately below.
      let simple: ReturnType<typeof parseSQLQuery> | undefined;
      try {
        simple = parseSQLQuery(request.sql, options);
      } catch {
        // The relational parser supplies diagnostics for queries outside the simple subset.
      }
      if (simple && 'command' in simple) {
        if (simple.command === 'describe') {
          const name =
            typeof simple.from === 'string'
              ? simple.from
              : `${simple.from.source}.${simple.from.table}`;
          const table = getTable(name);
          if (!table) throw new Error(`Unknown SQL table: ${name}`);
          return {
            data: table.schema.fields.map(field => ({
              name: field.name,
              type: String(field.type),
              nullable: field.nullable
            }))
          };
        }
        if (!listTables) throw new Error('Catalog discovery requires listTables');
        const from = 'from' in simple ? simple.from : undefined;
        return {
          data: [...listTables()].filter(name => !from || name === from).map(name => ({name}))
        };
      }
      const compound = parseSQLSelectCompound(request.sql, options);
      const tables = new Map<string, Table>();
      for (const input of compound.inputs) {
        for (const binding of [
          input.from,
          ...input.joins.filter(join => !join.unnest).map(join => join.table)
        ]) {
          const name = binding.inputTable ?? binding.name;
          const table = getTable(name);
          if (!table) throw new Error(`Unknown SQL table: ${name}`);
          tables.set(name, table);
        }
      }
      let result: Table;
      if (simple && !('command' in simple) && typeof simple.from === 'string') {
        const {query} = await import('@loaders.gl/core/query');
        result = await query(
          {...simple, from: undefined},
          {source: tables.get(simple.from)!, signal, functions: sqlFunctions}
        );
      } else {
        const {queryArrowSQL} = await import('@math.gl/sql/query');
        result = queryArrowSQL(request.sql, tables, {...options, signal});
      }
      signal?.throwIfAborted();
      const input = compound.inputs[0];
      const restore =
        compound.inputs.length === 1 && !input.select && !input.joins.length
          ? getRowAdapter?.(input.from.name)
          : undefined;
      const data = Array.from(result, row => {
        const plain = toPlainValue(row);
        return restore ? restore(plain) : plain;
      });
      const ids = rowIdColumn && data.map(row => row[rowIdColumn]);
      const hasRowIds =
        ids &&
        ids.every(
          id => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))
        ) &&
        new Set(ids).size === ids.length;
      return {
        data,
        ...(hasRowIds && {getRowId: (row: any) => row[rowIdColumn!]})
      };
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

/** Observable allowlist of host-owned Arrow inputs; removing entries does not close tables. */
export class PlaygroundSQLTableCatalog {
  private tables = new Map<string, Table>();
  private listeners = new Set<() => void>();
  private rowAdapters = new Map<string, PlaygroundSQLRowAdapter>();

  /** Registers or replaces a table and invalidates dependent managed queries. */
  setTable(name: string, table: Table, rowAdapter?: PlaygroundSQLRowAdapter): void {
    if (!name.trim()) throw new Error('SQL table names must be nonempty');
    this.tables.set(name, table);
    if (rowAdapter) this.rowAdapters.set(name, rowAdapter);
    else this.rowAdapters.delete(name);
    for (const listener of [...this.listeners]) listener();
  }

  /** Resolves a table by its exact allowlisted name. */
  getTable = (name: string): Table | undefined => this.tables.get(name);

  /** Returns the host row decoder for a named table, if registered. */
  getRowAdapter = (name: string): PlaygroundSQLRowAdapter | undefined => this.rowAdapters.get(name);

  /** Lists allowlisted table names in registration order. */
  listTables = (): Iterable<string> => this.tables.keys();

  /** Subscribes to table additions, replacements, and removals. */
  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  };

  /** Removes a name and invalidates queries; an absent table can be registered again later. */
  removeTable(name: string): void {
    if (!this.tables.delete(name)) return;
    this.rowAdapters.delete(name);
    for (const listener of [...this.listeners]) listener();
  }

  /** Releases the catalog's references and listeners without closing host-owned tables. */
  finalize(): void {
    this.listeners.clear();
    this.tables.clear();
    this.rowAdapters.clear();
  }
}
