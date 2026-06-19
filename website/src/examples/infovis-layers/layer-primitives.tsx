import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Infovis layer primitives',
    code: `${GITHUB_TREE}/examples/infovis-layers/layer-primitives`,
    async mount(container) {
      const {mountInfovisLayerPrimitivesExample} = await import(
        '../../../../examples/infovis-layers/layer-primitives/app'
      );
      return mountInfovisLayerPrimitivesExample(container);
    }
  },
  {addInfoPanel: false}
);
