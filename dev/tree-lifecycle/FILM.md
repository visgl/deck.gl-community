# Thirty Years: film contract

`STORY.md` says what the film is. This file says how it is built, so several people can work on it at
once. `story/story-types.ts` is the shared data contract. If you must change either, change both in
the same edit and say so in your report.

All paths are relative to `dev/tree-lifecycle/`.

## Principles

- **A pure function of time, mod the cycle.** `getStoryState(t, {aspect, world})` is pure: no clocks,
  no `Math.random`, no module state that changes a result. Any frame can be rendered at any time, and
  the same `t` mod `CYCLE_SECONDS` (64) gives the same picture. Nothing clamps a time anywhere.
- **`TreeLayer` is plain deck.gl.** Trees get `data`, `getTree`, `updateTriggers`, `windStrength`,
  `windDirection`, `windTime`, `windGustTime` and a standard `LightingEffect`, nothing internal.
- **Everything is metres, Cartesian, z up**, at the same spot in the same field. `OrbitView` with
  `COORDINATE_SYSTEM.CARTESIAN`.
- **One camera, no cuts.** Macro to wide in one take, and round again: the file is one cycle that
  loops on itself.

## The cycle

The film is one cycle of 64 s, 1,920 frames at 30 fps, and `story/beats.ts` keeps its clocks:

- **Cycle seconds**, `getCycleSeconds(t)`: any time mod 64, from 0 up to 64. This is `state.t`, what
  the stage, the scrubber, the URL and every tool count in. -0.1 is cycle second 63.9, and 125.3 is
  61.3.
- **The swap** is at cycle second 0. There the Year 30 grove, the end world, becomes the Day 0 field,
  the start world, hidden inside the falling orange's rind, which covers every pixel from seam -0.35
  to +0.25 s (`LOOP.cover`).
- **Seam seconds**, `getSeamSeconds(t)`: signed seconds from the swap, from -32 to 32, continuous
  through it. Only what must run through the swap is keyed on them: the time rate, the fall, the
  camera relative to the fruit and the timeline's roll-over. Everything else is an ordinary track of
  cycle seconds, flat and equal at both ends.
- **The scene clock**, `getSceneSeconds(t)`, as `state.cycle.clock` and `state.wind.time`: what
  everything that moves runs on. It runs at `getTimeRate(t)`, 1, or down to 0.12 in the slow motion
  around the swap (`TIME_RATE_KEYS`), and starts again at the swap. `wind.gustTime` is the clock the
  storm locks `TreeLayer`'s gust fronts to. It is exactly the scene clock before 32.6 and from 56 on,
  so a frame there is the same with `windGustTime` as without it. The lock puts about 30 gust seconds
  on it, more than a clock that never ran back could lose before the finale, so over 46.4-56
  (`GUST_LOCK.unwind`) it runs back at about 2.7 times the scene clock, in a breeze too light for any
  front to show: under `TreeLayer`'s strong-wind start, with no cat's-paws, grass fronts, rain or
  spray. It never runs back while there is wind to show it.
- **The world** a frame is composed from is its own side of the swap, `getWorld(t)`, unless
  `options.world` asks for the other inside `LOOP.cover`, as the seam check does. Tracks of cycle
  seconds are then read at that side's flat end of the cycle, `getContentSeconds(t, world)`.
- **The file** starts at `LOOP.fileStart`, cycle second 61.3, 2.7 s before the swap, and runs 1,920
  frames to 61.267. Its own wrap, 61.267 to 61.3, is one ordinary step of story time.

`state.cycle` carries all of it for a frame: `seconds`, `seam`, `world`, `rate`, `clock`, `fall` and
`cover`.

## Photographic pipeline: accumulation

The look comes from rendering each output frame many times and averaging, as a film renderer does. It
needs nothing from deck.gl internals, and gives true depth of field, motion blur, antialiasing and soft
sun shadows, all at once. `renderAt(t, {samples})` draws `samples` sub-frames, and for each one jitters:

- **Time**, across the shutter: `t + (u - 0.5) * shutter * rate / fps`, with a 180-degree shutter by default, so
  motion blur covers the wind, the falling things and the camera. `rate` is the time rate, `getTimeRate(t)`, as
  `getFrameShutter` in `stage/stage-query.ts` has it: slow motion is exposed as high-speed footage is, so at a rate of
  0.12 the shutter is open 0.06 of a frame, and the fall, the dew and the landing are crisp where the camera, moving
  at story speed through them, would smear the rind. At full speed it is the shutter given, and the rate is flat and
  equal across the swap, so the two sides still match.
- **Lens**, for depth of field: orbit the camera a little around the focus point on a disc of
  `aperture` radius, so everything there stays still and everything else blurs by the right amount. The
  camera is an eye, a direction and a target in the middle of what it shows. The focus point is on the same
  line of sight, on the near side of a closed orange or the hero's crown when the target is inside it, by
  `getFocusPull` in `stage/accumulator.ts`: a lens is focused on what can be seen, not on what is behind it.
