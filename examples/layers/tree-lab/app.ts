// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  COORDINATE_SYSTEM,
  Deck,
  MapController,
  MapView,
  WebMercatorViewport,
  type DeckProps,
  type MapViewState
} from '@deck.gl/core';
import {SolidPolygonLayer} from '@deck.gl/layers';
import {
  SplatLayer,
  TreeLayer,
  type Season,
  type TreeCharacteristics,
  type TreeSpec,
  type TreeType
} from '@deck.gl-community/layers';
import {
  ColumnPanel,
  CustomPanel,
  SettingsPanel,
  type SettingsState
} from '@deck.gl-community/panels';
import {BoxPanelWidget} from '@deck.gl-community/widgets';
import {
  CROWN_PROFILES,
  DEFAULT_TREE_LAB_SETTINGS,
  SETTINGS_SCHEMA,
  type TreeLabSettings
} from './settings';
import '@deck.gl/widgets/stylesheet.css';
import './style.css';

const SPECIES: TreeType[] = [
  'pine',
  'oak',
  'palm',
  'birch',
  'cherry',
  'banyan',
  'mangrove',
  'citrus'
];
const GROVE_SIDE = 100;
const GROVE_TREE_COUNT = GROVE_SIDE ** 2;
const TREES_PER_SPECIES = GROVE_TREE_COUNT / SPECIES.length;
// A compact, irregular cell field keeps crown overlap high enough to read as a grove instead of
// a plantation while still preserving a stable authored owner for every tree.
const GROVE_SPACING = 8.5;
const GROVE_GROUND_MARGIN = 8;
const GROVE_TREE_HALF_EXTENT = ((GROVE_SIDE - 1) * GROVE_SPACING) / 2;
const GROVE_HALF_EXTENT = GROVE_TREE_HALF_EXTENT + GROVE_GROUND_MARGIN;
const GROVE_EXTENT = GROVE_HALF_EXTENT * 2;
// The authored core remains exactly 10,000 trees. The first continuation owners form a dense,
// irregular apron that overlaps the core edge; the remaining owners taper outward instead of
// leaving a visibly bounded square grove surrounded by a sparse lawn.
const BACKDROP_INNER_APRON_TREE_COUNT = 2_800;
const BACKDROP_OUTER_APRON_TREE_COUNT = 2_000;
const BACKDROP_TAPER_TREE_COUNT = 1_200;
const BACKDROP_HORIZON_TREE_COUNT = 600;
const BACKDROP_INNER_APRON_SPACING = 12;
const BACKDROP_OUTER_APRON_SPACING = 23;
const BACKDROP_TAPER_SPACING = 80;
const BACKDROP_HORIZON_SPACING = 230;
const BACKDROP_INNER_APRON_INNER_DISTANCE = -55;
const BACKDROP_INNER_APRON_OUTER_DISTANCE = 180;
const BACKDROP_OUTER_APRON_INNER_DISTANCE = 60;
const BACKDROP_OUTER_APRON_OUTER_DISTANCE = 650;
const BACKDROP_TAPER_INNER_DISTANCE = 500;
const BACKDROP_TAPER_OUTER_DISTANCE = 1_800;
const BACKDROP_HORIZON_INNER_DISTANCE = 1_500;
const BACKDROP_HORIZON_OUTER_DISTANCE = 3_500;
const SCENE_HALF_EXTENT = 4_200;
const OVERVIEW_FIT = 0.72;
const HERO_PITCH = 85;
const HERO_TARGET_ELEVATION = 3.7;
// Operators can move closer than the Hero tree preset without bringing the eye through a crown.
const HERO_CLOSE_INSPECTION_ZOOM = 4.5;
const HERO_TREE_INDEX = 50 * GROVE_SIDE + 50;
// Tall palms and tangled mangroves need a clear foreground lane around the close orbit. Broadleaf
// orchard species stay in this zone, so the citrus still opens from a dense natural context.
const HERO_HABITAT_CLEAR_RADIUS_CELLS = 8;
const GROVE_EDGE_BUFFER_CELLS = 3;
const HERO_TOUR_CANOPY_PITCH = 12;
const HERO_TOUR_FINAL_PITCH = 60;

type CameraEdition = 'landscape' | 'portrait';
type TourBearingKeyframe = {
  atMs: number;
  bearing: number;
  velocityDegPerMs: number;
};
export type HeroTourProfile = {
  edition: CameraEdition;
  heroDetailWidth: number;
  heroDetailHeight: number;
  orbitDurationMs: number;
  highPitchPullbackDurationMs: number;
  pitchSettleDurationMs: number;
  canopyDriftDurationMs: number;
  finalLiftDurationMs: number;
  durationMs: number;
  finalZoomDelta: number;
  bearingKeyframes: readonly TourBearingKeyframe[];
};

// The landscape profile preserves the established framing and timing. Its bearing keyframes use
// shared physical velocities, so the camera no longer loses momentum at a phase boundary.
const LANDSCAPE_TOUR: HeroTourProfile = {
  edition: 'landscape',
  heroDetailWidth: 6.15,
  heroDetailHeight: 3.45,
  orbitDurationMs: 2_400,
  highPitchPullbackDurationMs: 5_200,
  pitchSettleDurationMs: 1_400,
  canopyDriftDurationMs: 0,
  finalLiftDurationMs: 1_800,
  durationMs: 10_800,
  finalZoomDelta: 1.1,
  bearingKeyframes: [
    {atMs: 0, bearing: 24, velocityDegPerMs: 0},
    {atMs: 2_400, bearing: 132, velocityDegPerMs: 0.018},
    {atMs: 7_600, bearing: 190, velocityDegPerMs: 0.011},
    {atMs: 9_000, bearing: 204, velocityDegPerMs: 0.009},
    {atMs: 10_800, bearing: 228, velocityDegPerMs: 0}
  ]
};

