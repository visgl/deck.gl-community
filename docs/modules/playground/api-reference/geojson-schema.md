# GeoJSON Schema

The private playground workspace includes RFC 7946 GeoJSON schemas for positions, bounding boxes,
all standard geometry types, features, and feature collections.

The generated JSON Schema is available at the package sub-export:

```ts
import geojsonSchema from '@deck.gl-community/playground/geojson-schema.json';
```

Use the JSON Schema value as `PlaygroundProps.jsonSchema` to enable Monaco diagnostics and
completion. The package is private, so the generated artifact is intended to be copied or served
by the consuming application rather than loaded from a public package CDN.
