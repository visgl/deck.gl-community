import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Shared Tileset',
  code: `${GITHUB_TREE}/examples/geo-layers/shared-tile-cockpit`,
  async mount(container) {
    const {mountSharedTileCockpitExample} = await import(
      '../../../../examples/geo-layers/shared-tile-cockpit/app'
    );
    return mountSharedTileCockpitExample(container);
  }
}, {
  addInfoPanel: false
});
