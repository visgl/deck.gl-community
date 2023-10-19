import {forceLink, forceSimulation, forceManyBody, forceCenter, forceCollide} from 'd3-force';

export default onmessage = function (event) {
  const {nodes, edges} = event.d3Graph;
  const {alpha, nBodyStrength, nBodyDistanceMin, nBodyDistanceMax, getCollisionRadius} =
    event.options;
  const simulation = forceSimulation(nodes)
    .force(
      'edge',
      forceLink(edges).id((n) => n.id)
    )
    .force(
      'charge',
      forceManyBody()
        .strength(nBodyStrength)
        .distanceMin(nBodyDistanceMin)
        .distanceMax(nBodyDistanceMax)
    )
    .force('center', forceCenter())
    .force('collision', forceCollide().radius(getCollisionRadius))
    .stop();

  // var simulation = d3.forceSimulation(nodes)
  //   .force("charge", d3.forceManyBody())
  //   .force("link", d3.forceLink(links).distance(20).strength(1))
  //   .force("x", d3.forceX())
  //   .force("y", d3.forceY())
  //   .stop();

  for (
    let i = 0,
      n = Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()));
    i < n;
    ++i
  ) {
    postMessage({type: 'tick', progress: i / n});
    simulation.tick();
  }

  postMessage({type: 'end', nodes, edges});
};
