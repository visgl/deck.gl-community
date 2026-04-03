import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'SkyboxLayer FirstPersonView',
    code: `${GITHUB_TREE}/examples/layers/skybox-first-person`,
    async mount(container) {
      const {mountSkyboxFirstPersonExample} = await import(
        '../../../../examples/layers/skybox-first-person/app'
      );
      return mountSkyboxFirstPersonExample(container);
    }
  },
  {addInfoPanel: false}
);
