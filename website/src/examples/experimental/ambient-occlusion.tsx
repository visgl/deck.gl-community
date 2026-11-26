import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'CORTAOEffect',
  code: `${GITHUB_TREE}/examples/experimental/ambient-occlusion`,
  async mount(container) {
    const {mountSwitchableAmbientOcclusionExample} = await import(
      '../../../../examples/experimental/ambient-occlusion/app'
    );
    // The panel's method and backend choices mount the example again with a new device.
    return mountSwitchableAmbientOcclusionExample(container);
  }
});
