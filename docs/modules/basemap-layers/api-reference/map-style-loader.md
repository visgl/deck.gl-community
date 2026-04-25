---
title: Map Style Loader
sidebar_label: Map Style Loader
description: Resolve and validate basemap style documents through a loaders.gl-compatible loader.
---

The map-style loader converts a MapLibre / Mapbox style document into the validated `ResolvedBasemapStyle` structure consumed by the basemap runtime. It can be used independently of `BasemapLayer` when you need a loaders.gl-compatible way to fetch and normalize style JSON plus TileJSON-backed sources.

## Importing

```ts
import {
  MapStyleLoader,
  resolveBasemapStyle
} from '@deck.gl-community/basemap-layers/map-style';
```

## `MapStyleLoader`

`MapStyleLoader` is a [loaders.gl](https://loaders.gl) compatible loader that parses a style document and returns a validated `ResolvedBasemapStyle`. It can be passed to `@loaders.gl/core` helpers such as `load`.

```ts
import {load} from '@loaders.gl/core';
import {MapStyleLoader} from '@deck.gl-community/basemap-layers/map-style';

const style = await load(
  'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  MapStyleLoader
);
```

### Loader options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `mapStyle.baseUrl` | `string` | inferred from the loader context when available | Base URL used to resolve relative TileJSON or tile template URLs. |
| `mapStyle.fetch` | `typeof fetch` | loader context fetch | Custom fetch implementation used for style or TileJSON requests. |
| `mapStyle.fetchOptions` | `RequestInit` | `undefined` | Request options forwarded to the selected fetch implementation. |

## `resolveBasemapStyle(style, loadOptions?)`

`resolveBasemapStyle` exposes the same normalization logic directly without going through loaders.gl. Use it when you already have a style JSON object in memory or when you want to call the resolver directly from application code.

```ts
const resolvedStyle = await resolveBasemapStyle(styleJson, {
  baseUrl: 'https://example.com/styles/base.json'
});
```

## Output shape

Both `MapStyleLoader` and `resolveBasemapStyle` return a validated `ResolvedBasemapStyle`:

- `sources` is guaranteed to be a record
- `layers` is guaranteed to be an array
- resolved TileJSON metadata is merged into each source
- relative URLs are normalized to absolute URLs when enough base information is available

Use `ResolvedBasemapStyleSchema` from `@deck.gl-community/basemap-layers/map-style` if you want to re-validate or further refine the output in your own application code.
