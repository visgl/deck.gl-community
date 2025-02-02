import React from 'react';
import {Map, useControl} from 'react-map-gl/maplibre';
import {DeckProps} from 'deck.gl';
import {MapboxOverlay} from '@deck.gl/mapbox';
import {
  DrawLineStringMode,
  DrawPolygonMode,
  EditableGeoJsonLayer
} from '@deck.gl-community/editable-layers';

function DeckGLOverlay(props: DeckProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

export default function OverlaidEditable() {
  const [features, setFeatures] = React.useState({
    type: 'FeatureCollection',
    features: []
  });
  const [mode, setMode] = React.useState(() => DrawPolygonMode);
  const [selectedFeatureIndexes] = React.useState([]);

  const layer = new EditableGeoJsonLayer({
    data: features,
    mode,
    selectedFeatureIndexes,
    onEdit: ({updatedData}) => {
      //FIXME: this event is not fired...
      console.log('updatedData', updatedData);
      setFeatures(updatedData);
    }
  });

  React.useEffect(() => {
    console.log(`mode changed to ${mode.name}`);
  }, [mode]);

  return (
    <div>
      <Map
        style={{width: '100%', height: 500}} //FIXME: unable to get height 100% to work
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
