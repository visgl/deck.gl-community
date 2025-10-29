// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

function genAllPairs<T>(s: T[]): T[][] {
  const length = s.length;
  const pairs = [] as T[][];
  for (let i = 0; i < length - 1; i += 1) {
    for (let j = i + 1; j < length; j += 1) {
      pairs.push([s[i], s[j]]);
    }
  }
  return pairs;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(n: number, m: number, name: string): number {
  let hash = 0x811c9dc5;
  const input = `${name}:${n}:${m}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function randomChoose<T>(s: T[], k: number, random: () => number): T[] {
  const selected = [] as T[];
  let i = -1;
  const setSize = s.length;
  const size = k >= setSize ? setSize : k;
  while (++i < size) {
    const idx = Math.floor(random() * s.length);
    selected.push(s.splice(idx, 1)[0]);
  }
  return selected;
}

export function randomGraphGenerator(
  n: number,
  m: number,
  name = 'default',
  randomFn?: () => number
) {
  // generate an array of nodes with id form 0 to n;
  const nodes = Array.from(Array(n).keys()).map((id) => ({id}));
  const random = randomFn ?? createSeededRandom(hashSeed(n, m, name));
  const links = randomChoose(genAllPairs(nodes), m, random);
  const edges = links.map((link, idx) => ({
    id: idx,
    sourceId: link[0].id,
    targetId: link[1].id
  }));
  return {name, nodes, edges};
}
