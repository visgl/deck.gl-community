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
  const {nodes, edges} = event.data;

  const {nBodyStrength, nBodyDistanceMin, nBodyDistanceMax, getCollisionRadius} =
    event.data.options;
  // @ts-expect-error TODO
  const simulation = d3
    .forceSimulation(nodes)
    .force(
      'edge',
      // @ts-expect-error TODO
      d3.forceLink(edges).id((n) => n.id)
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
  for (
    let i = 0,
      n = Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()));
    i < n;
    ++i
  ) {
    postMessage({
      type: 'tick',
      progress: i / n,
      nodes,
      options: event.data.options
    });
    simulation.tick();
  }
  postMessage({
    type: 'end',
    nodes,
    edges,
    options: event.data.options
  });

  this.self.close();
};
