# Satellite orbits on GlobeView

This example shows satellites from CelesTrak general perturbations (GP) data on a deck.gl
`GlobeView`, at their altitude. It uses `OrbitLayer` from
`@deck.gl-community/layers/space-layers`. See the
[OrbitLayer documentation](../../../docs/modules/layers/api-reference/orbit-layer.md).

- The app gives the layer the loaded text (OMM JSON or TLE) or the fixture rows as `data`, and
  the simulated time as `currentTime` on each frame.
- The layer parses the data, runs SGP4 in a Web Worker at 5 Hz and interpolates the positions
  in each frame. Colors show the orbit class: LEO (apogee below 2,000 km), MEO, GEO (period
  within 2 % of one sidereal day) and HEO (eccentricity above 0.25).
- Click a satellite to select it (`selectedNoradId`). The layer draws its orbit for one period
  at altitude, and its ground track (z = 0) from one period before to one period after the
  current time. "Follow" uses `onSelectedPositionChange`.
- The app keeps the panel, the CelesTrak cache, the Earth and land backdrop, the clock and the
  camera. The GEO button selects the first GEO satellite of the loaded data, and it is disabled when there is none.

## Run

```sh
yarn
yarn workspace satellite-orbits-example start
```

URL parameters:

| Parameter | Effect |
| --- | --- |
| `group=stations` | Load a live CelesTrak group (`stations`, `gps-ops`, `galileo`, `geo`, `active`, ...). The default is `fixture`. |
| `format=tle` | Load TLE text instead of OMM JSON. |
| `speed=60` | Simulated seconds per second. |
| `select=25544` | Select a satellite by NORAD catalog number. |
| `follow` | Keep the camera on the selected satellite. |
| `longitude`, `latitude`, `zoom` | Initial view. |
| `farZMultiplier=1` | `GlobeView` far plane. The example uses 8; 1 is the deck.gl default. |
| `cullPaths` | Keep the `GlobeView` back-face culling on the orbit path. |
| `tracks=0` | Do not draw the orbit and the ground track. |
| `cameraRelative` | Pass `_cameraRelative: true` to `GlobeView` (needs deck.gl PR #11283). |
| `measure` | Put a measurement handle on `window.satelliteOrbits`: `deck`, `stats` (`count`, `rejected`) and `setPlaying`. |

## Data and licenses

- `data/gp-fixture.omm.json` (93 KB) has 224 element sets from CelesTrak, downloaded on
  2026-11-24: the `stations`, `gps-ops` and `galileo` groups, 48 GEO, 16 HEO and 80 LEO
  satellites from the `geo` and `active` groups. `data/stations.tle` is the `stations` group as
  TLE text. The fixture runs at its median epoch, so it stays accurate
  offline.
- CelesTrak: the data is free to use. CelesTrak does not state a license, a redistribution rule
  or an attribution rule. The [usage policy](https://celestrak.org/usage-policy.php) asks
  clients to download a group only once per update (CelesTrak updates GP data every 2 hours),
  and to stop after any non-200 response. CelesTrak blocks clients that do not obey. The
  example keeps live text in `localStorage` for 2 hours. The `active` group (7 MB of OMM
  JSON) is too large for `localStorage`. CelesTrak sends `Access-Control-Allow-Origin: *`.
- CelesTrak TLE text does not include objects with a catalog number above 99999. OMM JSON
  includes them (`stations` has 16 objects in OMM JSON and 13 in TLE).
- [`satellite.js`](https://github.com/shashwatak/satellite-js) 7.2.0 is MIT. `OrbitLayer`
  uses it. The package entry also exports WASM builds that use top-level await. Thus
  `vite.config.ts` sets the ES2022 target and an ES module worker.

## Measurements

These numbers come from the prototype of this example, before the code moved into `OrbitLayer`. The handle no longer has `getPosition`, and `stats` no longer has the worker timings.

Method: headless Chromium (Playwright 1.62, `--use-angle=metal`), Apple M1 Max, 1400 x 900
viewport, device pixel ratio 1. The `active` group was downloaded once (16,905 element sets)
and served to the page from a local file. The scripts read `window.satelliteOrbits`.

### Frame time and worker time

The frame time is the main-thread task time per frame, from the Chrome DevTools Protocol
`Performance.getMetrics` (`TaskDuration`) over 5 s, at 60x speed. The worker time is the mean
time of one propagation of all satellites (SGP4, TEME to Earth-fixed to geodetic).

| Satellites | Worker init (satrecs) | Worker propagation | Main thread per frame | deck CPU per frame | Frame rate |
| --- | --- | --- | --- | --- | --- |
| 224 (fixture) | < 1 ms | 0.3 ms | - | - | 120 fps |
| 10,000 | 57 ms | 11.0 ms | 1.7 ms | 1.2 ms | 120 fps |
| 16,905 | 78 ms | 16.3 to 18.0 ms | 1.9 ms | 1.5 ms | 120 fps |

At 5 Hz the worker is busy 6 % (10,000) to 9 % (16,905) of the time. The main thread
interpolates 10,000 positions and uploads one `Float64Array` attribute in each frame.

### Precision on GlobeView

Method: the camera follows the selected satellite (`follow`, with `viewState.position` set to
the satellite altitude). Thus the satellite must draw at the screen center. The script takes 40
screenshots of a 24 x 24 px window at the center. It computes the color-weighted centroid of the
satellite dot, and reports the RMS distance from the mean (jitter) and the largest change between
two screenshots. The satellites are Hubble (LEO, 535 km) and TDRS 3 (GEO, 35,786 km), at 60x
speed. The ISS is not used because its docked vehicles have their own element sets and draw
next to it at zoom 15 and more.

| Zoom | Viewport | LEO RMS / max jump (px) | GEO RMS / max jump (px) |
| --- | --- | --- | --- |
| 8 | GlobeViewport | 0.00 / 0.01 | 0.01 / 0.04 |
| 10 | GlobeViewport | 0.00 / 0.00 | 0.06 / 0.18 |
| 12 | GlobeViewport | 0.02 / 0.07 | 0.22 / 0.61 |
| 13, 15, 18 | WebMercatorViewport | 0.00 / 0.00 | 0.00 / 0.00 |

With deck.gl PR #11283 (`_cameraRelative: true`), `GlobeViewport` stays on above zoom 12:

| Zoom | LEO RMS / max jump (px) | GEO RMS / max jump (px) |
| --- | --- | --- |
| 12 | 0.00 / 0.00 | 0.07 / 0.30 |
| 13 | 0.00 / 0.01 | 0.12 / 0.38 |
| 15 | 0.01 / 0.01 | 0.59 / 2.10 |
| 18 | 0.04 / 0.11 | 3.80 / 10.74 |

## GlobeView problems found

1. The default far plane clips the far half of the GEO ring. The far plane is the camera
   altitude plus the globe diameter, but GEO satellites are 6.6 Earth radii from the center.
   At zoom -0.6, 908 of 16,899 satellites on the screen are beyond the far plane with
   `farZMultiplier: 1`, and 0 with `farZMultiplier: 8`. Picking follows the drawing: hover
   found 24 GEO satellites with 1 and 49 with 8.
2. `GlobeView` sets `cullMode: 'back'`. A `PathLayer` orbit in space loses its far half,
   because the ribbon triangles face away from the camera there. The example sets
   `parameters: {cullMode: 'none'}` on the orbit layer.
3. A single world polygon in a `SolidPolygonLayer` draws as a flat octagon in 10.0.0-alpha.2
   (`resolution: 10` on `GlobeView` has no effect). It does not hide the satellites behind the
   Earth. The example draws the Earth as 5 degree cells.
4. `radiusUnits: 'pixels'` is exact only at the focal plane. A 6 px GEO dot draws 7.3 px wide
   near the camera and 4.2 px wide at the far side of the ring.
5. `_cameraRelative` (PR #11283) removes the LEO error at all zoom levels, but GEO still moves
   by up to 10.7 px between frames at zoom 18. A possible cause: the origin is at altitude 0,
   so the vector from the origin to a GEO satellite is 35,786 km long in float32.
6. `GlobeViewState` has no `pitch` and `bearing` in its type, but `GlobeViewport` uses them.
