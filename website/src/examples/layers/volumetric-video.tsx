import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'VolumetricVideoLayer',
    deviceTabs: {placement: 'bottom-right'},
    code: `${GITHUB_TREE}/examples/layers/volumetric-video`,
    async mount(container, props) {
      const {mountVolumetricVideoExample} = await import(
        '../../../../examples/layers/volumetric-video/app'
      );
      return mountVolumetricVideoExample(container, {
        ...props,
        embedded: true,
        sampleVideo: '/deck.gl-community/examples/layers/volumetric-video/sample.mp4'
      });
    }
  },
  {addInfoPanel: false}
);
