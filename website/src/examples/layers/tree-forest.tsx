import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Tree Forest',
    deviceTabs: false,
    code: `${GITHUB_TREE}/examples/layers/tree-lab`,
    async mount(container) {
      const {mountTreeForestExample} = await import('../../../../examples/layers/tree-lab/forest');
      return mountTreeForestExample(container);
    }
  },
  {addInfoPanel: false}
);
