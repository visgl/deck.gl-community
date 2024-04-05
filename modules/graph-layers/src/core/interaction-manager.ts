import {EDGE_STATE, NODE_STATE} from './constants';

const NODE_TO_EDGE_STATE_MAP = {
  [NODE_STATE.DEFAULT]: EDGE_STATE.DEFAULT,
  [NODE_STATE.HOVER]: EDGE_STATE.HOVER,
  [NODE_STATE.DRAGGING]: EDGE_STATE.DRAGGING,
  [NODE_STATE.SELECTED]: EDGE_STATE.SELECTED
};

function shouldEdgeBeSelected(edge) {
  return edge
    .getConnectedNodes()
    .some(
      (node) => node.getState() === NODE_STATE.SELECTED && node.shouldHighlightConnectedEdges()
    );
}

function setNodeState(node, state) {
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

export default class InteractionManager {
  constructor(props, notifyCallback) {
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
  }) {
    this.nodeEvents = nodeEvents;
    this.edgeEvents = edgeEvents;
    this.engine = engine;
    this.enableDragging = enableDragging;
    this.resumeLayoutAfterDragging = resumeLayoutAfterDragging;
  }

  getLastInteraction() {
    return this._lastInteraction;
  }

  onClick(info, event) {
    const {object} = info;

    if (!object) {
      return;
    }

    if (object.isNode) {
      if (object.isSelectable()) {
        if (this._lastSelectedNode) {
          setNodeState(this._lastSelectedNode, NODE_STATE.DEFAULT);
        }
        setNodeState(object, NODE_STATE.SELECTED);
        this._lastSelectedNode = object;
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

  _mouseLeaveNode() {
    const lastHoveredNode = this._lastHoveredNode;

    if (!(lastHoveredNode.isSelectable() && lastHoveredNode.getState() === NODE_STATE.SELECTED)) {
      // reset the last hovered node's state
      const newState =
        this._lastSelectedNode !== null && this._lastSelectedNode.id === this._lastHoveredNode?.id
          ? NODE_STATE.SELECTED
          : NODE_STATE.DEFAULT;
      setNodeState(this._lastHoveredNode, newState);
    }
    // trigger the callback if exists
    if (this.nodeEvents.onMouseLeave) {
      this.nodeEvents.onMouseLeave(this._lastHoveredNode);
    }
  }

  _mouseEnterNode(info) {
    // set the node's state to hover
    setNodeState(info.object, NODE_STATE.HOVER);
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
