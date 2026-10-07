import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Tree World', deviceTabs: false,
    code: `${GITHUB_TREE}/examples/layers/tree-lab`,
    async mount(container) {
      const {mountTreeWorldExample} = await import('../../../../examples/layers/tree-lab/world');
      return mountTreeWorldExample(container, {forestHref: './tree-forest', comparisonHref: './tree-lab', scroll: true});
    }
  },
  {addInfoPanel: false}
);
