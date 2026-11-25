import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Animated blocks',
    code: `${GITHUB_TREE}/examples/layers/animated-blocks`,
    deviceTabs: true,
    async mount(container, props) {
      const {mountAnimatedBlocksExample} = await import(
        '../../../../examples/layers/animated-blocks/app'
      );
      return mountAnimatedBlocksExample(container, props);
    }
  },
  {addInfoPanel: false}
);
