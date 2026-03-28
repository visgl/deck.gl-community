import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Graph Viewer',
    code: `${GITHUB_TREE}/examples/graph-layers/graph-viewer`,
    async mount(container, props) {
      const {mountGraphViewerExample} = await import(
        '../../../../examples/graph-layers/graph-viewer/app'
      );
      return mountGraphViewerExample(container, props);
    }
  },
  {addInfoPanel: false}
);
