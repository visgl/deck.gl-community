importScripts('https://cdn.jsdelivr.net/npm/gpu.js@latest/dist/gpu-browser.js');

onmessage = function (event) {
  const {nodes, edges} = event.data;
  const {nBodyStrength, nBodyDistanceMin, nBodyDistanceMax, getCollisionRadius} =
    event.data.options;

  const gpu = new GPU.GPU({mode: 'cpu'});
  const kernel = gpu.createKernel(
    function (kernel_nodes, kernel_edges) {
      // return nodes[this.thread.x] - edges[this.thread.x];
      let forceX = 0;
      let forceY = 0;
      const currentNode = kernel_nodes[this.thread.x];
      const x1 = currentNode[1];
      const y1 = currentNode[2];

      //Repell from other nodes in graph
      for (let i = 0; i < this.constants.nodesSize; i++) {
        if (i !== this.thread.y) {
          const x2 = kernel_nodes[i][1];
          const y2 = kernel_nodes[i][2];
          const dx = x1 - x2;
          const dy = y1 - y2;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const force = 1;
          forceX += distance !== 0 ? (force * dx) / distance : force;
          forceY += distance !== 0 ? (force * dy) / distance : force;
        }
      }
      // Attract to nodes current node shares an edge with (minimize edge distance)
      for (let i = 0; i < this.constants.edgesSize; i++) {
        const edge = kernel_edges[i];
        if (edge[0] === currentNode[0] || edge[1] === currentNode[0]) {
          //if source or target of edge is equal to current node id
          const otherNodeId = edge[0] === currentNode[0] ? edge[1] : edge[0]; //other node is the id of the other index on edge
          for (let j = 0; j < this.constants.nodesSize; j++) {
            if (kernel_nodes[j][0] === otherNodeId) {
              const otherNode = kernel_nodes[j];
              const x2 = otherNode[1];
              const y2 = otherNode[2];
              const dx = x1 - x2;
              const dy = y1 - y2;
              const distance = Math.sqrt(dx * dx + dy * dy);
              const force = 0.5;
              forceX -= distance !== 0 ? (force * dx) / distance : force;
              forceY -= distance !== 0 ? (force * dy) / distance : force;
              break;
            }
          }
        }
      }

      return [forceX, forceY];
    },
    {
      constants: {nodesSize: nodes.length, edgesSize: edges.length},
      output: [nodes.length]
    }
  );

  const tempNodes = nodes.map((node) => [
    node.id,
    node.x,
    node.y,
    node.collisionRadius,
    node.locked ? 1 : 0
  ]);
  const tempEdges = edges.map((edge) => [edge.source.id, edge.target.id]);

  postMessage({
    type: 'end',
    result: kernel(tempNodes, tempEdges)
  });
};
//# sourceMappingURL=worker.js.map
