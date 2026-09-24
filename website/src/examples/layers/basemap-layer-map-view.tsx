import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'BasemapLayer MapView',
    code: `${GITHUB_TREE}/examples/layers/basemap-layer-map-view`,
    async mount(container, props) {
      const {mountBasemapLayerMapViewExample} = await import(
        '../../../../examples/layers/basemap-layer-map-view/app'
      );
      return mountBasemapLayerMapViewExample(container, props);
    }
  },
  {addInfoPanel: false}
);
