# Thirty Years: beat sheet and art direction

One continuous shot of one citrus tree's life, as a 64-second loop with no ending. At sunrise in
year 30 a ripe Valencia lets go of the old tree in high-speed slow motion. The camera dives with it
until the dewy rind fills the frame, and the same fruit, still falling, comes out over the empty
bedded field where that tree began. It lands beside a pot and splits, and its seed grows into
everything that follows: the tree, a grove rising on a ring of light, a September hurricane, the
flood after it, the replanting, and the same fruit hanging again at Year 30. No cuts, one camera,
one spot in one field. The tree is `TreeLayer`, used as a plain deck.gl layer.

All timings live in tables: the beats, the year curve, the loop and the hurricane in
`story/beats.ts`, and the rest in the file that owns each thing. A value that reads better on
screen beats a value in this file.

## Art direction

- **Photographic, not illustrative.** Think of a nature documentary shot on a large sensor: natural
  light, real shadow, shallow focus when close, atmospheric depth when wide. Nothing glows without
  a physical reason except the two magic moments (the seed's arc and the grove's arrival).
- **Florida citrus.** Pale sandy soil on double-row beds with water furrows, flat land, huge skies,
  row-planted grove, mowed middles, bare herbicide strips under canopies, microjet irrigation. The
  audience includes people who grow citrus for a living; details such as the protective net, the
  planting berm, bloom timing, hurricane season, the culvert crossing and what standing water does
  to roots are right.
- **Motion has weight.** Nothing moves linearly. Heavy things accelerate slowly and settle. Light
  things flutter.
- **The camera is a person's hand on a very long crane.** Continuous, restrained and eased, with
  log-space distance moves. No zoom pulses. Shake appears only in the hurricane's walls.

## The loop

The file is exactly one cycle, 1,920 frames at 30 fps, and loops on itself. 64 s is 32 bars at
120 bpm, so a track added in an app loops with the picture.

- **Cycle seconds** run from 0 up to 64. Any time is taken mod 64: a frame is a pure function of `t`
  mod 64, and nothing ever clamps.
- **The swap** is at cycle second 0, where the Year 30 grove (the end world) becomes the Day 0 field
  (the start world). It is hidden inside the falling orange's rind, which covers every pixel from
  seam second -0.35 to +0.25 (`LOOP.cover`).
- **Seam seconds** are signed seconds from the swap, continuous through it. Only what must run
  through the swap is keyed on them: the time rate, the fall, the camera relative to the fruit, and
  the overlay's roll-over.
- **The scene clock** (`getSceneSeconds`) is what everything that moves runs on: the wind, the fall,
  ripples, drift. It runs at 1 scene second per second through the cycle and slows to 0.12 around
  the swap (`TIME_RATE_KEYS`), so the drop and the landing are high-speed footage.
- **The file** starts at cycle second 61.3 (`LOOP.fileStart`), with the fruit still hanging, and its
  wrap from 61.267 to 61.3 is an ordinary step of story time.

Everything that is not keyed on seam seconds is a track of cycle seconds that is flat and equal at
both ends: the sun (it rises exactly ten days over the cycle), the light, the grade, fog, cloud,
mist and the still air. So the end world's last frame and the start world's first agree in value
and slope, and only the content of the world changes in the covered frames.

## Time

`year` is a monotone curve of cycle seconds: days per second at the start, years per second later,
nearly frozen in the storm, held on March 1 of year 30 at the end. `season` is the fractional year,
with 0 being March 1, so 0.25 is June, 0.5 September and 0.75 December. The sun's daily arc is
authored separately from `year`, so day and night never strobe: each beat chooses its sunrises and
sunsets, and each quick one takes its time at the horizon.

| Seconds | Year | Beat |
| --- | --- | --- |
| 0 | 0 | `landing` |
| 2.6 | 0.0006 | `crop-opens` |
| 4.6 | 0.002 | `seed-flight` |
| 6.6 | 0.004 | `into-dirt` |
| 7.8 | 0.02 | `sprout` |
| 9.6 | 0.1 | `potted-tree` |
| 12.0 | 1.0 | `net` |
| 13.4 | 1.1 | `planting` |
| 15.8 | 1.5 | `establish` |
| 19.2 | 6.0 | `seasons` (year 6 on one day, then each year shorter than the last) |
| 27.0 | 15.0 | `grove-magic` |
| 31.0 | 15.25 | `grove-thrives` |
| 32.6 | 19.52 | `hurricane` (September) |
| 34.4 | 19.5206 | `first-wall` |
| 38.2 | 19.5209 | `eye` |
| 40.3 | 19.521 | `second-wall` |
| 44.0 | 19.5213 | `clearing` |
| 45.6 | 19.5216 | `flood` |
| 47.8 | 19.5227 | `aftermath` |
| 51.4 | 20.9 | `replant` |
| 53.2 | 21.1 | `regrowth` |
| 56.4 | 29.95 | `finale` |
| 60.6 | 30.0 | `drop` |
| 64 = 0 | 30 = 0 | the swap |

