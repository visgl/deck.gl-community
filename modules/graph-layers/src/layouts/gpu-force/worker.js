importScripts('https://cdn.jsdelivr.net/npm/gpu.js@latest/dist/gpu-browser.js');

onmessage = function (event) {
  const {nodes, edges} = event.data;
  const {nBodyStrength, nBodyDistanceMin, nBodyDistanceMax, getCollisionRadius} =
    event.data.options;
  const gpu = new GPU.GPU({
    mode: 'cpu'
  });
  const kernel = gpu.createKernel(
    function (kernel_nodes, kernel_edges) {
      const currentNode = kernel_nodes[this.thread.x];
      let x1 = currentNode[1];
      let y1 = currentNode[2];
      let collisons = true;

      //Check for and try to resolve collisions
      while (collisons) {
        collisons = false;
        for (let i = 0; i < this.constants.nodesSize; i++) {
          if (i !== this.thread.y) {
            const x2 = kernel_nodes[i][1];
            const y2 = kernel_nodes[i][2];
            const dx = x1 - x2;
            const dy = y1 - y2;
            let distance = Math.sqrt(dx * dx + dy * dy);

            while (distance < this.constants.collisionRadius) {
              collisons = true;
              const xMove = x1 + (Math.random() - 0.5) * 0.1;
              x1 = x1 + xMove;
              const yMove = y1 + (Math.random() - 0.5) * 0.1;
              y1 = y1 + yMove;
              const dx = x1 - x2;
              const dy = y1 - y2;
              distance = Math.sqrt(dx * dx + dy * dy);
            }
          }
        }
      }

      //Attact current node towards nodes it shares an edge with
      for (let i = 0; i < this.constants.edgesSize; i++) {
        const edge = kernel_edges[i];
        if (edge[0] === currentNode[0] || edge[1] === currentNode[0]) {
          const otherNodeId = edge[0] === currentNode[0] ? edge[1] : edge[0];
          for (let j = 0; j < this.constants.nodesSize; j++) {
            if (kernel_nodes[j][0] === otherNodeId) {
              const otherNode = kernel_nodes[j];
              const x2 = otherNode[1];
              const y2 = otherNode[2];
              const dx = x1 - x2;
              const dy = y1 - y2;
              const distance = Math.sqrt(dx * dx + dy * dy);
              const force = 1;
              if (distance > this.constants.collisionRadius + force) {
                x1 = dx > 0 ? x1 - force / 2 : x1 + force / 2;
                y1 = dy > 0 ? y1 - force / 2 : y1 + force / 2;
              }
              break;
            }
          }
        }
      }

      return [x1, y1];
    },
    {
      constants: {
        nodesSize: nodes.length,
        edgesSize: edges.length,
        collisionRadius: getCollisionRadius
      },
      output: [nodes.length]
    }
  );
  const tempNodes = nodes.map((node) => [node.id, node.x, node.y, node.locked ? 1 : 0]);
  const tempEdges = edges.map((edge) => [edge.source.id, edge.target.id]);
  let forceValues = kernel(tempNodes, tempEdges);
  const newNodes = nodes.map((node, index) => {
    return {...node, x: forceValues[index][0], y: forceValues[index][1]};
  });
  const newEdges = edges.map((edge) => {
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
};
//# sourceMappingURL=worker.js.map
