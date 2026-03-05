# Timeline Layer Example

An interactive GPU-accelerated timeline built with `@deck.gl-community/timeline-layers` — a deck.gl `CompositeLayer` that replaces DOM-driven timelines and handles hundreds of thousands of datapoints without lag.

### Prototype

https://github.com/user-attachments/assets/95006924-913f-4025-a0ef-6d74b336ca67

### End Goal

<img width="2560" height="1531" alt="Timeline end goal" src="https://github.com/user-attachments/assets/d6b52261-4d03-487d-8bba-e01b9035be7a" />

## Features

- Multi-track timeline with clip visualization
- Collision detection for overlapping clips (automatic subtrack assignment)
- Interactive playhead scrubber with drag support
- Zoom (mouse wheel) and pan (click + drag when zoomed)
- Clip and track selection with hover highlighting
- Multiple time formatting options

## Usage

```bash
# Against installed packages
yarn start

# Against local source (dev)
yarn start-local
```

## API

```ts
import {TimelineLayer} from '@deck.gl-community/timeline-layers';

new TimelineLayer({
  data: tracks,           // TimelineTrack[]
  timelineStart: 0,       // start of full range (ms)
  timelineEnd: 60_000,    // end of full range (ms)
  currentTimeMs: 5_000,   // current playhead position
  onClipClick: ({clip, track}) => console.log('clicked', clip.label),
  onViewportChange: (startMs, endMs) => setViewport({startMs, endMs}),
  onZoomChange: (zoom) => setZoom(zoom)
});
```

See [`TimelineLayerProps`](../../src/layers/timeline-layer/timeline-types.ts) for the full API reference.

## Context

Originally prototyped in PR [#379](https://github.com/visgl/deck.gl-community/pull/379), refined in PR [#517](https://github.com/visgl/deck.gl-community/pull/517). Lives in `dev/timeline-layers` until promoted to `modules/` — tracked in [#38](https://github.com/visgl/deck.gl-community/issues/38).
