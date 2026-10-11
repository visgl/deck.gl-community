import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Vega symbols and record transitions',
  code: `${GITHUB_TREE}/examples/vega/mark-transitions`,
  deviceTabs: false,
  async mount(container) {
    const {mountMarkTransitionsExample} = await import('../../../../examples/vega/mark-transitions/src/app');
    return mountMarkTransitionsExample(container);
  }
}, {addInfoPanel: false});
