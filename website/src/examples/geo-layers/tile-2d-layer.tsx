import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Tile2DLayer',
  code: `${GITHUB_TREE}/examples/geo-layers/tile-2d-layer`,
  async mount(container) {
    const {mountTile2DLayerExample} = await import(
      '../../../../examples/geo-layers/tile-2d-layer/app'
    );
    return mountTile2DLayerExample(container);
  }
}, {
  addInfoPanel: false
});
