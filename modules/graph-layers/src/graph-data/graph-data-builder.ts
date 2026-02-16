import type {GraphData} from './graph-data';

export interface GraphDataBuilder {
  addNode(node: Record<string, unknown>): number;
  addEdge(edge: Record<string, unknown>): number;
  build(): GraphData;
}
