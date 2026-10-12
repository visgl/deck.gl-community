import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Vega US map to stacked bars',
  code: `${GITHUB_TREE}/examples/vega/map-to-stacks`,
  deviceTabs: false,
  async mount(container) {
    const {mountMapToStacksExample} = await import('../../../../examples/vega/map-to-stacks/src/app');
    return mountMapToStacksExample(container);
  }
}, {addInfoPanel: false});
