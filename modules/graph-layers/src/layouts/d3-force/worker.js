// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* global importScripts, d3 */

importScripts('https://d3js.org/d3-collection.v1.min.js');
importScripts('https://d3js.org/d3-dispatch.v1.min.js');
importScripts('https://d3js.org/d3-quadtree.v1.min.js');
importScripts('https://d3js.org/d3-timer.v1.min.js');
importScripts('https://d3js.org/d3-force.v1.min.js');

onmessage = function (event) {
  const {nodes, edges, options} = event.data;

  const {nBodyStrength, nBodyDistanceMin, nBodyDistanceMax, getCollisionRadius} = options;
  // @ts-expect-error TODO
  const simulation = d3
    .forceSimulation(nodes)
    .force(
      'edge',
      // @ts-expect-error TODO
      d3.forceLink(edges).id(n => n.id)
    )
    .force(
      'charge',
      // @ts-expect-error TODO
      d3
        .forceManyBody()
        .strength(nBodyStrength)
        .distanceMin(nBodyDistanceMin)
        .distanceMax(nBodyDistanceMax)
    )
    // @ts-expect-error TODO
    .force('center', d3.forceCenter())
    // @ts-expect-error TODO
    .force('collision', d3.forceCollide().radius(getCollisionRadius))
    .stop();
  const alpha = Number.isFinite(options.alpha) && options.alpha >= 0 ? options.alpha : 1;
  simulation.alpha(alpha);
  const n =
    alpha <= simulation.alphaMin()
      ? 0
      : Math.ceil(Math.log(simulation.alphaMin() / alpha) / Math.log(1 - simulation.alphaDecay()));
  // Publish at most one intermediate snapshot per animation frame.
  const UPDATE_INTERVAL = 16;
  let lastUpdateTime = -Infinity;
  for (let i = 0; i < n; ++i) {
    simulation.tick();
    const now = performance.now();
    if (now - lastUpdateTime < UPDATE_INTERVAL) {
      continue;
    }
    lastUpdateTime = now;
    postMessage({
      type: 'tick',
      progress: n === 0 ? 1 : (i + 1) / n,
      nodes,
      options: event.data.options
    });
  }
  postMessage({
    type: 'end',
    nodes,
    edges,
    options: event.data.options
  });

  this.self.close();
};
