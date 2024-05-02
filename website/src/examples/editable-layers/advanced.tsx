import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';
import App from '../../../../examples/editable-layers/advanced/src/example';

import {makeExample} from '../../components';

class AdvancedDemo extends Component {
  static title = 'Advanced';

  static code = `${GITHUB_TREE}/examples/editable-layers/advanced`;

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
