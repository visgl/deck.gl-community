import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Multi Horizon Graph Layer Demo',
    code: `${GITHUB_TREE}/dev/timeline-layers/examples/horizon-graph-layer`,
    async mount(container) {
      const {mountMultiHorizonGraphLayerExample} = await import(
        '../../../../dev/timeline-layers/examples/horizon-graph-layer/app'
      );
      return mountMultiHorizonGraphLayerExample(container);
    }
  },
  {
    addInfoPanel: false,
    style: {
      height: '560px',
      minHeight: '560px'
    }
  }
);