// Portrait is an intentional 9:16 editorial edition, not an accidental aspect-ratio side effect.
// It holds the citrus close enough for automatic hierarchy level zero, travels at the high horizon
// longer, settles over the canopy, drifts flat for a beat, then rises into the final portrait view.
const PORTRAIT_TOUR: HeroTourProfile = {
  edition: 'portrait',
  heroDetailWidth: 3.6,
  heroDetailHeight: 6.4,
  orbitDurationMs: 3_200,
  highPitchPullbackDurationMs: 5_800,
  pitchSettleDurationMs: 1_800,
  canopyDriftDurationMs: 800,
  finalLiftDurationMs: 2_400,
  durationMs: 14_000,
  finalZoomDelta: 1.1,
  bearingKeyframes: [
    {atMs: 0, bearing: 24, velocityDegPerMs: 0},
    {atMs: 3_200, bearing: 116, velocityDegPerMs: 0.014},
    {atMs: 9_000, bearing: 198, velocityDegPerMs: 0.009},
    {atMs: 10_800, bearing: 210, velocityDegPerMs: 0.007},
    {atMs: 11_600, bearing: 216, velocityDegPerMs: 0.006},
    {atMs: 14_000, bearing: 228, velocityDegPerMs: 0}
  ]
};

function getHeroTourProfile(edition: CameraEdition): HeroTourProfile {
  return edition === 'portrait' ? PORTRAIT_TOUR : LANDSCAPE_TOUR;
}
const GROVE_CLUMP_RADIUS_CELLS = 17;
const GROVE_CLUMP_MAX_SHIFT_CELLS = 0.65;
const GROVE_CLUMP_CENTERS: readonly (readonly [number, number])[] = [
  [17, 19],
  [39, 22],
  [70, 22],
  [21, 55],
  [74, 53],
  [31, 79],
  [66, 79]
];
const MAP_ORIGIN = new WebMercatorViewport({width: 1, height: 1});
// `distanceScales` uses MapView's 512-unit world at zoom 0. Converting its metre scale into a
// zoom lets the scene retain metre-sized trees while fitting by viewport pixels.
const METER_ZOOM = Math.log2(1 / MAP_ORIGIN.distanceScales.unitsPerMeter[0]);
const METER_COORDINATES = {
  coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
  coordinateOrigin: [0, 0, 0] as [number, number, number]
};

const GROVE_DIMENSIONS: Record<
  TreeType,
  Required<Pick<TreeSpec, 'height' | 'crownRadius' | 'trunkRadius'>>
> = {
  pine: {height: 14.5, crownRadius: 2.8, trunkRadius: 0.29},
  oak: {height: 10.5, crownRadius: 3.6, trunkRadius: 0.32},
  palm: {height: 11.5, crownRadius: 3, trunkRadius: 0.22},
  birch: {height: 9.5, crownRadius: 2.3, trunkRadius: 0.17},
  cherry: {height: 7.2, crownRadius: 3.1, trunkRadius: 0.2},
  banyan: {height: 11, crownRadius: 4.8, trunkRadius: 0.38},
  mangrove: {height: 8.5, crownRadius: 3.5, trunkRadius: 0.25},
  citrus: {height: 5.6, crownRadius: 2.5, trunkRadius: 0.16}
};

// These are deliberately a tiny shared palette, not per-tree random traits. TreeLayer groups
// template work by morphology key, so two repeatable shapes plus dimensional variation keep the
// grove organic without turning 10,000 instances into 10,000 templates. The second profile is
// the denser citrus crown used by the hero tree.
const GROVE_MORPHOLOGY_PROFILES: readonly TreeCharacteristics[] = [
  {
    seed: 19,
    crownSpread: 0.94,
    crownDepth: 0.94,
    crownAsymmetry: 0.78,
    branchDensity: 0.92,
    branchLift: 1.08,
    internodeLength: 1.06,
    leafSize: 0.94,
    leafDensity: 0.92
  },
  {
    seed: 73,
    crownSpread: 1.1,
    crownDepth: 1.08,
    crownAsymmetry: 1.2,
    branchDensity: 1.12,
    branchLift: 0.91,
    internodeLength: 0.95,
    leafSize: 1.04,
    leafDensity: 1.16
  }
];

const SEASON_GROUND_COLORS: Record<Season, [number, number, number]> = {
  spring: [209, 224, 197],
  summer: [193, 214, 184],
  autumn: [222, 204, 170],
  winter: [223, 231, 230]
};

type CameraPreset = 'hero' | 'overview';

type GroveCell = {
  index: number;
  column: number;
  row: number;
  x: number;
  y: number;
  edgeDistance: number;
};

