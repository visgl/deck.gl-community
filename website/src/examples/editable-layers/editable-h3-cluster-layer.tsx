import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Editable H3 Cluster Layer',
  code: `${GITHUB_TREE}/examples/editable-layers/editable-h3-cluster-layer`,
  async mount(container) {
    const {mountEditableH3ClusterLayerExample} = await import(
      '../../../../examples/editable-layers/editable-h3-cluster-layer/app'
    );
    return mountEditableH3ClusterLayerExample(container);
  }
});
