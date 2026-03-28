import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'No Map',
  code: `${GITHUB_TREE}/examples/editable-layers/no-map`,
  async mount(container) {
    const {mountNoMapExample} = await import('../../../../examples/editable-layers/no-map/app');
    return mountNoMapExample(container);
  }
});
