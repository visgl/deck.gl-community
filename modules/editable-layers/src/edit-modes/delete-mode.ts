import {FeatureCollection} from 'geojson';

import {GeoJsonEditMode} from './geojson-edit-mode';
import {ClickEvent, ModeProps} from './types';
export class DeleteMode extends GeoJsonEditMode {
  handleClick(_event: ClickEvent, props: ModeProps<FeatureCollection>): void {
    const selectedFeatureIndexes = props.lastPointerMoveEvent.picks.map((pick) => pick.index);
    if (selectedFeatureIndexes.length > 0) {
      const indexToDelete = selectedFeatureIndexes[0];

      const features = props.data.features.filter((_, index) => index !== indexToDelete);
      const updatedData = {
        ...props.data,
        features
      };

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