- **Sub-pixel**, for antialiasing: a small shift of the whole image plane, by a view's `padding`, within a tent
  filter a pixel wide either side. It moves everything alike, near or far.
- **Sun**, for a soft penumbra: the sun direction moves on a small disc (real sun: 0.27 degrees of radius.
  Exaggerate up to about 1.2 degrees for softer shadows on leaves), and the shadow map changes with it,
  so dapples soften and blocky texels average away.

The sequence is an R2 set, by sample index and never by frame, so noise doesn't crawl. Time is stratified and only
rises across a frame, as `TreeLayer`'s rates need. `stage/accumulator.ts` works in deck's own context: deck draws
each sub-frame into an RGBA16F target, which is added to an RGBA32F sum in scene-linear light. A second context cost
the same in measurement, so that is the one that keeps more than 8 bits of what a sub-frame shaded. Scene-linear means
past gamma and the filmic curve the shaders end on, so a highlight outweighs what is next to it as it would on film,
and exposure rolls off as a stop does. Then, on the canvas, and with the 2D overlay on top:

1. Average the samples.
2. Bloom from bright pixels, wide and subtle.
3. Exposure, warmth, vignette, saturation and fade in scene light, then the filmic curve again and a slight S.
4. Fine film grain in display values, seeded by the frame, and a dither under half a step of 8 bits.
5. Overlay canvas: timeline and captions, sharp, unaffected by the above.

