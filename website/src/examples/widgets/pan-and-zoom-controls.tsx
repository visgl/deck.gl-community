import {GITHUB_TREE} from '../../constants/defaults';
import {mountPanAndZoomControlsExample} from '../../../../examples/widgets/pan-and-zoom-controls/app';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Pan and Zoom Controls',
    code: `${GITHUB_TREE}/examples/widgets/pan-and-zoom-controls`,
    mount: mountPanAndZoomControlsExample,
  },
  {addInfoPanel: false},
);
