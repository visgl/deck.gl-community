import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'ProceduralSkyLayer',
    code: `${GITHUB_TREE}/examples/sky-layers/procedural-sky`,
    async mount(container, props) {
      const {mountSkyExample} = await import('../../../../examples/sky-layers/procedural-sky/app');
      return mountSkyExample(container, props);
    }
  },
  {addInfoPanel: false}
);
