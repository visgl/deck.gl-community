// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {addMetersToLngLat} from '@math.gl/web-mercator';
import type {Color} from '@deck.gl/core';
import type {CropConfig, Season, TreeType} from '@deck.gl-community/three';

export type Species = 'date' | 'orange' | 'cherry' | 'pine' | 'birch' | 'cork-oak' | 'almond';
export type ForestSite = {
  id: string;
  name: string;
  country: string;
  position: [number, number];
  species: Species;
  source: string;
};

/** Regional examples, not surveyed individual-tree locations. */
export const FOREST_SITES: ForestSite[] = [
  {
    id: 'siwa',
    name: 'Siwa Oasis',
    country: 'Egypt',
    position: [25.53, 29.21],
    species: 'date',
    source: 'https://www.fao.org/giahs/giahs-around-the-world/egypt-siwa-oasis-dates-system/en'
  },
  {
    id: 'saopaulo',
    name: 'São Paulo',
    country: 'Brazil',
    position: [-47.04, -21.85],
    species: 'orange',
    source:
      'https://agenciadenoticias.ibge.gov.br/en/agencia-press-room/2185-news-agency/releases-en/43106-in-march-ibge-s-harvest-estimate-for-2025-is-327-6-million-tonnes'
  },
  {
    id: 'kyoto',
    name: 'Kyoto',
    country: 'Japan',
    position: [135.7847, 35.0035],
    species: 'cherry',
    source: 'https://kyoto.travel/en/destinations/maruyama-park/'
  },
  {
    id: 'nuuksio',
    name: 'Nuuksio',
    country: 'Finland',
    position: [24.5008, 60.3078],
    species: 'birch',
    source: 'https://www.luontoon.fi/en/destinations/nuuksio-national-park'
  },
  {
    id: 'alentejo',
    name: 'Alentejo',
    country: 'Portugal',
    position: [-8.009, 38.5528],
    species: 'cork-oak',
    source: 'https://www.visitportugal.com/en/content/the-cork'
  },
  {
    id: 'riverland',
    name: 'Riverland',
    country: 'Australia',
    position: [140.63, -34.41],
    species: 'almond',
    source: 'https://almondboard.org.au/almond-story/'
  },
  {
    id: 'yosemite',
    name: 'Yosemite',
    country: 'United States',
    position: [-119.58, 37.7469],
    species: 'pine',
    source: 'https://www.nps.gov/yose/learn/nature/plants.htm'
  }
];

