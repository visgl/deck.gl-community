// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeEach, afterEach, describe, it, expect} from 'vitest';
import {DrawEllipseUsingThreePointsMode} from '../../../src/edit-modes/draw-ellipse-using-three-points-mode';
import {
  createFeatureCollectionProps,
  createFeatureCollection,
  createClickEvent,
  createPointerMoveEvent
} from '../test-utils';
import {FeatureCollection} from '../../../src/utils/geojson-types';

let featureCollection: FeatureCollection;

let warnBefore: typeof console.warn;
beforeEach(() => {
  warnBefore = console.warn; // eslint-disable-line
  // $FlowFixMe
  console.warn = function () {}; // eslint-disable-line
  // @ts-expect-error TODO
  featureCollection = createFeatureCollection();

  const makeFlowHappy = featureCollection.features.find((f) => f.geometry.type === 'Polygon');
  if (!makeFlowHappy) {
    throw new Error('Need a Polygon in my setup');
  }
});

afterEach(() => {
  // $FlowFixMe
  console.warn = warnBefore; // eslint-disable-line
});

describe('dragToDraw=false', () => {
  it('sets tentative feature to a LineString after first click', () => {
    const mode = new DrawEllipseUsingThreePointsMode();

    const props = createFeatureCollectionProps();
    props.lastPointerMoveEvent = createPointerMoveEvent([1, 2]);
    mode.handleClick(createClickEvent([1, 2]), props);
    props.lastPointerMoveEvent = createPointerMoveEvent([2, 3]);

    const tentativeFeature = mode.getTentativeGuide(props);

    if (!tentativeFeature) {
      throw new Error('Should have tentative feature');
    }
    expect(tentativeFeature.geometry.type).toEqual('LineString');
    expect(tentativeFeature.geometry.coordinates.length).toEqual(2);
  });

  it('sets tentative feature to a Polygon after second click', () => {
    const mode = new DrawEllipseUsingThreePointsMode();

    const props = createFeatureCollectionProps();
    props.lastPointerMoveEvent = createPointerMoveEvent([1, 2]);
    mode.handleClick(createClickEvent([1, 2]), props);
    props.lastPointerMoveEvent = createPointerMoveEvent([3, 5]);
    mode.handleClick(createClickEvent([3, 5]), props);
    props.lastPointerMoveEvent = createPointerMoveEvent([2, 4]);

    const tentativeFeature = mode.getTentativeGuide(props);

    if (!tentativeFeature) {
      throw new Error('Should have tentative feature');
    }
    expect(tentativeFeature.geometry.type).toEqual('Polygon');
    // @ts-expect-error TODO
    expect(tentativeFeature.geometry.coordinates[0].length).toEqual(65);
  });

  it('adds a new feature after two clicks', () => {
    const mode = new DrawEllipseUsingThreePointsMode();

    const props = createFeatureCollectionProps();
    props.lastPointerMoveEvent = createPointerMoveEvent([1, 2]);
    mode.handleClick(createClickEvent([1, 2]), props);
    props.lastPointerMoveEvent = createPointerMoveEvent([3, 5]);
    mode.handleClick(createClickEvent([3, 5]), props);
    props.lastPointerMoveEvent = createPointerMoveEvent([2, 4]);
    mode.handleClick(createClickEvent([2, 4]), props);

    expect(props.onEdit).toHaveBeenCalledTimes(1);
    // @ts-expect-error TODO
    const result = props.onEdit.mock.calls[0][0];
    expect(result.editType).toEqual('addFeature');
    expect(result.editContext.featureIndexes).toEqual([featureCollection.features.length]);

    const resultFeatures = result.updatedData.features;
    const newFeature = resultFeatures[resultFeatures.length - 1];
    expect(newFeature.properties.editProperties.shape).toEqual('Ellipse');
    expect(newFeature.properties.editProperties.center).toEqual([2, 3.5]);
    expect(newFeature.properties.editProperties.xSemiAxis.unit).toEqual('kilometers');
    expect(newFeature.properties.editProperties.ySemiAxis.unit).toEqual('kilometers');
    expect(newFeature.properties.editProperties.xSemiAxis.value).closeTo(55.59754011676645, 1e-9);
    expect(newFeature.properties.editProperties.ySemiAxis.value).closeTo(200.33769586103622, 1e-9);
    expect(newFeature.properties.editProperties.angle).closeTo(33.58534207212082, 1e-9);
    expect(newFeature.geometry.type).toEqual('Polygon');
    expect(newFeature.geometry.coordinates[0].length).toEqual(65);
  });
});
