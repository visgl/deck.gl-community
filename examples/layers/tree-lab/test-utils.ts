// deck.gl-community
// SPDX-License-Identifier: MIT
import {type TreeSpec, type TreeType} from '@deck.gl-community/layers';
import {getTreeLabForest} from './app';

export const TREE_LAB_SPECIES: TreeType[] = [
  'pine',
  'oak',
  'palm',
  'birch',
  'cherry',
  'banyan',
  'mangrove',
  'citrus'
];

const HERO_TREE_INDEX = 5050;
const COMPACT_OFFSETS: readonly (readonly [number, number])[] = [
  [-2.4, -2.4],
  [-0.8, -2.4],
  [0.8, -2.4],
  [2.4, -2.4],
  [-2.4, -0.8],
  [-0.8, -0.8],
  [0.8, -0.8],
  [2.4, 0.8],
  [-2.4, 0.8],
  [-0.8, 0.8],
  [0.8, 0.8],
  [2.4, 0.8],
  [-2.4, 2.4],
  [-0.8, 2.4],
  [2.4, 2.4],
  [0, 0]
];

/**
 * Preserve every production species and morphology batch while keeping interaction tests small.
 * The dense arrangement sits in the hero camera frustum, so mixed-canopy draw assertions remain
 * meaningful without asking a software adapter to rasterize the 16,600-owner production forest.
 */
export function getCompactTreeLabForest(): TreeSpec[] {
  const forest = getTreeLabForest();
  const hero = forest[HERO_TREE_INDEX]!;
  const [heroX, heroY, heroZ] = hero.position as [number, number, number];
  return TREE_LAB_SPECIES.flatMap((species, speciesIndex) =>
    [19, 73].map((seed, profileIndex) => {
      const source =
        species === 'citrus' && seed === 73
          ? hero
          : forest.find(tree => tree.species === species && tree.characteristics?.seed === seed);
      if (!source) {
        throw new Error(
          `Missing ${species} morphology seed ${seed} in the authored Tree Lab forest.`
        );
      }
      const [offsetX, offsetY] = COMPACT_OFFSETS[speciesIndex * 2 + profileIndex]!;
      return {...source, position: [heroX + offsetX, heroY + offsetY, heroZ]};
    })
  );
}
