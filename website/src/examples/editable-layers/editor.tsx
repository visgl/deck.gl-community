import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Editor',
  code: `${GITHUB_TREE}/examples/editable-layers/editor`,
  async mount(container) {
    const {mountEditableLayersEditorExample} = await import(
      '../../../../examples/editable-layers/editor/app'
    );
    return mountEditableLayersEditorExample(container);
  }
});
