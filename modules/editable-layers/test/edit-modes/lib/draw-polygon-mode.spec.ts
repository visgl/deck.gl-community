// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeEach, describe, it, expect} from 'vitest';
import {DrawPolygonMode} from '../../../src/edit-modes/draw-polygon-mode';
import {createFeatureCollectionProps, createClickEvent, createKeyboardEvent, createPolygonFeature} from '../test-utils';

let props;
let mode;

beforeEach(() => {
  mode = new DrawPolygonMode();
  props = createFeatureCollectionProps({
    data: {
      type: 'FeatureCollection',
      features: []
    }
  });

  mode.handleClick(createClickEvent([0, 2]), props);
  mode.handleClick(createClickEvent([2, 2]), props);
  mode.handleClick(createClickEvent([2, 0]), props);
});

describe('after double-clicking', () => {
  beforeEach(() => {
    // Click very close to the first point to close the polygon
    mode.handleClick(createClickEvent([0.00001, 2.00001]), props);
  });
  it('calls onEdit with an added feature', () => {
    expect(props.onEdit).toHaveBeenCalled();
    const lastCall = props.onEdit.mock.calls[props.onEdit.mock.calls.length - 1][0];
    expect(lastCall.editType).toEqual('addFeature');
    expect(lastCall.updatedData.features).toEqual([
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 2],
              [2, 0],
              [2, 2],
              [0, 2]
            ]
          ]
        }
      }
    ]);
  });
});

describe('after hitting enter', () => {
  beforeEach(() => {
    mode.handleKeyUp(createKeyboardEvent('Enter'), props);
  });
  it('calls onEdit with an added feature', () => {
    expect(props.onEdit).toHaveBeenCalled();
    const lastCall = props.onEdit.mock.calls[props.onEdit.mock.calls.length - 1][0];
    expect(lastCall.editType).toEqual('addFeature');
    expect(lastCall.updatedData.features).toEqual([
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 2],
              [2, 0],
              [2, 2],
              [0, 2]
            ]
          ]
        }
      }
    ]);
  });
});

describe('after hitting escape', () => {
  beforeEach(() => {
    mode.handleKeyUp(createKeyboardEvent('Escape'), props);
  });

  it('calls onEdit with cancelFeature', () => {
    expect(props.onEdit).toHaveBeenCalled();
    const lastCall = props.onEdit.mock.calls[props.onEdit.mock.calls.length - 1][0];
    expect(lastCall.editType).toEqual('cancelFeature');
  });

  it("doesn't change the data", () => {
    const expectedData = {
      type: 'FeatureCollection',
      features: []
    };
    const lastCall = props.onEdit.mock.calls[props.onEdit.mock.calls.length - 1][0];
    expect(lastCall.updatedData).toEqual(expectedData);
  });

  it('resets the click sequence', () => {
    expect(mode.getClickSequence()).toEqual([]);
  });
});

