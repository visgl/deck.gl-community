import {GITHUB_TREE} from '../../constants/defaults';
import {mountDeckPanelExample} from '../../../../examples/widgets/deck-panel/app';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample(
  {
    title: 'DeckPanel',
    code: `${GITHUB_TREE}/examples/widgets/deck-panel`,
    mount: mountDeckPanelExample,
    deviceTabs: false
  },
  {addInfoPanel: false}
);
