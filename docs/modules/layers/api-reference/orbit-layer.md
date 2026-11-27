---
title: OrbitLayer
---

# OrbitLayer

<p class="badges">
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="Experimental" />
</p>

`OrbitLayer` draws satellites from GP element sets (OMM JSON or TLE). It runs SGP4 in a worker, interpolates between samples in each frame, and draws the orbit and ground track of one selected satellite. It works on `GlobeView` and `MapView`.

```ts
import {OrbitLayer} from '@deck.gl-community/layers/space-layers';

new OrbitLayer({
  id: 'satellites',
  data: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json',
  currentTime: Date.now(),
  selectedNoradId: 25544,
  getColor: d => (d.orbitClass === 'LEO' ? [80, 200, 255] : [255, 170, 60])
});
```

## Requirements

`satellite.js` (^7.2.0) and `@loaders.gl/scientific` (5.0.1) are optional peer dependencies. Install them to use the `space-layers` subpath.

```bash
npm install satellite.js@^7.2.0 @loaders.gl/scientific@5.0.1
```

`satellite.js` 7 uses top-level await. Set the bundler output target to ES2022 or newer.

The propagation worker is an ES module worker (`{type: 'module'}`). The layer loads it from `new URL('./orbit-propagation-worker.js', import.meta.url)`. The package ships the worker built, with `satellite.js` bundled in. Your bundler must resolve this URL and serve the file as a module. Set `propagation: 'main-thread'` to run without a worker.

If `satellite.js` is missing, the import of the subpath fails at build or load time.

## Data

`data` accepts one of these values:

- A URL string. A string that starts with `http`, `/` or `.` is a URL.
- OMM JSON text. A string that starts with `[` or `{` (after leading white space) is OMM JSON.
- TLE text. Any other string is TLE text.
- An `OMMRow[]` array, from `OMMLoader`. Import the type with `import type {OMMRow} from '@loaders.gl/scientific/omm'`.

`data` is not a deck.gl async data prop. The layer loads URLs itself. It uses the `fetch` prop, and the `OMMLoader` and `TLELoader` loaders from the `loaders` prop. Thus `dataTransform`, `onDataProgress` and a Promise as `data` do not apply.

When `data` changes, the layer discards the old satellites and loads the new data. Replies for old data are dropped.

Some satellites do not pass SGP4 initialization. The layer leaves these out and counts them in `onDataLoad`. A satellite that fails later (for example, after decay) is hidden for that sample. It keeps its index, so picking stays stable.

## Time

The layer does not animate by itself. Set `currentTime` (Unix ms) on each frame, as with `TripsLayer`.

