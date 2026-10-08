import {GITHUB_TREE} from '../constants/defaults';
import {makeImperativeExample} from '../components';

export default makeImperativeExample(
  {
    title: 'deck.gl Playground',
    code: `${GITHUB_TREE}/examples/playground`,
    mount: async (container) => {
      const {mountPlaygroundExample} = await import('../../../examples/playground/app');
      return mountPlaygroundExample(container);
    }
  },
  {addInfoPanel: false}
);
