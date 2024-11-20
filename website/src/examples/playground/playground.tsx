import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';
import {App} from '../../../../examples/playground/playground/src/app';

import {makeExample} from '../../components';

class AdvancedDemo extends Component {
  static title = 'Playground';

  static code = `${GITHUB_TREE}/examples/playground/playground`;

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
