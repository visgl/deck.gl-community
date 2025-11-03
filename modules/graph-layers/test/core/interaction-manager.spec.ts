// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';
import {
  InteractionManager,
  resolveChainInteractionSource,
  shouldToggleCollapsedChain,
  type ChainInteractionSource
} from '../../src/core/interaction-manager';
import {Node} from '../../src/graph/node';
import {Edge} from '../../src/graph/edge';

function generateIMProps(extraProps = {}) {
  const engine = {
    lockNodePosition: jest.fn(),
    resume: jest.fn(),
    unlockNodePosition: jest.fn()
  };
  const props = {
    nodeEvents: {
      onClick: jest.fn(),
      onMouseEnter: jest.fn(),
      onHover: jest.fn(),
      onMouseLeave: jest.fn(),
      onDrag: jest.fn()
    },
    edgeEvents: {
      onClick: jest.fn(),
      onHover: jest.fn()
    },
    engine,
    enableDragging: true,
    resumeLayoutAfterDragging: true
  };
  return {
    props: {
      ...props,
      ...extraProps
    },
    notifyCallback: jest.fn()
  };
}

describe.skip('core/interaction-manager', () => {
  it('click a node', () => {
    const {props, notifyCallback} = generateIMProps();
    const im = new InteractionManager(props, notifyCallback);
    const clickedObj = {
      object: new Node({id: 'test-node'}),
      x: 1,
      y: 1,
      coordinate: [10, 10]
    };
    im.onClick(clickedObj);
    expect(props.nodeEvents.onClick.mock.calls.length).toBe(1);
  });

  it('click an edge', () => {
    const {props, notifyCallback} = generateIMProps();
    const im = new InteractionManager(props, notifyCallback);
    const clickedObj = {
      object: new Edge({id: 'test-edge'}),
      x: 1,
      y: 1,
      coordinate: [10, 10]
    };
    im.onClick(clickedObj);
    expect(props.edgeEvents.onClick.mock.calls.length).toBe(1);
  });

  it('hover & leave a node', () => {
    const {props, notifyCallback} = generateIMProps();
    const im = new InteractionManager(props, notifyCallback);
    const node = new Node({id: 'test-node'});
    node.setState = jest.fn();

    const clickedObj = {
      object: node,
      x: 1,
      y: 1,
      coordinate: [10, 10]
    };
    // hover the node
    im.onHover(clickedObj);
    expect(props.nodeEvents.onMouseEnter.mock.calls.length).toBe(1);
    expect(props.nodeEvents.onHover.mock.calls.length).toBe(1);
    expect(props.nodeEvents.onMouseLeave.mock.calls.length).toBe(0);
    expect(clickedObj.object.setState.mock.calls.length).toBe(1);
    // leave the node
    im.onHover({});
    expect(props.nodeEvents.onMouseEnter.mock.calls.length).toBe(1);
    expect(props.nodeEvents.onHover.mock.calls.length).toBe(1);
    expect(props.nodeEvents.onMouseLeave.mock.calls.length).toBe(1);
    expect(clickedObj.object.setState.mock.calls.length).toBe(2);
  });

  it('drag a node', () => {
    const {props, notifyCallback} = generateIMProps();
    const im = new InteractionManager(props, notifyCallback);
    const node = new Node({id: 'test-node'});
    node.setState = jest.fn();

    const clickedObj = {
      object: node,
      x: 1,
      y: 1,
      coordinate: [10, 10]
    };
    const event = {
      stopImmediatePropagation: jest.fn()
    };
    // start dragging the node
    im.onDragStart(clickedObj, event);
    // dragging
    im.onDrag(clickedObj, event);
    expect(event.stopImmediatePropagation.mock.calls.length).toBe(1);
    expect(props.engine.lockNodePosition.mock.calls.length).toBe(1);
    expect(clickedObj.object.setState.mock.calls.length).toBe(1);
    expect(notifyCallback.mock.calls.length).toBe(1);
    expect(props.nodeEvents.onDrag.mock.calls.length).toBe(1);

    // stop dragging the node
    im.onDragEnd(clickedObj, event);
    expect(props.engine.resume.mock.calls.length).toBe(1);
    expect(clickedObj.object.setState.mock.calls.length).toBe(2);
    expect(props.engine.unlockNodePosition.mock.calls.length).toBe(1);
  });

  it('test dragging a node when enableDragging = false & resumeLayoutAfterDragging = true', () => {
    const {props, notifyCallback} = generateIMProps({
      enableDragging: false
    });
    const im = new InteractionManager(props, notifyCallback);
    const node = new Node({id: 'test-node'});
    node.setState = jest.fn();

    const clickedObj = {
      object: node,
      x: 1,
      y: 1,
      coordinate: [10, 10]
    };
    const event = {
      stopImmediatePropagation: jest.fn()
    };
    // start dragging the node
    im.onDragStart(clickedObj, event);
    // dragging
    im.onDrag(clickedObj, event);
    expect(event.stopImmediatePropagation.mock.calls.length).toBe(0);
    expect(props.engine.lockNodePosition.mock.calls.length).toBe(0);
    expect(clickedObj.object.setState.mock.calls.length).toBe(0);
    expect(notifyCallback.mock.calls.length).toBe(0);
    expect(props.nodeEvents.onDrag.mock.calls.length).toBe(0);

    // stop dragging the node
    im.onDragEnd(clickedObj, event);
    expect(props.engine.resume.mock.calls.length).toBe(0);
    expect(clickedObj.object.setState.mock.calls.length).toBe(0);
    expect(props.engine.unlockNodePosition.mock.calls.length).toBe(0);
  });

  it('test dragging a node when enableDragging = true & resumeLayoutAfterDragging = false', () => {
    const {props, notifyCallback} = generateIMProps({
      enableDragging: true,
      resumeLayoutAfterDragging: false
    });
    const im = new InteractionManager(props, notifyCallback);
    const node = new Node({id: 'test-node'});
    node.setState = jest.fn();

    const clickedObj = {
      object: node,
      x: 1,
      y: 1,
      coordinate: [10, 10]
    };
    const event = {
      stopImmediatePropagation: jest.fn()
    };
    // start dragging the node
    im.onDragStart(clickedObj, event);
    // dragging
    im.onDrag(clickedObj, event);
    expect(event.stopImmediatePropagation.mock.calls.length).toBe(1);
    expect(props.engine.lockNodePosition.mock.calls.length).toBe(1);
    expect(clickedObj.object.setState.mock.calls.length).toBe(1);
    expect(notifyCallback.mock.calls.length).toBe(1);
    expect(props.nodeEvents.onDrag.mock.calls.length).toBe(1);

    // stop dragging the node
    im.onDragEnd(clickedObj, event);
    expect(props.engine.resume.mock.calls.length).toBe(0);
    expect(clickedObj.object.setState.mock.calls.length).toBe(2);
    expect(props.engine.unlockNodePosition.mock.calls.length).toBe(1);
  });
});

