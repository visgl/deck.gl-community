import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';

import {makeExample} from '../../components';

class HorizonDemo extends Component {
  static title = 'Horizon Graph Layer Demo';

  static code = `${GITHUB_TREE}/dev/timeline-layers/examples/horizon-graph-layer`;

  static renderInfo(meta) {
    return <></>;
  }

  render() {
    const {...otherProps} = this.props;

    return (
      <BrowserOnly>
        {() => {
          const App = require('../../../../dev/timeline-layers/examples/horizon-graph-layer/app').default;
          return <App {...otherProps} />;
        }}
      </BrowserOnly>
    );
  }
}

export default makeExample(HorizonDemo);
