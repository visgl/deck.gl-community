import LayerLiveExample from '@site/src/components/docs/layer-live-example';

# SelectionLayer

<LayerLiveExample highlight="selection-layer" />

This layer can be used to select deck.gl objects using mouse drawing.

```js
import * as React from 'react';
import ReactDOM from 'react-dom';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { SelectionLayer } from '@deck.gl-community/editable-layers';
import { StaticMap } from 'react-map-gl';

const MAPBOX_ACCESS_TOKEN = ''; // add your mapbox token here

const initialViewState = {
  longitude: -73.986022,
  latitude: 40.730743,
  zoom: 12,
};

const MALE_COLOR = [0, 128, 255];
const FEMALE_COLOR = [255, 0, 128];
const DATA_URL =
  'https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/scatterplot/manhattan.json'; // eslint-disable-line

const App = function () {
  const radius = 30;
  const maleColor = MALE_COLOR;
  const femaleColor = FEMALE_COLOR;
  const data = fetch(DATA_URL).then((resp) => resp.json());

  const layers = [
    new ScatterplotLayer({
      id: 'scatter-plot',
      data,
      radiusScale: radius,
      radiusMinPixels: 0.25,
      getPosition: (d) => [d[0], d[1], 0],
      getFillColor: (d) => (d[2] === 1 ? maleColor : femaleColor),
      getRadius: 1,
      pickable: true,
      updateTriggers: {
        getFillColor: [maleColor, femaleColor],
      },
    }),
    new SelectionLayer({
      id: 'selection',
      selectionType: 'rectangle',
      onSelect: ({ pickingInfos }) => {},
      layerIds: ['scatter-plot'],
      getTentativeFillColor: () => [255, 0, 255, 100],
      getTentativeLineColor: () => [0, 0, 255, 255],
      getTentativeLineDashArray: () => [0, 0],
      lineWidthMinPixels: 1,
    }),
  ];

  return (
    <DeckGL initialViewState={initialViewState} controller={true} layers={layers}>
      <StaticMap mapboxApiAccessToken={MAPBOX_ACCESS_TOKEN} />
    </DeckGL>
  );
};
```

## Properties

Inherits all [deck.gl's Base Layer](https://deck.gl/docs/api-reference/core/layer) properties.

Also inherites **some** EditableGeoJsonLayer properties.

> Note: do not pass a data property.

#### `selectionType` (String, required)

- Default: `rectangle`

`rectangle` or `polygon`; `null` disables selection.

#### `onSelect` (Function, required)

Called when selection is completed with `{pickingInfos}`. Each entry is the original
[deck.gl picking info](https://deck.gl/docs/developer-guide/interactivity#the-picking-info-object),
including the selected object, source layer, and object index.

Both selection modes use deck.gl's WebGL GPU picking. Polygon selection masks pixels outside
the drawn lasso, including for wide, diagonal, and concave lassos. Objects are selected when visible rendered
pixels intersect the selection; overlapping objects hidden behind another object are not included.
The layer does not scan target data or require a `getPosition` accessor.

#### `layerIds` (String[], required)

Array of pickable layer IDs to search, including their sublayers. Place the `SelectionLayer`
after its target layers in the deck layer list so its picking mask covers those layers.
Layers must have `pickable: true`; hidden or fully occluded objects are not selected.
