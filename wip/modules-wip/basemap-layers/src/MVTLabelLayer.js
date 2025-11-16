// Copyright (c) 2020 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

import {CompositeLayer} from '@deck.gl/core';
import {MVTLayer} from '@deck.gl/geo-layers';
import {GeoJsonLayer, TextLayer} from '@deck.gl/layers';
import GL from '@luma.gl/constants';

export class MVTLabelLayer extends CompositeLayer {
  getLabel(feature) {
    // if (mapState.zoom < 3) return;

    const {properties} = feature;

    switch (properties.layerName) {
      case 'place_label':
        switch (properties.class) {
          case 'country':
            return properties.name_en;
          default:
            return;
        }
      default:
        return;
    }
  }

  getLabelSize(feature) {
    return 20;
  }

  getLabelColor(feature) {
    return [255, 255, 255];
  }

  getLabelAnchors(feature) {
    const {type, coordinates} = feature.geometry;
    switch (type) {
      case 'Point':
        return [coordinates];
      case 'MultiPoint':
        return coordinates;
      default:
        return [];
    }
  }

  updateState({changeFlags}) {
    const {data} = this.props;
    if (changeFlags.dataChanged && data) {
      const labelData = (data.features || data).flatMap((feature, index) => {
        const labelAnchors = this.getLabelAnchors(feature);
        return labelAnchors.map(p => this.getSubLayerRow({position: p}, feature, index));
      });

      this.setState({labelData});
    }
  }

  renderLayers() {
    const {config, labelSizeUnits, labelBackground, billboard} = this.props;

    const layers = [
      new GeoJsonLayer(this.props, this.getSubLayerProps({id: 'geojson'}), {
        data: this.props.data
      })
    ];

    if (config.labels) {
      layers.push(
        new TextLayer(this.getSubLayerProps({id: 'text'}), {
          data: this.state.labelData,
          parameters: {
            // If true, labels clip into globe background
            depthTest: false
          },
          billboard,
          sizeUnits: labelSizeUnits,
          backgroundColor: labelBackground,
          getPosition: d => d.position,
          getText: this.getSubLayerAccessor(this.getLabel),
          getSize: this.getSubLayerAccessor(this.getLabelSize),
          getColor: this.getSubLayerAccessor(this.getLabelColor)
        })
      );
    }

    return layers;
  }
}

MVTLabelLayer.layerName = 'MVTLabelLayer';
MVTLabelLayer.defaultProps = {
  ...GeoJsonLayer.defaultProps,
  billboard: true,
  labelSizeUnits: 'pixels',
  labelBackground: {type: 'color', value: null, optional: true},
  fontFamily: 'Monaco, monospace'
};

const BASEMAP_PARAMETERS = {
  // Force normal blending and keep tiles opaque
  blendFunc: [GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA, GL.ONE, GL.ONE_MINUS_SRC_ALPHA],
  blendEquation: [GL.FUNC_ADD, GL.FUNC_ADD]
};

const BASEMAP_LOAD_OPTIONS = {
  mvt: {
    layers: ['place_label', 'admin', 'water', 'road']
  }
};

const renderSubLayers = props => new MVTLabelLayer({...props});

export const getGlobeBasemapLayer = ({mapboxApiUrl, mapboxApiAccessToken, config, colors}) => {
  return new MVTLayer({
    // mapboxApiUrl
    data: `https://a.tiles.mapbox.com/v4/mapbox.mapbox-streets-v8/{z}/{x}/{y}.vector.pbf?access_token=${mapboxApiAccessToken}`,

    renderSubLayers,
    config,

    minZoom: 0,
    maxZoom: 23,

    parameters: BASEMAP_PARAMETERS,
    loadOptions: BASEMAP_LOAD_OPTIONS,

    getFillColor: f => {
      switch (f.properties.layerName) {
        case 'water':
          return colors.basemapWaterFillColor;
        default:
          return colors.basemapDefaultFillColor;
      }
    },

    getLineColor: f => {
      switch (f.properties.layerName) {
        case 'admin':
          return colors.basemapAdminLineColor;
        default:
          return colors.basemapDefaultLineColor;
      }
    },

    getLineWidth: f => {
      switch (f.properties.layerName) {
        case 'admin':
          switch (f.properties.admin_level) {
            case 0:
              return 1.5;
            default:
              return 1;
          }
        // case 'road':
        //   switch (f.properties.class) {
        //     case 'primary':
        //       return 3;
        //     case 'motorway':
        //       return 2;
        //     default:
        //       return 0;
        //   }
        default:
          return 0;
      }
    },

    lineWidthUnits: 'pixels',

    // Default to 0 pixels to give control over which layers have lines
    lineWidthMinPixels: 0,
    lineWidthMaxPixels: 20,

    getPointRadius: 0,
    pointRadiusMinPixels: 0
  });
};
