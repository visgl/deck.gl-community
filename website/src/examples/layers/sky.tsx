import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'SkyLayer',
    code: `${GITHUB_TREE}/examples/layers/sky`,
    async mount(container, props) {
      const {mountSkyExample} = await import('../../../../examples/layers/sky/app');
      return mountSkyExample(container, props);
    }
  },
  {addInfoPanel: false}
);
