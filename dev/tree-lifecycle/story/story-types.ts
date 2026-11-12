// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The film's shared data contract: everything a frame is, as plain data, in metres, z up, with the
 * hero tree at the origin. `getStoryState` is its only producer; layers, the stage and the overlay
 * only read it. See `FILM.md`.
 */

import type {TreeSpec} from '@deck.gl-community/layers';

export type Vec3 = [number, number, number];
/** A unit quaternion, xyzw. */
export type Quat = [number, number, number, number];
/** sRGB, 0-255, as deck.gl lights and colors take them. */
export type Rgb = [number, number, number];

export type BeatId =
  | 'landing'
  | 'crop-opens'
  | 'seed-flight'
  | 'into-dirt'
  | 'sprout'
  | 'potted-tree'
  | 'net'
  | 'planting'
  | 'establish'
  | 'seasons'
  | 'grove-magic'
  | 'grove-thrives'
  | 'hurricane'
  | 'first-wall'
  | 'eye'
  | 'second-wall'
  | 'clearing'
  | 'flood'
  | 'aftermath'
  | 'replant'
  | 'regrowth'
  | 'finale'
  | 'drop';

/** The two sides of the swap: the Year 30 grove before it, the Day 0 field after it. */
export type StoryWorld = 'start' | 'end';

export type StoryOptions = {
  /** Output width over height. Framing and the overlay adapt to it. */
  aspect: number;
  /**
   * Which side of the swap to compose a second inside `LOOP.cover` from. Omitted, the second
   * decides. Only the seam check sets it.
   */
  world?: StoryWorld;
};

/** Where a frame is in the cycle. */
export type StoryCycle = {
  /** Cycle seconds, 0 up to `CYCLE_SECONDS`. 0 is the swap. */
  seconds: number;
  /** Signed seconds from the swap, continuous across it. */
  seam: number;
  /** The side of the swap this frame was composed from. */
  world: StoryWorld;
  /** Scene seconds per story second: 1, or down to 0.12 in the slow motion around the swap. */
  rate: number;
  /** Scene seconds since cycle second 0 (`getSceneSeconds`): what everything that moves runs on. */
  clock: number;
  /**
   * Scene seconds since the fruit let go (`getFallSeconds`), continuous across the swap; 0 before.
   */
  fall: number;
  /** 1 inside `LOOP.cover`, where the falling orange's rind fills every pixel, else 0. */
  cover: number;
};

/**
 * The one take. `target` is the middle of what it shows. The lens orbits around the focus point for
 * depth of field, on the same line of sight: at `target`, or on the near side of a closed orange or
 * the hero's crown when `target` is inside it. See `getFocusPull` in `stage/accumulator.ts`.
 */
export type StoryCamera = {
  target: Vec3;
  /** Degrees around z, as `OrbitView.rotationOrbit`. */
  orbit: number;
  /** Degrees above the horizon, as `OrbitView.rotationX`. */
  pitch: number;
  /** Metres from the eye to `target`. */
  distance: number;
  /** Vertical field of view in degrees. */
  fovy: number;
  /** Tight planes in metres from the eye. The shadow map is fit to them. */
  near: number;
  far: number;
  /** Lens radius in metres. Blur at depth d is `aperture * |d - focus| / d`. 0 is a pinhole. */
  aperture: number;
};

export type StoryDirectionalLight = {
  /** Unit vector the light travels along, so it points down in the day. */
  direction: Vec3;
  color: Rgb;
  intensity: number;
  /** Whether it casts a shadow map. */
  shadow: boolean;
  /** Radius in degrees of the disc the direction is jittered over in accumulation. */
  softness: number;
};

