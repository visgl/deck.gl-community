// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {MutableRefObject} from 'react';

import type {Edge, EdgeState, Node, NodeState} from '@deck.gl-community/graph-layers';

const TEXT_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

const NODE_TO_EDGE_STATE_MAP: Record<NodeState, EdgeState> = {
  default: 'default',
  hover: 'hover',
  dragging: 'dragging',
  selected: 'selected'
};

function shouldEdgeBeSelected(edge: Edge): boolean {
  return edge
    .getConnectedNodes()
    .some((node) => node.getState() === 'selected' && node.shouldHighlightConnectedEdges());
}

export function isEditableElement(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  if (TEXT_INPUT_TAGS.has(target.tagName)) {
    return true;
  }
  const role = target.getAttribute('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox' || role === 'spinbutton';
}

export function isRepresentativeNode(node: Node): boolean {
  const chainId = node.getPropertyValue('collapsedChainId');
  const collapsedNodeIds = node.getPropertyValue('collapsedNodeIds');
  const representativeId = node.getPropertyValue('collapsedChainRepresentativeId');
  return (
    chainId !== null &&
    chainId !== undefined &&
    Array.isArray(collapsedNodeIds) &&
    collapsedNodeIds.length > 1 &&
    representativeId === node.getId()
  );
}

export function getRepresentativeChainId(node: Node): string | null {
  if (!isRepresentativeNode(node)) {
    return null;
  }
  const chainId = node.getPropertyValue('collapsedChainId');
  if (chainId === null || chainId === undefined) {
    return null;
  }
  return String(chainId);
}

export function setNodeInteractionState(node: Node, state: NodeState): void {
  node.setState(state);
  if (node.shouldHighlightConnectedEdges()) {
    for (const edge of node.getConnectedEdges()) {
      let nextEdgeState = NODE_TO_EDGE_STATE_MAP[state];
      if (shouldEdgeBeSelected(edge)) {
        nextEdgeState = 'selected';
      }
      edge.setState(nextEdgeState);
    }
  }
}

export function updateSelectedChain(
  engine: {getNodes(): Node[]} | null,
  chainId: string | null,
  selectedNodeIdRef: MutableRefObject<string | null>
): void {
  if (!engine) {
    selectedNodeIdRef.current = null;
    return;
  }

  const nodes = engine.getNodes();
  let targetNode: Node | null = null;
  if (chainId) {
    for (const node of nodes) {
      if (!node.isSelectable()) {
        continue;
      }
      const nodeChainId = getRepresentativeChainId(node);
      if (nodeChainId === chainId) {
        targetNode = node;
        break;
      }
    }
  }

  const nextSelectedId = targetNode ? String(targetNode.getId()) : null;
  if (selectedNodeIdRef.current === nextSelectedId) {
    return;
  }

  for (const node of nodes) {
    if (!node.isSelectable()) {
      continue;
    }
    const nodeId = String(node.getId());
    const nextState: NodeState = nextSelectedId && nodeId === nextSelectedId ? 'selected' : 'default';
    setNodeInteractionState(node, nextState);
  }

  selectedNodeIdRef.current = nextSelectedId;
}
