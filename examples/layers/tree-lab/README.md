# TreeLayer

Tree Lab has one pickable, 10,000-tree mixed-species authored core: exactly 1,250 pine, oak, palm,
birch, cherry, banyan, mangrove and citrus trees. It is surrounded by 6,600 deterministic
continuation trees: 4,800 form a dense, warped apron that overlaps the authored boundary, and the
remaining owners taper outward through clustered middle distance and a scattered horizon. This
keeps the cinematic tour from revealing a hard forest edge. Palms and mangroves disperse through
the core habitat; oak, cherry and citrus form soft interior clusters and density pockets.
Positions, dimensions and one of two shared morphology profiles are deterministic, so the scene
stays natural without allocating a unique TreeLayer template per tree. It has no species filter,
labels, wind, or shadows. Only the reserved hero citrus has explicit attached fruit; every
continuation owner is crop-free, so the shared device-adaptive canopy budget stays focused on
visible crowns. Hover any tree to identify its owning species.

Use **Season** to update the whole forest and **Crown profile**, **Crown spread**, and **Leaf
density** to adjust shared procedural characteristics without creating a unique template per tree.
**Hero citrus** frames the reserved dense-crowned, fruit-bearing citrus close enough to request
and prioritize its finest splat source within the shared device budget, while leaving the horizon visible; **Whole forest** fits the
authored core inside its continuation forest. **Play hero tour** follows one time-addressable
10.8-second track: a 2.4-second high-pitch orbit leads into a 6.6-second pullback that stays at
85° for its first 5.2 seconds, settles almost flat only after it has travelled across detailed
crowns, and then uses a distinct 1.8-second final lift after the continuation forest has filled
the view. It is also available at `?tour=hero`; the button exposes the phase durations for recording automation through
`data-tour-duration-ms`, `data-tour-orbit-ms`, `data-tour-canopy-pullback-ms`, and
`data-tour-final-lift-ms`. Any pointer, wheel, or touch interaction cancels the tour. **Reset
camera** restores the selected camera framing.

The demo uses `MapView` with metre offsets rooted at `[0, 0, 0]`. Drag to pan, scroll or pinch to
zoom, and right-drag or Ctrl-drag to tilt and rotate. The smaller MapView near plane supports close
canopy inspection; it does not change SplatLayer's per-crown LOD allocation.

Run `yarn workspace @deck.gl-community/tree-lab-example start` from the repository root. The
website provides WebGL2/WebGPU device tabs for the same scene.