export type StorySky = {
  /** Unit vector toward the sun, or below the horizon at night. */
  sunDirection: Vec3;
  /** Unit vector toward the moon. */
  moonDirection: Vec3;
  /** Haze: 2 is a crisp Florida winter morning, 6 a hot hazy afternoon. */
  turbidity: number;
  /** 0-1, how much of the sky is cloud. */
  cloudCover: number;
  /** 0 flat fair-weather cloud, 1 towering cumulus. */
  cloudBuild: number;
  /** Metres of drift of the cloud field, x and y. */
  cloudOffset: [number, number];
  /** 0-1, hurricane sky: green-grey, low, racing bands. */
  storm: number;
  /** Radians. Rotation of the storm's spiral bands around the eye. */
  stormSwirl: number;
  /** 0-1, the eye opens to clear sky overhead. */
  eye: number;
  /** 0-1, star visibility. */
  stars: number;
  /** Radians. Rotation of the star field around the celestial pole. */
  starTurn: number;
  /** 0-1, in-cloud lightning brightness this instant. */
  flash: number;
  /** Where the hurricane's deck shades the ground from the sun, as it comes over and as it clears. */
  deckShadow: StoryDeckShadow;
};

/**
 * The storm deck's shadow on the ground: a soft straight edge with the sun on one side of it and
 * the deck's own light on the other. It runs out across the grove away from the camera as the deck
 * comes over, at about 30 m/s, and the gold sun follows the trailing edge out east as it clears.
 * `key` is the light where the camera looks; a point `p` on the ground is on the sunlit side by
 * `smoothstep(position - softness, position + softness, p.x * direction[0] + p.y * direction[1])`,
 * and its key light is `key.intensity * mix(shaded, sunlit, that)`. Outside the deck's arrival and
 * its clearing, `shaded` and `sunlit` are both 1, so a layer that reads this changes nothing there.
 */
export type StoryDeckShadow = {
  /** Unit vector on the ground, from the shade toward the sunlit side. */
  direction: [number, number];
  /** Metres along `direction`, from the origin, to the middle of the edge. */
  position: number;
  /** Metres either side of the middle over which the shade comes in. */
  softness: number;
  /** What `key.intensity` is multiplied by in the deck's shade, and in the sun beside it. */
  shaded: number;
  sunlit: number;
};

export type StoryFog = {color: Rgb; density: number};

/** Finishing, in the order `FILM.md` gives. Identity values leave a frame alone. */
export type StoryGrade = {
  /** Stops of exposure. Identity 0. */
  exposure: number;
  /** Identity 1. */
  contrast: number;
  /** Identity 1. */
  saturation: number;
  /** Negative is cool, positive warm, about -1 to 1. Identity 0. */
  warmth: number;
  /** Strength of bloom from bright pixels, 0-1. */
  bloom: number;
  /** 0-1. */
  vignette: number;
  /** 0-1. */
  grain: number;
  /** 0 black, 1 full picture. */
  fade: number;
};

/** Where the field's hero planting stands. Ground in the polar mesh's fine center follows it. */
export type StoryHeroPlanting = {
  /** 0 closed, 1 fully dug. */
  hole: number;
  /** Metres. */
  holeRadius: number;
  holeDepth: number;
  /** 0-1, a low ring of soil around the tree. */
  berm: number;
  bermRadius: number;
  /** 0-1, dark water ring soaking into the basin. */
  water: number;
};

/** A replanted tree's site, drawn as a small patch where the polar mesh is too coarse. */
export type StorySite = {
  position: Vec3;
  /** 0 closed, 1 dug. */
  hole: number;
  /** 0-1, a low berm. */
  berm: number;
  /** 0-1, wet. */
  water: number;
  /** Root ball being lowered, or `null`. */
  rootBall: StoryRootBall | null;
};

/**
 * The grove's rows on the ground. Lines of trees run along x, one on each `y = k * spacing`, with
 * trees every `treeSpacing` along them, and they go on past the trees in `state.trees`: there the
 * ground draws them on its own, as dark strips of canopy and bare herbicide strips, to the horizon.
 */
export type StoryGroveRows = {
  /** Metres between lines of trees, along y. */
  spacing: number;
  /** Metres between trees in a line, along x. */
  treeSpacing: number;
  /** Half the block of real trees, x and y, in metres around the origin. */
  extent: [number, number];
  /** Metres from the origin they have spread so far, running ahead of the magic ring. */
  reach: number;
  /** 0 open field, 1 settled strips and mowed middles. */
  strength: number;
};