## Beats

**`landing` (0-2.6 s).** Inside the rind until seam 0.25: oil glands, fine pits and dew beads
holding points of the dawn sky. The camera draws back as the same orange, still falling in slow
motion, comes clear over the pale bare sand of the empty bedded field at first light, with the
sunrise ahead and to the right and the bed's grass line on the horizon. It lands beside the pot at
1.09: a slight squash, a crown of sand, a small hop, a short roll and a rock that settles to
nothing. The camera looks down on the impact from about 0.32 m, so all of it stands clear above the
timeline. It lies still by 2.5 in exactly the opening's pose. No trees anywhere. The pot is off to
the right and the furrow's water below the beds' line from an eye this low: neither can be in this
frame with the sun ahead and to the right. Caption *One orange*.

**`crop-opens` (2.6-4.6 s).** A hairline seam opens round the equator. The halves part and roll
apart under their own weight, settle face up, and show wet segments, membranes, translucent
vesicles, white pith and a few pale seeds. Juice beads rise and droplets fall. The camera rises to
look into the halves.

**`seed-flight` (4.6-6.6 s).** One pale seed works loose with a bead of juice, lifts and tumbles
through a short, high arc with the faintest gold trail, the first magic moment, and lands in the
pot's dark soil with a small puff. The camera follows it, swinging past the sun to the pot. Caption
*One seed*.

**`into-dirt` (6.6-7.8 s).** The seed settles in a dimple and grains tumble in to cover it. The day
runs on to its first sunset over the pot.

**`sprout` (7.8-9.6 s).** Two days and nights. The soil cracks and lifts, and a pale hooked shoot
pushes through, straightens and opens its first leaves.

**`potted-tree` (9.6-12 s).** The whip climbs with spiralling leaves and side shoots, the pot steps
up a size with a soft settle, and the camera pulls back with it. The readout runs through weeks and
months to Year 1.

**`net` (12-13.4 s).** A fine white mesh bag comes down over a wire hoop, billows and is cinched at
the base: an individual cover against the psyllid that spreads greening. Morning sun through the
mesh. Caption *Netted against greening*.

**`planting` (13.4-15.8 s).** The crane back shows a field already bedded, a water furrow on the
left with its culvert crossing beside the tree. The pot slides away, a hole opens, the netted root
ball goes in, soil pours back into a low berm that takes a dark ring of water, and a microjet
sprays. Caption *Planted out*.

**`establish` (15.8-19.2 s).** Years 1.5 to 6, with the branches as the star: the camera orbits low
and close, looking up into scaffold limbs that fork, arch and thicken, with a lime flush each
spring. The net strains, is slit and lifts away on the wind. First blossom, and the first small
crop, all in a long afternoon; then a blink of a night before a spring sunrise. Caption *First
fruit*.

**`seasons` (19.2-27 s).** Year 6 plays out on one authored day: a spring sunrise in full bloom,
summer noon with green fruit swelling, colour break at an autumn sunset, a blue winter night in
mid-January with frost and the microjet running for freeze protection, and a dawn harvest. Then
years 7 to 15 pass, each shorter than the last, with more fruit every year and a bar landing for
each, in daylight but for a short night before a March sunrise at the end of the aisle. There is no
summer storm in this cut. Caption *More fruit each year*.

**`grove-magic` (27-31 s).** The second magic moment. At a March sunrise in full bloom a soft ring
of light runs out from the hero along the ground. Where it passes, saplings burst up along the beds
and rise to young trees in a radial wave, with motes and petals. The crane rises to rows on beds
running to the horizon, every second aisle a furrow glinting with the sunrise. Caption *A grove*.

**`grove-thrives` (31-32.6 s).** High, calm and generous: four quick seasons of fruit across the
grove. By 32.4 it is September of year 19 and the light goes flat and hazy. Caption *Good years*.

