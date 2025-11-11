# Graph viewer

The graph viewer example showcases a number of network layouts powered by `@deck.gl-community/graph-layers`. It now supports both inline datasets bundled with the workspace and remote fixtures fetched at runtime.

## Adding datasets

Dataset definitions live in [`examples.ts`](./examples.ts) and use the `ExampleDefinition` type. Each entry must provide either:

- A `data()` function that returns node and edge arrays for inline samples, or
- A `dataUrl` paired with optional `loaders`, `loadOptions`, and a `graphLoader` to hydrate remote content into a `Graph` instance.

Remote samples can leverage loaders such as `DOTGraphLoader`:

```ts
{
  name: 'Cluster workflow (DOT)',
  description: 'Loads a directed workflow with clustered subgraphs defined in DOT format directly from GitHub.',
  dataUrl: `${DOT_FIXTURE_BASE_URL}cluster.dot`,
  loaders: [DOTGraphLoader],
  graphLoader: DOT_RESULT_GRAPH_LOADER,
  layouts: ['d3-force-layout', 'gpu-force-layout', 'simple-layout'],
  layoutDescriptions: LAYOUT_DESCRIPTIONS,
  style: DOT_DIRECTED_STYLE,
  type: 'graph'
}
```

The control panel surfaces basic dataset statistics once the data has been fetched and parsed, and layout option forms automatically pick up the metadata when it becomes available.