/** Where something heavy hits standing water. */
export type StorySplash = {
  position: Vec3;
  /** Scene seconds since it hit. */
  age: number;
  /** Metres across what it throws up. */
  size: number;
};

/** The flood: one level plane over the field, water wherever the land is below it. */
export type StoryFlood = {
  /** Metres, the water surface. -0.68 is the furrows' usual ribbon over floors at -0.75. */
  level: number;
  /** The highest level so far this cycle: the silt line and the wrack's edge. */
  mark: number;
  /** 0-1, how still it is: 1 a mirror, 0 chopped by wind and rain. */
  calm: number;
  /** 0-1, foam lines and spume. */
  foam: number;
  /** Metres the surface has carried what floats since the flood began, x and y. */
  drift: [number, number];
  /** 0-1, how much storm litter and fruit floats, or lies stranded where the water left it. */
  floating: number;
  splashes: StorySplash[];
};

export type StoryGround = {
  /** 0-1, across the whole field: dark sand, puddle sheen, wet grass. */
  wetness: number;
  /** 0-1, frost on the grass and sand. */
  frost: number;
  hero: StoryHeroPlanting;
  /** Replant sites with something to show at this moment. */
  sites: StorySite[];
  /** Soft ring of light of `grove-magic`, in metres from the origin. Strength 0 hides it. */
  magicRing: {radius: number; strength: number};
  rows: StoryGroveRows;
  flood: StoryFlood;
  /** 0-1, pale dried silt and wrack lines where the flood stood, once it has gone. */
  silt: number;
};

export type StoryWeather = {
  /** 0-1. Rain falls along the wind by this slant, up to near horizontal in the hurricane. */
  rain: number;
  /** Degrees from vertical. */
  rainSlant: number;
  /** 0-1, airborne torn leaves and twigs, added to what the trees themselves shed. */
  debris: number;
  /** 0-1, drifting dust and pollen motes catching the sun. */
  motes: number;
  /** 0-1, airborne petals, in addition to those the trees shed. */
  petals: number;
  /** 0-1, gold sparkles of the magic moments. */
  sparkle: number;
  /** 0-1, shaft of light through the eye of the storm. */
  shaft: number;
  /** 0-1, ground mist or steam after rain. */
  mist: number;
  /** 0-1, how banded the rain is: 0 an even veil, 1 sheets 40-80 m apart with clearer gaps. */
  curtains: number;
  /** 0-1, spindrift torn off water, wet ground and crown tops, in a low streaming layer. */
  spray: number;
};

export type StoryWind = {
  /** `TreeLayer.windStrength`, 0-1. Exactly 0 inside `LOOP.stillAir`. */
  strength: number;
  /** `TreeLayer.windDirection`: compass bearing, degrees clockwise from +y, it blows toward. */
  bearing: number;
  /** `TreeLayer.windTime`: the scene clock, `cycle.clock`, so slow motion slows the trees. */
  time: number;
  /**
   * `TreeLayer.windGustTime`: phase-locked in the storm so a front peaks at `HURRICANE.viewPoint`
   * at each of `HURRICANE.gustPeaks`; equal to `time` outside it.
   */
  gustTime: number;
  /** 0-1, `getTreeWindGust` at `HURRICANE.viewPoint`: what shake, spray and veils pulse with. */
  gust: number;
};

export type StoryOrangeHalf = {
  /** Center of the cut face. */
  position: Vec3;
  /** Turns a hemisphere whose cut face looks along +z, centered at the origin. */
  rotation: Quat;
};

