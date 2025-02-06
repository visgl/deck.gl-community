import React, {forwardRef, useImperativeHandle} from 'react';
import {Map, useControl} from 'react-map-gl/maplibre';
import {MapController} from 'deck.gl';
import {MapboxOverlay, type MapboxOverlayProps} from '@deck.gl/mapbox';
import {
  DrawLineStringMode,
  DrawPolygonMode,
  EditableGeoJsonLayer,
  type FeatureCollection
} from '@deck.gl-community/editable-layers';
import type {MjolnirEvent} from 'mjolnir.js';

export class EditableLayerMapController extends MapController {
  constructor(props) {
    super(props);
    // We cannot enable 'anyclick', because this seems to be not known to mjolnir.js anymore.
    this.events = ['click'];
  }
  handleEvent(event: MjolnirEvent): boolean {
    if (event.type === 'click') {
      // @ts-ignore https://github.com/visgl/deck.gl-community/issues/201
      this.eventManager.manager.emit('anyclick', event);
    }
    return super.handleEvent(event);
  }
}

export const DeckGLOverlay = forwardRef(function DeckGLOverlay(
  props: MapboxOverlayProps & {
    interleaved?: boolean;
  },
  ref
) {
  const overlay = useControl(() => new MapboxOverlay(props), {});
  overlay.setProps({
    ...props,
    interleaved: props.interleaved ?? false,
    /** @ts-expect-error: DeckGL expects a controller prop, but it's not in the MapboxOverlayProps type */
    controller: {
      type: EditableLayerMapController
    }
  });

  useImperativeHandle(ref, () => overlay, [overlay]);
  return null;
});

export default function OverlaidEditable() {
  const [features, setFeatures] = React.useState<FeatureCollection>({
    type: 'FeatureCollection',
    features: []
  });
  const [mode, setMode] = React.useState(() => DrawPolygonMode);
  const [selectedFeatureIndexes] = React.useState([]);

  const layer = new EditableGeoJsonLayer({
    data: features,
    mode,
    selectedFeatureIndexes,
    pickable: true,
    editHandleType: 'point', // Ensure points appear when editing
    onEdit: ({updatedData}) => {
      // FIXME: this event is not fired...
      console.log('updatedData', updatedData);
      setFeatures(updatedData);
    }
  });

  return (
    <div>
      <Map
        style={{width: '100%', height: 500}} // FIXME: unable to get height 100% to work
        mapStyle={'https://demotiles.maplibre.org/style.json'}
      >
        <DeckGLOverlay layers={[layer]} />
      </Map>
      <div className="controls">
        <button
          className={`button ${mode === DrawLineStringMode ? 'active' : ''}`}
          onClick={() => setMode(() => DrawLineStringMode)}
        >
          Line
        </button>
        <button
          className={`button ${mode === DrawPolygonMode ? 'active' : ''}`}
          onClick={() => setMode(() => DrawPolygonMode)}
        >
          Polygon
        </button>
      </div>
    </div>
  );
}