describe('resolveChainInteractionSource', () => {
  it('detects marker layers through nested parents', () => {
    const layerTree = {
      id: 'graph-layer-expanded-chain-markers-marker-layer',
      parent: {id: 'graph-layer-expanded-chain-markers', parent: null}
    };

    expect(resolveChainInteractionSource(layerTree)).toBe('expanded-marker');
  });

  it('detects outline layers and defaults to node when absent', () => {
    const outlineLayer = {
      id: 'graph-layer-collapsed-chain-outlines-zoomable-marker-layer',
      parent: {id: 'graph-layer-collapsed-chain-outlines', parent: null}
    };

    expect(resolveChainInteractionSource(outlineLayer)).toBe('collapsed-outline');
    expect(resolveChainInteractionSource(null)).toBe('node');
  });
});

describe('shouldToggleCollapsedChain', () => {
  const sources: ChainInteractionSource[] = [
    'node',
    'collapsed-marker',
    'expanded-marker',
    'collapsed-outline',
    'expanded-outline'
  ];

  it('always toggles when the chain is collapsed', () => {
    for (const source of sources) {
      expect(shouldToggleCollapsedChain(true, source)).toBe(true);
    }
  });

  it('only toggles expanded chains for marker or outline clicks', () => {
    expect(shouldToggleCollapsedChain(false, 'node')).toBe(false);
    expect(shouldToggleCollapsedChain(false, 'collapsed-marker')).toBe(false);
    expect(shouldToggleCollapsedChain(false, 'collapsed-outline')).toBe(false);
    expect(shouldToggleCollapsedChain(false, 'expanded-marker')).toBe(true);
    expect(shouldToggleCollapsedChain(false, 'expanded-outline')).toBe(true);
  });
});
