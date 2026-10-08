# Coit RAD scene

The Coit example uses the public Composite `SplatLayer` from `@deck.gl-community/layers`, a deck
FirstPersonView and the authored Coit affine pose. Its native 50,937,127-row RAD hierarchy is
streamed by HTTP ranges; it is never converted into a procedural template or downloaded in full.
The Gaussian scene and optional LineLayer axes share one host canvas/device/pass. Coit depends
only on the shared SplatLayer runtime; no TreeLayer PR or tree inventory API is required.

From the repository root run `yarn`, `yarn build`, then
`yarn workspace @deck.gl-community/coit-example start`. Open the printed URL. WebGPU is required.
No private deck/luma/loaders source aliases are used. The root luma compatibility patch provides
the pending upstream 9.4 host-pass API; see the public SplatLayer installation guide before
publishing or consuming a built package outside this repository.

Drag to look, shift-drag to pan and scroll to dolly. Reset returns to the authored camera.
`?diagnostic` exposes an eight-second camera exercise and source loading milestones. The diagnostic option is read on each mount, including website navigation back to Coit.
Rows, resident/pending pages and source metadata are read from the runtime, not synthetic values.
The default active budget is one million rows with four million resident source rows plus bounded
active transition headroom. First coverage is distinct from settled refinement and smooth motion;
software-GPU screenshots do not establish hardware frame-time or million-row performance parity.

The Coit dataset is hosted by its original source at the Google Cloud Storage URL in `app.tsx`.
This migration preserves the camera and source from deck.gl PR #10627 while removing the private
experimental layer and source-root development dependencies.
