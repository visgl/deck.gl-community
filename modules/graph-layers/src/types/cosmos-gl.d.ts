declare module 'cosmos.gl' {
  export type CosmosLayoutConfig = Record<string, unknown>;

  export type CosmosNode = {
    id: string | number;
    position?: {x: number; y: number; z?: number};
    locked?: boolean;
    [key: string]: unknown;
  };

  export type CosmosEdge = {
    id: string | number;
    source: string | number;
    target: string | number;
    weight?: number;
    [key: string]: unknown;
  };

  export type CosmosGraph = {
    nodes: CosmosNode[];
    edges: CosmosEdge[];
  };

  export type CosmosEvent = 'start' | 'tick' | 'end';

  export type CosmosEventHandler = () => void;

  export interface CosmosLayoutController {
    setOptions?(options: CosmosLayoutConfig): void;
    setGraph(graph: CosmosGraph): void;
    start(): void;
    update?(): void;
    resume?(): void;
    stop?(): void;
    destroy?(): void;
    on?(event: CosmosEvent, handler: CosmosEventHandler): void;
    off?(event: CosmosEvent, handler: CosmosEventHandler): void;
    addEventListener?(event: CosmosEvent, handler: CosmosEventHandler): void;
    removeEventListener?(event: CosmosEvent, handler: CosmosEventHandler): void;
    getNodePosition?(id: string | number): {x: number; y: number; z?: number} | null | undefined;
    lockNode?(id: string | number, position?: {x: number; y: number}): void;
    unlockNode?(id: string | number): void;
  }

  export function createCosmosLayout(options?: CosmosLayoutConfig): CosmosLayoutController;
}
