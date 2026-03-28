import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Widget',
  code: `${GITHUB_TREE}/examples/editable-layers/widget`,
  async mount(container) {
    const {mountEditableLayersWidgetExample} = await import(
      '../../../../examples/editable-layers/widget/app'
    );
    return mountEditableLayersWidgetExample(container);
  }
});
