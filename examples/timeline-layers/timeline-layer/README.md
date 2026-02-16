# Timeline Layer - Prototype

An interactive timeline visualization layer for deck.gl. This is a **working prototype** demonstrating core timeline functionality for video editing, animation sequencing, and temporal data visualization.

## Current Status

This prototype successfully demonstrates:

- Multi-track timeline rendering with clip visualization
- Interactive scrubber with drag support
- Zoom and pan controls for temporal navigation
- Clip and track selection with hover states
- Collision detection for overlapping clips (subtrack assignment)
- Multiple time formatting options
- Performance-optimized rendering with memoization

## Remaining Work

### 1. Critical Bugs to Fix

- **Scrubber Position After Window Resize**: When the window is resized and the user immediately drags the scrubber, the scrubber position jumps incorrectly. The coordinate system calculation needs investigation - likely related to how mouse coordinates are translated to timeline coordinates after dimension changes.

### 2. API Design & Internal Interactivity

**Critical Priority**: The current implementation exposes significant internal complexity to users. A production-ready timeline layer requires:

- **Simplified Props Interface**: Reduce the number of exposed props while maintaining flexibility
- **Internal State Management**: Move interaction state (panning, zooming, scrubber dragging) inside the layer
- **Hover State Management**: Currently hover states (hoveredClipId, hoveredTrackId) are managed externally. The layer should handle hover state internally and only expose necessary callbacks.
- **Callback Consolidation**: Streamline the event callback system (currently: onClipClick, onClipHover, onTrackClick, onTrackHover, onScrubberDrag, onViewportChange, onZoomChange)
- **Declarative Configuration**: Users should specify what they want, not how to achieve it
- **Default Behaviors**: Provide sensible defaults for common use cases (video editor vs. analytics timeline)

The goal: Users should be able to create a functional timeline with 5-10 props, not 30+.

### 3. Official Documentation

This layer needs comprehensive documentation matching the standards of other deck.gl layers:

- **API Reference**: Complete PropTypes documentation with descriptions, types, and defaults
- **Usage Guide**: Common patterns and best practices
- **Examples**: Multiple real-world use cases (video editing, analytics, scheduling)
- **Architecture Overview**: How the layer works internally (collision detection, sublayers, viewport management)
- **Migration Guide**: How to integrate into existing deck.gl projects

Reference: [deck.gl Layer Catalog](https://deck.gl/docs/api-reference/layers)

### 4. Testing & Validation

- Unit tests for collision detection and time calculations
- Integration tests for interaction behaviors
- Performance benchmarks with large datasets (1000+ clips)
- Cross-browser compatibility testing

### 5. Additional Features

- Clip resizing (drag edges to extend/trim)
- Multi-selection support
- Keyboard shortcuts (arrow keys, space for play/pause)
- Clip drag-and-drop between tracks
- Undo/redo support
- Timeline markers and regions
- Customizable track heights
- Nested timeline groups

## Running the Demo

```bash
yarn install
yarn start
```

Open [http://localhost:5173](http://localhost:5173)

## Architecture

```
timeline-layer.ts         # Main CompositeLayer implementation
timeline-types.ts         # TypeScript type definitions
timeline-utils.ts         # Time formatting and position calculations
timeline-collision.ts     # Subtrack assignment algorithm
timeline-hooks.ts         # React hooks for interaction state
demo-controls.tsx         # Demo control panel
app.tsx                   # Demo application
```

## Core Interactions Implemented

- **Mouse Wheel**: Zoom timeline in/out
- **Click + Drag**: Pan when zoomed (zoom level > 1.0)
- **Click Clip**: Select clip and show details
- **Click Track Background**: Deselect clip, select track
- **Click Empty Space**: Deselect both clip and track
- **Drag Scrubber**: Scrub through timeline
- **Hover**: Clips and tracks lighten on hover

## Contributing

This prototype demonstrates feasibility and core functionality. To make it production-ready:

1. Review the "Remaining Work" section above
2. Start with API simplification - gather feedback on ideal developer experience
3. Create comprehensive documentation following deck.gl standards
4. Add tests and validate performance at scale

---

**Note**: This is experimental code intended for evaluation and feedback. Not recommended for production use without addressing the items in "Remaining Work".
