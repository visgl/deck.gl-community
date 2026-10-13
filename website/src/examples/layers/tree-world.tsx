import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'Tree World', deviceTabs: false,
    code: `${GITHUB_TREE}/examples/layers/tree-world`,
    async mount(container) {
      const {mountTreeWorldExample} = await import('../../../../examples/layers/tree-world/world');
      return mountTreeWorldExample(container, {comparisonHref: './tree-lab', scroll: true});
    }
  },
  {addInfoPanel: false}
);
