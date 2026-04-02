import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Skybox Globe',
    code: `${GITHUB_TREE}/examples/layers/skybox-globe`,
    async mount(container) {
      const {mountSkyboxGlobeExample} = await import(
        '../../../../examples/layers/skybox-globe/app'
      );
      return mountSkyboxGlobeExample(container);
    }
  },
  {addInfoPanel: false}
);
