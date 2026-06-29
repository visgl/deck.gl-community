import {GITHUB_TREE} from '../../constants/defaults';
import {mountStandalonePanelContainersExample} from '../../../../examples/widgets/standalone-widgets/app';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Standalone Widgets',
    code: `${GITHUB_TREE}/examples/widgets/standalone-widgets`,
    mount: mountStandalonePanelContainersExample
  },
  {addInfoPanel: false}
);
