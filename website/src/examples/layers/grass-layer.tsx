import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'GrassLayer',
    code: `${GITHUB_TREE}/examples/layers/grass-layer`,
    deviceTabs: {placement: 'top-right'},
    async mount(container, props) {
      const {mountGrassLayerExample} = await import('../../../../examples/layers/grass-layer/app');
      return mountGrassLayerExample(container, props);
    }
  },
  {addInfoPanel: false}
);
