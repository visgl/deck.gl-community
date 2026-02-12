import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';

import {makeExample} from '../../components';

class HorizonDemo extends Component {
  static title = 'Horizon Graph Layer Demo';

  static code = `${GITHUB_TREE}/examples/timeline-layers/horizon-graph-layer`;

  static renderInfo(meta) {
    return <></>;
  }

  render() {
    const {...otherProps} = this.props;

    return (
      <BrowserOnly>
        {() => {
          const App = require('../../../../examples/timeline-layers/horizon-graph-layer/app').default;
          return <App {...otherProps} />;
        }}
      </BrowserOnly>
    );
  }
}

export default makeExample(HorizonDemo);
