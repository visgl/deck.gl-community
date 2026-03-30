import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Advanced',
  code: `${GITHUB_TREE}/examples/editable-layers/advanced`,
  async mount(container) {
    const {mountEditableLayersAdvancedExample} = await import(
      '../../../../examples/editable-layers/advanced/src/app'
    );
    return mountEditableLayersAdvancedExample(container);
  }
}, {addInfoPanel: false});
