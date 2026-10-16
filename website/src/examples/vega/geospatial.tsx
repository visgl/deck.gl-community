import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Vega geospatial projections',
  code: `${GITHUB_TREE}/examples/vega/geospatial`,
  deviceTabs: false,
  async mount(container) {
    const {mountGeospatialExample} = await import('../../../../examples/vega/geospatial/src/app');
    return mountGeospatialExample(container);
  }
}, {addInfoPanel: false});
