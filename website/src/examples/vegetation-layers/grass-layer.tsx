import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'GrassLayer',
    code: `${GITHUB_TREE}/examples/vegetation-layers/grass-layer`,
    deviceTabs: {placement: 'top-right'},
    async mount(container, props) {
      const {mountGrassLayerExample} = await import('../../../../examples/vegetation-layers/grass-layer/app');
      return mountGrassLayerExample(container, props);
    }
  },
  {addInfoPanel: false}
);
