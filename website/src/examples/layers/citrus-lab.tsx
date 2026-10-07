import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Citrus Lab',
  deviceTabs: false,
  code: `${GITHUB_TREE}/examples/layers/tree-lab/citrus.ts`,
  async mount(container) {
    const {mountCitrusLabExample} = await import('../../../../examples/layers/tree-lab/citrus');
    return mountCitrusLabExample(container);
  }
}, {addInfoPanel: false});
