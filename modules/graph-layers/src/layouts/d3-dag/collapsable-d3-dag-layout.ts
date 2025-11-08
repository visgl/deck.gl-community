// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable no-continue, complexity, max-statements */

import type {LegacyGraph} from '../../graph/legacy-graph';
import type {NodeInterface, EdgeInterface} from '../../graph/graph';
import {GraphLayoutDefaultProps} from '../../core/graph-layout';
import {log} from '../../utils/log';

import {D3DagLayout, type D3DagLayoutProps} from './d3-dag-layout';

type CollapsedChainDescriptor = {
  id: string;
  nodeIds: (string | number)[];
  edgeIds: (string | number)[];
  representativeId: string | number;
};

export type CollapsableD3DagLayoutProps = D3DagLayoutProps & {
  /** Whether to collapse linear chains of nodes into a single representative. */
  collapseLinearChains?: boolean;
}

export class CollapsableD3DagLayout extends D3DagLayout<CollapsableD3DagLayoutProps> {
  static override defaultProps = {
    ...D3DagLayout.defaultProps,
    collapseLinearChains: false
  } as const satisfies GraphLayoutDefaultProps<CollapsableD3DagLayoutProps>;

  private _chainDescriptors = new Map<string, CollapsedChainDescriptor>();
  private _nodeToChainId = new Map<string | number, string>();
  private _collapsedChainState = new Map<string, boolean>();
  private _hiddenNodeIds = new Set<string | number>();

  constructor(props: CollapsableD3DagLayoutProps = {}) {
    super(props, CollapsableD3DagLayout.defaultProps);
  }

  override setProps(props: Partial<CollapsableD3DagLayoutProps>): boolean {
    const shouldUpdate = super.setProps(props);
    if (props.collapseLinearChains !== undefined && this._graph) {
      this._runLayout();
    }
    return shouldUpdate;
  }

  protected override updateGraph(graph: LegacyGraph): void {
    super.updateGraph(graph);
    this._chainDescriptors.clear();
    this._nodeToChainId.clear();
    this._hiddenNodeIds.clear();
  }

  override toggleCollapsedChain(chainId: string): void {
    if (!this._graph) {
      log.log(1, `CollapsableD3DagLayout: toggleCollapsedChain(${chainId}) ignored (no graph)`);
      return;
    }

    if (!this._chainDescriptors.has(chainId)) {
      this._refreshCollapsedChains();
    }

    if (!this._chainDescriptors.has(chainId)) {
      log.log(1, `CollapsableD3DagLayout: toggleCollapsedChain(${chainId}) skipped (unknown chain)`);
      return;
    }

    const collapsed = this._isChainCollapsed(chainId);
    const nextState = !collapsed;
    log.log(
      0,
      `CollapsableD3DagLayout: toggleCollapsedChain(${chainId}) -> ${nextState ? 'collapsed' : 'expanded'}`
    );
    // eslint-disable-next-line no-console
    console.log(
      `CollapsableD3DagLayout: toggleCollapsedChain(${chainId}) -> ${nextState ? 'collapsed' : 'expanded'}`
    );
    this._collapsedChainState.set(chainId, nextState);
    this._runLayout();
  }

  override setCollapsedChains(chainIds: Iterable<string>): void {
    if (!this._graph) {
      log.log(1, 'CollapsableD3DagLayout: setCollapsedChains ignored (no graph)');
      return;
    }

    if (!this._chainDescriptors.size) {
      this._refreshCollapsedChains();
    }

    const desired = new Set(chainIds);
    log.log(0, `CollapsableD3DagLayout: setCollapsedChains(${desired.size}) requested`);

    let changed = false;
    for (const chainId of this._chainDescriptors.keys()) {
      const next = desired.has(chainId);
      if (this._isChainCollapsed(chainId) !== next) {
        this._collapsedChainState.set(chainId, next);
        changed = true;
      }
    }

    if (changed) {
      log.log(0, 'CollapsableD3DagLayout: setCollapsedChains -> changes detected, rerunning layout');
      // eslint-disable-next-line no-console
      console.log('CollapsableD3DagLayout: setCollapsedChains -> changes detected, rerunning layout');
      this._runLayout();
    } else {
      log.log(1, 'CollapsableD3DagLayout: setCollapsedChains -> no changes');
      // eslint-disable-next-line no-console
      console.log('CollapsableD3DagLayout: setCollapsedChains -> no changes');
    }
  }

