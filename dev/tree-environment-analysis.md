# Tree environment analysis: light and wind

Status: plan. Per-tree light and wind analysis on `TreeLayer`, using the same environment model
that renders the scene. Builds on [WindEffect](./wind-effect-design.md) and
[the luma.gl weather proposal](./wind-effect-weather.md).

## Shared foundation

Both threads need the same five pieces.

1. **Inventory.** TreeLayer rows already hold position, height, species, season and a crown
   transform (`scale`, `translation`, `orientation`). Each crown becomes an ellipsoid fitted to that
   transform. Buildings and terrain can join later as opaque occluders.
2. **Receiver samples per tree.** Points on the crown surface (Fibonacci points on the ellipsoid,
   16 to 128), interior points for within-crown light, and fruit points: TreeLayer's crops are
   already explicit, seeded positions (`sampleTreeFruit`). Each sample is tagged with a side
   (N/E/S/W) and a height band.
3. **Porous crowns.** Each crown is a turbid medium with leaf area density LAD (m²/m³). A ray
   through it keeps `T = exp(−G · LAD · L)`, with `G ≈ 0.5` for randomly oriented leaves. The same
   LAD gives the crown's optical porosity, which the wind thread turns into aerodynamic porosity.
   LAD varies with species and season (a winter deciduous crown is wood only). To keep the analysis
   and the picture consistent, calibrate per-species LAD offline from TreeLayer's Gaussian canopy:
   integrate optical depth through each template once.
4. **Spatial index.** A BVH over crown bounds (reuse `createSplatSpatialIndex`) answers "which
   crowns does this ray or this upwind strip cross".
5. **Clock and site.** A date range and step, and the site latitude/longitude from the layer's
   coordinates. Results are per-sample `Float32Array`s plus per-tree aggregates. They feed
   TreeLayer accessors (for example a colour ramp in `getCanopyColor`), tooltips, charts and CSV.

**Two engines, one set of inputs.** A CPU analytic engine (porous ellipsoids, node-testable, runs
in a Worker) is the reference and drives fast what-if sweeps. A GPU engine renders real geometry
(wood meshes, Gaussian scans, buildings) and produces the visual layers. The two are
cross-validated on the same scenes.

## Thread A: light and sun

### What it answers

| Scale | Metric |
| --- | --- |
| Sample | Direct-sun hours; daily intercepted PAR (mol/m²/day); share of full sun |
| Tree | Mean and distribution of the above; fraction of crown above 30% of full sun (a common fruit-quality threshold); light by side and height |
| Fruit | Hours of direct sun, by time of day |
| Orchard | Light interception (share of incident radiation the canopy captures); light reaching the alley floor |

### Sun and sky

- **Position**: `getSunDirection(timestamp, lat, lng)` from `@math.gl/sun`, which deck.gl's
  `SunLight` already uses.
- **Sampling**: every 15 minutes while the sun is above 2°. Days: one date, one representative day
  per month, or every day of a season, each weighted.
- **Irradiance**: a clear-sky model gives direct (DNI) and diffuse (DHI) radiation, with a cloud
  factor. Measured global radiation from a station can replace it, split into direct and diffuse.
  PAR is about 45 to 50% of shortwave, roughly 2.1 µmol/m²/s per W/m² of shortwave.
- **Diffuse light**: a sky view factor per sample, from 32 to 64 hemisphere directions. It depends
  only on the layout, not the hour, so it is computed once.

### CPU engine

For each sample and sun step, cast a ray toward the sun, query the BVH, and sum `LAD · L` over the
crowns it crosses. A sample's own crown counts for interior points only. Direct light is then
`DNI · max(0, cos θ) · T`, and diffuse light is `DHI · SVF`. A sample is "sunlit" when T > 0.5.

Cost: 10,000 trees × 64 samples × 48 steps is about 31 M rays a day, each crossing a handful of
crowns. That is seconds in a Worker for one day, and under a minute for twelve monthly days.
Sweeps use 16 samples per tree. A what-if recomputes only trees within shadow reach of the change
(`height / tan(lowest sun altitude)`).

### GPU engine

