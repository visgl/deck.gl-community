import {GITHUB_TREE} from '../../constants/defaults';
import {mountWidgetPanelsExample} from '../../../../examples/widgets/widget-panels/app';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Widget Panels',
    code: `${GITHUB_TREE}/examples/widgets/widget-panels`,
    mount: mountWidgetPanelsExample,
  },
  {addInfoPanel: false},
);
