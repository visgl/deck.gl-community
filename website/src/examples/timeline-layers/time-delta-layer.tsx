import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Time delta',
    code: `${GITHUB_TREE}/examples/layers/time-delta-layer`,
    deviceTabs: true,
    async mount(container, props) {
      const {mountTimeDeltaExample} = await import(
        '../../../../examples/layers/time-delta-layer/app'
      );
      return mountTimeDeltaExample(container, props);
    }
  },
  {addInfoPanel: false}
);