**`hurricane` (32.6-34.4 s).** The storm deck comes over from behind the camera and to its right.
Its shadow's soft edge runs out NE across the grove at about 30 m/s and drains the light row by row:
it passes the view centre at 33.0, and in the 33.2 frame the near rows are grey while the far ones
are still in the sun, until the deck thickens over them by 34.2. An outer band's rain shaft hangs
over the far rows, and gust fronts roll across the canopy as bands of upturned pale leaves. The
first drops ring the furrow ribbons, and the camera dives into the north water furrow. Caption
*Hurricane*.

**`first-wall` (34.4-38.2 s).** Low over the furrow between two canopy walls streaming left, the
camera's eye 1.4 m above the water. At each gust peak both walls silver, strip and tear spray off
their crowns, and the far end of the aisle whites out to a bright veil, not murk. A north-row tree
rocks and goes over away from the furrow; a hero-row tree falls across it at the culvert.
Lightning. The water rises.

**`eye` (38.2-40.3 s).** The wind collapses and the rain stops. The deck opens overhead to hazy
blue ringed by sunlit eyewall towers, steam rises with shafts of light, and the camera tilts up into
the stadium as the last of the wall goes over, up by 38.9 and held there through 39.2, then down
onto the furrow, which mirrors it. It holds still on the mirror from 39.88, so the frame is calm
when a dark line of cat's-paws races down it toward the lens: the second wall. Caption *The eye*.

**`second-wall` (40.3-44 s).** The wind returns from the other side and every crown streams right.
Trees go over both ways, the hero loses most of its last leaves and two limbs and stands, a falling
crown crashes into the brimming furrow, and the water covers the shoulders to the trunks. Its grade
has a deeper toe than the first wall's, for the darks the brimming water takes from the frame.

**`clearing` (44-45.6 s).** The deck breaks from the west and a low gold sun comes in under its
trailing edge from behind the camera, onto the near ground first, and follows the edge out east
over the wet, stripped, leaning grove. Every wet leaf glints, and the departing eyewall stands to
the east lit warm along its underside. The camera cranes up and back over the wrecks.

**`flood` (45.6-47.8 s).** From 11 to 14 m up, the block stands in tea-brown water, one sheet with
the furrows as darker channels, mirroring the clearing sky and the stripped crowns. Drifts of fruit
and leaves gather against the trunks and wrecks. The broken bar lands, the sun sets behind the
camera, a quick night passes, and the next morning lays a glitter path across the water. Caption
*Standing water*.

**`aftermath` (47.8-51.4 s).** Days, then weeks. The sheet breaks up, bed crowns first, and the
furrows drain to their ribbon, leaving a pale silt film and wrack lines. In the low east end the
trees that stood in water longest yellow, wilt and die back; survivors on the higher side flush
lime, the hero first. Caption *Roots drown*.

**`replant` (51.4-53.2 s).** In every gap a young netted tree is set out with the hero's own
motions, overlapping and quick. Caption *Replanting the gaps*.

**`regrowth` (53.2-56.4 s).** Years 21 to 30 in one sweeping day. The replants climb and their nets
lift off in a wave, the hero thickens and stays by far the largest, and the yield climbs past its
old peak, all in a long golden afternoon. Night falls for half a second, and as the camera comes
down into the bed middle south of the hero a bright blue first light comes up.

**`finale` (56.4-60.6 s).** Year 30, March 1, the sun just up, low in the bed middle. The camera
looks west down the aisle between the canopy walls, stopped down, with the hero's skirt on the
right sharp, thick-limbed and in full bloom with its ripe crop, and mist between the rows. The
timeline is complete from Year 0 to Year 30. The camera circles clockwise onto one ripe orange
hanging by its stalk at the outer bottom edge of the hero's skirt. From here through the landing
the grade opens up as for a golden hour. Caption *Thirty years*.

**`drop` (60.6-64 s).** Time slows to an eighth. The file starts here, with the fruit still
hanging, side-lit among bloom and fruit, a fifth of the frame across. The stalk lets go; the camera
stays on where it hung while the orange drops away from the springing stalk and out of the middle
of the frame, tumbling slowly and shedding dew, and then dives after it until the rind fills every
pixel and the timeline rolls Year 30 over into Day 0.

## The camera

