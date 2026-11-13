// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

type Point = [number, number, number];

/** Deterministic random source. Separate seeds keep crop counts and shapes independent. */
export function createTreeRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x9e3779b9) | 0;
    let mixed = value ^ (value >>> 16);
    mixed = Math.imul(mixed, 0x21f0aaad);
    mixed ^= mixed >>> 15;
    mixed = Math.imul(mixed, 0x735a2d97);
    return ((mixed ^ (mixed >>> 15)) >>> 0) / 4294967296;
  };
}

const PINE_TIER_CACHE = new Map<number, ReturnType<typeof generatePineTiers>>();
export function createPineTiers(levels: number) {
  levels = Math.max(1, Math.min(5, Math.round(levels) || 3));
  let tiers = PINE_TIER_CACHE.get(levels);
  if (!tiers) {
    tiers = generatePineTiers(levels);
    PINE_TIER_CACHE.set(levels, tiers);
  }
  return tiers;
}

function generatePineTiers(levels: number) {
  const rng = createTreeRng(levels * 2654435761);
  const tierHeight = 1.6 / (levels + 1);
  const tiers: {base: Point; radius: number; height: number}[] = [];
  let z = 0;
  for (let i = 0; i < levels; i++) {
    const t = i / (levels - 1 || 1);
    const radius = (1 - t * 0.5) * 0.85 * (0.8 + rng() * 0.4);
    const height = tierHeight * (0.85 + rng() * 0.3);
    const drift = levels > 1 ? i / (levels - 1) : 0;
    tiers.push({
      base: [(rng() - 0.5) * 0.2 * drift, (rng() - 0.5) * 0.2 * drift, z],
      radius,
      height
    });
    z += tierHeight / 2;
  }
  return {
    tiers,
    tipStart: [(rng() - 0.5) * 0.08, (rng() - 0.5) * 0.08, z - 0.06] as Point,
    tipEnd: [0, 0, z + 0.16] as Point
  };
}
