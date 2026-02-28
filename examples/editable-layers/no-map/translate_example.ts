import {
  TranslateMode,
  type FeatureCollection,
  type ModeProps,
  type Position,
  type SimpleGeometryCoordinates,
  ImmutableFeatureCollection,
  type SimpleGeometry,
  type EditAction,
} from "@deck.gl-community/editable-layers";

import clone from '@turf/clone';
import { point, type Feature as TurfFeature, type Geometry as TurfGeometry } from '@turf/helpers';


/** Creates a copy of feature's coordinates.
 * Each position in coordinates is transformed by calling the provided function.
 * @param coords Coordinates of a feature.
 * @param callback A function to transform each coordinate.
 * @returns Transformed coordinates.
 */
export function mapCoords(
  coords: SimpleGeometryCoordinates,
  callback: (coords: Position) => Position
): SimpleGeometryCoordinates {
  if (typeof coords[0] === 'number') {
    if (!Number.isNaN(coords[0]) && Number.isFinite(coords[0])) {
      return callback(coords as Position);
    }
    return coords;
  }

  return (coords as Position[])
    .map((coord) => {
      return mapCoords(coord, callback) as Position;
    })
    .filter(Boolean);
}

function translate(feature: TurfFeature<TurfGeometry>, dp: [number, number]) {
  if (!feature.geometry) return feature;
  const movedCoordinates = mapCoords(
    feature.geometry.coordinates as SimpleGeometryCoordinates,
    (coordinate) => [coordinate[0] - dp[0], coordinate[1] - dp[1]]
  )
  feature.geometry.coordinates = movedCoordinates;
  return feature;
}


/**
 * This is an edit mode for translating GeoJSON features with non-geographic coordinates.
 */
export default class TranslateModeEx extends TranslateMode {
  getTranslateAction(startDragPoint: Position, currentPoint: Position, editType: string, props: ModeProps<FeatureCollection>): EditAction<FeatureCollection> | null | undefined {
    if (!this._geometryBeforeTranslate) {
      return null;
    }

    let updatedData = new ImmutableFeatureCollection(props.data);
    const selectedIndexes = props.selectedIndexes;

    const { viewport: viewportDesc, screenSpace } = props.modeConfig || {};

    // move features without adapting to mercator projection - use original implementation
    if (viewportDesc && screenSpace) {
      return super.getTranslateAction(startDragPoint, currentPoint, editType, props);
    }

    const p1 = point(startDragPoint);
    const p2 = point(currentPoint);
    if (!p1.geometry || !p2.geometry) return null;
    const c1 = p1.geometry.coordinates;
    const c2 = p2.geometry.coordinates;
    const dp: [number, number] = [c1[0] - c2[0], c1[1] - c2[1]];

    const movedFeatures = this._geometryBeforeTranslate.features.map((feature) =>
      // xxx: original version of translateFromCenter was based on turfRhumb stuff that blows up with our coordinates
      translate(clone(feature as TurfFeature<TurfGeometry>), dp)
    );

    for (let i = 0; i < selectedIndexes.length; i++) {
      const selectedIndex = selectedIndexes[i];
      const movedFeature = movedFeatures[i];
      updatedData = updatedData.replaceGeometry(selectedIndex, movedFeature.geometry as SimpleGeometry);
    }

    return {
      updatedData: updatedData.getObject(),
      editType,
      editContext: {
        featureIndexes: selectedIndexes
      }
    };
  }
}
