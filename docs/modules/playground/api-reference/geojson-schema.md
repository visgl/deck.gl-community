# GeoJSON Schema

The private playground workspace includes RFC 7946 GeoJSON schemas for positions, bounding boxes,
all standard geometry types, features, and feature collections.

The generated JSON Schema is available at the package sub-export:

```ts
import geojsonSchema from '@deck.gl-community/playground/geojson-schema.json';
import geojsonSchemaCdnUrl from '@deck.gl-community/playground/geojson-schema.cdn';
```

Use the JSON Schema value as `PlaygroundProps.jsonSchema` to enable Monaco diagnostics and
completion. The CDN URL helper points at the versioned generated artifact for deployments that
load schemas remotely.
