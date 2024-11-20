import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';
import {exampleApplication} from '../../../../examples/leaflet/get-started/app';

import {makeExample} from '../../components';

class AdvancedDemo extends Component {
  static title = 'Leaflet as deck.gl Basemap';

  static code = `${GITHUB_TREE}/examples/leaflet/get-started`;

  static renderInfo(meta) {
    return <></>;
  }

  componentDidMount(): void {
    exampleApplication(); 
  }

  render() {
    const {...otherProps} = this.props;

    return (
      <BrowserOnly>
        {() => <div id="map" {...otherProps} />}
      </BrowserOnly>
    );
  }
}

export default makeExample(AdvancedDemo);
