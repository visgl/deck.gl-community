// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {addMetersToLngLat} from '@math.gl/web-mercator';
import type {Color} from '@deck.gl/core';
import type {CropConfig, Season, TreeType} from '@deck.gl-community/three';

export type Species = 'date' | 'orange' | 'cherry' | 'pine' | 'birch' | 'cork-oak' | 'almond';
export type FarmTree = {
  id: string;
  plotId: Species;
  position: [number, number, number];
  species: Species;
  type: TreeType;
  label: string;
  height: number;
  canopyRadius: number;
  trunkRadius: number;
  trunkFraction: number;
  branchLevels: number;
  maturity: 'sapling' | 'young' | 'mature' | 'veteran';
  vigor: number;
  foliageTone: number;
  barkTone: number;
  phenology: number;
  cropLoad: number;
  fruitSize: number;
  branchPhase: number;
};

const SPECIES: Record<
  Species,
  {type: TreeType; label: string; height: number; radius: number; trunk: number; fraction: number}
> = {
  date: {type: 'palm', label: 'Date palm', height: 17, radius: 4.8, trunk: 0.45, fraction: 0.8},
  orange: {
    type: 'cherry',
    label: 'Orange tree',
    height: 4.8,
    radius: 4,
    trunk: 0.24,
    fraction: 0.24
  },
  cherry: {
    type: 'cherry',
    label: 'Ornamental cherry',
    height: 8,
    radius: 5.8,
    trunk: 0.36,
    fraction: 0.3
  },
  pine: {type: 'pine', label: 'Pine', height: 22, radius: 5, trunk: 0.38, fraction: 0.32},
  birch: {type: 'birch', label: 'Birch', height: 16, radius: 4.5, trunk: 0.26, fraction: 0.42},
  'cork-oak': {type: 'oak', label: 'Cork oak', height: 10, radius: 8, trunk: 0.8, fraction: 0.28},
  almond: {type: 'oak', label: 'Almond tree', height: 5.5, radius: 4.8, trunk: 0.28, fraction: 0.28}
};

export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export type FarmPlot = {
  species: Species;
  label: string;
  bounds: [number, number, number, number];
  polygon: [number, number, number][];
  rows: number;
  columns: number;
};

/** A fictional farm, laid out in metres around an arbitrary origin. */
export function getFarmPosition(x: number, y: number, z = 0): [number, number, number] {
  return addMetersToLngLat([0, 0, 0], [x, y, z]) as [number, number, number];
}

export function createFarmPlots(columns = 3): FarmPlot[] {
  return (['orange', 'almond', 'cherry', 'date', 'cork-oak', 'birch', 'pine'] as Species[]).map(
    (species, index) => {
      const [x, y, width, height] =
        species === 'pine'
          ? [0, (6 / columns) * 104, columns * 104 - 8, 34]
          : [(index % columns) * 104, Math.floor(index / columns) * 104, 96, 96];
      return {
        species,
        label: SPECIES[species].label,
        bounds: [x, y, x + width, y + height],
        polygon: [
          [x, y],
          [x + width, y],
          [x + width, y + height],
          [x, y + height]
        ].map(([px, py]) => getFarmPosition(px, py)),
        rows: species === 'pine' ? 2 : 8,
        columns: species === 'pine' ? 16 : 8
      };
    }
  );
}

/** Independent, repeatable traits; season changes never regenerate the planting. */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let value = Math.imul(state ^ (state >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
  };
}

/** Compact orchard rows with independent age, shape, colour, and crop traits. */
export function createTreeSamples(plots = createFarmPlots()): FarmTree[] {
  return plots.flatMap((plot, plotIndex) => {
    const model = SPECIES[plot.species];
    const random = createRandom(127 + plotIndex * 7919);
    const [left, bottom, right, top] = plot.bounds;
    return Array.from({length: plot.rows * plot.columns}, (_, index): FarmTree => {
      const age = index === 0 ? 0.65 : random();
      const maturity =
        age < 0.1 ? 'sapling' : age < 0.32 ? 'young' : age < 0.88 ? 'mature' : 'veteran';
      const growth = 0.28 + Math.sqrt(age) * 0.95;
      const vigor = 0.5 + random() * 0.5;
      // Keep a clear border around each plot, with small offsets inside the rows.
      const x =
        left +
        10 +
        (((index % plot.columns) + random() * 0.2) * (right - left - 20)) / (plot.columns - 1);
      const y =
        bottom +
        10 +
        ((Math.floor(index / plot.columns) + random() * 0.2) * (top - bottom - 20)) /
          (plot.rows - 1);
      return {
        id: `${plot.species}-${index}`,
        plotId: plot.species,
        position: getFarmPosition(x, y),
        species: plot.species,
        type: model.type,
        label: model.label,
        height: model.height * growth * (0.85 + random() * 0.3),
        canopyRadius: model.radius * growth * (0.65 + random() * 0.7),
        trunkRadius: model.trunk * growth * (0.7 + random() * 0.65),
        trunkFraction: Math.max(0.18, model.fraction - 0.08) + random() * 0.12,
        branchLevels: Math.min(5, 1 + Math.floor(age * 4 + random() * 1.5)),
        maturity,
        vigor,
        foliageTone: random(),
        barkTone: random(),
        phenology: random(),
        cropLoad: maturity === 'sapling' ? 0 : (0.25 + random() * 1.4) * vigor * growth,
        fruitSize: 0.7 + random() * 0.6,
        branchPhase: random() * Math.PI * 2
      };
    });
  });
}