export type ForestTree = {
  id: string;
  siteId: string;
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

export const TREES_PER_SITE = 400;

/** Independent, repeatable traits; moving the camera never regenerates a grove. */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let value = Math.imul(state ^ (state >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
  };
}

/** Seven substantial groves: planted orchard rows and irregular woodland clusters. */
export function createTreeSamples(): ForestTree[] {
  return FOREST_SITES.flatMap((site, siteIndex) => {
    const model = SPECIES[site.species];
    const orchard = ['date', 'orange', 'almond'].includes(site.species);
    const spacing = model.radius * (orchard ? 1.65 : 1.9);
    const random = createRandom(127 + siteIndex * 7919);
    const offsets: [number, number][] = [];
    const trees = Array.from({length: TREES_PER_SITE}, (_, index): ForestTree => {
      const age = index === 0 ? 0.65 : random();
      const maturity =
        age < 0.1 ? 'sapling' : age < 0.32 ? 'young' : age < 0.88 ? 'mature' : 'veteran';
      const growth = 0.28 + Math.sqrt(age) * 0.95;
      const vigor = 0.5 + random() * 0.5;
      const width = 0.65 + random() * 0.7;
      const trunk = 0.7 + random() * 0.65 + (maturity === 'veteran' ? 0.35 : 0);
      let x: number;
      let y: number;
      if (orchard) {
        const col = index % 20;
        const row = Math.floor(index / 20);
        // Working lanes between blocks, with small planting offsets within rows.
        x = (col - 9.5 + (Math.floor(col / 5) - 1.5) * 0.65 + (random() - 0.5) * 0.2) * spacing;
        y = (row - 9.5 + (Math.floor(row / 5) - 1.5) * 0.65 + (random() - 0.5) * 0.2) * spacing;
      } else {
        const angle = index * 2.399963 + (random() - 0.5) * 0.35;
        const radius = Math.sqrt(index / TREES_PER_SITE) * spacing * 11;
        const edge = 1 + Math.sin(angle * 3) * 0.12 + Math.cos(angle * 5) * 0.08;
        x = Math.cos(angle) * radius * edge;
        y = Math.sin(angle) * radius * edge * 0.8;
        // A winding opening through the woodland creates loose, uneven stands.
        x += Math.sign(x) * spacing * (0.5 + 0.5 * Math.sin(y / (spacing * 3)));
      }
      offsets.push([x, y]);
      return {
        id: `${site.id}-${index}`,
        siteId: site.id,
        position: [0, 0, 0],
        species: site.species,
        type: model.type,
        label: model.label,
        height: model.height * growth * (0.85 + random() * 0.3),
        canopyRadius: model.radius * growth * width,
        trunkRadius: model.trunk * growth * trunk,
        trunkFraction:
          Math.max(0.18, model.fraction - 0.1) +
          random() * (Math.min(0.87, model.fraction + 0.1) - Math.max(0.18, model.fraction - 0.1)),
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
    const centerX = offsets.reduce((sum, point) => sum + point[0], 0) / trees.length;
    const centerY = offsets.reduce((sum, point) => sum + point[1], 0) / trees.length;
    for (let index = 0; index < trees.length; index++) {
      trees[index].position = addMetersToLngLat(
        [...site.position, 0],
        [offsets[index][0] - centerX, offsets[index][1] - centerY, 0]
      ) as [number, number, number];
    }
    return trees;
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
export function getBarkColor(tree: ForestTree): Color {
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

/** Crown fullness changes with local season, vigor, and each tree's timing. */
export function getSeasonalCanopyRadius(tree: ForestTree, season: Season): number {
  const evergreen = ['date', 'orange', 'cork-oak', 'pine'].includes(tree.species);
  const fullness = evergreen
    ? 0.9 + tree.vigor * 0.1
    : season === 'spring' || (tree.species === 'almond' && season === 'winter')
      ? 0.68 + tree.phenology * 0.25
      : season === 'autumn'
        ? 0.66 + tree.phenology * 0.3
        : 1;
  return tree.canopyRadius * fullness;
}

export function getFoliageColor(tree: ForestTree, season: Season): Color {
  const color = getSeasonColor(tree, season);
  if (color[3] === 0) return color;
  return mixColor(
    color,
    tree.foliageTone > 0.5 ? [223, 209, 111, 255] : [25, 69, 44, 255],
    Math.abs(tree.foliageTone - 0.5) * 0.55 + (1 - tree.vigor) * 0.15
  );
}

function getSeasonColor(tree: ForestTree, season: Season): Color {
  if (tree.species === 'date') return season === 'spring' ? [91, 145, 55, 255] : [62, 122, 49, 255];
  if (tree.species === 'orange') return [46, 111, 40, 255];
  if (tree.species === 'cork-oak') return [91, 118, 65, 255];
  if (tree.species === 'pine') return season === 'spring' ? [61, 124, 71, 255] : [37, 92, 60, 255];
  if (tree.species === 'almond' && season === 'winter')
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

/** Illustrative local seasons, not a synchronized global date; fruit is enlarged for visibility. */
export function getSeasonalCrop(tree: ForestTree, season: Season): CropConfig | null {
  const crop = (
    color: Color,
    count: number,
    radius: number,
    droppedCount = 0
  ): CropConfig | null => {
    if (tree.cropLoad === 0) return null;
    return {
      color: mixColor(color, [246, 219, 127, 255], tree.phenology * 0.24),
      count: Math.round(count * tree.cropLoad),
      radius: radius * tree.fruitSize,
      droppedCount: Math.round(droppedCount * tree.cropLoad * (0.35 + tree.phenology))
    };
  };
  switch (tree.species) {
    case 'date':
      return season === 'autumn'
        ? crop([169, 82, 29, 255], 48, 0.12, 8)
        : season === 'summer'
          ? crop([216, 167, 52, 255], 34, 0.1)
          : null;
    case 'orange':
      return season === 'spring'
        ? crop([255, 250, 225, 255], 34, 0.13)
        : season === 'summer'
          ? crop([121, 160, 40, 255], 22, 0.14)
          : crop([255, 151, 18, 255], 40, 0.18, season === 'winter' ? 7 : 2);
    case 'cherry':
      return season === 'spring' ? crop([255, 225, 238, 255], 46, 0.16, 14) : null;
    case 'almond':
      return season === 'winter'
        ? crop([255, 239, 242, 255], 38, 0.14)
        : season === 'summer' || season === 'autumn'
          ? crop([184, 142, 81, 255], 30, 0.13, season === 'autumn' ? 14 : 0)
          : null;
    case 'cork-oak':
      return season === 'autumn' ? crop([126, 80, 33, 255], 28, 0.15, 16) : null;
    default:
      return null;
  }
}

export function getSeasonDescription(site: ForestSite, season: Season): string {
  if (site.species === 'almond' && season === 'winter')
    return 'Winter blossom · white and pink almond flowers';
  if (site.species === 'cherry')
    return {
      spring: 'Blossom · ornamental cherries in flower',
      summer: 'Full green crowns · no edible-cherry crop shown',
      autumn: 'Amber foliage · leaves turning',
      winter: 'Leafless crowns · branching structure revealed'
    }[season];
  if (site.species === 'date')
    return {
      spring: 'Evergreen fronds · new growth',
      summer: 'Evergreen fronds · ripening dates',
      autumn: 'Date harvest · ripe fruit and fallen dates',
      winter: 'Evergreen fronds · fruiting display rests'
    }[season];
  if (site.species === 'orange')
    return {
      spring: 'Orange blossom · pale flowers',
      summer: 'Green fruit · evergreen foliage',
      autumn: 'Fruit colouring · oranges on the canopy',
      winter: 'Ripe oranges · evergreen winter crowns'
    }[season];
  if (site.species === 'birch')
    return {
      spring: 'Fresh birch leaves',
      summer: 'Full green birch canopy',
      autumn: 'Golden birch foliage',
      winter: 'Bare birch branches'
    }[season];
  if (site.species === 'cork-oak')
    return season === 'autumn'
      ? 'Acorns on the canopy and pasture · evergreen oak'
      : 'Evergreen cork-oak crowns · open woodland';
  if (site.species === 'pine') return 'Evergreen pine · tiered canopy';
  return season === 'summer' || season === 'autumn'
    ? 'Almonds ripening · harvest on the ground'
    : 'Fresh green almond leaves';
}

export type TreeBranch = {source: [number, number, number]; target: [number, number, number]};

/** A lightweight branching scaffold for winter's leafless cherry and birch silhouettes. */
export function createWinterBranches(trees: ForestTree[], sizeScale: number): TreeBranch[] {
  return trees
    .filter(tree => tree.species === 'cherry' || tree.species === 'birch')
    .flatMap(tree => {
      const h = tree.height * sizeScale;
      const base = h * tree.trunkFraction;
      return Array.from({length: 5 + tree.branchLevels * 2}, (_, index) => {
        const angle = tree.branchPhase + index * 2.39996;
        const level = 0.25 + (index % 3) * 0.24;
        const radius = tree.canopyRadius * sizeScale * 0.45 * (1 - level * 0.55);
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
