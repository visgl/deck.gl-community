import {Deck, MapView} from '@deck.gl/core';

export function createContainer(style) {
  const container = document.createElement('canvas');
  Object.assign(
    container.style,
    {
      position: 'absolute',
      zIndex: 0,
      // block deck.gl's own event listeners
      pointerEvents: 'none',
      left: 0,
      top: 0
    },
    style
  );
  return container;
}

const mouseEvents = ['click', 'dblclick', 'mousedown', 'mousemove', 'mouseout'];
const redrawEvents = ['viewchange', 'mapresize', 'maptypechanged'];

export function createDeckInstance(map, overlay, props, Events) {
  const eventListeners = {};

  const deck = new Deck({
    ...props,
    canvas: overlay.container,

    views: new MapView({repeat: true}),
    ...getViewState(map),
    controller: false,
    userData: {
      _map: map,
      _eventListeners: eventListeners
    },
    onLoad: () => {
      // TODO: .tooltip is protected, find another  way to set this.
      // Bing Maps' label canvas has z-index of 20000
      // deck.tooltip.el.style.zIndex = 30000;
      if (props.onLoad) {
        props.onLoad();
      }
    }
  });

  // Register event listeners
  for (const eventType of mouseEvents) {
    eventListeners[eventType] = Events.addHandler(map, eventType, (evt) =>
      handleMouseEvent(deck, eventType, evt)
    );
  }
  for (const eventType of redrawEvents) {
    eventListeners[eventType] = Events.addHandler(map, eventType, () => overlay.redraw());
  }

  return deck;
}

export function getViewState(map) {
  const zoom = map.getZoom();
  const center = map.getCenter();
  const width = map.getWidth();
  const height = map.getHeight();

  return {
    width,
    height,
    viewState: {
      longitude: center.longitude,
      latitude: center.latitude,
      zoom: zoom - 1
    }
  };
}

export function destroyDeckInstance(deck, Events) {
  if (!deck) return;
  const eventListeners = deck.props.userData._eventListeners;
  for (const eventType in eventListeners) {
    Events.removeHandler(eventListeners[eventType]);
  }
  deck.finalize();
}

interface MockEvent {
  type: string,
  offsetCenter: {x: number, y: number},
  srcEvent: unknown,
  tapCount?: number
}

function handleMouseEvent(deck, type, event) {
  const mockEvent: MockEvent = {
    type,
    offsetCenter: {
      x: deck.props.width / 2 + event.getX(),
      y: deck.props.height / 2 + event.getY()
    },
    srcEvent: event
  };

  switch (type) {
    case 'mousedown':
      deck._onPointerDown(mockEvent);
      break;

    case 'click':
      mockEvent.tapCount = 1;
      deck._onEvent(mockEvent);
      break;

    case 'dblclick':
      mockEvent.type = 'click';
      mockEvent.tapCount = 2;
      deck._onEvent(mockEvent);
      break;

    case 'mousemove':
      mockEvent.type = 'pointermove';
      deck._onPointerMove(mockEvent);
      break;

    case 'mouseout':
      mockEvent.type = 'pointerleave';
      deck._onPointerMove(mockEvent);
      break;

    default:
      return;
  }
}
