import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'GlobalGridLayer',
  code: `${GITHUB_TREE}/examples/geo-layers/global-grid-layer`,
  async mount(container) {
    const {mountGlobalGridLayerExample} = await import(
      '../../../../examples/geo-layers/global-grid-layer/app'
    );
    return mountGlobalGridLayerExample(container);
  }
});
