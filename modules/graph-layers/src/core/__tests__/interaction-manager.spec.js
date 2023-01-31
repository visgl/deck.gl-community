import InteractionManager from '../interaction-manager';
import Node from '../node';
import Edge from '../edge';

function generateIMProps(extraProps = {}) {
  const engine = {
    lockNodePosition: jest.fn(),
    resume: jest.fn(),
    unlockNodePosition: jest.fn(),
  };
  const props = {
    nodeEvents: {
      onClick: jest.fn(),
      onMouseEnter: jest.fn(),
      onHover: jest.fn(),
      onMouseLeave: jest.fn(),
      onDrag: jest.fn(),
    },
    edgeEvents: {
      onClick: jest.fn(),
      onHover: jest.fn(),
    },
    engine,
    enableDragging: true,
    resumeLayoutAfterDragging: true,
  };
  return {
    props: {
      ...props,
      ...extraProps,
    },
    notifyCallback: jest.fn(),
  };
}

describe('core/interaction-manager', () => {
  it('click a node', () => {
    const {props, notifyCallback} = generateIMProps();
    const im = new InteractionManager(props, notifyCallback);
    const clickedObj = {
      object: new Node({id: 'test-node'}),
      x: 1,
      y: 1,
      coordinate: [10, 10],
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
      coordinate: [10, 10],
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
      coordinate: [10, 10],
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
      coordinate: [10, 10],
    };
    const event = {
      stopImmediatePropagation: jest.fn(),
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
      enableDragging: false,
    });
    const im = new InteractionManager(props, notifyCallback);
    const node = new Node({id: 'test-node'});
    node.setState = jest.fn();

    const clickedObj = {
      object: node,
      x: 1,
      y: 1,
      coordinate: [10, 10],
    };
    const event = {
      stopImmediatePropagation: jest.fn(),
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
      resumeLayoutAfterDragging: false,
    });
    const im = new InteractionManager(props, notifyCallback);
    const node = new Node({id: 'test-node'});
    node.setState = jest.fn();

    const clickedObj = {
      object: node,
      x: 1,
      y: 1,
      coordinate: [10, 10],
    };
    const event = {
      stopImmediatePropagation: jest.fn(),
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
