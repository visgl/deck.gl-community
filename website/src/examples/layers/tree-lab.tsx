import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Tree Lab',
  deviceTabs: false,
  code: `${GITHUB_TREE}/examples/layers/tree-lab`,
  async mount(container) {
    const {mountTreeLabExample} = await import('../../../../examples/layers/tree-lab/app');
    return mountTreeLabExample(container, {scroll: true, benchmarkLinks: false});
  }
}, {addInfoPanel: false});
