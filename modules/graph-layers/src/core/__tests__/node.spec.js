import SAMPLE_NODE from './__fixtures__/edge.json';

import Node from '../node';
import Edge from '../edge';

const createEdges = edges => edges.map(e => new Edge(e));

describe('core/node', () => {
  it('should work for non-directed', () => {
    const node = new Node({id: 'node1', data: SAMPLE_NODE});
    const edges1 = createEdges([
      {id: 'edge1', sourceId: 'node1', targetId: 'node2'},
      {id: 'edge2', sourceId: 'node3', targetId: 'node1'},
    ]);
    node.addConnectedEdges(edges1);
    expect(node.getDegree()).toBe(2);
    expect(node.getInDegree()).toBe(0);
    expect(node.getOutDegree()).toBe(0);

    node.removeConnectedEdges(edges1[0]);
    expect(node.getDegree()).toBe(1);
    expect(node.getInDegree()).toBe(0);
    expect(node.getOutDegree()).toBe(0);

    node.clearConnectedEdges();
    expect(node.getDegree()).toBe(0);
    expect(node.getInDegree()).toBe(0);
    expect(node.getOutDegree()).toBe(0);
  });

  it('should work for directed', () => {
    const node = new Node({id: 'node1', data: SAMPLE_NODE});

    const edges2 = createEdges([
      {id: 'edge1', sourceId: 'node1', targetId: 'node2', directed: true},
      {id: 'edge2', sourceId: 'node3', targetId: 'node1', directed: true},
    ]);
    node.addConnectedEdges(edges2);
    expect(node.getDegree()).toBe(2);
    expect(node.getInDegree()).toBe(1);
    expect(node.getOutDegree()).toBe(1);
    expect([edges2[0], edges2[1]]).toEqual(
      expect.arrayContaining(node.getConnectedEdges())
    );
  });

  it('should have node id', () => {
    const node = new Node({id: 'node1', data: SAMPLE_NODE});
    expect(node.getId()).toBe('node1');
  });

  it('should have working getters and setters', () => {
    const node = new Node({id: 'node1', data: SAMPLE_NODE});
    const edges2 = createEdges([
      {id: 'edge1', sourceId: 'node1', targetId: 'node2', directed: true},
      {id: 'edge2', sourceId: 'node3', targetId: 'node1', directed: true},
    ]);
    node.addConnectedEdges(edges2);

    // test getters
    expect(['node2', 'node3']).toEqual(
      expect.arrayContaining(node.getSiblingIds())
    );

    // test setters
    const newNode = {
      ...SAMPLE_NODE,
      property1: 2,
    };
    node.setData(newNode);
    expect(node.getPropertyValue('property1')).toBe(2);

    node.setDataProperty('property4', 4);
    expect(node.getPropertyValue('property4')).toBe(4);
  });
});
