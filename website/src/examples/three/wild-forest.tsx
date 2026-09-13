import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Seasonal farm · TreeLayer',
    code: `${GITHUB_TREE}/examples/three/wild-forest`,
    deviceTabs: {placement: 'top-right'},
    async mount(container, props) {
      const {mountWildForestExample} = await import('../../../../examples/three/wild-forest/app');
      return mountWildForestExample(container, props);
    }
  },
  {addInfoPanel: false}
);
