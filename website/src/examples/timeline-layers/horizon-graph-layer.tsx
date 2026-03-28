import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Horizon Graph Layer Demo',
  code: `${GITHUB_TREE}/examples/timeline-layers/horizon-graph-layer`,
  async mount(container) {
    const {mountHorizonGraphLayerExample} = await import(
      '../../../../examples/timeline-layers/horizon-graph-layer/app'
    );
    return mountHorizonGraphLayerExample(container);
  }
});
