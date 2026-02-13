import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';

import {makeExample} from '../../components';

class GettingStartedDemo extends Component {
  static title = 'Getting Started';

  static code = `${GITHUB_TREE}/examples/editable-layers/getting-started`;

  static renderInfo(meta) {
    return <></>;
  }

  render() {
    const {...otherProps} = this.props;

    return (
      <BrowserOnly>
        {() => {
          const App = require('../../../../examples/editable-layers/getting-started/example');
          return <App.Example {...otherProps} />;
        }}
      </BrowserOnly>
    );
  }
}

export default makeExample(GettingStartedDemo);
