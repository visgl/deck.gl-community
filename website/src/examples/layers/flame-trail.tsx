import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'FlameTrailLayer',
    deviceTabs: {placement: 'top-left'},
    code: `${GITHUB_TREE}/examples/layers/flame-trail`,
    async mount(container, props) {
      const {mountFlameTrailExample} = await import('../../../../examples/layers/flame-trail/app');
      return mountFlameTrailExample(container, props);
    }
  },
  {addInfoPanel: false}
);
