import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'SharedTile2DLayer',
  code: `${GITHUB_TREE}/examples/geo-layers/shared-tile-2d-layer`,
  async mount(container) {
    const {mountSharedTile2DLayerExample} = await import(
      '../../../../examples/geo-layers/shared-tile-2d-layer/app'
    );
    return mountSharedTile2DLayerExample(container);
  }
}, {
  addInfoPanel: false
});
