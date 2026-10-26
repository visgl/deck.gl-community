# WindEffect and luma.gl weather

Status: step 1 prototyped in `modules/layers/src/wind-effect/` (`speed`, `shear`, the callback
clock, `getWindVelocity` and `getWindDisplacement`); steps 2 and 3 are open. How
[`WindEffect`](./wind-effect-design.md) and the luma.gl
[Riverfront weather](https://luma.gl/next/examples/deck/weather) example
(`visgl/luma.gl` `examples/deck/weather`) could share one wind.

## What the weather example does with wind today

The example keeps `windSpeed` (m/s) and `windDirection` (degrees clockwise from north) in app
state and hands each consumer its own copy:

| Consumer | Wind input | Motion |
| --- | --- | --- |
| `precipitation` module (`WeatherParticleLayer`) | `wind: [sin θ, cos θ] × speed`, m/s | Analytic: `(wind, −fallSpeed) × time` |
| `heightFog` module | `velocity: [sin θ, cos θ, 0]`, unit | Integrated: the app advances `fogTime += dt × fogDrift` |
| Clouds (`SkyLayer`) | fixed `velocity: [14, 4]` | Ignores the wind controls |
| Clock | app-owned `time`, passed as `time: () => time` | Paused when hidden or Animate is off; the app sets `_animate` |

The direction convention is already `WindEffect`'s: the bearing the wind blows *toward*. So
`[sin θ, cos θ]` is the same east/north axis the trees bend along. Nothing needs converting.

## One wind, each consumer takes what it needs

`WindEffect` should describe the air, not just the bend. Three additions make it a drop-in
source for the weather layers:

1. **`speed` in m/s**, at the standard 10 m anemometer height. When `strength` is omitted, the
   bend comes from a vegetation response curve, for example `0.025 × (speed / 5)^1.4`, capped
   at 0.2. That gives 0.032 at the example's default 6 m/s, close to TreeLayer's
   "gentle breeze" 0.025, and 0.12 in a 15 m/s gale. The exponent below 2 reflects flexible
   plants streamlining as the wind grows (Vogel). An explicit `strength` still wins.
2. **`time` also accepts `() => number`**, matching `WeatherParticleLayer`. The trees then pause,
   seek and skip hidden-tab gaps exactly with the rain.
3. **Pure helpers**, so that consumers never re-derive the wind:
   - `getWindVelocity(wind, height, time)` gives `[east, north]` in m/s, with power-law shear
     `v(z) = v₁₀ (z / 10)^α` (α = 1/7 over open ground, about 0.25 in a city) and the gust
     swell;
   - `getWindDisplacement(wind, height, time)` gives the metres travelled. It integrates the
     gust analytically: `∫₀ᵗ n = 0.6/0.83 (1 − cos 0.83t) + 0.4/2.09 (cos 1.3 − cos(2.09t + 1.3))`.

What each consumer would read:

| Consumer | From `WindEffect` | Example at 6 m/s |
| --- | --- | --- |
| TreeLayer, SplatLayer, `WindExtension` | bend `strength(speed) × gust(t)` | 0.032 |
| `precipitation` | velocity at the volume's mid-height (225 m) | 9.4 m/s |
| `heightFog` | direction only; drift speed stays its own control, as the README intends | |
| Clouds | velocity at ~1.5 km: `2.05 × v₁₀` | 12.3 m/s, near today's fixed 14.6 |

### Gusts and slider changes without jumps

`precipitation` places every drop at `(wind, −fallSpeed) × time`. Changing the wind, or letting
it gust, moves every drop at once by `Δwind × time`, which grows with the session. Fog already
avoids this by integrating its own clock. Precipitation can do the same with one
backward-compatible uniform:

```glsl
// precipitation module: drift.xy = wind * time + windOffset
vec3 drift = vec3(precipitation.wind * precipitation.time + precipitation.windOffset,
  -precipitation.fallSpeed * precipitation.time);
```

The app passes `wind: [0, 0]` and `windOffset` from `getWindDisplacement`, or keeps the
displacement integrated per frame (`offset += velocity × dt`) when the speed slider moves.
Existing callers keep `windOffset = [0, 0]` and behave as today.

## A riverfront sketch

```ts
const wind = new WindEffect({speed: windSpeed, direction: windDirection, gust: 0.3, time: () => time});

deck.setProps({
  effects: [wind],
  layers: [
    sky, // clouds: {velocity: getWindVelocity(wind.props, 1500, time)}
    district, // fog: velocity is the unit vector toward wind.props.direction; drift keeps its own speed
    new WeatherParticleLayer({
      ...weather,
      precipitation: viewport => ({
        ...getPrecipitation(viewport),
        wind: [0, 0],
        windOffset: getWindDisplacement(wind.props, 225, time)
      })
    }),
    // The district's `park` blocks get trees that lean with the rain.
    new TreeLayer({id: 'park-trees', data: parkTrees, coordinateOrigin: CITY_ORIGIN, coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS})
  ]
});
```

The district has `park` features but no trees today, so TreeLayer fills a real gap: the rain
slants, the fog drifts and the trees lean, all from the Wind and Wind direction sliders.

## Redraws

The weather app schedules frames itself (`_animate`). Today, wind layers call `setNeedsRedraw()`
while the clock follows the deck timeline. With a callback clock they should stop doing that:
the app owns scheduling, and a paused weather scene must stay idle. So the rule becomes: a
`time` callback means the app schedules frames; `time: null` means the deck timeline and layer
redraw requests.

## Where the code lives

- **luma.gl shadertools**: the `wind` module (uniform block, `windBend` bend and Jacobian,
  gust envelope, velocity and displacement helpers), in `modules/geometry/` beside
  `precipitation`. It is deck-agnostic vertex math, like `heightFog` and `surfaceWeather`.
- **deck side**: `WindEffect`, `WindExtension` and the TreeLayer/SplatLayer consumers, in
  `@deck.gl-community/layers` now and in deck.gl core once settled.

The version gap is the main obstacle. `@deck.gl-community/gpu-layers` is `10.0.0-alpha.4`,
built on luma.gl 10 alpha and a patched deck.gl 9.4, while `@deck.gl-community/layers` is on
luma.gl 9.4. A combined riverfront demo therefore waits for one side to move. Until then:

1. here: add `speed`, the callback clock and the helpers to `WindEffect` (no luma.gl
   dependency);
2. in luma.gl: add `precipitation.windOffset`, and let the weather example read a plain
   `{speed, direction, gust}` object through the same helpers, so its wind is already
   `WindEffect`-shaped;
3. when deck.gl-community moves to luma.gl 10: move the `wind` module into shadertools, and add
   park trees to the riverfront example.

## Questions for luma.gl

- Does the `wind` module belong in shadertools `geometry/`, next to `precipitation`?
- Shear defaults: reference height 10 m, α = 1/7, or a city value for the riverfront?
- `precipitation.windOffset`, or a single `drift` uniform that replaces `wind × time`?
- Should clouds follow the scene wind, or keep their own upper-air velocity?