function getGroveVariation(index: number, salt: number): number {
  let value = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getGroveClumpWarp(
  cell: Pick<GroveCell, 'column' | 'row' | 'edgeDistance'>
): [number, number] {
  // The outer collar and the hero's close-orbit corridor must stay quiet. Everywhere else, a
  // bounded radial field gently compresses a few pockets and leaves breathing room between them.
  // This makes visible density clusters without changing logical owners/counts.
  const heroColumn = HERO_TREE_INDEX % GROVE_SIDE;
  const heroRow = Math.floor(HERO_TREE_INDEX / GROVE_SIDE);
  const edgeTaper = clamp((cell.edgeDistance - GROVE_EDGE_BUFFER_CELLS) / 7, 0, 1);
  const heroDistance = Math.hypot(cell.column - heroColumn, cell.row - heroRow);
  const heroTaper = clamp((heroDistance - HERO_HABITAT_CLEAR_RADIUS_CELLS) / 8, 0, 1);
  let shiftColumn = 0;
  let shiftRow = 0;
  for (const [centerColumn, centerRow] of GROVE_CLUMP_CENTERS) {
    const deltaColumn = centerColumn - cell.column;
    const deltaRow = centerRow - cell.row;
    const distance = Math.hypot(deltaColumn, deltaRow);
    if (distance >= GROVE_CLUMP_RADIUS_CELLS) continue;
    const normalizedDistance = distance / GROVE_CLUMP_RADIUS_CELLS;
    const attraction = 0.13 * (1 - normalizedDistance ** 2) ** 2;
    shiftColumn += deltaColumn * attraction;
    shiftRow += deltaRow * attraction;
  }
  const shiftLength = Math.hypot(shiftColumn, shiftRow);
  if (shiftLength > GROVE_CLUMP_MAX_SHIFT_CELLS) {
    const scale = GROVE_CLUMP_MAX_SHIFT_CELLS / shiftLength;
    shiftColumn *= scale;
    shiftRow *= scale;
  }
  const taper = edgeTaper * heroTaper * GROVE_SPACING;
  return [shiftColumn * taper, shiftRow * taper];
}

let groveCells: GroveCell[] | undefined;
let groveTrees: TreeSpec[] | undefined;
let backdropTrees: TreeSpec[] | undefined;
let forestTrees: TreeSpec[] | undefined;

function getGroveCells(): GroveCell[] {
  groveCells ??= Array.from({length: GROVE_TREE_COUNT}, (_, index) => {
    const column = index % GROVE_SIDE;
    const row = Math.floor(index / GROVE_SIDE);
    // Low-frequency drift disrupts global rows while modest local jitter retains a dense,
    // stable field rather than allowing arbitrary tree collisions on every render.
    const driftX =
      Math.sin(row * 0.31 + column * 0.08) * 2.3 +
      Math.cos(row * 0.11 - column * 0.17) * 1.2 +
      (getGroveVariation(index, 2) - 0.5) * 3.6;
    const driftY =
      Math.cos(column * 0.29 - row * 0.09) * 2.2 +
      Math.sin(column * 0.14 + row * 0.19) * 1.3 +
      (getGroveVariation(index, 3) - 0.5) * 3.6;
    const cell = {
      index,
      column,
      row,
      x: 0,
      y: 0,
      edgeDistance: Math.min(column, row, GROVE_SIDE - 1 - column, GROVE_SIDE - 1 - row)
    };
    const [clumpX, clumpY] = getGroveClumpWarp(cell);
    return {
      ...cell,
      x: (column - (GROVE_SIDE - 1) / 2) * GROVE_SPACING + driftX + clumpX,
      y: (row - (GROVE_SIDE - 1) / 2) * GROVE_SPACING + driftY + clumpY
    };
  });
  return groveCells;
}

function assignSpecies(
  cells: readonly GroveCell[],
  assignments: (TreeType | undefined)[],
  species: TreeType,
  count: number,
  getScore: (cell: GroveCell) => number,
  isEligible: (cell: GroveCell) => boolean = () => true
): void {
  const candidates = cells
    .filter(cell => assignments[cell.index] === undefined && isEligible(cell))
    .sort((a, b) => getScore(b) - getScore(a) || a.index - b.index);
  if (candidates.length < count) {
    throw new Error(`Could not place ${count} ${species} trees in the grove.`);
  }
  for (let index = 0; index < count; index++) {
    assignments[candidates[index]!.index] = species;
  }
}

function hasHeroHabitatClearance(cell: GroveCell): boolean {
  const heroColumn = HERO_TREE_INDEX % GROVE_SIDE;
  const heroRow = Math.floor(HERO_TREE_INDEX / GROVE_SIDE);
  return (
    Math.hypot(cell.column - heroColumn, cell.row - heroRow) >= HERO_HABITAT_CLEAR_RADIUS_CELLS
  );
}

function getClusterScore(
  cell: GroveCell,
  centers: readonly (readonly [number, number])[],
  radius: number
): number {
  const nearest = Math.min(
    ...centers.map(([column, row]) => Math.hypot(cell.column - column, cell.row - row))
  );
  return Math.max(0, 1 - nearest / radius);
}

function getInteriorClusterScore(
  cell: GroveCell,
  centers: readonly (readonly [number, number])[],
  radius: number,
  salt: number
): number {
  const interior = Math.min(1, cell.edgeDistance / 14);
  return (
    getClusterScore(cell, centers, radius) * 1.5 +
    interior * 0.35 +
    getGroveVariation(cell.index, salt) * 0.2
  );
}

function getScatteredHabitatScore(cell: GroveCell, salt: number, edgeBias: number): number {
  const edge = 1 - Math.min(1, cell.edgeDistance / 28);
  const gentleBands =
    (Math.sin(cell.column * 0.43 + cell.row * 0.17) +
      Math.cos(cell.column * 0.19 - cell.row * 0.37) +
      2) /
    4;
  return getGroveVariation(cell.index, salt) * 0.78 + edge * edgeBias + gentleBands * 0.08;
}

function getGroveSpecies(cells: readonly GroveCell[]): TreeType[] {
  const assignments: (TreeType | undefined)[] = Array(GROVE_TREE_COUNT);
  // The hero is reserved before habitat placement, guaranteeing it stays within the citrus grove.
  assignments[HERO_TREE_INDEX] = 'citrus';
  // Pines have a gentle edge affinity but no continuous plantation-like windbreak. The
  // continuation field can therefore dissolve the 10k core into its surroundings without
  // revealing a geometric inner border from the elevated tour view.
  assignSpecies(cells, assignments, 'pine', TREES_PER_SPECIES, cell =>
    getScatteredHabitatScore(cell, 11, 0.24)
  );
  // Palms and mangroves are spatially dispersed, with only a gentle edge affinity. Their
  // independent hashes prevent a grid-aligned plantation block.
  assignSpecies(
    cells,
    assignments,
    'mangrove',
    TREES_PER_SPECIES,
    cell => getScatteredHabitatScore(cell, 17, 0.16),
    hasHeroHabitatClearance
  );
  assignSpecies(
    cells,
    assignments,
    'palm',
    TREES_PER_SPECIES,
    cell => getScatteredHabitatScore(cell, 23, 0.1),
    hasHeroHabitatClearance
  );
  // The interior species form overlapping, softened clusters rather than hard rectangular lots.
  assignSpecies(cells, assignments, 'citrus', TREES_PER_SPECIES - 1, cell =>
    getInteriorClusterScore(
      cell,
      [
        [50, 50],
        [34, 43],
        [64, 61],
        [45, 72]
      ],
      22,
      29
    )
  );
  assignSpecies(cells, assignments, 'cherry', TREES_PER_SPECIES, cell =>
    getInteriorClusterScore(
      cell,
      [
        [35, 27],
        [63, 33],
        [29, 68],
        [66, 74]
      ],
      20,
      31
    )
  );
  assignSpecies(cells, assignments, 'oak', TREES_PER_SPECIES, cell =>
    getInteriorClusterScore(
      cell,
      [
        [25, 46],
        [57, 25],
        [71, 52],
        [49, 72]
      ],
      24,
      37
    )
  );
  assignSpecies(cells, assignments, 'banyan', TREES_PER_SPECIES, cell =>
    getInteriorClusterScore(
      cell,
      [
        [43, 32],
        [61, 57],
        [37, 66]
      ],
      19,
      41
    )
  );
  assignSpecies(cells, assignments, 'birch', TREES_PER_SPECIES, cell =>
    getInteriorClusterScore(
      cell,
      [
        [27, 35],
        [52, 47],
        [73, 69]
      ],
      26,
      43
    )
  );
  const counts = new Map<TreeType, number>(SPECIES.map(species => [species, 0] as const));
  for (const species of assignments as TreeType[]) {
    counts.set(species, (counts.get(species) ?? 0) + 1);
  }
  if (!SPECIES.every(species => counts.get(species) === TREES_PER_SPECIES)) {
    throw new Error('The grove must keep an equal inventory of every supported species.');
  }
  return assignments as TreeType[];
}

function getTreeCharacteristics(
  variation: TreeCharacteristics | undefined,
  controls: TreeCharacteristics
): TreeCharacteristics {
  const multiply = (key: Exclude<keyof TreeCharacteristics, 'seed'>) =>
    Math.round((variation?.[key] ?? 1) * (controls[key] ?? 1) * 100) / 100;
  return {
    seed: variation?.seed,
    crownSpread: multiply('crownSpread'),
    crownDepth: multiply('crownDepth'),
    crownAsymmetry: multiply('crownAsymmetry'),
    branchDensity: multiply('branchDensity'),
    branchLift: multiply('branchLift'),
    internodeLength: multiply('internodeLength'),
    leafSize: multiply('leafSize'),
    leafDensity: multiply('leafDensity')
  };
}

function getGroveTrees(): TreeSpec[] {
  groveTrees ??= (() => {
    const cells = getGroveCells();
    const speciesByIndex = getGroveSpecies(cells);
    return cells.map(cell => {
      const {index} = cell;
      const species = speciesByIndex[index]!;
      const dimensions = GROVE_DIMENSIONS[species];
      const isHero = index === HERO_TREE_INDEX;
      const size = isHero ? 1.25 : 0.82 + getGroveVariation(index, 1) * 0.38;
      const morphology = isHero
        ? GROVE_MORPHOLOGY_PROFILES[1]!
        : GROVE_MORPHOLOGY_PROFILES[getGroveVariation(index, 5) < 0.5 ? 0 : 1]!;
      return {
        position: [cell.x, cell.y, 0],
        species,
        height: dimensions.height * size,
        crownRadius: dimensions.crownRadius * size,
        trunkRadius: dimensions.trunkRadius * size * (0.88 + getGroveVariation(index, 7) * 0.25),
        trunkHeightFraction:
          species === 'palm' ? 0.68 + getGroveVariation(index, 8) * 0.1 : undefined,
        branchLevels: species === 'pine' ? 3 + Math.floor(getGroveVariation(index, 4) * 3) : 3,
        characteristics: morphology,
        // Fruit is deliberately limited to the focal citrus. It makes the close orbit legible
        // without turning the 10,000-tree overview into a crop-mesh workload. Wind is left to the
        // layer's `windStrength` control.
        crop: isHero
          ? {kind: 'fruit' as const, color: [244, 153, 34, 255], count: 88, radius: 0.085}
          : undefined,
        season: 'summer'
      };
    });
  })();
  return groveTrees;
}

type ContinuationBand = {
  count: number;
  spacing: number;
  minDistance: number;
  maxDistance: number;
  indexOffset: number;
  salt: number;
};

type ContinuationCell = {
  index: number;
  x: number;
  y: number;
  priority: number;
};

function getContinuationEdgeWarp(x: number, y: number, salt: number): number {
  // The core is still a deliberately authored 100-by-100 field, but continuation density needs
  // to cross its edge without drawing a second, perfect square around it. This bounded field
  // disrupts the rounded-square contour while retaining an even all-sides forest apron.
  const angle = Math.atan2(y, x);
  return (
    Math.sin(x * 0.012 + y * 0.008 + salt) * 18 +
    Math.cos(x * 0.007 - y * 0.015 + salt * 0.7) * 12 +
    Math.sin(angle * 5 + salt * 0.1) * 8
  );
}

function getRoundedSquareDistance(x: number, y: number): number {
  const qx = Math.abs(x) - GROVE_TREE_HALF_EXTENT;
  const qy = Math.abs(y) - GROVE_TREE_HALF_EXTENT;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}

function getContinuationDistance(x: number, y: number, salt: number): number {
  return getRoundedSquareDistance(x, y) - getContinuationEdgeWarp(x, y, salt);
}

function getContinuationBand({
  count,
  spacing,
  minDistance,
  maxDistance,
  indexOffset,
  salt
}: ContinuationBand): ContinuationCell[] {
  const extent = GROVE_TREE_HALF_EXTENT + maxDistance + 48;
  const columnRadius = Math.ceil(extent / spacing);
  const rowSpacing = spacing * (Math.sqrt(3) / 2);
  const rowRadius = Math.ceil(extent / rowSpacing);
  const side = columnRadius * 2 + 1;
  const candidates: ContinuationCell[] = [];
  for (let row = -rowRadius; row <= rowRadius; row++) {
    for (let column = -columnRadius; column <= columnRadius; column++) {
      // A staggered, softly jittered lattice supplies even coverage without letting the lower
      // density continuation read as a line of planted rows.
      const baseX = (column + (row & 1 ? 0.5 : 0)) * spacing;
      const baseY = row * rowSpacing;
      const index = indexOffset + (row + rowRadius) * side + column + columnRadius;
      const x = baseX + (getGroveVariation(index, salt) - 0.5) * spacing * 0.58;
      const y = baseY + (getGroveVariation(index, salt + 1) - 0.5) * spacing * 0.58;
      const distance = getContinuationDistance(x, y, salt);
      if (distance < minDistance || distance > maxDistance) continue;
      const clumpScore =
        (Math.sin(x * 0.012 + y * 0.007 + salt) + Math.cos(x * 0.006 - y * 0.014 - salt)) * 0.5;
      candidates.push({
        index,
        x,
        y,
        priority: getGroveVariation(index, salt + 2) - clumpScore * 0.18
      });
    }
  }
  if (candidates.length < count) {
    throw new Error(`Could not place ${count} continuation trees around the grove.`);
  }
  return candidates.sort((a, b) => a.priority - b.priority || a.index - b.index).slice(0, count);
}

function getBackdropTrees(): TreeSpec[] {
  backdropTrees ??= (() => {
    const cells = [
      ...getContinuationBand({
        count: BACKDROP_INNER_APRON_TREE_COUNT,
        spacing: BACKDROP_INNER_APRON_SPACING,
        minDistance: BACKDROP_INNER_APRON_INNER_DISTANCE,
        maxDistance: BACKDROP_INNER_APRON_OUTER_DISTANCE,
        indexOffset: GROVE_TREE_COUNT,
        salt: 47
      }),
      ...getContinuationBand({
        count: BACKDROP_OUTER_APRON_TREE_COUNT,
        spacing: BACKDROP_OUTER_APRON_SPACING,
        minDistance: BACKDROP_OUTER_APRON_INNER_DISTANCE,
        maxDistance: BACKDROP_OUTER_APRON_OUTER_DISTANCE,
        indexOffset: GROVE_TREE_COUNT + 100_000,
        salt: 59
      }),
      ...getContinuationBand({
        count: BACKDROP_TAPER_TREE_COUNT,
        spacing: BACKDROP_TAPER_SPACING,
        minDistance: BACKDROP_TAPER_INNER_DISTANCE,
        maxDistance: BACKDROP_TAPER_OUTER_DISTANCE,
        indexOffset: GROVE_TREE_COUNT + 200_000,
        salt: 71
      }),
      ...getContinuationBand({
        count: BACKDROP_HORIZON_TREE_COUNT,
        spacing: BACKDROP_HORIZON_SPACING,
        minDistance: BACKDROP_HORIZON_INNER_DISTANCE,
        maxDistance: BACKDROP_HORIZON_OUTER_DISTANCE,
        indexOffset: GROVE_TREE_COUNT + 300_000,
        salt: 83
      })
    ];
    return cells.map(cell => {
      const species = SPECIES[Math.floor(getGroveVariation(cell.index, 61) * SPECIES.length)]!;
      const dimensions = GROVE_DIMENSIONS[species];
      const size = 0.82 + getGroveVariation(cell.index, 67) * 0.38;
      return {
        position: [cell.x, cell.y, 0],
        species,
        height: dimensions.height * size,
        crownRadius: dimensions.crownRadius * size,
        trunkRadius:
          dimensions.trunkRadius * size * (0.88 + getGroveVariation(cell.index, 71) * 0.25),
        trunkHeightFraction:
          species === 'palm' ? 0.68 + getGroveVariation(cell.index, 73) * 0.1 : undefined,
        branchLevels:
          species === 'pine' ? 3 + Math.floor(getGroveVariation(cell.index, 79) * 3) : 3,
        characteristics:
          GROVE_MORPHOLOGY_PROFILES[getGroveVariation(cell.index, 83) < 0.5 ? 0 : 1]!,
        season: 'summer'
      };
    });
  })();
  return backdropTrees;
}

/** Return the deterministic 10,000-tree core and 6,600-owner continuation forest. */
export function getTreeLabForest(): TreeSpec[] {
  forestTrees ??= [...getGroveTrees(), ...getBackdropTrees()];
  return forestTrees;
}

function getSceneView(): MapView {
  // MapView keeps familiar map controls. A small near plane preserves close canopy inspection
  // without feeding camera state into SplatLayer's independent canopy allocator. Its explicit
  // altitude narrows the perspective FOV enough for the eye-level hero citrus to remain tight.
  return new MapView({id: 'trees', nearZMultiplier: 0.02, altitude: 3});
}

function getMapCenter(x: number, y: number): Pick<MapViewState, 'longitude' | 'latitude'> {
  const [longitude, latitude] = MAP_ORIGIN.addMetersToLngLat([0, 0], [x, y]);
  return {longitude, latitude};
}

function getMapZoom(
  container: HTMLElement,
  widthMeters: number,
  heightMeters: number,
  fit = 1
): number {
  const pixelsPerMeter =
    fit *
    Math.min(
      Math.max(1, container.clientWidth) / widthMeters,
      Math.max(1, container.clientHeight) / heightMeters
    );
  return METER_ZOOM + Math.log2(Math.max(0.01, pixelsPerMeter));
}

function getCameraPreset(
  container: HTMLElement,
  preset: CameraPreset,
  tour: HeroTourProfile = LANDSCAPE_TOUR
): MapViewState {
  const overviewZoom = getMapZoom(container, GROVE_EXTENT, GROVE_EXTENT, OVERVIEW_FIT);
  const heroZoom = getMapZoom(container, tour.heroDetailWidth, tour.heroDetailHeight);
  const [heroX, heroY] = getGroveTrees()[HERO_TREE_INDEX]!.position as [number, number, number];
  return {
    ...getMapCenter(preset === 'hero' ? heroX : 0, preset === 'hero' ? heroY : 0),
    position: [0, 0, preset === 'hero' ? HERO_TARGET_ELEVATION : 3],
    // The explicit camera altitude keeps this near-eye-level pitch telephoto rather than a broad
    // fisheye-like ground span. It is deliberately much lower than the whole-grove overview.
    pitch: preset === 'hero' ? HERO_PITCH : 46,
    bearing: preset === 'hero' ? 24 : 18,
    zoom: preset === 'hero' ? heroZoom : overviewZoom,
    minZoom: overviewZoom - 0.7,
    maxZoom: heroZoom + HERO_CLOSE_INSPECTION_ZOOM,
    minPitch: 0,
    maxPitch: 85
  };
}

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function interpolate(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

// A quintic Hermite segment matches position, physical velocity, and zero acceleration at both
// ends. Adjacent segments therefore carry the orbit through each edit point without a perceptible
// bearing hitch while the zero acceleration keeps the handoff filmic rather than mechanical.
function interpolateQuinticHermite(
  start: number,
  end: number,
  startVelocityDegPerMs: number,
  endVelocityDegPerMs: number,
  durationMs: number,
  t: number
): number {
  const progress = clamp(t, 0, 1);
  const t2 = progress * progress;
  const t3 = t2 * progress;
  const t4 = t3 * progress;
  const t5 = t4 * progress;
  const delta = end - start;
  const startTangent = startVelocityDegPerMs * durationMs;
  const endTangent = endVelocityDegPerMs * durationMs;
  return (
    start +
    startTangent * progress +
    (10 * delta - 6 * startTangent - 4 * endTangent) * t3 +
    (-15 * delta + 8 * startTangent + 7 * endTangent) * t4 +
    (6 * delta - 3 * startTangent - 3 * endTangent) * t5
  );
}

function getTourBearing(tour: HeroTourProfile, elapsedMs: number): number {
  const keyframes = tour.bearingKeyframes;
  for (let index = 1; index < keyframes.length; index++) {
    const start = keyframes[index - 1]!;
    const end = keyframes[index]!;
    if (elapsedMs <= end.atMs) {
      const durationMs = end.atMs - start.atMs;
      return interpolateQuinticHermite(
        start.bearing,
        end.bearing,
        start.velocityDegPerMs,
        end.velocityDegPerMs,
        durationMs,
        (elapsedMs - start.atMs) / durationMs
      );
    }
  }
  return keyframes[keyframes.length - 1]!.bearing;
}

export function getHeroTourView(
  container: HTMLElement,
  elapsedMs: number,
  tour: HeroTourProfile = LANDSCAPE_TOUR
): MapViewState {
  const time = clamp(elapsedMs, 0, tour.durationMs);
  const hero = getCameraPreset(container, 'hero', tour);
  const overview = getCameraPreset(container, 'overview', tour);
  const canopyElapsedMs = time - tour.orbitDurationMs;
  const canopyPullbackDurationMs =
    tour.highPitchPullbackDurationMs + tour.pitchSettleDurationMs + tour.canopyDriftDurationMs;
  const canopyProgress = clamp(canopyElapsedMs / canopyPullbackDurationMs, 0, 1);
  const revealProgress = smootherstep(canopyProgress);
  const highPitchEndMs = tour.orbitDurationMs + tour.highPitchPullbackDurationMs;
  const pitchSettleEndMs = highPitchEndMs + tour.pitchSettleDurationMs;
  const finalLiftStartMs = pitchSettleEndMs + tour.canopyDriftDurationMs;
  const finalLiftProgress = smootherstep(
    clamp((time - finalLiftStartMs) / tour.finalLiftDurationMs, 0, 1)
  );
  const pitchSettleProgress = smootherstep(
    clamp((time - highPitchEndMs) / tour.pitchSettleDurationMs, 0, 1)
  );
  const pitch =
    time <= highPitchEndMs
      ? HERO_PITCH
      : time <= pitchSettleEndMs
        ? interpolate(HERO_PITCH, HERO_TOUR_CANOPY_PITCH, pitchSettleProgress)
        : time <= finalLiftStartMs
          ? HERO_TOUR_CANOPY_PITCH
          : interpolate(HERO_TOUR_CANOPY_PITCH, HERO_TOUR_FINAL_PITCH, finalLiftProgress);

  return {
    ...hero,
    longitude: interpolate(hero.longitude!, overview.longitude!, revealProgress),
    latitude: interpolate(hero.latitude!, overview.latitude!, revealProgress),
    zoom: interpolate(hero.zoom!, overview.zoom! + tour.finalZoomDelta, revealProgress),
    position: [0, 0, interpolate(HERO_TARGET_ELEVATION, overview.position![2]!, revealProgress)],
    pitch,
    bearing: getTourBearing(tour, time)
  };
}

type MountOptions = Pick<
  DeckProps<MapView>,
  'device' | 'initialViewState' | 'widgets' | 'onViewStateChange'
> & {
  // The standalone demo always uses the authored forest. Browser tests may supply a compact,
  // representative fixture when they are verifying camera/UI mechanics rather than forest scale.
  data?: TreeSpec[];
  onDeckInitialized?: (deck: Deck<MapView>) => void;
};

// This stays private to the mounted demo. The deterministic capture harness sends a DOM event
// because Deck is intentionally not exposed on the standalone page. It records just enough
// state to prove the opening owner is using automatic hierarchy selection. Its rendered level
// may vary with the device-aware automatic splat budget.
type HeroSplatInspection = {
  hero: {index: number; species: TreeType | null};
  automatic: boolean;
  view: {zoom: number | null; pitch: number | null; targetElevation: number | null};
  wood: {near: number; far: number};
  candidate: {requestedLevel: number; pixels: number; focus: number | null} | null;
  hierarchyLevels: number;
  dominant: number | null;
  weights: number[];
  settled: boolean;
};
type HeroSplatInspectionDetail = {inspection?: HeroSplatInspection};

/** Mount a 10,000-tree authored core and deterministic continuation forest using TreeLayer. */
export function mountTreeLabExample(
  container: HTMLElement,
  options: MountOptions = {}
): () => void {
  const {data: suppliedData, onDeckInitialized, widgets = [], ...deckOptions} = options;
  const params = new URLSearchParams(container.ownerDocument.defaultView?.location.search);
  const edition: CameraEdition = params.get('edition') === 'portrait' ? 'portrait' : 'landscape';
  const tour = getHeroTourProfile(edition);
  const forest = suppliedData ?? getTreeLabForest();
  let settings = DEFAULT_TREE_LAB_SETTINGS;
  let crownKey = '';
  let crownCharacteristics: TreeCharacteristics = {};
  let cameraPreset: CameraPreset = 'hero';
  let currentViewState: MapViewState | undefined;
  let tourFrame: number | undefined;
  let tourGeneration = 0;
  let touring = false;
  let destroyed = false;
  const root = container.ownerDocument.createElement('div');
  root.className = 'trees-demo';
  root.dataset.edition = edition;
  root.innerHTML = '<div class="trees-stage"></div>';
  container.append(root);
  const stage = root.querySelector<HTMLDivElement>('.trees-stage')!;
  // Keep one characteristics object per crown setting so unrelated controls, such as wind or the
  // splat budget, update TreeLayer without regenerating any tree templates.
  const getCrownCharacteristics = (): TreeCharacteristics => {
    const {crownProfile, crownSpread, leafSize, leafDensity} = settings;
    const key = [crownProfile, crownSpread, leafSize, leafDensity].join();
    if (key !== crownKey) {
      crownKey = key;
      crownCharacteristics = {
        ...CROWN_PROFILES[crownProfile]!.characteristics,
        crownSpread,
        leafSize,
        leafDensity
      };
    }
    return crownCharacteristics;
  };
  // The camera buttons live in the settings widget, which may render after this function returns.
  const setControlState = () => {
    root.dataset.season = settings.season;
    root.querySelectorAll<HTMLButtonElement>('[data-camera-preset]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.cameraPreset === cameraPreset));
    });
    const playTour = root.querySelector<HTMLButtonElement>('[name="play-tour"]');
    if (playTour) {
      playTour.textContent = touring ? 'Stop tour' : 'Play hero tour';
      playTour.setAttribute('aria-pressed', String(touring));
    }
  };
  const renderCameraControls = (element: HTMLElement) => {
    element.innerHTML = `
      <button type="button" data-camera-preset="hero" aria-pressed="true">Hero citrus</button>
      <button type="button" data-camera-preset="overview" aria-pressed="false">Whole forest</button>
      <button name="play-tour" type="button" data-tour-edition="${edition}" data-tour-duration-ms="${tour.durationMs}" data-tour-orbit-ms="${tour.orbitDurationMs}" data-tour-canopy-pullback-ms="${tour.highPitchPullbackDurationMs + tour.pitchSettleDurationMs + tour.canopyDriftDurationMs}" data-tour-high-pitch-pullback-ms="${tour.highPitchPullbackDurationMs}" data-tour-canopy-pitch-settle-ms="${tour.pitchSettleDurationMs}" data-tour-canopy-drift-ms="${tour.canopyDriftDurationMs}" data-tour-final-lift-ms="${tour.finalLiftDurationMs}" aria-pressed="false">Play hero tour</button>
      <button name="reset-view" type="button">Reset camera</button>`;
    const onClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement).closest('button');
      if (button?.dataset.cameraPreset) {
        selectCameraPreset(button.dataset.cameraPreset as CameraPreset);
      } else if (button?.name === 'play-tour') {
        if (touring) stopTour();
        else startTour();
      } else if (button?.name === 'reset-view') {
        selectCameraPreset(cameraPreset);
      }
    };
    element.addEventListener('click', onClick);
    setControlState();
    return () => element.removeEventListener('click', onClick);
  };
  const controls = new BoxPanelWidget({
    id: 'tree-lab-controls',
    title: 'TreeLayer',
    placement: 'top-left',
    widthPx: 320,
    collapsible: true,
    defaultOpen: container.clientWidth >= 600,
    panel: new ColumnPanel({
      id: 'tree-lab-panels',
      title: '',
      panels: [
        new CustomPanel({
          id: 'tree-lab-camera',
          title: 'Camera',
          className: 'trees-camera',
          onRenderHTML: renderCameraControls
        }),
        new SettingsPanel({
          id: 'tree-lab-settings',
          label: '',
          schema: SETTINGS_SCHEMA,
          settings: settings as unknown as SettingsState,
          onSettingsChange: nextSettings => {
            settings = nextSettings as unknown as TreeLabSettings;
            stopTour();
            render();
          }
        })
      ]
    })
  });
  setControlState();
  const initialViewState =
    (options.initialViewState as MapViewState | undefined) ??
    getCameraPreset(stage, cameraPreset, tour);
  currentViewState = initialViewState;
  const deck = new Deck<MapView>({
    ...deckOptions,
    parent: stage,
    widgets: [...widgets, controls],
    views: getSceneView(),
    initialViewState,
    controller: {
      type: MapController,
      dragMode: 'pan',
      dragPan: true,
      dragRotate: true,
      inertia: 150,
      scrollZoom: {speed: 0.02, smooth: false},
      doubleClickZoom: true,
      zoomAround: 'pointer',
      touchRotate: true
    },
    useDevicePixels: 1,
    getTooltip: ({object}) => object?.species ?? null,
    onViewStateChange: params => {
      const nextViewState = options.onViewStateChange?.(params);
      currentViewState = (nextViewState ?? params.viewState) as MapViewState;
      return nextViewState;
    }
  });
  onDeckInitialized?.(deck);

  const stopTour = (freezeCamera = true) => {
    if (!touring && tourFrame === undefined) return;
    touring = false;
    tourGeneration++;
    if (tourFrame !== undefined) {
      container.ownerDocument.defaultView?.cancelAnimationFrame(tourFrame);
      tourFrame = undefined;
    }
    if (freezeCamera && currentViewState && !destroyed) {
      deck.setProps({initialViewState: {...currentViewState, transitionDuration: 0}});
    }
    setControlState();
  };
  const resetCamera = () => {
    deck.setProps({initialViewState: null});
    const preset = getCameraPreset(stage, cameraPreset, tour);
    currentViewState = preset;
    deck.setProps({initialViewState: preset});
  };
  const selectCameraPreset = (preset: CameraPreset) => {
    stopTour();
    cameraPreset = preset;
    setControlState();
    resetCamera();
  };
  const render = () => {
    const {season, windStrength, maxCanopySplats, maxCanopyPixels, foveationStrength} = settings;
    const characteristics = getCrownCharacteristics();
    root.dataset.season = season;
    deck.setProps({
      layers: [
        new SolidPolygonLayer({
          id: 'ground',
          ...METER_COORDINATES,
          data: [
            [
              [-SCENE_HALF_EXTENT, -SCENE_HALF_EXTENT, -0.02],
              [SCENE_HALF_EXTENT, -SCENE_HALF_EXTENT, -0.02],
              [SCENE_HALF_EXTENT, SCENE_HALF_EXTENT, -0.02],
              [-SCENE_HALF_EXTENT, SCENE_HALF_EXTENT, -0.02]
            ]
          ],
          getPolygon: polygon => polygon,
          getFillColor: SEASON_GROUND_COLORS[season],
          shadowEnabled: false
        }),
        new TreeLayer<TreeSpec>({
          id: 'trees',
          data: forest,
          ...METER_COORDINATES,
          // The two finite authored morphology profiles are multiplied by the UI controls, so
          // changing a shared control preserves natural per-tree variation without template churn.
          getTree: tree => ({
            ...tree,
            season,
            characteristics: getTreeCharacteristics(tree.characteristics, characteristics)
          }),
          windStrength,
          maxCanopySplats,
          maxCanopyPixels,
          foveationStrength,
          pickable: true,
          updateTriggers: {getTree: [season, characteristics]}
        })
      ]
    });
  };
  const setTourTime = (elapsedMs: number) => {
    const viewState = getHeroTourView(stage, elapsedMs, tour);
    currentViewState = viewState;
    deck.setProps({initialViewState: {...viewState, transitionDuration: 0}});
  };
  const startTour = () => {
    stopTour();
    cameraPreset = 'hero';
    setControlState();
    resetCamera();
    touring = true;
    const generation = ++tourGeneration;
    setControlState();
    // One clock owns the orbit, pullback, and pitch so the camera cannot stall at a transition
    // boundary. The same time-addressable path is available to capture tooling below.
    tourFrame = container.ownerDocument.defaultView?.requestAnimationFrame(startedAt => {
      tourFrame = undefined;
      if (!touring || generation !== tourGeneration) return;
      const animate = (now: number) => {
        if (!touring || generation !== tourGeneration) return;
        const elapsedMs = Math.min(now - startedAt, tour.durationMs);
        setTourTime(elapsedMs);
        if (elapsedMs < tour.durationMs) {
          tourFrame = container.ownerDocument.defaultView?.requestAnimationFrame(animate);
          return;
        }
        cameraPreset = 'overview';
        touring = false;
        setControlState();
      };
      setTourTime(0);
      tourFrame = container.ownerDocument.defaultView?.requestAnimationFrame(animate);
    });
  };
  const cancelTourOnInteraction = () => stopTour();
  const seekTour = (event: Event) => {
    const elapsedMs = (event as CustomEvent<{elapsedMs?: unknown}>).detail?.elapsedMs;
    if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs)) return;
    stopTour(false);
    setTourTime(clamp(elapsedMs, 0, tour.durationMs));
  };
  const inspectHeroSplat = (event: Event) => {
    const detail = (event as CustomEvent<HeroSplatInspectionDetail>).detail;
    if (!detail) return;
    const heroTree = getGroveTrees()[HERO_TREE_INDEX]!;
    const findTreeLayer = (layers: unknown): TreeLayer<TreeSpec> | undefined => {
      if (layers instanceof TreeLayer) return layers;
      if (Array.isArray(layers))
        for (const layer of layers) {
          const treeLayer = findTreeLayer(layer);
          if (treeLayer) return treeLayer;
        }
      return undefined;
    };
    const treeLayer = findTreeLayer(deck.props.layers);
    const wood = treeLayer
      ?.getSubLayers()
      .filter(layer => (layer.constructor as {layerName?: string}).layerName === 'TreeWoodLayer')
      .reduce(
        (total, layer) => {
          const state = layer.state as {near?: unknown[]; far?: unknown[]};
          total.near += state.near?.length ?? 0;
          total.far += state.far?.length ?? 0;
          return total;
        },
        {near: 0, far: 0}
      ) ?? {near: 0, far: 0};
    const canopy = treeLayer
      ?.getSubLayers()
      .filter((layer): layer is SplatLayer<{object: TreeSpec}> => layer instanceof SplatLayer)
      .find(layer => layer.state.owners.some(owner => owner.row.object.object === heroTree));
    const owner = canopy?.state.owners.find(owner => owner.row.object.object === heroTree);
    const candidate = canopy?.state.candidates.find(candidate => candidate.owner === owner);
    const refinement = owner ? canopy?.state.refinement.entries.get(owner.key) : undefined;
    detail.inspection = {
      hero: {index: HERO_TREE_INDEX, species: heroTree.species ?? null},
      automatic: treeLayer?.props.maxCanopySplats === 'auto',
      view: {
        zoom: currentViewState?.zoom ?? null,
        pitch: currentViewState?.pitch ?? null,
        targetElevation: currentViewState?.position?.[2] ?? null
      },
      wood,
      candidate: candidate
        ? {
            requestedLevel: candidate.level,
            pixels: candidate.pixels,
            focus: candidate.focus ?? null
          }
        : null,
      hierarchyLevels: owner?.asset.hierarchy.length ?? 0,
      dominant: refinement?.dominant ?? null,
      weights: refinement ? [...refinement.weights] : [],
      settled: Boolean(canopy && !canopy.state.refinement.active)
    };
  };

  stage.addEventListener('pointerdown', cancelTourOnInteraction);
  stage.addEventListener('wheel', cancelTourOnInteraction, {passive: true});
  stage.addEventListener('touchstart', cancelTourOnInteraction, {passive: true});
  root.addEventListener('tree-lab:seek-tour', seekTour);
  root.addEventListener('tree-lab:inspect-hero-splat', inspectHeroSplat);
  render();
  if (params.get('tour') === 'hero') {
    // The query is an explicit, reproducible capture trigger; normal demo loads stay interactive.
    tourFrame = container.ownerDocument.defaultView?.requestAnimationFrame(startTour);
  }
  return () => {
    destroyed = true;
    stopTour(false);
    stage.removeEventListener('pointerdown', cancelTourOnInteraction);
    stage.removeEventListener('wheel', cancelTourOnInteraction);
    stage.removeEventListener('touchstart', cancelTourOnInteraction);
    root.removeEventListener('tree-lab:seek-tour', seekTour);
    root.removeEventListener('tree-lab:inspect-hero-splat', inspectHeroSplat);
    deck.finalize();
    root.remove();
  };
}
