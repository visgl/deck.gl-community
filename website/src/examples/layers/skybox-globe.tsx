import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'SkyboxLayer GlobeView',
    code: `${GITHUB_TREE}/examples/layers/skybox-globe`,
    async mount(container, props) {
      const {mountSkyboxGlobeExample} = await import(
        '../../../../examples/layers/skybox-globe/app'
      );
      return mountSkyboxGlobeExample(container, props);
    }
  },
  {addInfoPanel: false}
);