- **Sun maps fitted to the orchard.** deck.gl's `ShadowPass` sizes its map like the viewport and
  fits it to the view frustum, which suits drawing but not measurement. The analysis renders its
  own orthographic map per sun step, fitted to the orchard bounds at a fixed resolution such as
  4096².
- **Partial occlusion.** Wood and buildings write depth. Canopies write optical depth into K depth
  slices (an opacity shadow map: two RGBA targets give 8 slices). SplatLayer's weighted path
  already accumulates optical depth additively; the same shaders run with the sun camera. A first
  version can reuse today's stochastic splat shadows instead, seeding the per-Gaussian hash with the
  step index so the average converges to the true transmittance.
- **Gather.** Samples are drawn as points, one output texel each. Each looks up depth and slices,
  computes `DNI · cos θ · T`, and blends additively over all sun steps. One readback at the end.
- **Visual products from the same pass:**
  - a ground "sun hours" heatmap (ground grid samples);
  - per-Gaussian exposure, using canopy Gaussian centres as samples, so each crown's sunny and
    shaded sides show as a colour ramp on its own leaves;
  - a shadow sweep across the day with deck's normal `SunLight` shadows.

### Sunburn

- **Exposure per fruit.** For each step, the fruit's transmittance and the angle of its sun-facing
  side.
- **Fruit surface temperature (FST).** An energy-balance estimate: air temperature, plus absorbed
  radiation, minus convective cooling that grows with wind speed.
  - Inputs are hourly air temperature and wind; `WindField` frames already carry temperature.
  - Apple thresholds from the literature: browning from about 46 to 49 °C FST, necrosis from about
    52 °C.
  - Cultivar-specific values would come from the product side.
- **Outputs.**
  - Hours above threshold, per fruit and per tree.
  - A map of the faces at risk (typically southwest in the afternoon).
  - What-ifs: shade netting (a transmittance factor), pruning (lower LAD), row orientation.
- **Validity.** This is a risk index for ranking and planning, not a prediction. It needs
  per-cultivar calibration.

### Row orientation and layout what-ifs

- **Layout generator parameters:**
  - row azimuth, row spacing and in-row spacing;
  - tree height and crown width/depth;
  - a training-system preset (spindle, V-trellis with two planes, hedgerow wall);
  - site and date range.
- **Azimuth sweep.** 0 to 165° in 15° steps (rows repeat at 180°), on the CPU engine at reduced
  samples. It reports:
  - orchard interception;
  - east vs west face balance;
  - fruit-zone light;
  - sunburn hours;
  - alley shading.
- **Views.** Two layouts side by side in deck.gl multi-view, on one sun clock. Charts of each
  metric against azimuth.
- **Sanity checks the tool should reproduce:**
  - north–south rows balance the two faces;
  - east–west rows shade the north face more as latitude rises;
  - taller trees and narrower alleys raise interception but darken the lower canopy.

### Validation

- **Analytic cases:**
  - a lone tree on flat ground is fully lit;
  - a neighbour's shadow has length `h / tan(altitude)`;
  - an ellipsoid of known LAD gives known transmittance;
  - open ground has a sky view factor of 1.
- **Engine agreement.** CPU and GPU agree within a stated tolerance on shared scenes.
- **Plausibility.** Orchard interception against canopy cover; high-density apple targets about
  60 to 70%.

## Thread B: wind and shelter

### What it answers

| Scale | Metric |
| --- | --- |
| Tree | Local wind speed at crown height; shelter factor; gust load index and exposure rank |
| Orchard | Wind-reduction map behind rows; what-if of adding or removing a windbreak |

### Inputs

- **Wind data.** `WindField` from `geo-layers`: station or forecast frames with direction, speed
  and temperature, sampled with `sampleWindField(field, [lng, lat], time)`.
  - Its direction is counterclockwise radians from east. It must become `WindEffect`'s bearing,
    clockwise from north, in the direction the wind blows toward.
  - Station data usually reports where wind comes *from*, so check the field's convention before
    converting.
- **Height profile.** A power law from 10 m to crown height, with exponent about 0.2 to 0.3 over
  orchards.
- **Gusts.** A gust factor from the data, or `WindEffect`'s `gust`.

### Shelter model

