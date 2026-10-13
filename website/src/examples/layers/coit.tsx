import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({title: 'Coit RAD Scene', deviceTabs: false, code: `${GITHUB_TREE}/examples/layers/coit`, async mount(container) {const {mountCoitExample} = await import('../../../../examples/layers/coit/app');return mountCoitExample(container);}}, {addInfoPanel: false});