export type StoryOrange = {
  visible: boolean;
  /** Metres, about 0.04. */
  radius: number;
  /** Center and turn of the whole fruit before it parts. */
  position: Vec3;
  rotation: Quat;
  /** 0 sealed, 1 a fully open hairline, after which the halves move. */
  seam: number;
  halves: [StoryOrangeHalf, StoryOrangeHalf];
  /** 0-1, wetness of the cut faces, and how many juice beads stand on them. */
  juice: number;
  /** Falling droplets, in metres, each with a 0-1 fade. */
  droplets: {position: Vec3; alpha: number}[];
  /** 0-1, dew on the rind in the opening shot. */
  dew: number;
  /**
   * Hanging and falling before the swap, falling and resting after it, opening once its seam
   * starts.
   */
  phase: 'hanging' | 'falling' | 'resting' | 'opening';
  /**
   * The stalk it hung by, from the twig to the fruit's button. It stays on the twig. `null` if
   * there is none.
   */
  stem: {top: Vec3; bottom: Vec3; radius: number} | null;
  /** 0-1, its flattening along z at impact. */
  squash: number;
  /** Height of the land under its centre: its ground bounce is measured above this. */
  groundZ: number;
};

export type StorySeed = {
  visible: boolean;
  position: Vec3;
  /** Turns a seed whose long axis is +z and whose pointed end looks up. */
  rotation: Quat;
  /** Metres, about 0.011. */
  length: number;
  /** 0-1, the clinging bead of juice. */
  bead: number;
  /** Recent positions, oldest first, for the faint gold trail, each with a 0-1 alpha. */
  trail: {position: Vec3; alpha: number}[];
};

export type StoryPot = {
  visible: boolean;
  /** Base center. */
  position: Vec3;
  /** Metres. Pot-up changes these. */
  rimRadius: number;
  height: number;
  /** Height above the base of the soil surface, in metres. */
  soilLevel: number;
  /** 0-1, wet, dark soil. */
  soilWetness: number;
  /** A dimple at the soil's center: negative is a dent, positive a mound. Metres. */
  soilBump: number;
  soilBumpRadius: number;
  /** 0-1, soil cracked and lifted where the shoot breaks through. */
  soilCrack: number;
  /** Tumbling soil grains and the landing puff, in metres, each with a size and a 0-1 alpha. */
  grains: {position: Vec3; size: number; alpha: number}[];
  /** Fades the pot away, once it has slid off. */
  alpha: number;
};

export type StoryRootBall = {
  /** Center. */
  position: Vec3;
  /** Metres. */
  radius: number;
  height: number;
  /** 0-1, fine roots circling on its surface. */
  roots: number;
};

export type StoryNet = {
  id: number;
  /** Center at the ground of the tree it covers. */
  position: Vec3;
  /** Metres, the bag's radius and height, following the crown inside it. */
  radius: number;
  height: number;
  /** 0 high above the tree, 1 on it. */
  descent: number;
  /** Metres of slow, soft outward motion while it settles. */
  billow: number;
  /** 0-1, gathered in at the base. */
  cinch: number;
  /** 0-1, taut against a crown too big for it. */
  strain: number;
  /** 0-1, a vertical slit opening. */
  slit: number;
  /** 0-1, carried up and off on the wind. */
  lift: number;
  /** Compass bearing lift-off blows toward. */
  liftBearing: number;
};

export type StoryMicrojet = {
  position: Vec3;
  /** 0-1, stake and emitter have appeared. */
  visible: number;
  /** 0-1, spraying. */
  spray: number;
};

export type StoryLightShaft = {position: Vec3; radius: number; strength: number};

export type StoryProps = {
  orange: StoryOrange;
  seed: StorySeed;
  pot: StoryPot;
  rootBall: StoryRootBall | null;
  nets: StoryNet[];
  microjets: StoryMicrojet[];
  /**
   * Sand thrown up where the orange lands, each with a size and a 0-1 alpha, drawn in the sand's
   * colour.
   */
  puffs: {position: Vec3; size: number; alpha: number}[];
};

export type StoryTickLevel = 'day' | 'week' | 'month' | 'year' | 'fiveYears';

