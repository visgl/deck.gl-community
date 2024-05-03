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

function randomChoose<T>(s: T[], k: number): T[] {
  const selected = [] as T[];
  let i = -1;
  const setSize = s.length;
  const size = k >= setSize ? setSize : k;
  while (++i < size) {
    const idx = Math.floor(Math.random() * s.length);
    selected.push(s.splice(idx, 1)[0]);
  }
  return selected;
}

export function randomGraphGenerator(n: number, m: number, name = 'default') {
  // generate an array of nodes with id form 0 to n;
  const nodes = Array.from(Array(n).keys()).map((id) => ({id}));
  const links = randomChoose(genAllPairs(nodes), m);
  const edges = links.map((link, idx) => ({
    id: idx,
    sourceId: link[0].id,
    targetId: link[1].id
  }));
  return {name, nodes, edges};
}
