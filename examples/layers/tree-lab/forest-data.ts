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

/** An explicitly procedural forest: stable positions and dimensions, with all five species. */
export function createForestSpecimens(count: number): ForestSpecimen[] {
  const width = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / width);
  return Array.from({length: count}, (_, index) => {
    const species = SPECIES[Math.floor(getNoise(index, 1) * SPECIES.length)];
    const scale = 0.75 + getNoise(index, 2) * 0.5;
    return {
      index,
      species,
      position: [
        (((index % width) - (width - 1) / 2) * 18 + (getNoise(index, 3) - 0.5) * 10) / 111320,
        ((Math.floor(index / width) - (rows - 1) / 2) * 18 + (getNoise(index, 4) - 0.5) * 10) /
          111320
      ],
      height: (species === 'pine' ? 21 : species === 'cherry' ? 11 : 16) * scale,
      canopyRadius: (species === 'palm' ? 4.5 : species === 'birch' ? 5.5 : 7) * scale,
      trunkRadius: (species === 'palm' ? 0.25 : 0.38) * scale
    };
  });
}

/** Query counts are exact integers; malformed values use the documented default. */
export function getTreeCount(value: string | null, fallback = 1000): number {
  const parsed = value === null || value.trim() === '' ? fallback : Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(20000, Math.floor(parsed))) : fallback;
}
