// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* global importScripts, d3 */

importScripts('https://d3js.org/d3-collection.v1.min.js');
importScripts('https://d3js.org/d3-dispatch.v1.min.js');
importScripts('https://d3js.org/d3-quadtree.v1.min.js');
importScripts('https://d3js.org/d3-timer.v1.min.js');
importScripts('https://d3js.org/d3-force.v1.min.js');

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const getNodeFromRef = (nodeById, ref) => (ref && typeof ref === 'object' ? ref : nodeById.get(ref));

const getNodeIdFromRef = (ref) => (ref && typeof ref === 'object' ? ref.id : ref);

const formatNodeUpdate = (node) => ({
  id: node.id,
  x: node.x,
  y: node.y,
  vx: node.vx,
  vy: node.vy,
  fx: node.fx,
  fy: node.fy
});

const formatEdgeUpdate = (edge, sourceNode, targetNode) => ({
  id: edge.id,
  sourceId: sourceNode?.id,
  targetId: targetNode?.id,
  sourcePosition: [sourceNode?.x, sourceNode?.y],
  targetPosition: [targetNode?.x, targetNode?.y],
  controlPoints: edge.controlPoints || []
});

const createSimulation = (nodes, edges, options) =>
  // @ts-expect-error TODO
  d3
    // @ts-expect-error TODO
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
        .strength(options.nBodyStrength)
        .distanceMin(options.nBodyDistanceMin)
        .distanceMax(options.nBodyDistanceMax)
    )
    // @ts-expect-error TODO
    .force('center', d3.forceCenter())
    // @ts-expect-error TODO
    .force('collision', d3.forceCollide().radius(options.getCollisionRadius))
    .stop();

const collectNodeUpdates = (nodes, previousPositions) => {
  const updates = [];
  const changedNodeIds = new Set();

  for (const node of nodes) {
    const hasPosition = node && isFiniteNumber(node.x) && isFiniteNumber(node.y);
    if (hasPosition) {
      const previous = previousPositions.get(node.id);
      const positionChanged = !previous || previous.x !== node.x || previous.y !== node.y;

      if (positionChanged) {
        previousPositions.set(node.id, {x: node.x, y: node.y});
        updates.push(formatNodeUpdate(node));
        changedNodeIds.add(node.id);
      }
    }
  }

  return {updates, changedNodeIds};
};

const collectEdgeUpdates = (edges, nodeById, changedNodeIds) => {
  const updates = [];

  for (const edge of edges) {
    if (edge) {
      const sourceNode = getNodeFromRef(nodeById, edge.source);
      const targetNode = getNodeFromRef(nodeById, edge.target);
      const sourceId = getNodeIdFromRef(edge.source);
      const targetId = getNodeIdFromRef(edge.target);
      const shouldUpdate =
        sourceNode &&
        targetNode &&
        (changedNodeIds.has(sourceId) || changedNodeIds.has(targetId));

      if (shouldUpdate) {
        updates.push(formatEdgeUpdate(edge, sourceNode, targetNode));
      }
    }
  }

  return updates;
};

const createFinalEdgeUpdates = (edges, nodeById) =>
  edges
    .map((edge) => {
      if (!edge) {
        return null;
      }

      const sourceNode = getNodeFromRef(nodeById, edge.source);
      const targetNode = getNodeFromRef(nodeById, edge.target);

      return sourceNode && targetNode ? formatEdgeUpdate(edge, sourceNode, targetNode) : null;
    })
    .filter(Boolean);

onmessage = function (event) {
  const {nodes, edges, options} = event.data;

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const previousPositions = new Map(
    nodes
      .filter((node) => isFiniteNumber(node.x) && isFiniteNumber(node.y))
      .map((node) => [node.id, {x: node.x, y: node.y}])
  );

  const simulation = createSimulation(nodes, edges, options);
  const totalTicks = Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()));

  for (let i = 0; i < totalTicks; ++i) {
    simulation.tick();

    const {updates, changedNodeIds} = collectNodeUpdates(nodes, previousPositions);

    if (updates.length > 0) {
      const edgeUpdates = collectEdgeUpdates(edges, nodeById, changedNodeIds);

      if (edgeUpdates.length > 0 || updates.length > 0) {
        postMessage({
          type: 'tick',
          progress: (i + 1) / totalTicks,
          nodes: updates,
          edges: edgeUpdates,
          options
        });
      }
    }
  }

  postMessage({
    type: 'end',
    nodes: nodes.map((node) => formatNodeUpdate(node)),
    edges: createFinalEdgeUpdates(edges, nodeById),
    options
  });

  this.self.close();
};
