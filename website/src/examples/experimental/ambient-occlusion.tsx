import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'CORTAOEffect',
  code: `${GITHUB_TREE}/examples/experimental/ambient-occlusion`,
  async mount(container) {
    const {mountAmbientOcclusionExample} = await import(
      '../../../../examples/experimental/ambient-occlusion/app'
    );
    const example = mountAmbientOcclusionExample(container);
    return example.finalize;
  }
});
