# Timeline Layer Example

An interactive timeline visualization built with `@deck.gl-community/timeline-layers`.

## Features

- Multi-track timeline with clip visualization
- Collision detection for overlapping clips (automatic subtrack assignment)
- Interactive playhead scrubber with drag support
- Zoom (mouse wheel) and pan (click + drag when zoomed)
- Clip and track selection with hover highlighting
- Multiple time formatting options

## Usage

```bash
yarn start
```

Open [http://localhost:5173](http://localhost:5173)

## API

Import `TimelineLayer` from `@deck.gl-community/timeline-layers`:

```ts
import {TimelineLayer} from '@deck.gl-community/timeline-layers';

const layer = new TimelineLayer({
  data: tracks,          // TimelineTrack[]
  timelineStart: 0,      // start of full range (ms)
  timelineEnd: 60000,    // end of full range (ms)
  currentTimeMs: 5000,   // current playhead position
  onClipClick: ({clip, track}) => console.log('clicked', clip.label)
});
```

See `TimelineLayerProps` for the full API reference.
