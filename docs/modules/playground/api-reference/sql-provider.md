# SQL provider (POC)

`createPlaygroundSQLProvider` is an experimental opt-in adapter exported from
`@deck.gl-community/playground/sql`. It parses SQL with `@math.gl/sql/parser` and executes the
logical query against Arrow with `@loaders.gl/core/query`. deck.gl receives ordinary row objects.

```typescript
import {PlaygroundDataSourceManager} from '@deck.gl-community/playground';
import {createPlaygroundSQLProvider} from '@deck.gl-community/playground/sql';

const manager = new PlaygroundDataSourceManager({
  queryProvider: createPlaygroundSQLProvider({getTable: name => tables.get(name)})
});
```

`getTable(name)` must return a host-owned Apache Arrow table, or undefined for an unknown name.
The adapter does not load URLs or modify input tables. It converts nested Arrow values into
ordinary objects and arrays for deck.gl accessors. Cancellation and execution errors propagate
to the existing manager; failed requests preserve the accepted preview.

Documents declare derived sources using `sources: {filtered: {"@@sql": "SELECT value FROM points
WHERE value >= 2 LIMIT 10"}}`, then reference `datasource://filtered` in a layer's data prop.
Existing inline `SELECT * FROM name;` shortcuts still perform whole-table lookup; use a declared
SQL source for filtering or projection.

The POC accepts single-table SELECT queries supported by the upstream parser and executor.
It rejects parameters, metadata commands, and missing or qualified table names. It does not
invalidate cached query results when input tables change. Update the SQL to execute again.
Sparse/heterogeneous uploads and GeoJSON retain their JSON-backed Arrow columns; the adapter
does not reinterpret those columns as nested SQL fields. It does not provide stable picking IDs.

This experiment upgrades loaders.gl core to 5.0.0 while leaving other loader versions unchanged.
Broader dependency consolidation and runtime compatibility validation remain follow-up work.
