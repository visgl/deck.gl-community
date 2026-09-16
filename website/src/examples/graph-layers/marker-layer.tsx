import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'MarkerLayer',
  code: `${GITHUB_TREE}/examples/graph-layers/marker-layer`,
  async mount(container) {
    const {mountMarkerLayerExample} = await import('../../../../examples/graph-layers/marker-layer/app');
    return mountMarkerLayerExample(container);
  }
});