  protected override _refreshCollapsedChains(): void {
    const previousChainCount = this._chainDescriptors.size;

    if (!this._graph) {
      if (previousChainCount > 0) {
        log.log(0, 'CollapsableD3DagLayout: clearing collapsed chains (graph unavailable)');
        // eslint-disable-next-line no-console
        console.log('CollapsableD3DagLayout: clearing collapsed chains (graph unavailable)');
      }
      this._chainDescriptors.clear();
      this._nodeToChainId.clear();
      this._hiddenNodeIds.clear();
      this._updateCollapsedChainNodeMetadata();
      return;
    }

    log.log(
      0,
      `CollapsableD3DagLayout: refreshing collapsed chains (previous=${previousChainCount})`
    );
    // eslint-disable-next-line no-console
    console.log(
      `CollapsableD3DagLayout: refreshing collapsed chains (previous=${previousChainCount})`
    );

    const collapseDefault =
      this.props.collapseLinearChains;

    const previousStates = new Map(this._collapsedChainState);

    this._chainDescriptors.clear();
    this._nodeToChainId.clear();
    this._hiddenNodeIds.clear();

    const nodes = this._graph.getNodes();
    const candidateNodes = new Set<string | number>();
    const incomingCache = new Map<string | number, EdgeInterface[]>();
    const outgoingCache = new Map<string | number, EdgeInterface[]>();

    for (const node of nodes) {
      const incoming = this._getIncomingEdges(node);
      const outgoing = this._getOutgoingEdges(node);
      incomingCache.set(node.getId(), incoming);
      outgoingCache.set(node.getId(), outgoing);
      if (incoming.length <= 1 && outgoing.length <= 1 && incoming.length + outgoing.length > 0) {
        candidateNodes.add(node.getId());
      }
    }

    const visited = new Set<string | number>();
    for (const node of nodes) {
      const nodeId = node.getId();
      if (!candidateNodes.has(nodeId) || visited.has(nodeId)) {
        continue;
      }

      const incoming = incomingCache.get(nodeId) ?? [];
      const hasCandidateParent =
        incoming.length === 1 && candidateNodes.has(incoming[0].getSourceNodeId());
      if (hasCandidateParent) {
        continue;
      }

      const chainNodeIds: (string | number)[] = [];
      const chainEdgeIds: (string | number)[] = [];
      let currentNode: NodeInterface | undefined = node;

      while (currentNode) {
        const currentId = currentNode.getId();
        if (!candidateNodes.has(currentId) || visited.has(currentId)) {
          break;
        }

        visited.add(currentId);
        chainNodeIds.push(currentId);

        const outgoing = outgoingCache.get(currentId) ?? [];
        if (outgoing.length !== 1) {
          break;
        }

        const nextEdge = outgoing[0];
        const nextNodeId = nextEdge.getTargetNodeId();
        if (!candidateNodes.has(nextNodeId)) {
          break;
        }

        const nextIncoming = incomingCache.get(nextNodeId) ?? [];
        if (nextIncoming.length !== 1) {
          break;
        }

        chainEdgeIds.push(nextEdge.getId());
        currentNode = this._nodeLookup.get(nextNodeId);
      }

      if (chainNodeIds.length > 1) {
        const chainId = this._createChainId(chainNodeIds);
        const collapsed = previousStates.has(chainId)
          ? Boolean(previousStates.get(chainId))
          : collapseDefault;
        this._chainDescriptors.set(chainId, {
          id: chainId,
          nodeIds: chainNodeIds,
          edgeIds: chainEdgeIds,
          representativeId: chainNodeIds[0]
        });
        this._collapsedChainState.set(chainId, collapsed);
        for (const chainNodeId of chainNodeIds) {
          this._nodeToChainId.set(chainNodeId, chainId);
        }
      }
    }

    for (const key of previousStates.keys()) {
      if (!this._chainDescriptors.has(key)) {
        this._collapsedChainState.delete(key);
      }
    }

    this._hiddenNodeIds.clear();
    for (const [chainId, descriptor] of this._chainDescriptors) {
      const collapsed = this._isChainCollapsed(chainId);
      if (collapsed) {
        for (const nodeId of descriptor.nodeIds) {
          // eslint-disable-next-line max-depth
          if (nodeId !== descriptor.representativeId) {
            this._hiddenNodeIds.add(nodeId);
          }
        }
      }
    }

    this._updateCollapsedChainNodeMetadata();

    let collapsedCount = 0;
    for (const chainId of this._chainDescriptors.keys()) {
      if (this._isChainCollapsed(chainId)) {
        collapsedCount++;
      }
    }

    log.log(
      0,
      `CollapsableD3DagLayout: refreshed collapsed chains -> total=${this._chainDescriptors.size}, collapsed=${collapsedCount}`
    );
  }

