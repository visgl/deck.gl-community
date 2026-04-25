import {GITHUB_TREE} from '../../constants/defaults';
import {mountStandaloneWidgetsExample} from '../../../../examples/widgets/standalone-widgets/app';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Standalone Widgets',
    code: `${GITHUB_TREE}/examples/widgets/standalone-widgets`,
    mount: mountStandaloneWidgetsExample
  },
  {addInfoPanel: false}
);