describe('allowHoles configuration', () => {
  describe('when allowHoles is false (default)', () => {
    beforeEach(() => {
      mode = new DrawPolygonMode();
      props = createFeatureCollectionProps({
        data: {
          type: 'FeatureCollection',
          features: [createPolygonFeature()]
        },
        modeConfig: { allowHoles: false }
      });
    });

    it('creates a new polygon instead of a hole when drawing inside existing polygon', () => {
      // Draw a small polygon inside the existing one
      mode.handleClick(createClickEvent([-0.3, -0.3]), props);
      mode.handleClick(createClickEvent([-0.1, -0.3]), props);
      mode.handleClick(createClickEvent([-0.1, -0.1]), props);
      mode.handleClick(createClickEvent([-0.3, -0.1]), props);
      mode.finishDrawing(props);

      const lastCall = props.onEdit.mock.calls[props.onEdit.mock.calls.length - 1][0];
      expect(lastCall.editType).toEqual('addFeature');
      expect(lastCall.updatedData.features).toHaveLength(2);
      expect(lastCall.updatedData.features[1].geometry.coordinates).toHaveLength(1); // No holes
    });
  });

  describe('when allowHoles is true', () => {
    beforeEach(() => {
      mode = new DrawPolygonMode();
      props = createFeatureCollectionProps({
        data: {
          type: 'FeatureCollection',
          features: [createPolygonFeature()]
        },
        modeConfig: { allowHoles: true }
      });
    });

    it('creates a hole when drawing inside existing polygon', () => {
      // Draw a small polygon inside the existing one, avoiding the existing hole
      mode.handleClick(createClickEvent([0.6, 0.6]), props);
      mode.handleClick(createClickEvent([0.8, 0.6]), props);
      mode.handleClick(createClickEvent([0.8, 0.8]), props);
      mode.handleClick(createClickEvent([0.6, 0.8]), props);
      mode.finishDrawing(props);

      const lastCall = props.onEdit.mock.calls[props.onEdit.mock.calls.length - 1][0];
      expect(lastCall.editType).toEqual('addHole');
      expect(lastCall.updatedData.features[0].geometry.coordinates).toHaveLength(3); // Original exterior + original hole + new hole
    });

    it('prevents creating intersecting holes', () => {
      // Try to draw a hole that intersects with the existing hole
      // The existing hole is at [-0.5, -0.5] to [0.5, 0.5]
      // Create a hole that partially overlaps
      mode.handleClick(createClickEvent([0, -0.8]), props);
      mode.handleClick(createClickEvent([0.8, -0.8]), props);
      mode.handleClick(createClickEvent([0.8, 0]), props);
      mode.handleClick(createClickEvent([0, 0]), props);
      mode.finishDrawing(props);

      const lastCall = props.onEdit.mock.calls[props.onEdit.mock.calls.length - 1][0];
      expect(lastCall.editType).toEqual('invalidHole');
      expect(lastCall.editContext.reason).toEqual('intersects-existing-hole');
    });

    it('prevents creating holes that contain existing holes', () => {
      // Try to draw a hole that contains the existing hole
      mode.handleClick(createClickEvent([-0.8, -0.8]), props);
      mode.handleClick(createClickEvent([0.8, -0.8]), props);
      mode.handleClick(createClickEvent([0.8, 0.8]), props);
      mode.handleClick(createClickEvent([-0.8, 0.8]), props);
      mode.finishDrawing(props);

      const lastCall = props.onEdit.mock.calls[props.onEdit.mock.calls.length - 1][0];
      expect(lastCall.editType).toEqual('invalidHole');
      expect(lastCall.editContext.reason).toEqual('contains-or-contained-by-existing-hole');
    });

    it('prevents creating holes outside of polygon boundaries', () => {
      // Draw outside the existing polygon
      mode.handleClick(createClickEvent([2, 2]), props);
      mode.handleClick(createClickEvent([3, 2]), props);
      mode.handleClick(createClickEvent([3, 3]), props);
      mode.handleClick(createClickEvent([2, 3]), props);
      mode.finishDrawing(props);

      const lastCall = props.onEdit.mock.calls[props.onEdit.mock.calls.length - 1][0];
      expect(lastCall.editType).toEqual('addFeature');
      expect(lastCall.updatedData.features).toHaveLength(2); // Creates new polygon instead
    });
  });
});

describe('allowSelfIntersection configuration', () => {
  describe('when allowSelfIntersection is false (default)', () => {
    beforeEach(() => {
      mode = new DrawPolygonMode();
      props = createFeatureCollectionProps({
        data: {
          type: 'FeatureCollection',
          features: []
        },
        modeConfig: { allowSelfIntersection: false }
      });
    });

    it('prevents creating overlapping polygons', () => {
      // Create a bowtie/figure-8 shape
      mode.handleClick(createClickEvent([0, 0]), props);
      mode.handleClick(createClickEvent([2, 2]), props);
      mode.handleClick(createClickEvent([2, 0]), props);
      mode.handleClick(createClickEvent([0, 2]), props);
      mode.finishDrawing(props);

      const lastCall = props.onEdit.mock.calls[props.onEdit.mock.calls.length - 1][0];
      expect(lastCall.editType).toEqual('invalidPolygon');
      expect(lastCall.editContext.reason).toEqual('overlaps');
    });

    it('allows creating valid non-intersecting polygons', () => {
      // Create a simple triangle
      mode.handleClick(createClickEvent([0, 0]), props);
      mode.handleClick(createClickEvent([1, 0]), props);
      mode.handleClick(createClickEvent([0.5, 1]), props);
      mode.finishDrawing(props);

      const lastCall = props.onEdit.mock.calls[props.onEdit.mock.calls.length - 1][0];
      expect(lastCall.editType).toEqual('addFeature');
      expect(lastCall.updatedData.features).toHaveLength(1);
    });
  });

  describe('when allowSelfIntersection is true', () => {
    beforeEach(() => {
      mode = new DrawPolygonMode();
      props = createFeatureCollectionProps({
        data: {
          type: 'FeatureCollection',
          features: []
        },
        modeConfig: { allowSelfIntersection: true }
      });
    });

    it('allows creating overlapping polygons', () => {
      // Create a bowtie/figure-8 shape
      mode.handleClick(createClickEvent([0, 0]), props);
      mode.handleClick(createClickEvent([2, 2]), props);
      mode.handleClick(createClickEvent([2, 0]), props);
      mode.handleClick(createClickEvent([0, 2]), props);
      mode.finishDrawing(props);

      const lastCall = props.onEdit.mock.calls[props.onEdit.mock.calls.length - 1][0];
      expect(lastCall.editType).toEqual('addFeature');
      expect(lastCall.updatedData.features).toHaveLength(1);
      expect(lastCall.updatedData.features[0].geometry.coordinates[0]).toEqual([
        [0, 0],
        [2, 2],
        [2, 0],
        [0, 2],
        [0, 0]
      ]);
    });
  });
});
