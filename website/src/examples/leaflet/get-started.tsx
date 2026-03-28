import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Leaflet as deck.gl Basemap',
  code: `${GITHUB_TREE}/examples/leaflet/get-started`,
  mount(container) {
    return import('../../../../examples/leaflet/get-started/app').then(
      ({mountLeafletGetStartedExample}) => mountLeafletGetStartedExample(container),
    );
  },
});
