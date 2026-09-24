import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'NewHeatLayer',
    code: `${GITHUB_TREE}/examples/layers/newheat`,
    async mount(container) {
      const {mountNewHeatExample} = await import('../../../../examples/layers/newheat/app');
      return mountNewHeatExample(container);
    }
  },
  {addInfoPanel: false}
);
