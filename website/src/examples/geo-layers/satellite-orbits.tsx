import {GITHUB_TREE} from '../../constants/defaults';
import {makeImperativeExample} from '../../components';

export default makeImperativeExample({
  title: 'Satellite orbits',
  code: `${GITHUB_TREE}/examples/geo-layers/satellite-orbits`,
  async mount(container) {
    const {mountSatelliteOrbitsExample} = await import(
      '../../../../examples/geo-layers/satellite-orbits/app'
    );
    return mountSatelliteOrbitsExample(container);
  }
});
