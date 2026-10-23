import {GITHUB_TREE} from '../../constants/defaults';
import {mountCanvasChromeExample} from '../../../../examples/widgets/panel-docs/canvas-chrome';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Canvas Chrome',
  deviceTabs: false,
  code: `${GITHUB_TREE}/examples/widgets/panel-docs/canvas-chrome.tsx`,
  mount: mountCanvasChromeExample
}, {addInfoPanel: false});
