import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'EdgeMarkerLayer',
    deviceTabs: true,
    code: `${GITHUB_TREE}/examples/layers/edge-markers`,
    async mount(container, props) {
      const {mountEdgeMarkersExample} = await import(
        '../../../../examples/layers/edge-markers/app'
      );
      return mountEdgeMarkersExample(container, props);
    }
  },
  {addInfoPanel: false}
);
