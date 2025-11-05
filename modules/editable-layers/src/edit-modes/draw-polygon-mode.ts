// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import lineIntersect from '@turf/line-intersect';
import { polygon as turfPolygon} from '@turf/helpers';
import centroid from '@turf/centroid';
import {booleanWithin} from "@turf/boolean-within";


import {
  ClickEvent,
  PointerMoveEvent,
  ModeProps,
  GuideFeatureCollection,
  TentativeFeature,
  GuideFeature,
  DoubleClickEvent
} from './types';
import {Position, FeatureCollection, Geometry} from '../utils/geojson-types';
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

  // eslint-disable-next-line complexity
  handleClick(event: ClickEvent, props: ModeProps<FeatureCollection>) {
    const clickSequence = this.getClickSequence();
        const coords = event.mapCoords;
    
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
    
        this.addClickSequence(event);
  }

  handleDoubleClick(event: DoubleClickEvent, props: ModeProps<FeatureCollection>) {
    this.finishDrawing(props);
    this.resetClickSequence();
  }

  handleKeyUp(event: KeyboardEvent, props: ModeProps<FeatureCollection>) {
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
  finishDrawing(props: ModeProps<FeatureCollection>) {
    const clickSequence = this.getClickSequence();
    const polygon = [...clickSequence, clickSequence[0]];

    const newPolygon = turfPolygon([polygon]);
    const center = centroid(newPolygon);

    const canAddHole = canAddHoleToPolygon(props);
    const canSelfIntersect = canPolygonSelfIntersect(props);

    // Check if the polygon intersects itself (excluding shared start/end point)
    if (!canSelfIntersect) {
      const selfIntersection = lineIntersect(
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
  
      if (selfIntersection.length > 0) {
        // ❌ Invalid polygon: self-intersects
        props.onEdit({
          updatedData: props.data,
          editType: "invalidPolygon",
          editContext: { reason: "self-intersects" },
        });
        return;
      }
    }

    if (canAddHole) {
    for (const [featureIndex, feature] of props.data.features.entries()) {
      if (feature.geometry.type === "Polygon") {
        const outer = turfPolygon(feature.geometry.coordinates);

        // Check if the new hole intersects or contains another hole first
        // eslint-disable-next-line max-depth
        for (let i = 1; i < feature.geometry.coordinates.length; i++) {
          const hole = turfPolygon([feature.geometry.coordinates[i]]);
          const intersection = lineIntersect(hole, newPolygon);
          // eslint-disable-next-line max-depth
          if (intersection.features.length > 0) {
            // ❌ Invalid hole: intersects existing hole
            props.onEdit({
              updatedData: props.data,
              editType: "invalidHole",
              editContext: { reason: "intersects-existing-hole" },
            });
            return;
          }

          // eslint-disable-next-line max-depth
          if (
            booleanWithin(hole, newPolygon) ||
            booleanWithin(newPolygon, hole)
          ) {
            // ❌ Invalid hole: contains or is contained by existing hole
            props.onEdit({
              updatedData: props.data,
              editType: "invalidHole",
              editContext: {
                reason: "contains-or-contained-by-existing-hole",
              },
            });
            return;
          }
        }

        // Check if the new polygon intersects or contains the outer polygon
        const intersectionWithOuter = lineIntersect(outer, newPolygon);
        // eslint-disable-next-line max-depth
        if (intersectionWithOuter.features.length > 0) {
          // ❌ Invalid polygon: intersects existing polygon
          props.onEdit({
            updatedData: props.data,
            editType: "invalidPolygon",
            editContext: { reason: "intersects-existing-polygon" },
          });
          return;
        }

        // eslint-disable-next-line max-depth
        if (booleanWithin(outer, newPolygon)) {
          // ❌ Invalid polygon: contains existing polygon
          props.onEdit({
            updatedData: props.data,
            editType: "invalidPolygon",
            editContext: {
              reason: "contains-existing-polygon",
            },
          });
          return;
        }

        // Now check if the center of the new hole is within the outer polygon
        // eslint-disable-next-line max-depth
        if (booleanWithin(center, outer)) {
          // ✅ Valid hole
          const updatedCoords = [...feature.geometry.coordinates, polygon];
          const updatedGeometry = {
            ...feature.geometry,
            coordinates: updatedCoords,
          };

          const updatedData = new ImmutableFeatureCollection(props.data)
            .replaceGeometry(featureIndex, updatedGeometry)
            .getObject();

          props.onEdit({
            updatedData,
            editType: "addHole",
            editContext: { hole: newPolygon.geometry },
          });
          return;
        }
      }
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
function canPolygonSelfIntersect(
  props: ModeProps<FeatureCollection>
): boolean {
  // For simplicity, always return false in this example.
  // Implement your own logic based on application requirements.
  return props.modeConfig?.allowSelfIntersection ?? false;
}
