import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Seasonal Farm · TreeLayer',
    code: `${GITHUB_TREE}/examples/layers/seasonal-farm`,
    deviceTabs: {placement: 'top-right'},
    async mount(container, props) {
      const {mountSeasonalFarmExample} = await import('../../../../examples/layers/seasonal-farm/app');
      return mountSeasonalFarmExample(container, props);
    }
  },
  {addInfoPanel: false}
);
