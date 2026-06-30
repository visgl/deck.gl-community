import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'TraceGraphLayer',
    code: `${GITHUB_TREE}/examples/trace-layers/trace-graph-layer`,
    async mount(container) {
      const {mountTraceGraphLayerExample} = await import(
        '../../../../examples/trace-layers/trace-graph-layer/app'
      );
      return mountTraceGraphLayerExample(container);
    }
  },
  {addInfoPanel: false}
);
