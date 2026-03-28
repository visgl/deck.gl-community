import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Getting Started',
  code: `${GITHUB_TREE}/examples/editable-layers/getting-started`,
  async mount(container) {
    const {mountGettingStartedExample} = await import(
      '../../../../examples/editable-layers/getting-started/app'
    );
    return mountGettingStartedExample(container);
  }
});
