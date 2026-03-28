import {GITHUB_TREE} from '../../constants/defaults';
import {mountBingMapsGetStartedExample} from '../../../../examples/bing-maps/get-started/app';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Bing Maps as deck.gl Basemap',
  code: `${GITHUB_TREE}/examples/bing-maps/get-started`,
  mount: mountBingMapsGetStartedExample,
});
