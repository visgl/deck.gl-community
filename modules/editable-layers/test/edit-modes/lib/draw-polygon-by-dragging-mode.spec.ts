// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeEach, expect, test, vi} from 'vitest';
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

test.each([0, 1, 2])('button %i draws only with the primary button', button => {
  dragToDrawPolygon(button);
  if (button === 0) {
    expect(props.onEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({editType: 'addFeature'})
    );
  } else {
    expect(props.onEdit).not.toHaveBeenCalled();
  }
});

test('Escape cancels queued throttled polygon edits', () => {
  vi.useFakeTimers();
  try {
    props.modeConfig = {throttleMs: 100};
    mode.handleStartDragging(createStartDraggingEvent([0, 0], [0, 0]), props);
    mode.handleDragging(createStartDraggingEvent([1, 0], [0, 0]), props);
    mode.handleDragging(createStartDraggingEvent([1, 1], [0, 0]), props);
    mode.handleKeyUp({key: 'Escape'} as KeyboardEvent, props);
    expect(props.onEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({editType: 'cancelFeature'})
    );
    const callCount = props.onEdit.mock.calls.length;
    vi.runAllTimers();
    expect(props.onEdit).toHaveBeenCalledTimes(callCount);
    expect(mode.getClickSequence()).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});
