import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'SourceLayer',
    deviceTabs: true,
    code: `${GITHUB_TREE}/examples/layers/source-layers`,
    async mount(container, props) {
      const {mountSourceLayersExample} = await import('../../../../examples/layers/source-layers/app');
      return mountSourceLayersExample(container, props);
    }
  },
  {addInfoPanel: false}
);
