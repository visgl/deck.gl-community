// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeEach, describe, expect, it} from 'vitest';
import {DrawPolygonByDraggingMode} from '../../../src/edit-modes/draw-polygon-by-dragging-mode';
import {
  createFeatureCollectionProps,
  createStartDraggingEvent,
  createStopDraggingEvent
} from '../test-utils';

let mode;
let props;

function setButton<T extends {sourceEvent: any}>(event: T, button: number): T {
  event.sourceEvent = {button};
  return event;
}

function dragToDrawPolygon(button: number) {
  mode.handleStartDragging(setButton(createStartDraggingEvent([0, 0], [0, 0]), button), props);
  mode.handleDragging(setButton(createStartDraggingEvent([1, 0], [0, 0]), button), props);
  mode.handleDragging(setButton(createStartDraggingEvent([1, 1], [0, 0]), button), props);
  mode.handleStopDragging(setButton(createStopDraggingEvent([0, 1], [0, 0]), button), props);
}

beforeEach(() => {
  mode = new DrawPolygonByDraggingMode();
  props = createFeatureCollectionProps({
    data: {
      type: 'FeatureCollection',
      features: []
    }
  });
});

describe('mouse buttons', () => {
  it('draws a polygon with the primary button', () => {
    dragToDrawPolygon(0);

    expect(props.onEdit).toHaveBeenCalled();
    const lastCall = props.onEdit.mock.calls[props.onEdit.mock.calls.length - 1][0];
    expect(lastCall.editType).toEqual('addFeature');
  });

  it('does not draw with the middle mouse button', () => {
    dragToDrawPolygon(1);

    expect(props.onEdit).not.toHaveBeenCalled();
  });

  it('does not draw with the right mouse button', () => {
    dragToDrawPolygon(2);

    expect(props.onEdit).not.toHaveBeenCalled();
  });
});