`window.renderAt(t, {samples, shutter, apertureScale})` draws such a frame and resolves once the GPU has finished
it. It also takes `adaptive`, `fps`, `softnessScale`, `pixelScale`, `grade`, `preroll` and `world`, the side of the
swap for this frame alone. `t`, the frame before a jump, `t - 1/60`, and every sub-frame's time are taken mod the
cycle: the frame at 0 has its rates from 63.983, opens its shutter at 63.999, and follows on from 63.967 as any frame
follows the one before it. `samples: 1` skips jitter and goes through the canvas, with its MSAA, for the interactive
preview, and comes within a few milliseconds of real time. Export uses 8 to 32 as the least, and `adaptive` raises
that as far as 4 times where a wide lens would otherwise show its points as ghosts of what is out of focus, as it does
in the macro beats. The opening's are cheap to draw. The finale's and the drop's are not: their 16 to 32 sub-frames
each draw the hero's full crown and the grove behind the fruit, and they are the largest cost of an export (see
[the cost of an export](#the-cost-of-an-export)).
A page for many samples is best opened with `?msaa=0`. An identity grade gives back deck's canvas, exactly. A layer
should write finite values: a float target does not turn NaN into 0, or clamp above 1, until the sum, as the canvas
does at once.

## Layout

| Path | Owner | Contents |
| --- | --- | --- |
| `story/story-types.ts` | contract | `StoryState` and its parts |
| `story/beats.ts` | contract | The cycle: beat table, year curve, `LOOP`, `TIME_RATE_KEYS`, `HURRICANE`, cycle, seam and scene clocks, hero growth curve |
| `story/story.ts` | story | `getStoryState(t, options)`, composes the rest |
| `story/grove.ts` | story | Grove plan: rows, seeds, the storm's falls and leaners, dieback, replacements, splashes. Deterministic |
| `story/environment.ts` | story | Sun, moon, sky, weather, wind and its gust clock, grade by time |
| `story/camera.ts` | story | The one take: key poses, the fruit-relative keys around the swap, log-space distance, portrait variant, shake |
| `story/props.ts` | story | The hanging and falling orange, the opening's props and the hero's planting and net, by second |
| `story/yield.ts` | story | Illustrative yields, timeline scale, ticks, bars, flags, readouts, captions, the roll-over |
| `story/land.ts` | ground | The bedded field: beds, furrows and the culvert, as `getLandHeight` and `LAND_GLSL` from one table |
| `story/flood.ts` | ground | The flood's level, mark, calm, foam and drift, silt, and days under water |
| `layers/sky-layer.ts` | sky | Full-screen sky: gradient, sun, moon, stars, clouds, storm, and the probe of it the water mirrors |
| `layers/ground-layer.ts` | ground | Polar mesh, hole, berm, wetness, soil and row detail, reads shadows |
| `layers/grass-layer.ts` | ground | Instanced mowed grass and weeds near the camera |
| `layers/weather-layer.ts` | weather | Rain and its curtains, spray and crown plumes, motes, petals, sparkles, debris, light shafts, floating litter and the flood's splashes |
| `layers/orange-layer.ts` | props | Whole orange, halves, cut face, juice beads |
| `layers/seed-layer.ts` | props | The seed and its trail |
| `layers/pot-layer.ts` | props | Terracotta pot, potting soil, mound, grains, root ball, microjet |
| `layers/net-layer.ts` | props | The net bag: descent, drape, cinch, strain, slit, lift-off |
| `layers/prop-shading.ts` | props | Lighting and tone curve for props, reading the same `lighting` uniforms and matching `TreeLayer` |
| `layers/field-shading.ts` | ground | Shadow lookup and fog shared by custom layers |
| `stage/stage.ts`, `stage.html` | stage | Deck, lights, layer assembly, `renderAt`, the clock round the cycle, the seam check's `checkCover`, `keepStage` and `compareStage`, `StageHost` |
| `stage/stage-query.ts` | stage | The URL parameters, frame times and loop checks the stage, its debug tools and the Node tools all use, as values |
| `stage/debug-panel.ts` | stage | The debug tools and the keys, from deck.gl widgets and `@deck.gl-community` panels, with the seam strip and the gust plot. Never under `capture` |
| `stage/debug-settings.ts` | stage | Their settings, URL parameters and overrides, as pure functions |
| `tsconfig.json` | stage | `yarn tsc --noEmit -p dev/tree-lifecycle/tsconfig.json` checks stage, story and layers |
| `stage/accumulator.ts` | stage | Sub-frame accumulation and finishing |
| `stage/timeline-overlay.ts` | stage | Canvas 2D timeline and captions, laid out by pure functions, and the roll-over at the swap |
| `export.mjs` | stage | Frames to a verified, upload-sized MP4 (two-pass H.264, 5 Mbps by default), resumable; one cycle with `--cycle`; `--check-seam` and `--check-loop` |
| `capture.mjs` | stage | Stills of the lab or the stage at any second; `loadStoryClock` for the other tools |
| `story-sheet.mjs` | stage | A contact sheet of chosen or evenly spaced times, or the acceptance stills, for reviewers |
| `qa-shots.mjs` | stage | The standard `TreeLayer` views in the lab, and in the film by cycle second |
| `test/*.spec.ts` | each | Node tests of pure logic. `test/loop.spec.ts` holds the loop's invariants |

Each layer file exports a factory, for example `createSkyLayer(state: StoryState): Layer | Layer[] | null`,
which returns `null` when it has nothing to draw. `stage.ts` assembles them in draw order: sky, ground, grass,
trees, orange, seed, pot, net, weather. Factories are called each sub-frame, so they keep data identity where
possible and put what changes into uniforms. Nothing may be drawn behind the stage's back: it stops Deck's
animation loop and draws each frame itself, so a layer cannot rely on `setNeedsRedraw` or on the timeline.

## Testing a layer

Everything goes through `stage.html`, which takes `only`, a comma-separated list of the names in draw order. It
has `plain` too, a stand-in sand plane, which also stands in for `ground` while that factory returns `null`, and
`props`, for orange, seed and pot. What no layer covers shows a flat sky, the color of the horizon at that moment.

```
yarn node dev/tree-lifecycle/capture.mjs --page stage --query 'only=sky' --time 50 --out /scratch/sky.png
yarn node dev/tree-lifecycle/capture.mjs --page stage --query 'only=plain,pot,trees' --time 25 --out /scratch/pot.png
yarn node dev/tree-lifecycle/capture.mjs --page stage --query 'only=ground' --time 40 --aspect 9:16 --out /scratch/a.png
yarn node dev/tree-lifecycle/capture.mjs --page stage --query 'only=weather' --time 36 --pick 640,360 --out /scratch/b.png
yarn node dev/tree-lifecycle/capture.mjs --page stage --time -0.0167 --world start --aspect 9:16 --out /scratch/c.png
```

Any `--time` is taken mod the cycle, so seam seconds work as they are: `-0.0167` is cycle second 63.983. `--world`
composes a second inside the rind from that side of the swap. Many shots in one browser take `--batch shots.json`, an
array of `{out, time, world, aspect, query, width, height, dpr, pick, samples, measure}`, where shots in a row with the
same size and query share a page. A run exits with code 1,
and says why, if the page reported an error or GL rejected something. That includes a shader that does not compile,
with the compiler's message and the line it refers to. `--pick x,y` makes every layer `pickable` and runs the
picking pass at that point, for the picking half of the definition of done below. In a browser,
`http://127.0.0.1:4393/stage.html?only=sky,ground&t=50` has the same layers and the [debug tools](#debug-tools):
Space plays, arrow keys step 1/30 s, with Shift 1 s, and up and down go from beat to beat. The time stays in the URL
for a reload, as the dev server has no hot reload.

Every frame is finished, so a layer is seen under the film's grade, with its fade and grain. `finish=0` in the query
shows what deck drew, and nothing else. The timeline and captions come with the whole film, and with `overlay=1` when
`only` is given. `--samples 16` with `capture.mjs` shows real depth of field, motion blur and soft shadows.

```
yarn node dev/tree-lifecycle/capture.mjs --page stage --query 'only=sky&finish=0' --time 50 --out /scratch/sky.png
yarn node dev/tree-lifecycle/capture.mjs --page stage --query 'msaa=0' --samples 16 --time 46 --out /scratch/c.png
yarn node dev/tree-lifecycle/story-sheet.mjs --count 24 --out /scratch/sheet.png
yarn node dev/tree-lifecycle/story-sheet.mjs --preset acceptance --samples 16 --out /scratch/acceptance.png
yarn node dev/tree-lifecycle/qa-shots.mjs --only film --out /scratch/qa
yarn node dev/tree-lifecycle/export.mjs --cycle 1 --width 1080 --height 1920 --samples 16 --out file.mp4
```

A sheet's default is the cycle in the file's order, from its first frame. `--preset acceptance` is the spec's
acceptance stills, at 9:16, with 0.1 from the end world beside 0.1 from the start. `--times` takes seam seconds and
`0.1:end` too.

## Debug tools

Without `capture`, `stage.html` loads `stage/debug-panel.ts`: deck.gl's widgets and this repository's
`@deck.gl-community/widgets` and `panels`, as built in their `dist`, over settings that `stage/debug-settings.ts` keeps
as pure functions. A change to the source of those two modules shows after a `yarn build` of the module, and a
half-made one does not stop the page loading. Under `capture=1` none of it loads, so a capture draws the same frame in
the same time whatever the panel's parameters in the URL say.

- **Timeline**, deck.gl's `TimelineWidget`, over the cycle from 0 to 64: play and pause, with a tick at each beat of
  `BEAT_TABLE`, the swap marked at both ends with the rind's cover either side of it, the file's first frame marked at
  61.3, and the A-B range over the track, in two pieces when it runs through the swap. A drag of its thumb scrubs, with
  frames at the moving level of detail and without their rates until the pointer comes up. A click on the track, Home,
  End, Page Up or Page Down on the focused timeline, and the wheel, a second a notch and round the cycle, seek. The
  stage's clock plays the film, and the widget shows it, with the seam second in its label near the swap.
- **Keys**: Space plays, arrow keys step 1/30 s, with Shift 1 s, and up and down go from beat to beat, all round the
  cycle: back a frame from 0 is 63.9667. One list of panels' `KeyboardShortcut`s handles them and documents them. A key
  on a focused control of the panels, as a toggle, a select's list, a slider or a tab, is the control's. The timeline's
  keys stay the film's, and a click on a toolbar button does not take them from it.
- **Toolbar**, `ToolbarWidget`: a beat, a second or a frame either way, speed from ¼× to 4×, loop, A and B at the
  playhead and the A-B range, `Still ×N`, which renders this second through `renderAt` as an export does, with N
  sub-frames or more for a wide lens, and `Measure`, which runs `measureStage` and comes back to where it started.
  Badges show the beat, the cycle second, the seam second with the time rate while it is slowed, the year, and a forced
  world. Each badge keeps its width, and the bar under the frame one height, so nothing moves as the playhead does.
- **Settings**, the gear: the Studio settings widget over one `SettingsSchema`, in tabs. Time has the speed, loop, on
  by default, which runs on round the cycle or from B back to A, play as the file, a jump to any beat, the one playing
  too, and the A-B range, which runs through the swap when B is before A, as 62 to 2. Loop has the world, the seam strip
  and the gust plot. Layers has each layer of `LAYERS`, the overlay and the finish. Overrides pins a number of the
  story. Trees has `lodBias`. Render has the samples of a still, the aspect, guides for the 9:16 safe area of
  `PORTRAIT_SAFE_AREA`, device pixels, which change at once, and MSAA, which reloads the page, as a canvas keeps its
  antialiasing for life. Camera has the story camera or a free one, which starts on the frame on screen, shake and all,
  and stays put while time moves, and a readout of both, filled as soon as it is turned on.
- **Loop views**: `?world=end` or `?world=start` composes a second inside the rind from that side of the swap; the
  stage reads it, under `capture` too, as the seam check needs it. `?seam=1` shows seam -2/30, -1/60 (end), +1/60
  (start) and +2/30 s side by side with no grain, the MAD and PSNR of each step between them, and of the two worlds at
  ±1/60 against the 42 dB gate. `?loop=1` plays the cycle from the file's first frame, as a feed does. `?gust=1` plots
  `wind.gust` and the wind's strength through the storm, with `HURRICANE.gustPeaks` and the playhead. `?water=0.05`
  pins the flood's surface at 5 cm. All but `world` are the panel's, so a capture has none of them.
- **Stats**, deck.gl's `StatsWidget`: frame rate and time while playing, from a probe.gl `Stat` over the last ten
  frames, layers, trees growing and GPU memory.
- **Help**, the `?`: the keys, and every URL parameter, from the descriptors that read and write the URL.

A frame drawn after a jump or a change of settings is made anew. `TreeLayer` holds its levels of detail, and the leaves
and crops it lists near the camera, through small changes of view and of its props, so a layer that has drawn other
frames can draw this one a little differently. The stage makes it again before the frame's preroll, so the frame is the
one a capture's first shot of that second draws, and a change undone gives back the frame there was. In the hurricane a
frame made anew takes about 0.8 s, against 0.3 s for one that follows on. A drag of the free camera draws as it goes,
and makes its frame anew once it stops. A capture makes nothing anew, and draws as it always has.

What changes the picture goes to the URL, so a reload or a link shows it again: `t`, kept to the frame, as `t=0.0333`
for frame 1, `only`, `overlay`, `finish`, `lodBias`, `aspect`, `dpr`, `msaa` and `world`, which the stage and the panel
read alike with `stage/stage-query.ts`, and those only the panel reads, `override=weather.rain:0.8,wind.strength:1`,
`water=0.05`, `ab=44,52`, `camera=orbit`, `loop=1`, `seam=1` and `gust=1`. `camera=orbit` starts the free camera on the
story camera, and where a drag takes it is not kept. Preferences, as the speed, stay in this browser's local storage.

An override pins a number of `StoryState` after `getStoryState(t)`, on a copy, and is off until its switch is on or its
slider moves. Unpinned, the slider shows the story's number. The Overrides tab has rain, rain curtains, spray, debris,
wind strength, gust and bearing, the storm sky, the flood level (`ground.flood.level`, which the URL calls `water`),
ground wetness, silt and tree wetness. A number the story adds later takes one line in `OVERRIDE_FIELDS`, and a path
that is not in `story-types.ts` does not compile. What the story derived from a number at that second stays as it was:
a pinned storm sky darkens the sky, while the light, the stars and the grain stay as the story has them, and a pinned
gust moves what reads `wind.gust`, not the shake the camera took from it. An agent at a page can do all of it with
`stageDebug.setSetting('override.value.weather.rain', 1)`, and `stageDebug.showSeamStrip()` draws the strip again.

## The loop and its checks

The file must loop without a hitch on every pass, and the swap must not show. Four checks gate an export, two in Node
and two on the real GPU, all with the same numbers, from `stage/stage-query.ts`:

- `test/loop.spec.ts`: whatever is keyed on seam seconds, and the sun, grade, fog and cloud, match in value and slope
  either side of the swap; the overlay lays out within a pixel either side on the film's 1080x1920, and at every size
  steps across the swap no further than it steps 2 ms either side of it; year, scene clock and world change only at
  the swap; the air is still through `LOOP.stillAir`; and the rind covers every lens position inside `LOOP.cover`.
- `export.mjs --check-seam 1`, the hidden swap on the GPU. At seam -1/60 and +1/60 s a frame from the end world and one
  from the start world, with no overlay or grain, are at least 42 dB alike (`SEAM_CHECK`). And every sub-frame of the 18
  frames inside `LOOP.cover`, at an export's time, lens position, pixel offset and sun, drawn with the orange alone over
  a magenta that no layer draws (`checkCover`, on a page with `only=orange&finish=0&msaa=0`), shows none of it.
- `export.mjs --check-loop FILE`, the file's own wrap and the swap, on any MP4, as decoded. The pair where it starts
  over, frame 1919 to frame 0, and the pair across the swap, 80 to 81, each against the 8 pairs either side, its 16
  neighbouring steps (`LOOP_CHECK`), over the whole frame and over the overlay's band, y 1090 to 1560 of 1920. The MAD
  rule is a MAD of at least 0.5 and at most 1.3 times their median, so the rind's slide never jumps and never stops,
  and the SSIM rule an SSIM, by ffmpeg's `ssim`, of at least their median less 0.01 (`LOOP_CHECK.rules`). The floor
  is for a freeze: a last frame the same as the first, a MAD of 0 and an SSIM of 1 in the picture, kept both rules
  while they bounded the MAD only from above and the SSIM only from below.
  - **The swap** keeps both rules. That is what the spec's section on the stage asks; its loop section names only the
    MAD rule for the swap, and the stricter is kept. The swap's SSIM was only reported for a while, after one run of
    the band missed it by 0.0006; it gates again, and `--from 63 --to 65` at 1080x1920 and 8 samples keeps it by 0.019
    over the whole frame and 0.012 in the band.
  - **The wrap's picture**, rule 1, keeps both rules wherever an export's intermediate is at hand: in an export, from
    its parts, and with `--parts FOLDER`, from that export's parts folder, whose plan the MP4 must match and whose
    picture it must be an encode of. The frames about the wrap are decoded from the VP9 segments that hold them,
    streamed to ffmpeg as an IVF. This is the strict gate on the picture. Without the parts it is not judged, and
    the check cannot pass.
  - **The wrap in the MP4**, rule 2, keeps the MAD rule. In place of the SSIM rule, which it measures and reports only,
    its SSIM dip below its neighbours' median is no deeper than the deepest such dip at the file's own internal
    key-frame steps, the steps into every IDR frame but frame 0 as the stream has them, plus 0.005
    (`LOOP_CHECK.keyFrameMargin`), over the whole frame and over the band. Their median, 90th percentile and deepest
    are reported beside it. The H.264's GOPs are closed, so every step into an IDR frame dips in SSIM below its
    neighbours, and the wrap is one, into frame 0: the SSIM rule fails any such encode of the film, whatever its
    picture does. The first full cycle at 1080x1920 and 8 samples missed it by 0.012 over the whole frame and 0.025 in
    the band, while the same pair in its VP9 kept both rules, and x264's `ipratio` at 1.1 or 1.0, or 8 Mbps, did not
    clear it. A wrap that is not a step into a key frame, as a short run's inside its one GOP, or one in a file with
    no other key-frame step, may dip no more than 0.01, as the SSIM rule has it.

    With the parts at hand, each key-frame step's dip is the MP4's less the picture's there, the encoder's own share,
    and the wrap's dip, the MP4's as a viewer sees it, may be no deeper than the deepest of those and 0.005, and never
    deeper than the MP4's own dips allow (`judgeEncodedWrap`). The picture's own dips had widened the allowance: the
    band dips 0.281 at 1259 to 1260 in the MP4, 0.25 of it the picture's, and allowed the wrap 0.286. The encoder's
    shares are at most 0.0216 over the whole frame, at 1499 to 1500, and 0.0354 in the band, at 839 to 840, so the
    film's wrap, which dips 0.0215 and 0.0336, is allowed 0.0266 and 0.0404.
  - **Two-frame steps.** Across the wrap, 1918 to 0 and 1919 to 1, and across the swap, 79 to 81 and 80 to 82, each
    step of two frames has a MAD of at least 0.7 times the median of its 16 neighbouring two-frame steps'
    (`LOOP_CHECK.twoFrameLeastRatio`, `getTwoFrameSteps`), over the whole frame and over the band, on the picture where
    the parts are at hand and on the MP4 where not. Motion that runs back into frame 0 and out again, a bounce, steps
    as far in each frame as the film does and the same either way, so it keeps the MAD and SSIM rules; but two frames
    apart it shows one picture. The film's picture steps 13.28 and 13.20 across the wrap, at least 9.24 and 9.28, and
    5.54 and 5.57 across the swap, at least 3.94 and 3.93.
  - **The parts are the MP4's.** With the parts, before any pair is judged, the MP4's frames 0, 960 and 1919, and the
    frames of the wrap's and the swap's two-frame steps, 1, 79 to 82 and 1918 (`getTieFrames`), are each at least 35
    dB from theirs, over Y, U and V together as each is coded (`getYuvPsnr`, `LOOP_CHECK.leastPartsPsnr`), or the
    check stops with an error that the parts are not this file's. Without it, an MP4 torn at the wrap and checked with
    the film's own parts had the film's picture judged in its place, and passed. The film's MP4 at 5 Mbps is 36.87 dB
    from its VP9 at the least, at frame 1918; the frame a step on is about 28 dB from it. In RGB the same frames read
    about 4 dB lower, 32.7 at 1918, as the tv range is stretched and each channel takes in the chroma's error, so the
    tie is on the coded planes.
  - **A cycle file**, whose export wrote `cycle=1` in its comment, or a file with no export's comment checked without
    `--from`, which the check takes for the film, must have exactly 1,920 frames at 30 fps (`judgeFrameCount`), or it
    fails before its pairs are measured. Of 1,919 frames there is no wrap to judge, and of 1,921 the wrap found, 1919
    to 1920, is not the file's own.

  The check ends PASS, exit code 0, when every rule holds with the picture judged, and FAIL, exit code 1, when one
  does not, or there is nothing to judge, as an error does too (`getLoopVerdict`). Without the parts, a file whose MP4
  keeps every rule ends `encoded only: picture not judged`, exit code 2, which is not a pass; the published film
  checked without its parts ends that way. An export always has its parts, so its check is PASS or FAIL. It also says
  whether the file has key frames every 60 frames, an edit list, and its first frame at 0. An export writes where it
  starts in the cycle into the MP4's comment; for another file `--from` says, and for any file it goes before the
  comment.
- `export.mjs --cycle 1` makes the file as it is posted: one cycle from the file start, 1,920 constant-frame-rate
  frames, H.264 with closed GOPs of 60 and, with the B-frames' delay in negative composition offsets, no edit list and
  a first frame at 0. It runs the seam check before rendering and the loop check on the MP4, with the wrap's picture
  from its parts, and fails if either does, or if the MP4 is not of that shape. Its B-frames have no pyramid
  (`b-pyramid=none`), so each shows one frame before it is decoded and no composition offset is below -1 frame. A
  pyramid's runs of three show one two frames early, and FFmpeg's reader, which takes the delay from all but the last
  two `ctts` entries, then finds a frame shown before it is decoded wherever the first such run comes last, as it did
  in a 10-frame window at 36.2. It costs about 0.001 of SSIM at 5 Mbps. A run so short that all its B-frames are in
  those last two entries is still read so, as every run of 3 frames and some of 5 are; every encode is checked packet
  by packet as FFmpeg reads it, and one with a frame shown before it is decoded is encoded again without B-frames. No
  run of 7 frames or more has needed it.

A short run tests the tools before an export of about 65 minutes: `--from 60.3 --to 62.3` is the file's last second
and its first, whose wrap pair is 29 to 30, inside its one GOP, and `--from 63 --to 65` runs through the swap, whose
pair is also 29 to 30. With `--check-loop 1`, each is checked as it is made, the wrap's picture from the run's parts.

### What the loop check does not catch

A skeptic attacked the gate after it was hardened. These are still open, as of 9 November 2026:
- **Bugs to fix before the next export.**
  - The check can hang. An ffmpeg `ssim` run blocked reading about 280 MB of piped input while Node waited in
    `execFileSync`, with no timeout, for 12 and 17 minutes. Stream the input with backpressure and give every child
    process a timeout.
  - An honest re-export can fail. The published film's band MAD margin at the wrap is 0.215 (8.434 against 8.649),
    and the same parts at `--h264-bitrate 4000000` fail it (8.579 against 8.453). The key-frame pulse at frame 0
    raises the MP4's MAD as well as its SSIM dip, so rule 2's MAD rule needs the same key-frame allowance as its dip.
- **Blind spots of judging two pairs by whole-frame and band means.**
  - Timing: frames held by their timestamps, or an empty edit list, decode identically, so they pass.
    `verify-export.py` catches them on cadence and frame duration, but `--check-loop FILE` alone does not run it.
  - Local defects: a 48 to 128 px square changed at frame 0 or 81, or the top 240-480 rows of frame 0 frozen.
    Judging a grid of tiles at each pair, each against its own neighbours, would catch them.
  - Defects one or two frames off the judged pairs, such as frame 1918 or 82 frozen, or a skip into 1919. Running
    the stale-frame scan over the whole file would catch them.
  - A film exported without `--cycle` whose length is not the cycle's is never judged at its own wrap.

### The cost of an export

The cycle at 1080x1920 and 8 samples, with `adaptive` as an export has it, takes about 65 minutes on the laptop it was
measured on: about 62 minutes of frames, half a minute of seam check, and the encode. By beat, from a sweep of 28
seconds weighted by their frames:

| Frames | Seconds a frame | Minutes |
| --- | --- | --- |
| Storm, 32.6-45.6, 390 frames | 3.2 | 21 |
| Flood and aftermath, 45.6-51.4, 174 frames | 1.8 | 5 |
| Finale and drop, 56.4-64, 228 frames, 16 to 32 sub-frames each | about 7 (3.4 at 59.5 to 10.7 at 62.6) | 27 |
| Everything else, 1,128 frames | about 0.5 | 9 |

So the finale and the drop, not the storm, are the largest cost: the lens is wide there, `adaptive` draws each of
them 16 to 32 times, and each draw has the hero's full crown and the grove behind the orange. The opening's macro
frames take the same sub-frames and stay cheap (0.45 s at 1.09), as little else is in front of the lens. The spec's 45
minutes assumed 0.7 s for everything outside the storm and the flood. To come back to it, the finale's and the drop's
sub-frames would have to come down, by `MOST_LENS_SAMPLES_SCALE` or a cap of a beat's in `getLensSamples`
(`stage/accumulator.ts`), with the bokeh judged at 16 samples against `export.mjs --from 56.4 --to 64 --samples 8`
with and without `--adaptive 0`.

## Changes to the contract

- `StoryRollover.previous` and `next` are `StoryTimelineChart`, `Omit<StoryTimeline, 'rollover'>`, rather than
  `StoryTimeline` as the spec has them, so a chart has no roll-over of its own and the type does not nest without end.
- `YEAR_KEYS` has `[38.2, 19.5209]` and `[40.3, 19.521]`, which the spec's table leaves out, so the eye and the second
  wall start on the years of `BEAT_TABLE`.

## Where the build departs from the spec

- **The hang point.** The hero's south-east skirt ends 3.6-3.8 m out at the fruit's height, so nothing reaches the
  spec's (4.1, -3.44). The fruit hangs at bearing 115 from the hero, 3.72 m out, at (3.3656, -1.5799)
  (`HERO_FRUIT_TABLE.hang`), placed by picking rays against the year-30 hero, under a 5 mm twig. It is drawn from seam
  -8.6, at night and far off, rather than -5, where it would pop in 1.6 m from the lens. The camera's keys from 59.0
  and around the swap follow it; those at 56.4 and 57.4 are placed by their eyes, in the bed middle, as the spec gives
  them, so the fruit comes into the frame from the right as the camera turns onto it. The relative keys start at seam
  -5 on the 59.0 pose, so the take moves on through the hand-over at -4 instead of coming to rest there.
- **Focus in the dive.** The orange's focus pull comes to the whole radius as the lens closes in (`FOCUS.orangeClose`),
  so at the swap's 0.068 m the focus is on the near rind, not 4-6 mm behind it, and is not held to half the distance.
- **The land.** The slow noise is a fifth over the whole bed, not only near rows, so it never breaks the furrow's 7 cm
  ribbon. The tilt levels off over 80 m (`BED_LAYOUT.tiltReach`), so the far field neither drowns nor dries.
- **The flood.** `FLOOD_LEVEL_KEYS` has -0.03 at 49.0 rather than -0.02: the hero stands 2.72 days in water, and about
  a fifth of the grove, all at x 12 and more, past 3 days.
- **The sky probe**, `getSkyProbe(device)`: the whole sphere in a 128x64 texture, across by compass bearing clockwise
  from +y, up by 0.5 + elevation/180 degrees, in linear light before the film curve (`getSkyProbeDirection` and
  `SKY_PROBE_GLSL` in `field-shading.ts`).
- **The aftermath's days.** The spec's sunsets at 48.3 and 49.5 put its 48.50 still at night. The first night is
  48.77-49.17, and the second, last, quick night 50.47-51.0, so 48.5 and 50.2 are both by day, the second in a low
  afternoon sun from behind the camera, and the replant still starts on clock 9.40.
- **The eye's leaves.** Standing trees lose no leaves over 37.9-38.7 and 40.2-40.7 (`STORM_TABLE.throughEye`), as
  `TreeLayer`'s leaves in the air follow the wind of the moment and would draw back upwind as it drops.

## Lighting and shading of props

`prop-shading.ts` reads the standard `lighting` module uniforms, so lights mean the same to props and to
`TreeLayer`. It uses the same inline filmic tone curve as `TREE_PHOTOREAL_FRAGMENT_CHUNK`, so everything
in a frame sits in the same space. Sun and moon go through one mutated `DirectionalLight` plus a second
for lightning; the `AmbientLight` carries the sky.

A stock `LightingEffect` draws one map per directional light once any of them casts, and its shadow module
averages over them. The stage's keeps lightning out of that, so there is one shadow pass and one map, sized to the
viewport and fit to the view frustum, and `shadow.lightCount` is always 1. Lightning joins the `lighting` uniforms
only while it is lit, so `lighting.directionalLightCount` is 1 most of the time and 2 in a flash: index 0 is the key
and has the map, index 1 is the flash and has none. The near and far planes must be tight in every frame. `camera.ts`
computes them from what the shot can see, and its `getOrbitViewProps` turns a camera into `OrbitView` props and a view
state. So `far` is often only metres away, as at the start, when it is under a metre: anything that must reach the
horizon, as the sky and the ground must, has to hold its own depth inside the far plane. Custom layers read shadow
maps the way `TreePhotorealPrimitiveLayer` does.

## Sizes

`state.trees` holds ordinary rows with `TreeSpec` values, the hero first. Row identity is stable across
frames, and numbers are written in place, so read a frame's trees before the next `getStoryState`. The stage
gives `TreeLayer` an array of row indices as `data`, and `getTree` reads `state.trees`. At `t` in `grove-magic`
and later, about 100 trees are present. Heights are the same as `STORY.md`: hero 9 m and crown radius 5 m at
growth 1, others 6.2 m and 3 m. Lines of trees run along x, 7.6 m apart on y with 6 m between trees, as
`state.ground.rows` says, so the camera can look down an aisle into the sun. Past the block of real trees the
ground draws those rows on to the horizon on its own.

## Definition of done for a layer

- Compiles under Metal ANGLE with no GL errors, and survives the shadow pass and picking pass. A layer
  that does not cast must skip the shadow pass (for example `shadowEnabled: false` or checking the render pass).
- Holds up at every distance the story asks of it, from macro to the horizon.
- Looks right under every light in the story, including night and storm.
- Has been viewed in real captures with `capture.mjs`, against a plain sky if the sky is not ready yet. See
  [Testing a layer](#testing-a-layer).
- Pure logic has node tests.

## Generated files

Keep QA images, frame caches and exports outside the repository.
