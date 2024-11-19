import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';
import {App} from '../../../../examples/graph-layers/react-graph-gl/app';

import {makeExample} from '../../components';

class AdvancedDemo extends Component {
  static title = 'Advanced';

  static code = `${GITHUB_TREE}/examples/graph-layers/graph-gl`;

  static renderInfo(meta) {
    return <></>;
  }

  render() {
    const {...otherProps} = this.props;

    return (
      <BrowserOnly>
        {() => <App {...otherProps} />}
      </BrowserOnly>
    );
  }
}

export default makeExample(AdvancedDemo);
