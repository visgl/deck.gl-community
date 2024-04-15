import {describe, it, expect} from 'vitest';
import SAMPLE_EDGE from '../__fixtures__/edge.json';
import {Edge} from '../../src/core/edge';

describe('core/edge', () => {
  it('should have correctly functioning getters', () => {
    const edge = new Edge({
      id: 'edge1',
      sourceId: 'node1',
      targetId: 'node2',
      directed: false,
      data: SAMPLE_EDGE
    });
    expect(edge.getId()).toBe('edge1');
    expect(edge.isDirected()).toBe(false);
    expect(edge.getSourceNodeId()).toBe('node1');
    expect(edge.getTargetNodeId()).toBe('node2');
    expect(edge.getPropertyValue('property1')).toBe(1);
    expect(edge.getPropertyValue('_directed')).toBe(false);
    expect(edge.getPropertyValue('unknown')).toBeUndefined();
  });

  it('should have update existing edge internal data functioning getters', () => {
    const edge = new Edge({
      id: 'edge1',
      sourceId: 'node1',
      targetId: 'node2',
      directed: false,
      data: SAMPLE_EDGE
    });
    const newEdge = {
      ...SAMPLE_EDGE,
      property1: 2
    };
    edge.setData(newEdge);
    expect(edge.getPropertyValue('property1')).toBe(2);
  });

  it('should have set new data property if it does not already exist', () => {
    const edge = new Edge({
      id: 'edge1',
      sourceId: 'node1',
      targetId: 'node2',
      directed: false,
      data: SAMPLE_EDGE
    });
    edge.setDataProperty('property4', 4);
    expect(edge.getPropertyValue('property4')).toBe(4);
  });
});
