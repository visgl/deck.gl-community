// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  ClickEvent,
  PointerMoveEvent,
  ModeProps,
  GuideFeatureCollection,
  TentativeFeature
} from './types';
import {
  Position,
  Polygon,
  Feature,
  FeatureCollection,
  SimpleFeatureCollection
} from '../utils/geojson-types';
import {GeoJsonEditMode} from './geojson-edit-mode';
import {EditModeCoordinateSystem} from './coordinate-system';

export class ThreeClickPolygonMode extends GeoJsonEditMode {
  handleClick(event: ClickEvent, props: ModeProps<SimpleFeatureCollection>) {
    this.addClickSequence(event);

    const {modeConfig, coordinateSystem} = props;
    const clickSequence = this.getClickSequence();

    if (clickSequence.length > 2) {
      const {geometry, properties} = this.getThreeClickPolygon(
        clickSequence[0],
        clickSequence[1],
        clickSequence[2],
        modeConfig,
        coordinateSystem
      );

      const editAction = this.getAddFeatureOrBooleanPolygonAction(geometry, props, properties);
      this.resetClickSequence();

      if (editAction) {
        props.onEdit(editAction);
      }
    }
  }

  getGuides(props: ModeProps<FeatureCollection>): GuideFeatureCollection {
    const {lastPointerMoveEvent, modeConfig, coordinateSystem} = props;
    const clickSequence = this.getClickSequence();

    const guides: GuideFeatureCollection = {
      type: 'FeatureCollection',
      features: []
    };

    const coords = [
      ...clickSequence,
      ...(lastPointerMoveEvent ? [lastPointerMoveEvent.mapCoords] : [])
    ];

    if (coords.length === 2) {
      guides.features.push({
        type: 'Feature',
        properties: {
          guideType: 'tentative'
        },
        geometry: {
          type: 'LineString',
          coordinates: [coords[0], coords[1]]
        }
      });
    } else if (coords.length > 2) {
      const polygon = this.getThreeClickPolygon(
        coords[0],
        coords[1],
        coords[2],
        modeConfig,
        coordinateSystem
      );
      if (polygon) {
        guides.features.push({
          ...polygon,
          properties: {
            ...polygon.properties,
            guideType: 'tentative'
          }
        });
      }
    }

    return guides;
  }

  getThreeClickPolygon(
    coord1: Position,
    coord2: Position,
    coord3: Position,
    modeConfig: any,
    coordSystem?: EditModeCoordinateSystem
  ): Feature<Polygon> | null | undefined {
    return null;
  }

  handlePointerMove(event: PointerMoveEvent, props: ModeProps<FeatureCollection>) {
    props.onUpdateCursor('cell');
    super.handlePointerMove(event, props);
  }

  createTentativeFeature(props: ModeProps<FeatureCollection>): TentativeFeature {
    const {lastPointerMoveEvent, coordinateSystem} = props;
    const clickSequence = this.getClickSequence();

    const lastCoords = lastPointerMoveEvent ? [lastPointerMoveEvent.mapCoords] : [];

    let tentativeFeature;
    if (clickSequence.length === 2) {
      tentativeFeature = this.getThreeClickPolygon(
        clickSequence[0],
        clickSequence[1],
        lastCoords[0],
        props.modeConfig,
        coordinateSystem
      );
    }

    return tentativeFeature;
  }
}