function mixColor(from: Color, to: Color, amount: number): Color {
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount),
    from[3] ?? 255
  ];
}

/** Individual bark tones preserve the pale birch and warm date-palm trunks. */
export function getBarkColor(tree: FarmTree): Color {
  const base: Color =
    tree.species === 'birch'
      ? [221, 216, 200, 255]
      : tree.species === 'date'
        ? [153, 117, 71, 255]
        : tree.species === 'cork-oak'
          ? [112, 87, 65, 255]
          : [112, 78, 51, 255];
  return mixColor(base, [55, 48, 37, 255], tree.barkTone * 0.35);
}

/** Crown fullness changes with season, vigor, and each tree's timing. */
export function getSeasonalCanopyRadius(tree: FarmTree, season: Season): number {
  const evergreen = ['date', 'orange', 'cork-oak', 'pine'].includes(tree.species);
  const fullness = evergreen
    ? 0.9 + tree.vigor * 0.1
    : season === 'spring'
      ? 0.68 + tree.phenology * 0.25
      : season === 'autumn'
        ? 0.66 + tree.phenology * 0.3
        : 1;
  return tree.canopyRadius * fullness;
}

export function getFoliageColor(tree: FarmTree, season: Season): Color {
  const color = getSeasonColor(tree, season);
  if (color[3] === 0) return color;
  return mixColor(
    color,
    tree.foliageTone > 0.5 ? [223, 209, 111, 255] : [25, 69, 44, 255],
    Math.abs(tree.foliageTone - 0.5) * 0.55 + (1 - tree.vigor) * 0.15
  );
}

function getSeasonColor(tree: FarmTree, season: Season): Color {
  if (tree.species === 'date') return season === 'spring' ? [91, 145, 55, 255] : [62, 122, 49, 255];
  if (tree.species === 'orange') return [46, 111, 40, 255];
  if (tree.species === 'cork-oak') return [91, 118, 65, 255];
  if (tree.species === 'pine') return season === 'spring' ? [61, 124, 71, 255] : [37, 92, 60, 255];
  if (tree.species === 'almond' && season === 'spring')
    return mixColor([253, 245, 237, 255], [238, 179, 199, 255], tree.phenology);
  if (season === 'winter') return [135, 119, 101, 0];
  if (tree.species === 'cherry' && season === 'spring')
    return mixColor([255, 240, 237, 255], [238, 151, 188, 255], tree.phenology);
  if (season === 'autumn')
    return tree.species === 'birch'
      ? mixColor([151, 166, 57, 255], [236, 163, 32, 255], tree.phenology)
      : mixColor([125, 155, 63, 255], [197, 73, 38, 255], tree.phenology);
  return season === 'spring' ? [143, 191, 88, 255] : [65, 130, 53, 255];
}

type CropPreset = [color: Color, count: number, radius: number, droppedCount?: number];
const CROPS: Partial<Record<Species, Partial<Record<Season, CropPreset>>>> = {
  date: {
    summer: [[216, 167, 52, 255], 34, 0.1],
    autumn: [[169, 82, 29, 255], 48, 0.12, 8]
  },
  orange: {
    spring: [[255, 250, 225, 255], 34, 0.13],
    summer: [[121, 160, 40, 255], 22, 0.14],
    autumn: [[255, 151, 18, 255], 40, 0.18, 2],
    winter: [[255, 151, 18, 255], 40, 0.18, 7]
  },
  cherry: {spring: [[255, 225, 238, 255], 46, 0.16, 14]},
  almond: {
    summer: [[184, 142, 81, 255], 30, 0.13],
    autumn: [[184, 142, 81, 255], 30, 0.13, 14],
    spring: [[255, 239, 242, 255], 38, 0.14]
  },
  'cork-oak': {autumn: [[126, 80, 33, 255], 28, 0.15, 16]}
};

/** Illustrative seasons; fruit is enlarged for visibility. */
export function getSeasonalCrop(tree: FarmTree, season: Season): CropConfig | null {
  const preset = CROPS[tree.species]?.[season];
  if (!preset || tree.cropLoad === 0) return null;
  const [color, count, radius, droppedCount = 0] = preset;
  return {
    color: mixColor(color, [246, 219, 127, 255], tree.phenology * 0.24),
    count: Math.round(count * tree.cropLoad),
    radius: radius * tree.fruitSize * 2.5,
    droppedCount: Math.round(droppedCount * tree.cropLoad * (0.35 + tree.phenology))
  };
}

export type TreeBranch = {source: [number, number, number]; target: [number, number, number]};

/** A lightweight branching scaffold for winter's leafless orchard silhouettes. */
export function createWinterBranches(trees: FarmTree[]): TreeBranch[] {
  return trees
    .filter(tree => ['cherry', 'birch', 'almond'].includes(tree.species))
    .flatMap(tree => {
      const h = tree.height;
      const base = h * tree.trunkFraction;
      return Array.from({length: 5 + tree.branchLevels * 2}, (_, index) => {
        const angle = tree.branchPhase + index * 2.39996;
        const level = 0.25 + (index % 3) * 0.24;
        const radius = tree.canopyRadius * 0.45 * (1 - level * 0.55);
        return {
          source: [tree.position[0], tree.position[1], base + (h - base) * level * 0.4] as [
            number,
            number,
            number
          ],
          target: addMetersToLngLat(tree.position, [
            Math.cos(angle) * radius,
            Math.sin(angle) * radius,
            base + (h - base) * level
          ]) as [number, number, number]
        };
      });
    });
}
