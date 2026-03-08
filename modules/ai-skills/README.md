# @deck.gl-community/ai-skills

AI agent helpers for building deck.gl visualizations. Supports two complementary patterns:

**Pattern A — Native TypeScript** (recommended for LLM code generation)
Typed factory functions that return correct props with sensible defaults, backed by full TypeScript types. LLMs write native code; `llms.txt` provides the reference.

**Pattern B — JSON descriptors** (for serializable configs and low-code UIs)
Fully JSON-serializable layer descriptors with dot-path accessors, pre-flight validation, and a hydration step that converts them to runtime functions. Safe to store, transmit, or emit from an LLM to a server.

## Installation

```bash
npm install @deck.gl-community/ai-skills
# peer deps
npm install @deck.gl/core @deck.gl/layers
```

## Quick start

See [`llms.txt`](./llms.txt) for the complete agent-facing reference with worked examples for both patterns.

### Pattern A — factory functions

```ts
import {ScatterplotLayer} from '@deck.gl/layers';
import {scatterplotLayer, fitViewport} from '@deck.gl-community/ai-skills';

const layer = new ScatterplotLayer(
  scatterplotLayer({
    data: cities,
    getPosition: (d) => d.coordinates,
    getRadius: (d) => d.population,
    getFillColor: [255, 140, 0],
    radiusScale: 0.00003
  })
);
const viewState = fitViewport(cities.map((c) => c.coordinates));
```

### Pattern B — JSON descriptors

```ts
import {
  createDescriptor,
  validateDescriptor,
  hydrateDescriptor
} from '@deck.gl-community/ai-skills';
import {ScatterplotLayer} from '@deck.gl/layers';

const desc = createDescriptor('ScatterplotLayer', {
  data: cities,
  getPosition: 'coordinates', // dot-path string, resolved at hydration
  getFillColor: [255, 140, 0]
});
const {valid, errors} = validateDescriptor(desc);
const layer = new ScatterplotLayer(hydrateDescriptor(desc));
```

## API

| Export                                     | Description                                                      |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `scatterplotLayer(options)`                | Factory for ScatterplotLayer props                               |
| `pathLayer(options)`                       | Factory for PathLayer props                                      |
| `polygonLayer(options)`                    | Factory for PolygonLayer props                                   |
| `textLayer(options)`                       | Factory for TextLayer props                                      |
| `arcLayer(options)`                        | Factory for ArcLayer props                                       |
| `heatmapLayer(options)`                    | Factory for HeatmapLayer props                                   |
| `createDescriptor(type, props, id?)`       | Build a JSON-serializable layer descriptor                       |
| `validateDescriptor(desc)`                 | Pre-flight validation returning `{valid, errors}`                |
| `hydrateDescriptor(desc)`                  | Resolve dot-path accessors to runtime functions                  |
| `DeckBuilder`                              | Fluent builder composing layers + view state into a `DeckConfig` |
| `fitViewport(positions, w?, h?, padding?)` | Fit Web Mercator viewport to a set of coordinates                |
| `getBoundingBox(positions)`                | Get `[minLng, minLat, maxLng, maxLat]`                           |
| `createViewState(lng, lat, zoom, opts?)`   | Convenience view state constructor                               |

## For AI agents

This module ships `llms.txt` at its package root — a single clean reference file covering both patterns, all layer types, and a decision guide. Point your agent at it:

```
https://unpkg.com/@deck.gl-community/ai-skills/llms.txt
```

Or read it locally after install:

```
node_modules/@deck.gl-community/ai-skills/llms.txt
```

## License

MIT © vis.gl contributors