export type StoryTimeline = {
  /** Years at the axis's left and right ends. Grows until it is exactly 0 to 30. */
  spanStart: number;
  spanEnd: number;
  /** The current year, on the axis. */
  playhead: number;
  /** Each tick level's opacity at this zoom, 0-1. */
  tickAlpha: Record<StoryTickLevel, number>;
  /** Yield bars so far. Illustrative boxes per tree. `rise` is 0-1, as it lands. */
  bars: {year: number; boxes: number; rise: number; broken: boolean}[];
  /** Event flags reached so far, each fading in. The overlay lays them out so they never collide. */
  flags: {id: string; label: string; year: number; alpha: number}[];
  /** Large readout, for example `Day 12`, `Month 7` or `Year 12`. */
  readout: string;
  /** Under the readout, for example `Spring`. */
  subReadout: string;
  /** This year's and cumulative yield, or `null` before the first harvest. */
  yield: {thisYear: number; total: number} | null;
  /** Always 1: the overlay is on in every frame, with no fade at either end. */
  alpha: number;
  /** The roll-over from the Year 30 chart to the Day 0 axis around the swap, or `null`. */
  rollover: StoryRollover | null;
};

/**
 * The timeline rolling over: the Year 30 chart slides off to the left, joined end to end with a
 * fresh Day 0 axis.
 */
export type StoryRollover = {
  /**
   * 0-1, how far the Year 30 chart has slid left, as a share of the axis. The playhead rides the
   * join.
   */
  slide: number;
  /** Opacity of the Year 30 chart, and of the Day 0 axis joined to its right. */
  previousAlpha: number;
  nextAlpha: number;
  /**
   * 0-1, the readout's odometer, from `previous.readout` rolling out to `next.readout` rolled in.
   */
  roll: number;
  /** 0-1, the yield numbers, which go first. */
  yieldAlpha: number;
  /** The Year 30 chart as it is at the swap. */
  previous: StoryTimelineChart;
  /** The Day 0 axis: live after the swap, and as it is at the swap before it. */
  next: StoryTimelineChart;
};

/**
 * One chart of a roll-over: a timeline without a roll-over of its own, which also keeps the state's
 * type from nesting without end.
 */
export type StoryTimelineChart = Omit<StoryTimeline, 'rollover'>;

export type StoryCaption = {text: string; alpha: number} | null;

export type StoryState = {
  /** Cycle seconds, 0 up to `CYCLE_SECONDS`, as `cycle.seconds`. */
  t: number;
  /** Where this frame is in the cycle, and the clocks that run through the swap. */
  cycle: StoryCycle;
  beat: BeatId;
  /** 0-1 through this beat. */
  beatProgress: number;
  /** Fractional years since the seed. */
  year: number;
  /** Fractional part of a year, 0 = March 1, 0.25 = June, 0.5 = September, 0.75 = December. */
  season: number;
  camera: StoryCamera;
  /** Slight handheld or storm shake, in degrees added to orbit and pitch. */
  shake: [number, number];
  /** Sun or moon, whichever leads. */
  key: StoryDirectionalLight;
  /** A second light for lightning. Intensity 0 most of the time, never casts. */
  flash: StoryDirectionalLight;
  ambient: {color: Rgb; intensity: number};
  /** `LightingEffect.shadowColor`. */
  shadowColor: [number, number, number, number];
  sky: StorySky;
  fog: StoryFog;
  grade: StoryGrade;
  ground: StoryGround;
  weather: StoryWeather;
  wind: StoryWind;
  /** `TreeLayer.wetness` and `TreeLayer.frost`. */
  treeWetness: number;
  treeFrost: number;
  /**
   * Every tree that ever exists, in a fixed order, with the hero first. A tree not yet planted has
   * growth 0, which draws nothing, so row order and count never change. The array and its rows are
   * the same objects in every state, for `data`, with their numbers written in place: read them
   * before the next `getStoryState`.
   */
  trees: TreeSpec[];
  props: StoryProps;
  lightShafts: StoryLightShaft[];
  timeline: StoryTimeline;
  caption: StoryCaption;
};