Key poses by cycle second (`CAMERA_KEYS`), softened, with distance and aperture in log space. Three
things change how a pose is held:
- Around the swap, from seam -5 to +2.6, the take rides the falling orange on keys of seam seconds
  (`RELATIVE_KEYS`): its aim is the land point under the fruit's fall line, which jumps at the swap
  and is never softened, plus the fruit's offset from it, softened over 0.35 s with a reading every
  1/240 s, so the impact eases the camera in and out with no step. So the camera never flies
  between the worlds, and it glides through the impact. For a moment after the let-go the aim stays
  on where the fruit hung (`LET_GO_FOLLOW_KEYS`), so the fruit is seen to drop.
- In the storm, from 34.4 to 44, it is held by its eye low in the north water furrow, as an operator
  standing there would hold it, so its tilts in the eye turn about the eye. Those tilts
  (`EYE_TILT_KEYS`) are read as they are, unsoftened, and come to rest at the stadium (38.9-39.2)
  and on the mirror (39.88-40.08). The way down between them is the quickest move of the take, 28
  degrees in 0.68 s: slower would put one of those two frames mid-tilt.
- A narrow frame widens first, then pulls back, and lifts its subject clear of the timeline, except
  in the dive onto the fruit and where the camera is held by its eye. The widening eases onto its
  cap, so the hand-over to pulling back has no kink.

Its planes are pinned to `LOOP.pinnedPlanes` only inside the rind's cover, so in the dive it draws to
its own far plane and never clips away the trees behind the falling fruit. The stage's adaptive
sample count can take what moves across the shutter, from `getShutterTravel`, as well as the lens,
so a fast tilt, a storm's thrashing crowns or a crown going over by the lens blur rather than smear.

## The grove

The hero is at the origin, with mature height 9 m and crown radius 5 m at growth 1. Others have
mature height around 6.2 m and crown radius around 3 m, each with one of about six `characteristics`
seeds. About a hundred positions sit in rows 7.6 m apart with about 6 m in-row spacing, on Florida
flatwoods double-row beds 15.2 m on centre, with a water furrow north of the hero's row. Each row has
its position, seed, planting year, its fall or its dieback, and its replacement if it has one.

Approximate hero `growth`: 0 at year 0.04, 0.02 at 0.25, 0.075 at 1, 0.095 at 1.5, 0.17 at 3, 0.32
at 6, 0.6 at 15, 0.75 at 21, and 0.97 at 30, on a monotone curve. Others follow the same curve from
their own effective age, so at year 30 a survivor stands near 5.9 m and a replant near 3.6 m.

## The timeline (bottom of frame, always)

A single elegant axis, with no chrome and a transparent background over a soft scrim. It is on in
every frame, with no fade at either end.

- The scale itself grows. At the start the axis spans days; it eases out through weeks, months and
  years, so the playhead stays around 70 to 85 percent across, until by the finale it spans exactly
  **Year 0 to Year 30**. Ticks fade in and out by level: days, weeks, months, years, five years.
- A thin season ribbon on the axis: green, gold, amber, blue. When compressed it becomes a fine
  rhythm.
- Annual yield bars rise from the axis as each harvest lands. The hurricane year's bar is visibly
  broken and the following year is low. The numbers are illustrative: about 0.1 boxes in year 4, 2
  in year 8, 4.5 in year 15, 1.4 harvested in the storm year, 0.7 the year after, and 7 in year 30.
- Event flags appear when reached: Seed, Sprout, Potted, Net, Planted, First bloom, First harvest,
  Grove, Hurricane, Flood, Replanted, and a final tag for Year 30. They never overlap.
- Left: a large readout (`Day 12`, `Month 7`, `Year 12`) with the season underneath. Right: this
  year's and cumulative yield, once a harvest exists. It works in portrait at 1080x1920.
- Around the swap it rolls over: the Year 30 chart slides off to the left, joined end to end with a
  fresh Day 0 axis, and the readout rolls from `Year 30` to `Day 0` like an odometer.

Short captions name a beat in plain words, never more than a few, and there are none around the
swap.

## Everything else is standard deck.gl

Lights are a standard `LightingEffect` whose `AmbientLight` and `DirectionalLight` are updated each
frame. The key is the light where the camera looks; as the hurricane's deck comes over and as it
clears, `sky.deckShadow` says where its shadow's edge lies on the ground, so the ground and the
trees can take the key at a point as `key.intensity * mix(shaded, sunlit, smoothstep(position -
softness, position + softness, dot(p.xy, direction)))`. Anywhere else both factors are 1. Props use
custom layers only where a standard one cannot reach the look. All state is a pure
function of cycle seconds: `renderAt(t)` produces the same frame every time, given `t - 1/60` mod 64
is rendered first so falling things have their rates.
