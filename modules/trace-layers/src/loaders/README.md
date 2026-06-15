# Trace Loaders

Dependency-light trace loading and tiling helpers live here when they do not need
`TraceGraph`, React, deck.gl, or application-specific data formats.

## TraceTileSource

`TraceTileSource` is a standalone 1D timeline tile source intended to be easy to
wrap in a future loaders.gl source loader. It accepts neutral in-memory span,
process, and thread tables and returns trace-specific tile tables.

The first iteration is API-only. It does not integrate with `TraceGraph`,
deck.gl, React, remote loading, or application rendering.

Spans that cross tile boundaries are returned as tile-local fragments. Each
fragment keeps the original `spanId` for hover and selection identity, receives a
unique `tileFragmentId`, and includes clipped visible times plus border flags so
renderers can avoid drawing continuation borders at tile edges.
