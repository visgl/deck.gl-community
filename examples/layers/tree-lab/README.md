# TreeLayer

Tree Lab renders a 10,000-tree mixed-species core, 1,250 of each TreeLayer species, inside 6,600
continuation trees that taper out to the horizon. Two shared morphology profiles and
deterministic dimensions keep the forest varied without a unique template per tree. Only the hero
citrus carries fruit. Hover a tree to identify its species.

The **TreeLayer** panel controls the layer directly:

- **Camera**: **Hero citrus** frames the fruiting citrus up close, **Whole forest** fits the
  core, **Play hero tour** runs a 10.8-second orbit and pullback (also available at
  `?tour=hero`), and **Reset camera** restores the selected framing. Any pointer, wheel or touch
  interaction cancels the tour.
- **Trees**: season, crown profile, crown spread, leaf size, leaf density and wind.
- **Rendering**: the shared splat budget (`maxCanopySplats`), canopy pixel cap
  (`maxCanopyPixels`) and foveation strength.

The tour button exposes its phase durations for recording automation through
`data-tour-duration-ms`, `data-tour-orbit-ms`, `data-tour-canopy-pullback-ms` and
`data-tour-final-lift-ms`.

The demo uses `MapView` with metre offsets rooted at `[0, 0, 0]`. Drag to pan, scroll or pinch to
zoom, and right-drag or Ctrl-drag to tilt and rotate.

Run `yarn workspace @deck.gl-community/tree-lab-example start` from the repository root. The
website provides WebGL2/WebGPU device tabs for the same scene.
