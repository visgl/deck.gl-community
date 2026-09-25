import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'FlameTrailLayer',
    deviceTabs: false,
    code: `${GITHUB_TREE}/examples/layers/flame-trail`,
    async mount(container) {
      const {mountFlameTrailExample} = await import('../../../../examples/layers/flame-trail/app');
      return mountFlameTrailExample(container);
    }
  },
  {addInfoPanel: false}
);
