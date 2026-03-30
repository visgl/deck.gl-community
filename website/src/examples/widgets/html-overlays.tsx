import {GITHUB_TREE} from '../../constants/defaults';
import {mountHtmlOverlaysExample} from '../../../../examples/widgets/html-overlays/app';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'HTML Overlays',
    code: `${GITHUB_TREE}/examples/widgets/html-overlays`,
    mount: mountHtmlOverlaysExample,
  },
  {addInfoPanel: false},
);
