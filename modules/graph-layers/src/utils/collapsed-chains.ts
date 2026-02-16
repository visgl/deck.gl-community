// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {GraphEngine} from '../core/graph-engine';
import type {NodeInterface} from '../graph/graph';

const OUTLINE_PADDING = 24;
const OUTLINE_CORNER_RADIUS = 16;
const OUTLINE_CORNER_SEGMENTS = 6;

export type ChainInteractionSource =
  | 'node'
  | 'collapsed-marker'
  | 'expanded-marker'
  | 'collapsed-outline'
  | 'expanded-outline';

function resolveLayerId(layer: any): string {
  if (!layer) {
    return '';
  }
  if (typeof layer.id === 'string') {
    return layer.id;
  }
  if (typeof layer.props?.id === 'string') {
    return layer.props.id;
  }
  return '';
}

function classifyChainLayer(layer: any): ChainInteractionSource | null {
  let current = layer ?? null;
  while (current) {
    const layerId = resolveLayerId(current);
    if (layerId.includes('collapsed-chain-markers')) {
      return 'collapsed-marker';
    }
    if (layerId.includes('expanded-chain-markers')) {
      return 'expanded-marker';
    }
    if (layerId.includes('collapsed-chain-outlines')) {
      return 'collapsed-outline';
    }
    if (layerId.includes('expanded-chain-outlines')) {
      return 'expanded-outline';
    }
    current = current.parent ?? null;
  }
  return null;
}

export function resolveChainInteractionSource(info: any): ChainInteractionSource {
  if (!info) {
    return 'node';
  }

  const layersToCheck = [] as any[];
  if (info.layer || info.sourceLayer) {
    if (info.layer) {
      layersToCheck.push(info.layer);
    }
    if (info.sourceLayer && info.sourceLayer !== info.layer) {
      layersToCheck.push(info.sourceLayer);
    }
  } else {
    layersToCheck.push(info);
  }

  for (const layer of layersToCheck) {
    const classification = classifyChainLayer(layer);
    if (classification) {
      return classification;
    }
  }

  return 'node';
}

function isChainRepresentative(node: NodeInterface): boolean {
  const chainId = node.getPropertyValue('collapsedChainId');
  const nodeIds = node.getPropertyValue('collapsedNodeIds');
  const representativeId = node.getPropertyValue('collapsedChainRepresentativeId');

  return (
    Boolean(chainId) &&
    Array.isArray(nodeIds) &&
    nodeIds.length > 1 &&
    representativeId === node.getId()
  );
}

export function getRepresentativeNodes(engine: GraphEngine | null | undefined): NodeInterface[] {
  if (!engine) {
    return [];
  }

  return engine.getNodes().filter((node) => isChainRepresentative(node));
}

export type ChainOutlineGetter = (node: NodeInterface) => [number, number][] | null;

export function createChainOutlineGetter(
  engine: GraphEngine | null | undefined
): ChainOutlineGetter {
  if (!engine) {
    return () => null;
  }

  const cache = new Map<string, [number, number][] | null>();

  // eslint-disable-next-line max-statements, complexity
  return (node: NodeInterface): [number, number][] | null => {
    const chainId = node.getPropertyValue('collapsedChainId');
    if (!chainId) {
      return null;
    }

    const cacheKey = String(chainId);
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey) ?? null;
    }

    const collapsedNodeIds = node.getPropertyValue('collapsedNodeIds');
    if (!Array.isArray(collapsedNodeIds) || collapsedNodeIds.length === 0) {
      cache.set(cacheKey, null);
      return null;
    }

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const nodeId of collapsedNodeIds) {
      const chainNode = engine.findNode(nodeId);
      if (chainNode) {
        const position = engine.getNodePosition(chainNode);
        if (position) {
          const [x, y] = position;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxY)
    ) {
      cache.set(cacheKey, null);
      return null;
    }

    const paddedMinX = minX - OUTLINE_PADDING;
    const paddedMaxX = maxX + OUTLINE_PADDING;
    const paddedMinY = minY - OUTLINE_PADDING;
    const paddedMaxY = maxY + OUTLINE_PADDING;

    const width = paddedMaxX - paddedMinX;
    const height = paddedMaxY - paddedMinY;

    if (width <= 0 || height <= 0) {
      cache.set(cacheKey, null);
      return null;
    }

    const radius = Math.min(OUTLINE_CORNER_RADIUS, width / 2, height / 2);

    if (radius <= 0) {
      const polygon: [number, number][] = [
        [paddedMinX, paddedMinY],
        [paddedMinX, paddedMaxY],
        [paddedMaxX, paddedMaxY],
        [paddedMaxX, paddedMinY],
        [paddedMinX, paddedMinY]
      ];
      cache.set(cacheKey, polygon);
      return polygon;
    }

    const left = paddedMinX;
    const right = paddedMaxX;
    const top = paddedMinY;
    const bottom = paddedMaxY;

    const polygon: [number, number][] = [];
    const pushArc = (cx: number, cy: number, startAngle: number, endAngle: number) => {
      const step = (endAngle - startAngle) / OUTLINE_CORNER_SEGMENTS;
      for (let i = 1; i <= OUTLINE_CORNER_SEGMENTS; i++) {
        const angle = startAngle + step * i;
        polygon.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
      }
    };

    polygon.push([right - radius, top]);
    pushArc(right - radius, top + radius, -Math.PI / 2, 0);
    polygon.push([right, bottom - radius]);
    pushArc(right - radius, bottom - radius, 0, Math.PI / 2);
    polygon.push([left + radius, bottom]);
    pushArc(left + radius, bottom - radius, Math.PI / 2, Math.PI);
    polygon.push([left, top + radius]);
    pushArc(left + radius, top + radius, Math.PI, (3 * Math.PI) / 2);
    polygon.push(polygon[0]);

    cache.set(cacheKey, polygon);
    return polygon;
  };
}

export interface CollapsedChainLayerData {
  representativeNodes: NodeInterface[];
  collapsedNodes: NodeInterface[];
  collapsedOutlineNodes: NodeInterface[];
  expandedNodes: NodeInterface[];
  expandedOutlineNodes: NodeInterface[];
  getChainOutlinePolygon: ChainOutlineGetter;
  outlineUpdateTrigger: string;
}

export function buildCollapsedChainLayers(
  engine: GraphEngine | null | undefined
): CollapsedChainLayerData | null {
  if (!engine) {
    return null;
  }

  const representativeNodes = getRepresentativeNodes(engine);
  if (representativeNodes.length === 0) {
    return null;
  }

  const getChainOutlinePolygon = createChainOutlineGetter(engine);
  const outlineUpdateTrigger = [engine.getLayoutLastUpdate(), engine.getLayoutState()].join();

  const collapsedNodes = representativeNodes.filter((node) =>
    Boolean(node.getPropertyValue('isCollapsedChain'))
  );
  const collapsedOutlineNodes = collapsedNodes.filter((node) => getChainOutlinePolygon(node));

  const expandedNodes = representativeNodes.filter(
    (node) => !node.getPropertyValue('isCollapsedChain')
  );
  const expandedOutlineNodes = expandedNodes.filter((node) => getChainOutlinePolygon(node));

  return {
    representativeNodes,
    collapsedNodes,
    collapsedOutlineNodes,
    expandedNodes,
    expandedOutlineNodes,
    getChainOutlinePolygon,
    outlineUpdateTrigger
  };
}
