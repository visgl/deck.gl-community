import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'BasemapLayer / MapLibre Split View',
    deviceTabs: false,
    code: `${GITHUB_TREE}/examples/basemap-layers/split-view`,
    async mount(container) {
      const {mountBasemapSplitViewExample} = await import(
        '../../../../examples/basemap-layers/split-view/app'
      );
      return mountBasemapSplitViewExample(container);
    }
  },
  {addInfoPanel: false}
);
