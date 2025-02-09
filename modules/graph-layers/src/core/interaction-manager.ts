// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {EDGE_STATE, NODE_STATE, ValueOf} from './constants';
import {Edge} from '../graph/edge';
import {Node} from '../graph/node';
import {GraphEngine} from './graph-engine';

const NODE_TO_EDGE_STATE_MAP: Record<ValueOf<typeof NODE_STATE>, ValueOf<typeof EDGE_STATE>> = {
  [NODE_STATE.DEFAULT]: EDGE_STATE.DEFAULT,
  [NODE_STATE.HOVER]: EDGE_STATE.HOVER,
  [NODE_STATE.DRAGGING]: EDGE_STATE.DRAGGING,
  [NODE_STATE.SELECTED]: EDGE_STATE.SELECTED
};

function shouldEdgeBeSelected(edge: Edge): boolean {
  return edge
    .getConnectedNodes()
    .some(
      (node) => node.getState() === NODE_STATE.SELECTED && node.shouldHighlightConnectedEdges()
    );
}

function setNodeState(node: Node, state: ValueOf<typeof NODE_STATE>) {
  node.setState(state);
  if (node.shouldHighlightConnectedEdges()) {
    node.getConnectedEdges().forEach((edge) => {
      let newEdgeState = NODE_TO_EDGE_STATE_MAP[state];
      if (shouldEdgeBeSelected(edge)) {
        newEdgeState = EDGE_STATE.SELECTED;
      }
      edge.setState(newEdgeState);
    });
  }
}

interface EventMap {
  onClick?: (info: unknown, event: Event) => void;
  onHover?: (info: unknown) => void;
  onMouseEnter?: (info: unknown) => void;
  onMouseLeave?: (node: Node) => void;
  onDragStart?: (info: unknown) => void;
  onDrag?: (info: unknown) => void;
  onDragEnd?: (info: unknown) => void;
}

export interface InteractionManagerProps {
  nodeEvents?: EventMap;
  edgeEvents?: EventMap;
  engine: GraphEngine;
  enableDragging: boolean;
  resumeLayoutAfterDragging: boolean;
}

export class InteractionManager {
  public notifyCallback: Function;
  private _lastInteraction = 0;
  private _lastHoveredNode: Node | null = null;
  private _lastSelectedNode: Node | null = null;

  public nodeEvents: EventMap = undefined!;
  public edgeEvents: EventMap = undefined!;
  public engine: GraphEngine = undefined!;
  public enableDragging: boolean = undefined!;
  public resumeLayoutAfterDragging: boolean = undefined!;

  constructor(props: InteractionManagerProps, notifyCallback: Function) {
    this.updateProps(props);
    this.notifyCallback = notifyCallback;

    // internal state
    this._lastInteraction = 0;
    this._lastHoveredNode = null;
    this._lastSelectedNode = null;
  }

  updateProps({
    nodeEvents = {},
    edgeEvents = {},
    engine,
    enableDragging,
    resumeLayoutAfterDragging
  }: InteractionManagerProps): void {
    this.nodeEvents = nodeEvents;
    this.edgeEvents = edgeEvents;
    this.engine = engine;
    this.enableDragging = enableDragging;
    this.resumeLayoutAfterDragging = resumeLayoutAfterDragging;
  }

  getLastInteraction(): number {
    return this._lastInteraction;
  }

  onClick(info, event): void {
    const {object} = info;

    if (!object) {
      return;
    }

    if (object.isNode) {
      if ((object as Node).isSelectable()) {
        if (this._lastSelectedNode) {
          setNodeState(this._lastSelectedNode, NODE_STATE.DEFAULT);
        }
        setNodeState(object, NODE_STATE.SELECTED);
        this._lastSelectedNode = object as Node;
        this._lastInteraction = Date.now();
        this.notifyCallback();
      }

      if (this.nodeEvents.onClick) {
        this.nodeEvents.onClick(info, event);
      }
    }

    if (object.isEdge && this.edgeEvents.onClick) {
      this.edgeEvents.onClick(info, event);
    }
  }

  _mouseLeaveNode(): void {
    const lastHoveredNode = this._lastHoveredNode;

    if (!(lastHoveredNode.isSelectable() && lastHoveredNode.getState() === NODE_STATE.SELECTED)) {
      // reset the last hovered node's state
      const newState =
        this._lastSelectedNode !== null && this._lastSelectedNode.id === this._lastHoveredNode?.id
          ? NODE_STATE.SELECTED
          : NODE_STATE.DEFAULT;
      setNodeState(lastHoveredNode, newState);
    }
    // trigger the callback if exists
    if (this.nodeEvents.onMouseLeave) {
      this.nodeEvents.onMouseLeave(lastHoveredNode);
    }
  }

  _mouseEnterNode(info): void {
    // set the node's state to hover
    setNodeState(info.object as Node, NODE_STATE.HOVER);
    // trigger the callback if exists
    if (this.nodeEvents.onMouseEnter) {
      this.nodeEvents.onMouseEnter(info);
    }
    if (this.nodeEvents.onHover) {
      this.nodeEvents.onHover(info);
    }
  }

  onHover(info, event) {
    if (!info.object) {
      if (this._lastHoveredNode) {
        this._mouseLeaveNode();
        this._lastInteraction = Date.now();
        this._lastHoveredNode = null;
        this.notifyCallback();
      }
      return;
    }

    // hover over on a node
    if (info.object.isNode) {
      const isSameNode = this._lastHoveredNode && this._lastHoveredNode.id === info.object.id;
      // stay in the same node
      if (isSameNode) {
        return;
      }
      if (this._lastHoveredNode) {
        // reset the previous hovered node's state if not the same node
        this._mouseLeaveNode();
      }
      // enter new node
      this._mouseEnterNode(info);
      this._lastInteraction = Date.now();
      this._lastHoveredNode = info.object;
      this.notifyCallback();
    }
    if (info.object.isEdge && this.edgeEvents.onHover) {
      this.edgeEvents.onHover(info);
    }
  }

  onDragStart(info, event) {
    if (this.nodeEvents.onDragStart) {
      this.nodeEvents.onDragStart(info);
    }
  }

  onDrag(info, event) {
    if (!info.object.isNode || !this.enableDragging) {
      return;
    }
    event.stopImmediatePropagation();

    // info.viewport is undefined when the object is offscreen, so we use viewport from onDragStart
    const coordinates = info.layer.context.viewport.unproject([info.x, info.y]);

    // limit the node position to be within bounds of the viewport
    const bounds = info.layer.context.viewport.getBounds(); // [minX, minY, maxX, maxY]
    const x = Math.min(Math.max(coordinates[0], bounds[0]), bounds[2]);
    const y = Math.min(Math.max(coordinates[1], bounds[1]), bounds[3]);
    this.engine.lockNodePosition(info.object, x, y);

    setNodeState(info.object, NODE_STATE.DRAGGING);
    this._lastInteraction = Date.now();
    this.notifyCallback();
    if (this.nodeEvents.onDrag) {
      this.nodeEvents.onDrag(info);
    }
  }

  onDragEnd(info, event) {
    if (!info.object.isNode || !this.enableDragging) {
      return;
    }
    if (this.resumeLayoutAfterDragging) {
      this.engine.resume();
    }
    setNodeState(info.object, NODE_STATE.DEFAULT);
    this.engine.unlockNodePosition(info.object);
  }
}
