import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Shared terrain contracts',
  deviceTabs: false,
  code: `${GITHUB_TREE}/examples/basemap-layers/terrain-contract`,
  async mount(container) {
    const {mountTerrainContractExample} = await import('../../../../examples/basemap-layers/terrain-contract/app');
    return mountTerrainContractExample(container);
  }
}, {addInfoPanel: false});
