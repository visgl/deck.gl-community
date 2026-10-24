import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Wind Garden · WindEffect',
    code: `${GITHUB_TREE}/examples/layers/wind-garden`,
    deviceTabs: {placement: 'top-right'},
    async mount(container, props) {
      const {mountWindGardenExample} = await import('../../../../examples/layers/wind-garden/app');
      return mountWindGardenExample(container, props);
    }
  },
  {addInfoPanel: false}
);
