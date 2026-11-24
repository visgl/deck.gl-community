import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Infovis layer primitives',
    code: `${GITHUB_TREE}/examples/layers/layer-primitives`,
    deviceTabs: true,
    async mount(container, props) {
      const {mountInfovisLayerPrimitivesExample} = await import(
        '../../../../examples/layers/layer-primitives/app'
      );
      return mountInfovisLayerPrimitivesExample(container, props);
    }
  },
  {addInfoPanel: false}
);
