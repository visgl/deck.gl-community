import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'SF Polygons',
  code: `${GITHUB_TREE}/examples/editable-layers/sf`,
  async mount(container) {
    const {mountSfExample} = await import('../../../../examples/editable-layers/sf/app');
    return mountSfExample(container);
  }
}, {addInfoPanel: false});
