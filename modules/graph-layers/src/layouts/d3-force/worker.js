/* global importScripts, d3*/

importScripts('https://d3js.org/d3-collection.v1.min.js');
importScripts('https://d3js.org/d3-dispatch.v1.min.js');
importScripts('https://d3js.org/d3-quadtree.v1.min.js');
importScripts('https://d3js.org/d3-timer.v1.min.js');
importScripts('https://d3js.org/d3-force.v1.min.js');

onmessage = function (event) {
  const {nodes, edges} = event.data;

  const {nBodyStrength, nBodyDistanceMin, nBodyDistanceMax, getCollisionRadius} =
    event.data.options;
  const simulation = d3
    .forceSimulation(nodes)
    .force(
      'edge',
      d3.forceLink(edges).id((n) => n.id)
    )
    .force(
      'charge',
      d3
        .forceManyBody()
        .strength(nBodyStrength)
        .distanceMin(nBodyDistanceMin)
        .distanceMax(nBodyDistanceMax)
    )
    .force('center', d3.forceCenter())
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
};
