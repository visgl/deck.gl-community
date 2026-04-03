import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'SkyboxLayer MapView',
    code: `${GITHUB_TREE}/examples/layers/skybox-map-view`,
    async mount(container) {
      const {mountSkyboxMapViewExample} = await import(
        '../../../../examples/layers/skybox-map-view/app'
      );
      return mountSkyboxMapViewExample(container);
    }
  },
  {addInfoPanel: false}
);