  protected override _updateCollapsedChainNodeMetadata(): void {
    if (!this._graph) {
      return;
    }

    for (const node of this._graph.getNodes()) {
      const nodeId = node.getId();
      const chainId = this._nodeToChainId.get(nodeId);

      if (!chainId) {
        node.setDataProperty('collapsedChainId', null);
        node.setDataProperty('collapsedChainLength', 1);
        node.setDataProperty('collapsedNodeIds', []);
        node.setDataProperty('collapsedEdgeIds', []);
        node.setDataProperty('collapsedChainRepresentativeId', null);
        node.setDataProperty('isCollapsedChain', false);
        continue;
      }

      const descriptor = this._chainDescriptors.get(chainId);
      if (!descriptor) {
        node.setDataProperty('collapsedChainId', null);
        node.setDataProperty('collapsedChainLength', 1);
        node.setDataProperty('collapsedNodeIds', []);
        node.setDataProperty('collapsedEdgeIds', []);
        node.setDataProperty('collapsedChainRepresentativeId', null);
        node.setDataProperty('isCollapsedChain', false);
        continue;
      }

      const collapsed = this._isChainCollapsed(chainId);
      node.setDataProperty('collapsedChainId', chainId);
      node.setDataProperty('collapsedChainLength', collapsed ? descriptor.nodeIds.length : 1);
      node.setDataProperty('collapsedNodeIds', descriptor.nodeIds);
      node.setDataProperty('collapsedEdgeIds', descriptor.edgeIds);
      node.setDataProperty('collapsedChainRepresentativeId', descriptor.representativeId);
      node.setDataProperty('isCollapsedChain', collapsed);
    }
  }

  protected override _shouldSkipNode(nodeId: string | number): boolean {
    return this._hiddenNodeIds.has(nodeId);
  }

  protected override _mapNodeId(nodeId: string | number): string | number {
    const chainId = this._nodeToChainId.get(nodeId);
    if (!chainId) {
      return nodeId;
    }

    const descriptor = this._chainDescriptors.get(chainId);
    if (!descriptor) {
      return nodeId;
    }

    return this._isChainCollapsed(chainId) ? descriptor.representativeId : nodeId;
  }

  private _createChainId(nodeIds: (string | number)[]): string {
    return `chain:${nodeIds.map((id) => this._toDagId(id)).join('>')}`;
  }

  private _isChainCollapsed(chainId: string): boolean {
    const collapseDefault = this.props.collapseLinearChains;
    return this._collapsedChainState.get(chainId) ?? collapseDefault;
  }
}
