// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import lineIntersect from '@turf/line-intersect';
import { polygon as turfPolygon} from '@turf/helpers';
import booleanWithin from "@turf/boolean-within";
import type {Geometry} from 'geojson'

import {
  ClickEvent,
  PointerMoveEvent,
  ModeProps,
  GuideFeatureCollection,
  TentativeFeature,
  GuideFeature,
  DoubleClickEvent
} from './types';
import {Position, FeatureCollection} from 'geojson';
import {SimpleFeatureCollection} from '../utils/geojson-types';
import {getPickedEditHandle} from './utils';
import {GeoJsonEditMode} from './geojson-edit-mode';
import { ImmutableFeatureCollection } from './immutable-feature-collection';


export class DrawPolygonMode extends GeoJsonEditMode {

  holeSequence: Position[] = [];  
  isDrawingHole = false;

  createTentativeFeature(props: ModeProps<FeatureCollection>): TentativeFeature {
    const { lastPointerMoveEvent } = props;
    const clickSequence = this.getClickSequence();
    const holeSequence = this.holeSequence;
    const lastCoords = lastPointerMoveEvent
      ? [lastPointerMoveEvent.mapCoords]
      : [];

    let geometry: Geometry;

    if (this.isDrawingHole && holeSequence.length > 1) {
      geometry = {
        type: "Polygon",
        coordinates: [
          [...clickSequence, clickSequence[0]],
          [...holeSequence, ...lastCoords, holeSequence[0]],
        ],
      };
    } else if (clickSequence.length > 2) {
      geometry = {
        type: "Polygon",
        coordinates: [[...clickSequence, ...lastCoords, clickSequence[0]]],
      };
    } else {
      geometry = {
        type: "LineString",
        coordinates: [...clickSequence, ...lastCoords],
      };
    }

    return {
      type: "Feature",
      properties: {
        guideType: "tentative",
      },
      geometry,
    };
  }

  getGuides(props: ModeProps<FeatureCollection>): GuideFeatureCollection {
    const guides: GuideFeatureCollection = {
          type: "FeatureCollection",
          features: [],
        };
    
        const tentative = this.createTentativeFeature(props);
        if (tentative) guides.features.push(tentative);
    
        const sequence = this.isDrawingHole
          ? this.holeSequence
          : this.getClickSequence();
    
        const handles: GuideFeature[] = sequence.map((coord, index) => ({
          type: "Feature",
          properties: {
            guideType: "editHandle",
            editHandleType: "existing",
            featureIndex: -1,
            positionIndexes: [index],
          },
          geometry: {
            type: "Point",
            coordinates: coord,
          },
        }));
    
        guides.features.push(...handles);
        return guides;
  }

  // eslint-disable-next-line complexity, max-statements
  handleClick(event: ClickEvent, props: ModeProps<SimpleFeatureCollection>) {
    const {picks} = event;
    const clickedEditHandle = getPickedEditHandle(picks);
    const clickSequence = this.getClickSequence();
    const coords = event.mapCoords;
    
    // Check if they clicked on an edit handle to complete the polygon
    if (
      !this.isDrawingHole &&
      clickSequence.length > 2 &&
      clickedEditHandle &&
      Array.isArray(clickedEditHandle.properties.positionIndexes) &&
      (clickedEditHandle.properties.positionIndexes[0] === 0 ||
        clickedEditHandle.properties.positionIndexes[0] === clickSequence.length - 1)
    ) {
      // They clicked the first or last point, so complete the polygon
      this.finishDrawing(props);
      return;
    }
    
    // Check if they clicked near the first point to complete the polygon
    if (!this.isDrawingHole && clickSequence.length > 2) {
      if (isNearFirstPoint(coords, clickSequence[0])) {
        this.finishDrawing(props);
        this.resetClickSequence();
        return;
      }
    }
    
    if (this.isDrawingHole) {
      const current = this.holeSequence;
      current.push(coords);

      if (current.length > 2) {
        const poly: Geometry = {
          type: "Polygon",
          coordinates: [
            [...clickSequence, clickSequence[0]],
            [...current, current[0]],
          ],
        };

        this.resetClickSequence();
        this.holeSequence = [];
        this.isDrawingHole = false;

        const editAction = this.getAddFeatureOrBooleanPolygonAction(
          poly,
          props,
        );
        if (editAction) props.onEdit(editAction);
      }
      return;
    }

    // Add the click if we didn't click on a handle
    let positionAdded = false;
    if (!clickedEditHandle) {
      this.addClickSequence(event);
      positionAdded = true;
    }

    if (positionAdded) {
      // new tentative point
      props.onEdit({
        // data is the same
        updatedData: props.data,
        editType: 'addTentativePosition',
        editContext: {
          position: event.mapCoords
        }
      });
    }
  }

  handleDoubleClick(_event: DoubleClickEvent, props: ModeProps<SimpleFeatureCollection>) {
    this.finishDrawing(props);
    this.resetClickSequence();
  }

  handleKeyUp(event: KeyboardEvent, props: ModeProps<SimpleFeatureCollection>) {
    if (event.key === "Enter") {
      this.finishDrawing(props);
      this.resetClickSequence();
    } else if (event.key === "Escape") {
      this.resetClickSequence();
      this.holeSequence = [];
      this.isDrawingHole = false;

      props.onEdit({
        updatedData: props.data,
        editType: "cancelFeature",
        editContext: {},
      });
    }
  }

