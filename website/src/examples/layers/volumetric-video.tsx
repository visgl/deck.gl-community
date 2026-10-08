import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'VolumetricVideoLayer',
    deviceTabs: false,
    code: `${GITHUB_TREE}/examples/layers/volumetric-video`,
    async mount(container) {
      const {mountVolumetricVideoExample} = await import(
        '../../../../examples/layers/volumetric-video/app'
      );
      return mountVolumetricVideoExample(container);
    }
  },
  {addInfoPanel: false}
);
