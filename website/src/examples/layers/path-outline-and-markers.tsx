import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Path outline, marker, and dependency arrow',
    code: `${GITHUB_TREE}/examples/layers/path-marker-outline`,
    async mount(container) {
      const {mountPathOutlineAndMarkersExample} = await import(
        '../../../../examples/layers/path-marker-outline/app'
      );
      return mountPathOutlineAndMarkersExample(container);
    }
  },
  {addInfoPanel: false}
);
