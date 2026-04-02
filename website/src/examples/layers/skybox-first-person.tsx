import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Skybox First Person',
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
