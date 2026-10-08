import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'SkyboxLayer MapView',
    code: `${GITHUB_TREE}/examples/layers/skybox-map-view`,
    deviceTabs: true,
    async mount(container, props) {
      const {mountSkyboxMapViewExample} = await import(
        '../../../../examples/layers/skybox-map-view/app'
      );
      return mountSkyboxMapViewExample(container, props);
    }
  },
  {addInfoPanel: false}
);
