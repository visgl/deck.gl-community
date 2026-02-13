import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';

import {makeExample} from '../../components';

class SfDemo extends Component {
  static title = 'SF Polygons';

  static code = `${GITHUB_TREE}/examples/editable-layers/sf`;

  static renderInfo(meta) {
    return <></>;
  }

  render() {
    const {...otherProps} = this.props;

    return (
      <BrowserOnly>
        {() => {
          const App = require('../../../../examples/editable-layers/sf/example');
          return <App.Example {...otherProps} />;
        }}
      </BrowserOnly>
    );
  }
}

export default makeExample(SfDemo);
