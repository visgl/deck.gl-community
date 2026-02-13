import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';

import {makeExample} from '../../components';

class NoMapDemo extends Component {
  static title = 'No Map';

  static code = `${GITHUB_TREE}/examples/editable-layers/no-map`;

  static renderInfo(meta) {
    return <></>;
  }

  render() {
    const {...otherProps} = this.props;

    return (
      <BrowserOnly>
        {() => {
          const App = require('../../../../examples/editable-layers/no-map/example');
          return <App.Example {...otherProps} />;
        }}
      </BrowserOnly>
    );
  }
}

export default makeExample(NoMapDemo);
