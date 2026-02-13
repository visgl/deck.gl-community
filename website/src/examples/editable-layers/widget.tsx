import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';

import {makeExample} from '../../components';

class WidgetDemo extends Component {
  static title = 'Widget';

  static code = `${GITHUB_TREE}/examples/editable-layers/widget`;

  static renderInfo(meta) {
    return <></>;
  }

  render() {
    const {...otherProps} = this.props;

    return (
      <BrowserOnly>
        {() => {
          const App = require('../../../../examples/editable-layers/widget/example');
          return <App.Example {...otherProps} />;
        }}
      </BrowserOnly>
    );
  }
}

export default makeExample(WidgetDemo);
