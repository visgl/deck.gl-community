import {FeatureCollection} from '../utils/geojson-types';

import {GeoJsonEditMode} from './geojson-edit-mode';
import {ClickEvent, ModeProps} from './types';
import {ImmutableFeatureCollection} from './immutable-feature-collection';

export class DeleteMode extends GeoJsonEditMode {
  handleClick(_event: ClickEvent, props: ModeProps<FeatureCollection>): void {
    const selectedFeatureIndexes = props.lastPointerMoveEvent.picks.map((pick) => pick.index);
    if (selectedFeatureIndexes.length > 0) {
      const updatedData = new ImmutableFeatureCollection(props.data)
        // in case of overlapping features, delete only the most recent feature
        .deleteFeatures([selectedFeatureIndexes[0]])
        .getObject();

      const editAction = {
        updatedData,
        editType: 'deleteFeature',
        editContext: {
          featureIndexes: selectedFeatureIndexes
        }
      };

      props.onEdit(editAction);
    }
  }
}
