// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {SPECIES, type Specimen} from './scene';

export type ForestSpecimen = Specimen & {height: number; canopyRadius: number; trunkRadius: number};

function getNoise(index: number, salt: number): number {
  let value = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

// Grow a square spiral around the same origin; adding trees never moves an existing row.
function getGridPosition(index: number): [number, number] {
  if (index === 0) return [0, 0];
  const radius = Math.ceil((Math.sqrt(index + 1) - 1) / 2);
  const edge = radius * 2;
  const offset = (radius * 2 + 1) ** 2 - 1 - index;
  if (offset < edge) return [radius - offset, -radius];
  if (offset < edge * 2) return [-radius, -radius + offset - edge];
  if (offset < edge * 3) return [-radius + offset - edge * 2, radius];
  return [radius, radius - (offset - edge * 3)];
}

/** An explicitly procedural forest: stable positions and dimensions, with all seven species. */
export function createForestSpecimens(count: number, speciesList = SPECIES): ForestSpecimen[] {
  return Array.from({length: count}, (_, index) => {
    const species = speciesList[Math.floor(getNoise(index, 1) * speciesList.length)];
    const scale = 0.75 + getNoise(index, 2) * 0.5;
    const [x, y] = getGridPosition(index);
    return {
      index,
      species,
      position: [
        (x * 18 + (getNoise(index, 3) - 0.5) * 10) / 111320,
        (y * 18 + (getNoise(index, 4) - 0.5) * 10) / 111320
      ],
      height:
        (species === 'pine' ? 21 : species === 'cherry' ? 11 : species === 'mangrove' ? 10 : 16) *
        scale,
      canopyRadius:
        (species === 'palm'
          ? 4.5
          : species === 'birch'
            ? 5.5
            : species === 'banyan'
              ? 10
              : species === 'mangrove'
                ? 8
                : 7) * scale,
      trunkRadius: (species === 'palm' ? 0.25 : 0.38) * scale
    };
  });
}

/** Query counts are exact integers; malformed values use the documented default. */
export function getTreeCount(value: string | null, fallback = 1000): number {
  const parsed = value === null || value.trim() === '' ? fallback : Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(20000, Math.floor(parsed))) : fallback;
}
