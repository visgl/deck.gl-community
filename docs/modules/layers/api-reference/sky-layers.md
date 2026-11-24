# Sky layers

`SkyLayer` renders an astronomical sky with one observer and timestamp. It composes the sun,
moon, stars, local atmosphere, and view-appropriate procedural clouds. The individual layers
are also available for applications that need to compose their own sky.

## Installation

```sh
npm install @deck.gl-community/layers @math.gl/earth
```

The sky entry point uses `@math.gl/earth` to compute celestial positions and load the star catalog.

## Usage

```ts
import {SkyLayer} from '@deck.gl-community/layers/sky-layers';

const sky = new SkyLayer({
  id: 'sky',
  timestamp: Date.UTC(2026, 9, 4, 21),
  sun: true,
  moon: true,
  stars: true,
  clouds: true,
  atmosphere: true
});
```

Place the sky before opaque scene layers. The sky uses the viewport's position as the observer
unless you supply `observer`. Advance `timestamp` to animate astronomical time and `time` in
seconds to animate cloud drift. On a globe, `SkyLayer` selects spherical clouds and uses the
application's space background. In a local geographic view it uses atmospheric scattering and
local clouds. The cloud layers model procedural formations.

| Export | Purpose |
| --- | --- |
| `SkyLayer` | Composite sky with one observer and astronomical clock |
| `AtmosphereLayer`, `CloudLayer` | Local atmospheric scattering and clouds |
| `GlobeCloudLayer` | Spherical cloud shell |
| `SunLayer`, `MoonLayer` | Sun and moon disks |
| `StarfieldLayer` | Stellar catalog rendered in observer coordinates |

Run `yarn --cwd examples/layers/sky-layers start` after building the workspace. Drag the UTC slider
to see changes in the sky and lighting.

The implementation originated in the [deck.gl proposals workspace](https://github.com/visgl/deck.gl/tree/66542993e7/modules/proposals/src/layers).

The [Globe Clouds example](../../../../examples/layers/globe-clouds) explores cloud motion, observer time, and celestial lighting on a globe.