The layer estimates the clock rate of your app from the last `currentTime` values. It samples ahead of the current time and interpolates toward that sample. A paused clock requests no new samples. A time jump (time goes backward, or a large change that does not match the estimated rate) requests a new sample at once. The layer does not interpolate across a jump.

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `data` | `string \| OMMRow[]` | `[]` | GP element sets. See [Data](#data). |
| `currentTime` | `number \| null` | `null` | Simulated time in Unix ms. When `null`, the layer uses its creation time. |
| `propagation` | `'worker' \| 'main-thread'` | `'worker'` | Where SGP4 runs. Use `'main-thread'` for small groups and tests. |
| `propagationRate` | `number` | `5` | Samples per second of wall time. The layer interpolates between samples. Minimum `0.01`. |
| `selectedNoradId` | `number \| null` | `null` | Draws the orbit and ground track of this satellite. |
| `showOrbit` | `boolean` | `true` | Draws the orbit of the selected satellite. |
| `showGroundTrack` | `boolean` | `true` | Draws the ground track of the selected satellite. |
| `getColor` | `Accessor<OrbitSatellite, Color>` | by orbit class | See [Accessors](#accessors). |
| `getRadius` | `Accessor<OrbitSatellite, number>` | `1.5` above 2000 satellites, else `3` | Radius in pixels. See [Accessors](#accessors). |
| `radiusMinPixels` | `number` | `0` | Minimum radius in pixels. |
| `radiusMaxPixels` | `number` | `Number.MAX_SAFE_INTEGER` | Maximum radius in pixels. |
| `orbitColor` | `Color` | `[255, 255, 255, 220]` | Color of the orbit path. |
| `groundTrackColor` | `Color` | `[255, 230, 120, 200]` | Color of the ground track. |
| `orbitWidthMinPixels` | `number` | `1.5` | Minimum width of the orbit and ground track paths, in pixels. |

The default `getColor` uses these colors: LEO `[80, 200, 255, 230]`, MEO `[120, 230, 120, 230]`, GEO `[255, 170, 60, 230]`, HEO `[240, 100, 220, 230]`.

The layer also accepts the standard `CompositeLayer` props, such as `id`, `pickable`, `fetch` and `loaders`. The `fetch` and `loaders` props apply to URL loading. The default of `loaders` is `[OMMLoader, TLELoader]`.

### Accessors

`getColor` and `getRadius` run once per data load. They get the static fields only: `name`, `noradId`, `epochMs`, `orbitClass` and `periodMinutes`. In accessors, `position` is `null` and `speedKmS` is `NaN`. Positions go to the GPU as binary attributes. Color by position is not supported.

Use `updateTriggers` to run an accessor again.

## Callbacks

| Callback | Description |
| --- | --- |
| `onDataLoad({satellites, rejected})` | Called after parsing and SGP4 initialization. `satellites` is the count of satellites drawn. `rejected` is the count of element sets that SGP4 rejected. |
| `onSelectedPositionChange(position, satellite)` | Called after each interpolation while the selected satellite has a position. `position` is `[lng, lat, altitude m]`. Use it for "follow". |
| `onError(error)` | Called for parse, network and propagation errors. |

The layer does not control the camera. To follow a satellite, move the camera in `onSelectedPositionChange`.

## Selection

For the selected satellite, the layer draws:

- A ring around the satellite.
- The orbit, for one period.
- The ground track, for one period back and forward.

The layer cuts paths at the antimeridian. Thus it works on `GlobeView` and `MapView`. On `MapView`, paths near the poles are clipped to the Web Mercator latitude range. The layer computes the paths again once per simulated orbit period.

## Picking

Set `pickable: true`. A pick returns an `OrbitSatellite` as `info.object`.

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Satellite name. |
| `noradId` | `number` | NORAD catalog number. |
| `epochMs` | `number` | Element set epoch in Unix ms. |
| `orbitClass` | `'LEO' \| 'MEO' \| 'GEO' \| 'HEO'` | Orbit class. |
| `periodMinutes` | `number` | Orbital period in minutes. |
| `position` | `[number, number, number] \| null` | `[lng, lat, altitude m]` at `currentTime`. `null` when SGP4 fails. |
| `speedKmS` | `number` | Speed in km/s at `currentTime`. `NaN` when unknown. |

## CelesTrak usage policy

CelesTrak updates GP data about every 2 hours. It blocks repeated downloads. Download each group at most once per update, and cache the data in your app. Pass the cached text or rows as `data`.

```ts
const CACHE_MS = 2 * 60 * 60 * 1000;

async function loadGroup(group: string): Promise<string> {
  const key = `gp-${group}`;
  const cached = JSON.parse(localStorage.getItem(key) ?? 'null');
  if (cached && Date.now() - cached.time < CACHE_MS) {
    return cached.text;
  }
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`;
  const text = await (await fetch(url)).text();
  localStorage.setItem(key, JSON.stringify({time: Date.now(), text}));
  return text;
}

async function createLayer(currentTime: number): Promise<OrbitLayer> {
  const data = await loadGroup('active');
  return new OrbitLayer({id: 'satellites', data, currentTime});
}
```

## Limits

- The layer uses SGP4 from `satellite.js`. It does not use high-precision ephemerides.
- Accessors run on static fields only.
- The layer does not control the camera.
- The layer does not cache or rate-limit downloads.
