import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Tracevis',
    code: `${GITHUB_TREE}/examples/trace-layers/tracevis`,
    deviceTabs: true,
    async mount(container, props) {
      const {mountTracevisExample} = await import('../../../../examples/trace-layers/tracevis/app');
      return mountTracevisExample(container, props);
    }
  },
  {addInfoPanel: false}
);
