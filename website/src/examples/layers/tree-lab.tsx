import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'TreeLayer',
  deviceTabs: true,
  code: `${GITHUB_TREE}/examples/layers/tree-lab`,
  async mount(container, props) {
    const {mountTreeLabExample} = await import('../../../../examples/layers/tree-lab/app');
    return mountTreeLabExample(container, props);
  }
}, {addInfoPanel: false});
