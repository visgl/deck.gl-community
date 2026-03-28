import {GITHUB_TREE} from '../../constants/defaults';
import {mountOverlaysExample} from '../../../../examples/widgets/overlays/example';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Overlays',
  code: `${GITHUB_TREE}/examples/widgets/overlays`,
  mount: mountOverlaysExample,
});
