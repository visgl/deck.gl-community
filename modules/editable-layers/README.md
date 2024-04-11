<h1 align="center">editable-layers | <a href="https://@deck.gl-community/editable-layers">Website</a></h1>

<h5 align="center">An editing framework for deck.gl</h5>

[![docs](https://i.imgur.com/bRDL1oh.gif)](https://@deck.gl-community/editable-layers)

[@deck.gl-community/editable-layers](https://@deck.gl-community/editable-layers) provides editable and interactive map overlay layers, built using the power of [deck.gl](https://deck.gl/).

## Getting started

### Running the example

1. `git clone git@github.com:uber/@deck.gl-community/editable-layers.git`
2. `cd @deck.gl-community/editable-layers`
3. `yarn`
4. `cd examples/advanced`
5. `yarn`
6. `export MapboxAccessToken='<Add your key>'`
7. `yarn start-local`
8. You can now view and edit geometry.

### Installation

For npm

```bash
npm install @deck.gl-community/editable-layers
```

For yarn

```bash
yarn add @deck.gl-community/editable-layers
```

### `EditableGeoJsonLayer`

[EditableGeoJsonLayer](/docs/modules/editor-layers/api-reference/editable-geojson-layer.md) is implemented as a [deck.gl](https://deck.gl) layer. It provides the ability to view and edit multiple types of geometry formatted as [GeoJSON](https://tools.ietf.org/html/rfc7946) (an open standard format for geometry) including polygons, lines, and points.

```jsx
import DeckGL from '@deck.gl/react';
import { EditableGeoJsonLayer, DrawPolygonMode } from '@deck.gl-community/editable-layers';

const myFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    /* insert features here */
  ],
};

const selectedFeatureIndexes = [];

class App extends React.Component {
  state = {
    data: myFeatureCollection,
  };

  render() {
    const layer = new EditableGeoJsonLayer({
      id: 'geojson-layer',
      data: this.state.data,
      mode: DrawPolygonMode,
      selectedFeatureIndexes,

      onEdit: ({ updatedData }) => {
        this.setState({
          data: updatedData,
        });
      },
    });

    return <DeckGL {...this.props.viewport} layers={[layer]} />;
  }
}
```

### Useful examples (Codesandbox)

- [Hello World (using deck.gl)](https://codesandbox.io/s/hello-world-nebulagl-csvsm)
- [With Toolbox](https://codesandbox.io/s/hello-nebulagl-with-toolbox-oelkr)
- [No React](https://codesandbox.io/s/deckgl-and-nebulagl-editablegeojsonlayer-no-react-p9yrs)
- [Custom EditMode](https://codesandbox.io/s/connect-the-dots-mode-yow65)
