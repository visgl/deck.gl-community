import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';

import {makeExample} from '../../components';

class OverlaysDemo extends Component {
  static title = 'Overlays';

  static code = `${GITHUB_TREE}/examples/widgets/overlays`;

  static renderInfo(meta) {
    return <></>;
  }

  render() {
    const {...otherProps} = this.props;

    return (
      <BrowserOnly>
        {() => {
          const App = require('../../../../examples/widgets/overlays/example');
          return <App.default {...otherProps} />;
        }}
      </BrowserOnly>
    );
  }
}

export default makeExample(OverlaysDemo);
