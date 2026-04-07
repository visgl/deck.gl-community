import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: '3D Tiles',
  code: `${GITHUB_TREE}/examples/editable-layers/3d-tiles`,
  async mount(container) {
    const {mountEditableLayers3DTilesExample} = await import(
      '../../../../examples/editable-layers/3d-tiles/app'
    );
    return mountEditableLayers3DTilesExample(container);
  }
}, {addInfoPanel: false});
