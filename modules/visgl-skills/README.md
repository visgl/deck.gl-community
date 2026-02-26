# @deck.gl-community/visgl-skills

[![NPM Version](https://img.shields.io/npm/v/@deck.gl-community/visgl-skills.svg)](https://www.npmjs.com/package/@deck.gl-community/visgl-skills)

Agent skills for deck.gl – typed helpers that simplify layer construction for
**Claude Code**, **Openclaw**, **GitHub Copilot**, and other AI coding agents.

## Overview

`visgl-skills` provides a thin, typed abstraction layer over deck.gl that
makes it easy for both humans and AI coding agents to build WebGL
visualisations. It offers three complementary APIs:

| API              | Description                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layer skills** | Factory functions that return a `LayerDescriptor` (plain object) for every common deck.gl layer type.                                                      |
| **Noodles**      | A JSON-serializable layer recipe system. AI agents can produce noodles as pure data; the runtime converts them to real deck.gl props with `hydrateNoodle`. |
| **DeckBuilder**  | A fluent builder that composes multiple layers and view-state into a single `DeckConfig` object.                                                           |

Helper skills for **viewport** (`fitViewport`, `createViewState`) and
**data** (`createColorAccessor`, `flattenGeoJSON`, …) round out the toolkit.

## Installation

```bash
npm install @deck.gl-community/visgl-skills
# peer deps
npm install @deck.gl/core @deck.gl/layers
# optional – only needed for HeatmapLayer
npm install @deck.gl/aggregation-layers
```

## Quick Start

### Layer skills

```ts
import {
  createScatterplotLayer,
  createPathLayer,
  DeckBuilder,
  fitViewport,
  getBoundingBox
} from '@deck.gl-community/visgl-skills';
import {Deck} from '@deck.gl/core';
import {ScatterplotLayer, PathLayer} from '@deck.gl/layers';

const cities = [
  {name: 'San Francisco', coordinates: [-122.4, 37.8], population: 900_000},
  {name: 'Los Angeles', coordinates: [-118.2, 34.1], population: 4_000_000}
];

// 1. Build layer descriptors using skills
const scatterDescriptor = createScatterplotLayer({
  id: 'cities',
  data: cities,
  getPosition: (d) => d.coordinates,
  getRadius: (d) => d.population / 100,
  getFillColor: [255, 140, 0],
  radiusUnits: 'meters',
  pickable: true
});

// 2. Auto-fit the viewport
const bbox = getBoundingBox(cities.map((d) => d.coordinates));
const viewState = fitViewport(bbox, {width: 800, height: 600, padding: 60});

// 3. Assemble with DeckBuilder
const config = new DeckBuilder().setViewState(viewState).addLayer(scatterDescriptor).build();

// 4. Instantiate the real deck.gl layers from the descriptors
const deck = new Deck({
  ...config,
  layers: [new ScatterplotLayer(scatterDescriptor.props)]
});
```

### Noodles 🍜

Noodles are JSON-serializable layer recipes that AI agents can generate as
pure data. Field accessors are encoded as dot-notation **path strings**
(`"coordinates"`, `"meta.size"`); the runtime resolves them via `hydrateNoodle`.

```ts
import {createNoodle, hydrateNoodle, validateNoodle} from '@deck.gl-community/visgl-skills';
import {ScatterplotLayer} from '@deck.gl/layers';

// An AI agent produces this noodle as plain JSON:
const noodle = createNoodle('ScatterplotLayer', {
  data: cities,
  position: 'coordinates', // reads d.coordinates
  radius: 'population', // reads d.population
  fillColor: [255, 0, 128], // static colour
  radiusUnits: 'meters',
  radiusScale: 0.001,
  pickable: true
});

// Validate before use
const {valid, errors} = validateNoodle(noodle);
if (!valid) throw new Error(errors.join('\n'));

// Hydrate into real props
const props = hydrateNoodle(noodle);
const layer = new ScatterplotLayer(props);
```

### Data skills

```ts
import {
  createColorAccessor,
  createRadiusAccessor,
  flattenGeoJSON
} from '@deck.gl-community/visgl-skills';

// Linear colour scale
const getColor = createColorAccessor({
  getValue: (d) => d.temperature,
  domainMin: -10,
  domainMax: 40,
  colorLow: [0, 0, 255],
  colorHigh: [255, 0, 0]
});

// Proportional radius
const getRadius = createRadiusAccessor({
  getValue: (d) => d.population,
  domainMin: 0,
  domainMax: 10_000_000,
  minPixels: 3,
  maxPixels: 40
});

// Flatten GeoJSON → plain objects for easy data binding
const flat = flattenGeoJSON(myFeatureCollection);
// flat[0] → { longitude, latitude, ...properties }
```

## API Reference

### Layer skills

| Function                       | deck.gl Layer                       |
| ------------------------------ | ----------------------------------- |
| `createScatterplotLayer(opts)` | `ScatterplotLayer`                  |
| `createPathLayer(opts)`        | `PathLayer`                         |
| `createPolygonLayer(opts)`     | `PolygonLayer`                      |
| `createTextLayer(opts)`        | `TextLayer`                         |
| `createIconLayer(opts)`        | `IconLayer`                         |
| `createHeatmapLayer(opts)`     | `HeatmapLayer` (aggregation-layers) |

All factories accept a typed options object and return `{ id, type, props }`.

### Noodle API

| Symbol                      | Description                                    |
| --------------------------- | ---------------------------------------------- |
| `createNoodle(kind, props)` | Create a typed noodle descriptor               |
| `hydrateNoodle(noodle)`     | Convert a noodle to deck.gl layer props        |
| `validateNoodle(noodle)`    | Validate a noodle; returns `{ valid, errors }` |

### Viewport skills

| Function                    | Description                                   |
| --------------------------- | --------------------------------------------- |
| `createViewState(opts?)`    | Create a view state with sensible defaults    |
| `getBoundingBox(positions)` | Compute `[minLng, minLat, maxLng, maxLat]`    |
| `fitViewport(bbox, opts)`   | Compute a view state that fits a bounding box |

### Data skills

| Function                       | Description                                         |
| ------------------------------ | --------------------------------------------------- |
| `createColorAccessor(opts)`    | Linear colour interpolation accessor                |
| `createRadiusAccessor(opts)`   | Proportional radius accessor                        |
| `flattenGeoJSON(collection)`   | Flatten GeoJSON FeatureCollection to plain objects  |
| `extractPositions(collection)` | Extract `[lng, lat]` pairs from a FeatureCollection |

### DeckBuilder

```ts
new DeckBuilder()
  .setId(id)
  .setContainer(elementOrId)
  .setViewState(viewState)
  .setController(controllerConfig)
  .setSize(width, height)
  .addLayer(layerDescriptor)
  .prependLayer(layerDescriptor)
  .removeLayer(id)
  .replaceLayer(layerDescriptor)
  .build() // → DeckConfig
  .getLayers() // → LayerDescriptor[]
  .getViewState(); // → ViewState
```

## License

MIT – see [LICENSE](../../LICENSE)
