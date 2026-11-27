import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'CORTAOEffect',
  code: `${GITHUB_TREE}/examples/experimental/ambient-occlusion`,
  // The shared mount owns the community tabs so method and backend changes stay in sync.
  deviceTabs: false,
  async mount(container) {
    const {mountSwitchableAmbientOcclusionExample} = await import(
      '../../../../examples/experimental/ambient-occlusion/app'
    );
    const example = await mountSwitchableAmbientOcclusionExample(container);
    return example.finalize;
  }
});
