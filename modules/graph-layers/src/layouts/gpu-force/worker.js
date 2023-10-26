/* global importScripts GPU*/

importScripts('https://cdn.jsdelivr.net/npm/gpu.js@latest/dist/gpu-browser.js');

onmessage = function (event) {
  const {sourceNodes, sourceEdges} = event.data;
  const {nBodyStrength, nBodyDistanceMin, nBodyDistanceMax, getCollisionRadius} =
    event.data.options;
  const gpu = new GPU.GPU({
    mode: 'cpu'
  });

  const getDistance = (node1, node2) => {
    const dx = node1[1] - node2[1];
    const dy = node1[2] - node2[2];
    return Math.sqrt(dx * dx + dy * dy);
  };

  const isCollision = (node1, node2) => {
    return getDistance(node1, node2) < getCollisionRadius;
  };

  const forceCollide = (nodes, currentNode) => {
    let collisons = true;
    while (collisons) {
      collisons = false;
      for (let i = 0; i < nodes.length; i++) {
        while (nodes[i][0] !== currentNode[0] && isCollision(currentNode, nodes[i])) {
          collisons = true;
          const xMove = currentNode[1] + Math.random() - 0.5;
          currentNode[1] = currentNode[1] + xMove;
          const yMove = currentNode[2] + Math.random() - 0.5;
          currentNode[2] = currentNode[2] + yMove;
        }
      }
    }
    return [currentNode[1], currentNode[2]];
  };

  const forceLink = (nodes, edges, currentNode) => {
    let x1 = currentNode[1];
    let y1 = currentNode[2];
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      if (edge[0] === currentNode[0] || edge[1] === currentNode[0]) {
        const otherNodeId = edge[0] === currentNode[0] ? edge[1] : edge[0];
        const otherNode = nodes.find((node) => node[0] === otherNodeId);
        const x2 = otherNode[1];
        const y2 = otherNode[2];
        const dx = x1 - x2;
        const dy = y1 - y2;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const force = 1;
        if (distance > getCollisionRadius + force) {
          x1 = dx > 0 ? x1 - force / 2 : x1 + force / 2;
          y1 = dy > 0 ? y1 - force / 2 : y1 + force / 2;
        }
      }
    }
    return [x1, y1];
  };

  const kernel = gpu.createKernel(
    function (kernelNodes, kernelEdges) {
      const currentNode = kernelNodes[this.thread.x];
      forceCollide(kernelNodes, currentNode);
      const forceLinkResult = forceLink(kernelNodes, kernelEdges, currentNode);
      currentNode[1] = forceLinkResult[0];
      currentNode[2] = forceLinkResult[1];
      return [currentNode[1], currentNode[2]];
    },
    {
      constants: {
        nodesSize: sourceNodes.length,
        edgesSize: sourceEdges.length,
        collisionRadius: getCollisionRadius,
        nBodyStrength,
        nBodyDistanceMin,
        nBodyDistanceMax
      },
      output: [sourceNodes.length]
    }
  );
  const tempNodes = sourceNodes.map((node) => [node.id, node.x, node.y, node.locked ? 1 : 0]);
  const tempEdges = sourceEdges.map((edge) => [edge.source.id, edge.target.id]);

  kernel(tempNodes, tempEdges);

  const newNodes = sourceNodes.map((node, index) => {
    const updatedNode = tempNodes.find((n) => n[0] === node.id);
    return {
      ...node,
      x: updatedNode[1],
      y: updatedNode[2]
    };
  });
  const newEdges = sourceEdges.map((edge) => {
    return {
      ...edge,
      source: newNodes.find((node) => node.id === edge.source.id),
      target: newNodes.find((node) => node.id === edge.target.id)
    };
  });
  postMessage({
    type: 'end',
    nodes: newNodes,
    edges: newEdges
  });

  this.self.close();
};
