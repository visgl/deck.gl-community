import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Horizon Graph Layer Demo',
    code: `${GITHUB_TREE}/modules/timeline-layers/examples/horizon-graph-layer`,
    deviceTabs: {placement: 'bottom-right'},
    async mount(container, props) {
      const {mountHorizonGraphLayerExample} = await import(
        '../../../../modules/timeline-layers/examples/horizon-graph-layer/app'
      );
      return mountHorizonGraphLayerExample(container, props);
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