- **Porosity.** Crowns and rows are porous barriers. Optical porosity comes from the crown model's
  LAD. Aerodynamic porosity follows from it, roughly `optical^0.4` for thin barriers (Guan et al.).
- **Reduction profile.** For a barrier of height H, an empirical curve (Heisler and DeWalle):
  - the lowest relative speed is a few barrier heights downwind, at about 3 to 6 H, and depends on
    porosity;
  - speed recovers to about 90% by 15 to 25 H;
  - a smaller effect reaches 2 to 5 H upwind.
- **Grid.** Multiply the reduction factors of every upwind barrier on a 1 m grid. Cache one grid
  per direction bin (16 bins).
- **Per tree.** Local speed is the field speed at crown height times the shelter factor at its
  position, excluding the tree's own crown.

Full fluid simulation is out of scope; the empirical model is what windbreak design uses.

### Load and risk

Drag `F = ½ ρ C_d A v²`, with streamlining: flexible crowns shrink `C_d · A` as speed rises
(Vogel exponent −0.5 to −1). The bending moment at the trunk is `F × centre-of-pressure height`.
Report a gust load index against species values, as a ranking rather than a structural claim.

### Rendering coupling

- **Per-tree sway now.** Each tree's local-to-scene wind ratio becomes its flex, which TreeLayer
  already accepts per tree (`wind[2]`). Sheltered trees then visibly sway less, with no shader
  change.
- **Spatial wind field later.** Varying direction across the scene needs a wind raster in the
  `wind` module, sampled at each anchor.
- **Particles.** `DelaunayInterpolation` already rasterizes the field. Multiplied by the shelter
  grid, it lets `ParticleLayer` show the air slowing behind rows.

### Validation

- Reproduce the textbook reduction curve behind one long uniform row.
- Check that mirrored layouts give mirrored results.
- Compare against published field measurements.

## Where the threads meet

- Sunburn cooling uses Thread B's local wind.
- Drying of wet canopies (the next thread) needs both sun exposure and wind.
- A windbreak what-if shows both sides of the trade: wind load drops, but shading grows. One chart,
  one layout change.

## Packaging

- **deck.gl-community** (generic):
  - crown model, sample generation, sun path and irradiance;
  - CPU light engine, shelter grid, GPU exposure pass;
  - colour-ramp accessors and overlays.
  - It would live in `@deck.gl-community/layers` under `tree-analysis/`, or as its own module once
    it grows. Outputs are typed arrays, with no UI.
- **Product side:**
  - cultivar thresholds, disease and sunburn calibration;
  - weather ingestion, reports and decisions.

## Phases

Each phase ships a tested engine piece and a demo.

| Phase | Deliverable | Test | Demo |
| --- | --- | --- | --- |
| L1 | Sun path, porous-crown CPU engine, per-tree sunlit hours and PAR | Analytic cases in node | Seasonal Farm "Light" panel: date, latitude, metric colours the crowns |
| W1 | `WindEffect` speed, shear and time callback; per-tree local wind from `WindField` | Sampling and conversion tests | Wind Garden fed by station data |
| L2 | Layout generator, azimuth sweep, split view | Sweep reproduces the north–south balance | Two layouts side by side, metric vs azimuth chart |
| W2 | Shelter grid from crowns; flex per tree; windbreak what-if | Textbook curve behind one row | Sheltered trees sway less; particles slow behind rows |
| L3 | GPU exposure pass, per-Gaussian exposure, ground sun-hours map | Matches L1 on shared scenes | Leaves coloured by their own light |
| L4 / W3 | Fruit exposure and sunburn index; gust load; shade-vs-shelter trade-off chart | Threshold-hour cases | Risk overlay with weather timeline |

Order: L1, W1, L2, W2, L3, then L4 and W3. L1 builds the crown model, samples and BVH that W2
reuses, so the foundation lands once.

## Decisions needed

- Crops and training systems to preset first (apple spindle, citrus, almond, ...).
- Site and dates for the demos.
- Weather data: hourly temperature, radiation and wind from stations, forecasts, or CSV.
- Accuracy target: ranking and what-ifs, which the CPU engine covers, or absolute radiation, which
  needs calibration against measurements.
- Home: inside `@deck.gl-community/layers`, or a new module.
