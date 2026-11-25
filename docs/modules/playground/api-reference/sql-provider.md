# SQL provider

The experimental `@deck.gl-community/playground/sql` entry point connects math.gl SQL parsing
and relational execution to loaders.gl's Arrow query API. deck.gl receives ordinary row objects.

```typescript
import {PlaygroundDataSourceManager} from '@deck.gl-community/playground';
import {
  createPlaygroundSQLProvider,
  PlaygroundSQLTableCatalog
} from '@deck.gl-community/playground/sql';

const catalog = new PlaygroundSQLTableCatalog();
catalog.setTable('points', arrowTable);
const manager = new PlaygroundDataSourceManager({
  queryProvider: createPlaygroundSQLProvider({...catalog, rowIdColumn: 'id'})
});
```

Use SQL directly in a layer's data prop, such as
`"data": "SELECT id, position FROM points WHERE value >= 2 ORDER BY value DESC LIMIT 10"`.
The existing `SELECT * FROM name;` shortcut remains a whole-table source binding, and
`datasource://name` references remain supported without a query provider.

For reusable queries or named parameters, declare a derived source:

```json
{
  "sources": {
    "filtered": {
      "@@sql": "SELECT * FROM points WHERE value >= :minimum ORDER BY value DESC LIMIT 10",
      "parameters": {"minimum": 2}
    }
  },
  "layers": [{"@@type": "ScatterplotLayer", "id": "points", "data": "datasource://filtered",
    "getPosition": "@@=position"}]
}
```

Parameters bind through math.gl as values, never by text substitution. The adapter supports named
parameter objects, including supported scalar and array values. Positional parameter arrays are
not part of the upstream parser contract.

Single-table queries run through loaders.gl; relational queries use math.gl's `queryArrowSQL`.
Supported upstream operations include computed projections, filters, one inner/left join per
SELECT, grouping and aggregation, sorting, pagination and schema-compatible `UNION ALL`.
Unsupported SQL constructs report upstream diagnostics; this is not a general SQL database.
All table names resolve through the host allowlist. Qualified names are supported when the
catalog contains the exact name accepted by the upstream parser. No URL or database connection
is created by this adapter. Remote SQL uses the existing `PlaygroundQueryProvider` host contract.

`SHOW TABLES` and `SHOW SOURCES` return `{name}` rows from the allowed catalog;
`SHOW TABLES FROM name` filters that list. `DESCRIBE name` returns `{name, type, nullable}` rows.
No hidden sources or external database catalogs are discovered.

## Table lifecycle

`catalog.setTable(name, table, rowAdapter?)` adds or replaces an input and automatically reruns
managed queries. `removeTable(name)` invalidates queries; registering the name again recovers
them without editing SQL. `getTable`, `listTables`, `getRowAdapter`, and `subscribe` are bound
callbacks and can be passed directly as provider options. Custom hosts can supply these callbacks
without using the catalog class. Notifications currently invalidate all queries using that catalog.

The manager cancels superseded requests and releases invalidation subscriptions when sources are
replaced, removed or finalized. Failed SQL and unavailable tables preserve the accepted preview.
`catalog.finalize()` releases references/listeners without closing host-owned Arrow tables.
Synchronous relational execution still runs on the calling thread; off-thread execution is a
separate host-provider choice for large inputs.

## Picking and lossless JSON

Set `rowIdColumn` to an explicitly projected stable ID column. The adapter supplies `getRowId`
only when all output IDs are unique strings or finite numbers. Dropped IDs, duplicates (for
example after joins), null IDs and aggregate results do not receive invented identities.

Sparse/heterogeneous JSON and GeoJSON uploads retain their lossless JSON-backed Arrow columns.
Use `JSON_NUMBER(row, '$.value')`, `JSON_VALUE(row, '$.info.label')`, or
`JSON_NUMBER(properties, '$.population')` to filter/project those fields. Paths support `$`,
dot-separated identifiers, and numeric array indices such as `$.coordinates[0]`. Missing values
or incompatible scalar types yield null; malformed JSON or invalid paths fail the query.
`JSON_VALUE` returns scalar text; `JSON_NUMBER` returns finite numeric values without coercion.

A registered `rowAdapter` restores losslessly encoded rows after single-table `SELECT *`, including
filtered or sorted queries. Explicit projections and joins return their SQL result rows unchanged.
The standalone app registers these adapters automatically for JSON-backed uploads. These helpers
do not turn GeoJSON into native GeoArrow geometry or provide implicit spatial functions.

The experiment requires loaders.gl core 5.0.0. All workspace core peers are aligned; other loader
packages remain at their existing versions. Broader loader-version consolidation remains separate.

## Additional math.gl functions

Pass explicit `functions` packages to enable math, color, geospatial, or application functions
supported by math.gl. For example, import `SQRT` from `@math.gl/sql/math-functions` and pass
`functions: [SQRT]` to use `SQRT(CAST(value AS FLOAT64))`. Registration is local to the provider;
no global function catalog or remote code loading is introduced.
