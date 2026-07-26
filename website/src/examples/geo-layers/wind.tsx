import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Wind Map',
  code: `${GITHUB_TREE}/examples/geo-layers/wind`,
  deviceTabs: true,
  async mount(container, options) {
    const {mountWindExample} = await import('../../../../examples/geo-layers/wind/app');
    return mountWindExample(container, options);
  }
});