  handlePointerMove(event: PointerMoveEvent, props: ModeProps<FeatureCollection>) {
    props.onUpdateCursor('cell');
    super.handlePointerMove(event, props);
  }

  // eslint-disable-next-line max-statements, complexity
  finishDrawing(props: ModeProps<SimpleFeatureCollection>) {
    const clickSequence = this.getClickSequence();
    const polygon = [...clickSequence, clickSequence[0]];

    const newPolygon = turfPolygon([polygon]);

    const canAddHole = canAddHoleToPolygon(props);
    const canOverlap = canPolygonOverlap(props);


    // Check if the polygon intersects itself (excluding shared start/end point)
    if (!canOverlap) {
      const overlapping = lineIntersect(
        newPolygon,
        newPolygon,
      ).features.filter(
        (intersection) =>
          !newPolygon.geometry.coordinates[0].some(
            (coord) =>
              coord[0] === intersection.geometry.coordinates[0] &&
              coord[1] === intersection.geometry.coordinates[1],
          ),
      );
  
      if (overlapping.length > 0) {
        // ❌ Invalid polygon: overlaps
        props.onEdit({
          updatedData: props.data,
          editType: "invalidPolygon",
          editContext: { reason: "overlaps" },
        });
        this.resetClickSequence();
        return;
      }
    }

    if (canAddHole) {
      const holeResult = this.tryAddHoleToExistingPolygon(newPolygon, polygon, props);
      if (holeResult.handled) {
        this.resetClickSequence();
        return;
      }
    }
    
    // If no valid hole was found, add the polygon as a new feature
    const editAction = this.getAddFeatureOrBooleanPolygonAction(
      {
        type: "Polygon",
        coordinates: [[...this.getClickSequence(), this.getClickSequence()[0]]],
      },
      props,
    );
    if (editAction) props.onEdit(editAction);
    this.resetClickSequence();
    return;
  }

  private tryAddHoleToExistingPolygon(
    newPolygon: any,
    polygon: Position[],
    props: ModeProps<SimpleFeatureCollection>
  ): { handled: boolean } {
    for (const [featureIndex, feature] of props.data.features.entries()) {
      if (feature.geometry.type === "Polygon") {
        const result = this.validateAndCreateHole(feature, featureIndex, newPolygon, polygon, props);
        if (result.handled) {
          return result;
        }
      }
    }
    
    return { handled: false };
  }

  private validateAndCreateHole(
    feature: any,
    featureIndex: number,
    newPolygon: any,
    polygon: Position[],
    props: ModeProps<SimpleFeatureCollection>
  ): { handled: boolean } {
    const outer = turfPolygon(feature.geometry.coordinates);

    // Check existing holes for conflicts
    for (let i = 1; i < feature.geometry.coordinates.length; i++) {
      const hole = turfPolygon([feature.geometry.coordinates[i]]);
      const intersection = lineIntersect(hole, newPolygon);
      
      if (intersection.features.length > 0) {
        props.onEdit({
          updatedData: props.data,
          editType: "invalidHole",
          editContext: { reason: "intersects-existing-hole" },
        });
        return { handled: true };
      }

      if (booleanWithin(hole, newPolygon) || booleanWithin(newPolygon, hole)) {
        props.onEdit({
          updatedData: props.data,
          editType: "invalidHole",
          editContext: { reason: "contains-or-contained-by-existing-hole" },
        });
        return { handled: true };
      }
    }

    // Check outer polygon conflicts
    const intersectionWithOuter = lineIntersect(outer, newPolygon);
    if (intersectionWithOuter.features.length > 0) {
      props.onEdit({
        updatedData: props.data,
        editType: "invalidPolygon",
        editContext: { reason: "intersects-existing-polygon" },
      });
      return { handled: true };
    }

    if (booleanWithin(outer, newPolygon)) {
      props.onEdit({
        updatedData: props.data,
        editType: "invalidPolygon",
        editContext: { reason: "contains-existing-polygon" },
      });
      return { handled: true };
    }

    // Check if new polygon is within outer polygon (valid hole)
    if (booleanWithin(newPolygon, outer)) {
      const updatedData = new ImmutableFeatureCollection(props.data)
        .replaceGeometry(featureIndex, {
          ...feature.geometry,
          coordinates: [...feature.geometry.coordinates, polygon],
        })
        .getObject();

      props.onEdit({
        updatedData,
        editType: "addHole",
        editContext: { hole: newPolygon.geometry },
      });
      return { handled: true };
    }
    return { handled: false };
  }
}

// Helper function to check if a point is near the first point in the sequence
function isNearFirstPoint(
  click: Position,
  first: Position,
  threshold = 1e-4,
): boolean {
  const dx = click[0] - first[0];
  const dy = click[1] - first[1];
  return dx * dx + dy * dy < threshold * threshold;
}

// Helper function to determine if a hole can be added to a polygon
function canAddHoleToPolygon(
  props: ModeProps<FeatureCollection>
): boolean {
  // For simplicity, always return true in this example.
  // Implement your own logic based on application requirements.
  return props.modeConfig?.allowHoles ?? false;
}

// Helper function to determine if a polygon can intersect itself
function canPolygonOverlap(
  props: ModeProps<FeatureCollection>
): boolean {
  // Return the value of allowSelfIntersection (defaults to false for safety)
  return props.modeConfig?.allowSelfIntersection ?? false;
}
